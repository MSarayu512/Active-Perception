# Lumen — maze perception lab

A connected maze wraps around the six surfaces of a cube. Choose the number of cells **per side**, observe its shadows, and reconstruct the passages needed to find a shortest route. This is a surface maze, not a maze inside a solid cube.

## Run

Node.js 22.9 or newer:

```sh
npm ci
npm start
```

Open [localhost:8000](http://localhost:8000). Enter a size and seed, then select **Create maze**. **Reconstruct from shadows** runs the deterministic pixel reader without credentials. **Run model · paid** uses your configured vision provider. Observation controls, model settings, exports, and reconstruction details are expandable; the maze is the main view.

## Seeded model batches

[seeded-runs.csv](seeded-runs.csv) defines the 20 runs per configured model:
face sizes 4, 6, 8 and 10, with seeds 101–105. Seed 101 at each size is the pilot.
The default track is images only (`vision-only`). Each run allows 30 model-call
attempts, 30 minutes, 3 consecutive provider/network failures, or 5 consecutive
rejected answers. Abstention ends that run. Rejected answers receive the existing
evidence feedback on the next call; the runner does not repair their routes.

Install the browser tooling once:

```sh
npm install --no-save playwright
npx playwright install chromium
```

Start the configured local server in one terminal:

```sh
npm start
```

In another terminal, from this project folder:

```sh
# Inspect the matrix without a browser or any paid requests
node scripts/batch-run.mjs --dry-run
# Four pilot runs (paid, using the server's configured model)
node scripts/batch-run.mjs --pilot
# All twenty runs (paid)
node scripts/batch-run.mjs
```

To retry only infrastructure failures, restart the updated server first and use
the original batch's results file:

```sh
node scripts/batch-run.mjs --retry-from batch-results/2026-10-29T14-41-22-386Z/results.csv --dry-run
node scripts/batch-run.mjs --retry-from batch-results/2026-10-29T14-41-22-386Z/results.csv
```

Retries start fresh for those size/seed combinations and are saved in a new
timestamped folder. Solved and abstained rows are excluded, and the configured
model/provider must match. Keep the original results for provenance; the new
settings record the source CSV. A different batch can be selected with its path.
The runner checks `/api/status` before requests and waits up to 150 seconds for
busy or temporarily unreachable servers. HTTP 409 is retried after readiness
polling (still counting toward the attempt limit). If readiness recovery or a
browser operation fails, the batch stops instead of cascading through later
seeds. Unstarted seeds have no result row. A client disconnect cancels the
server's outgoing request; this does not guarantee cancellation or no billing
at the provider. Do not run model calls in other tabs during the batch.

Use `--headed` to see the browser, `--url http://127.0.0.1:PORT` for a custom
server port, or `--out batch-results/my-model-01` for a new output directory.
Existing output directories are refused to protect results. To compare another
model, change the server configuration, restart it, and run a separate batch.
Do not run another model session against the same server during a batch.

Each batch saves settings, full per-run JSON records after decisions, and
`results.csv` after each run. CSV includes outcomes, metrics, timing, reported
token usage and limits. Unknown token usage stays blank; failed requests may
have unreported usage. Outcomes distinguish solved, abstained, limit reached,
validation failure, infrastructure failure and interruption. A 502 or network
failure counts toward the three-failure cutoff and the total attempt limit.

The time cutoff prevents starting further decisions; an in-flight request and
capture are allowed to finish, so elapsed time can exceed 30 minutes by one step.
Ctrl+C stops after the current step and saves results. Interrupted run JSON is
preserved, but importing it to resume a run is not implemented. Rerunning starts
a new batch; a full batch also repeats pilot seeds. Keep pilot and final results
separate when reporting comparisons. Limit outcomes live in the batch CSV, not
the app's original `stop` field.

## Dimensions and practical limits

The size is an integer N ≥ 2, with no fixed 8×8 ceiling. Every face has N×N cells: 6N² cells and 12N² candidate connections in total, including cube seams. All six faces use the same dimension. The implementation checks safe integer arithmetic; it does not promise unlimited physical capacity.

Capture resolution scales as `max(512, ceil(51.2 × (N + 2)))`, preserving pixel density instead of squeezing larger mazes into the old fixed image. Maximum lamp height is `max(16, 2N)`. Camera clipping range and observer lighting also scale.

Large mazes require substantially more memory and computation. The renderer, browser canvas limits, model context/image limits, and local server's 96 MiB request limit still apply. Very large inputs may fail or exhaust available resources; there is no claim that every numerical size is practical. Capture failures pause work rather than fabricate observations. Full reconstruction is regression-tested through size 12, not at every possible size.

## Measurement geometry

There is one centered point lamp outside each face, at local position `[0, 0, height]`. A canopy one unit above each face has a square opening of side `0.45N`. A measurement uses:

```json
{"type":"measure","control":[0.5,-0.5,6],"confidence":0.4,"reason":"Observe unresolved passages","edge_states_sparse":{}}
```

The first two values move the **aperture**, not the lamp. Positive u moves right; positive v moves up toward row zero. Both lie within −N to +N. Height ranges from 3 to the size-dependent maximum. All six faces share this local setting; independent per-face lamp positioning is not implemented.

Every capture produces six receivers from exact Three.js ray/box intersections. The receiver includes a one-cell outer margin for seam shadows. Outside the illuminated patch, darkness means **unlit**, not a closed passage. Model images add a 48-pixel annotation margin and public grid/edge labels. The observer's decorative 3D lighting is separate from measurement optics.

## Evidence policy: observations before claims

The browser uses [Evidence](src/evidence.js) to check accepted decisions against captured raw pixels and public topology. The gate receives no hidden wall list or true passage map.

1. Capture six complete RGBA receivers at sufficient resolution.
2. Read only geometrically readable edge samples. Mixed samples and disagreement between the two sides of a seam remain unknown.
3. Accumulate pixel readings with their observation step and control.
4. Reject a proposed open/closed claim unless it matches captured evidence. For measurement/abstention decisions, omit rejected updates but retain supported updates and allow the action to proceed. Log rejected edges/reasons and send them as validation feedback on the next model request. Never supply replacement wall labels. Conflicting observations invalidate the edge; it stays unresolved for that run.
5. Require every answer-route passage to be both claimed open and supported by non-conflicting pixel evidence.
6. Certify shortest length only if an optimistic graph—treating all unresolved passages as potentially open—cannot offer a shorter route.
7. Pause on rejected answers, invalid decisions, or capture failures. Unsupported updates alone do not block a valid request for another observation. Never substitute hidden truth or silently repair an unsupported answer.

This makes unsupported claims rejectable; **it cannot prove that an LLM internally perceived rather than guessed**. The calibrated pixel reader is itself a synthetic-image estimator, not an infallible physical sensor. Its assumptions and performance must be revalidated if optics, noise, wall dimensions, or capture formats change.

The UI modes are:
- **Images only · verified**: the model gets calibrated images; its claims are checked by the pixel gate.
- **Images + pixel readings**: the model also gets deterministic readings.
- **Reconstruct from shadows**: deterministic reader and next-observation planner, no LLM.

Because both model modes now use a pixel acceptance gate, images-only runs are **not the previous ungated vision-only benchmark**. Existing exported track identifiers are retained for compatibility; new exports include `evidence.policy = "pixel-evidence-gated"`. Do not pool these results with earlier ungated runs.

## Iteration and task

The model receives the public candidate-edge list, start/goal cells, optical calibration, its accumulated claims, the latest eight observations, and the latest sixteen decisions. It does not receive the seed, maze truth, observer screenshots, or grading accuracy.

Cells use `FACE:row:column`, for example `+X:0:1`. Faces are `+X, -X, +Y, -Y, +Z, -Z`. The task currently starts at `+X:0:0` and ends at `-Z:N-1:N-1`; there is no arbitrary-task editor.

Sparse claims map candidate-edge indices to `O` (open), `C` (closed), or `?` (no new evidence). Explicit `map_updates` with state `unknown` retract a claim. The older `light` alias for `control` and positional edge strings remain supported.

A model can request another measurement, submit an answer path, or abstain. In autonomous mode, abstention pauses with progress retained; a positive optional capture limit enables bounded mode. Pause takes effect after the current model call and requested capture. Reloading starts a new episode; importing/resuming an exported run is not implemented.

## Configuration

Create a local `.env` (never share it):

```dotenv
LLM_PROVIDER=anthropic
LLM_BASE_URL=https://api.anthropic.com/v1
LLM_MODEL=YOUR_ACCOUNT_MODEL_ID
LLM_API_KEY=YOUR_KEY
LLM_MAX_TOKENS=32000
PORT=8000
```

Alternatively use `LLM_PROVIDER=openai-compatible` with the endpoint's HTTPS `/v1` base URL. The output token budget defaults to 32,000 (also the server maximum). The provider prompt requests sparse updates, at most 256 observed edges per reply, without repeating unchanged claims. Your provider model must support the configured token budget. Restart the server after configuration changes. No credentials are needed for the pixel demo or tests.

## Tests

```sh
npm test
npm run test:coverage
```

- [Core tests](tests/core.test.mjs): topology, walls, optical controls, route scoring, decision formats, metrics, timing, and history limits.
- [Maze-view tests](tests/maze-view.test.mjs): actual Three.js scene geometry, face placement, walls, routes across seams, texture cropping, camera controls, and resource cleanup.
- [Perception tests](tests/perception.test.mjs): production-resolution reconstruction at sizes 2–9 and 12 with seeds 1, 7, 19; evidence rejection and conflicts; fractional/corner captures; independent wall and seam fixtures; topology at sizes 16 and 32.
- [Module integration tests](tests/end-to-end.test.mjs): reconstruction loop, model-content assembly, and pause/resume. Transport images here are fixtures, not encoded PNGs.

The broader reconstruction matrix takes longer than the small core suite. Passing tests do not establish correctness for every size, seed, control, browser, or live model.

Optional actual browser/worker/PNG rendering checks:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:render
```

[The maze render check](tests/maze-render.mjs) runs a provider-free reconstruction, captures a size-12 maze, and writes screenshots into a temporary directory for visual inspection. Autosaves are intercepted so test runs do not pollute research records. It checks execution and basic layout, not pixel-perfect visual equivalence across GPUs.

## Records and evaluation

The local server autosaves runs under `runs/<uuid>.json`. JSON exports include observations, decisions, image-derived evidence provenance/conflicts, errors, timing, and hidden truth for offline grading. CSV exports summarize metrics. Coverage, labeled-edge accuracy, open-edge F1, valid routes, and shortest routes are distinct measures; reported model confidence is not measured accuracy.

```sh
npm run report
npm run mock -- 4 7 auto greedy
```


## Main modules

- [maze.js](src/maze.js): topology, seeded generation, walls, BFS, grading.
- [shadows.js](src/shadows.js): calibrated optics, size-dependent resolution/heights, ray occlusion.
- [pixel-baseline.js](src/pixel-baseline.js): conservative readings and next-observation planner.
- [evidence.js](src/evidence.js): image-derived acceptance gate and provenance.
- [experiment.js](src/experiment.js): experiment state, claims, metrics, serialization.
- [view.js](public/view.js): Three.js maze and route visualization.
- [app.js](public/app.js): captures, evidence validation, model loop, exports.
- [server.mjs](server.mjs): local serving, provider adapter, autosave.
