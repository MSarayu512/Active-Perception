import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generate, topology, faceWalls, shortestPath, edgeKey } from '../src/maze.js';
import { shadowPixels } from '../src/shadows.js';
import { baselineDecision, mergeClaims, MIN_READ_RESOLUTION } from '../src/pixel-baseline.js';
import { Experiment } from '../src/experiment.js';
import { buildMessages, parseDecision } from '../server.mjs';

const FACES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
// Transport fixture only: these tests exercise raw shadow pixels, not browser PNG encoding.
const TEST_PNG = 'data:image/png;base64,YQ==';

function capture(maze, light, resolution = MIN_READ_RESOLUTION) {
  return FACES.map((face, index) => {
    const result = shadowPixels(THREE, faceWalls(maze, index), maze.size, light, resolution);
    return {
      face,
      pixels: result.data,
      dark_fraction: result.darkFraction,
      lit_fraction: result.litFraction,
      lit_region: result.lit_region
    };
  });
}

function observation(output, step, light, resolution = MIN_READ_RESOLUTION) {
  return {
    step,
    light: [...light],
    resolution,
    panels: output.map(({ face, dark_fraction, lit_fraction, lit_region }) => ({
      face,
      png: TEST_PNG,
      model_png: TEST_PNG,
      dark_fraction,
      lit_fraction,
      lit_region
    }))
  };
}

test('end-to-end free pixel run captures six faces, reconstructs the maze, and solves optimally', () => {
  const maze = generate(3, 7);
  const graph = topology(maze.size);
  const experiment = new Experiment(maze, {
    model: 'pixel-baseline-test',
    track: 'pixel-baseline'
  });

  let claims = new Map();
  let light = [0, 0, 6];
  let decision;
  let step = 0;

  while (!experiment.done && step < 20) {
    step++;
    const output = capture(maze, light);
    assert.equal(output.length, 6);
    assert(output.every(panel => panel.pixels.length === MIN_READ_RESOLUTION ** 2 * 4));
    assert(output.every(panel => panel.lit_fraction > 0));

    experiment.recordObservation(observation(output, step, light), 0.01);
    decision = baselineDecision(
      graph,
      output.map(panel => panel.pixels),
      MIN_READ_RESOLUTION,
      experiment.start,
      experiment.goal,
      light,
      claims
    );
    claims = mergeClaims(claims, decision.map_updates);

    if (decision.type === 'measure') {
      experiment.apply(decision, { measured: true });
      light = decision.light;
    } else {
      experiment.apply(decision);
    }
  }

  assert.equal(experiment.done, true);
  assert.equal(experiment.result.status, 'answered');
  assert.equal(experiment.result.valid, true);
  assert.equal(experiment.result.optimal, true);
  assert.equal(experiment.metrics().coverage, 1);
  assert.equal(experiment.metrics().accuracy, 1);
  assert.equal(experiment.observations.length, step);
  assert.equal(experiment.decisions.length, step);

  const record = experiment.record();
  assert.equal(record.backend, 'threejs-exact-face-shadows');
  assert.equal(record.result.optimal, true);
  assert.equal(record.observations.length, step);
  assert.equal(record.truth_open_edges.length, maze.open.size);
});

test('end-to-end model boundary preserves calibrated observations and accepts a sparse decision', () => {
  const maze = generate(3, 19);
  const graph = topology(maze.size);
  const experiment = new Experiment(maze, { track: 'vision-only' });
  const light = [1, -1, 8];
  const output = capture(maze, light);

  experiment.recordObservation(observation(output, 1, light), 0.25);
  const input = experiment.input();
  const serialized = JSON.stringify(input);

  assert.equal(input.history.length, 1);
  assert.equal(input.history[0].panels.length, 6);
  assert(input.history[0].panels.every(panel => panel.lit_fraction > 0));
  assert(!serialized.includes('truth_open_edges'));
  assert(!serialized.includes('"seed"'));
  assert(!serialized.includes('"accuracy"'));

  const messages = buildMessages(input, 'anthropic');
  assert.equal(messages.length, 13);
  assert.equal(messages.filter(part => part.type === 'image').length, 6);
  assert.equal(messages[0].type, 'text');

  const readable = input.history[0].readable_edge_ids;
  assert(readable.length > 0 && readable.length < graph.edges.length);
  const sparse = Object.fromEntries(readable.slice(0, 2).map(id => [
    String(id),
    maze.open.has(edgeKey(graph.edges[id].a, graph.edges[id].b)) ? 'O' : 'C'
  ]));
  const providerText = JSON.stringify({
    type: 'measure',
    control: [0, 0, 6],
    confidence: 0.4,
    reason: 'Inspect another region',
    edge_states_sparse: sparse
  });
  const decision = parseDecision(`Here is the next decision:\n${providerText}`);
  const normalized = experiment.normalize(decision);
  assert.deepEqual(normalized.light, [0, 0, 6]);
  const nextOutput = capture(maze, normalized.light);
  experiment.recordObservation(observation(nextOutput, 2, normalized.light), 0.25);
  experiment.apply(normalized, { measured: true });
  assert.equal(experiment.observations.length, 2);
  assert.equal(experiment.map.size, Object.keys(sparse).length);
  assert.equal(experiment.done, false);
});

test('end-to-end autonomous run pauses on abstention and resumes without losing progress', () => {
  const maze = generate(2, 7);
  const experiment = new Experiment(maze, { model: 'resume-test' });
  const path = shortestPath(maze, experiment.start, experiment.goal);

  experiment.recordObservation({ step: 1, light: [0, 0, 6], panels: [] }, 0.1);
  const edge = maze.edges[0];
  const claim = maze.open.has(edge.key) ? 'O' : 'C';
  experiment.apply({
    type: 'abstain',
    confidence: 0.2,
    reason: 'Need another observation',
    edge_states_sparse: {0: claim}
  });

  assert.equal(experiment.done, false);
  assert.equal(experiment.result, null);
  assert.equal(experiment.stop.reason, 'model_uncertain_paused');
  assert.equal(experiment.observations.length, 1);
  assert.equal(experiment.reconstructionSparse()[0], claim);

  experiment.recordObservation({ step: 2, light: [0, 0, 8], panels: [] }, 0.1);
  experiment.apply({
    type: 'answer',
    path,
    confidence: 0.8,
    reason: 'Route is now supported',
    edge_states_sparse: {}
  });

  assert.equal(experiment.done, true);
  assert.equal(experiment.result.valid, true);
  assert.equal(experiment.result.optimal, true);
  assert.equal(experiment.stop.reason, 'model_answered');
  assert.equal(experiment.stop.budget_unused, null);
  assert.equal(experiment.observations.length, 2);
  assert.equal(experiment.decisions.length, 2);
  assert.equal(experiment.reconstructionSparse()[0], claim);
});
