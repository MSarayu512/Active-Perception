# Research extension — implementation status and experiment contract

This incremental extension adds an initial five-seed benchmark configuration, public-input isolation preflight, probabilistic claim scoring, transitions, and tests. **It is not yet an end-to-end local-model research runner.** The original browser, API server, deterministic pixel baseline and batch runner remain in place.

## Critical physical limitation

`src/shadows.js` renders each face independently in local coordinates. The lamp is centered above *each face* and only the square canopy aperture moves laterally. `src/maze.js` describes a connected six-face surface graph, but the shadow observations are NOT from one assembled opaque cube. This is an idealized multi-face measurement apparatus, not a validated physical opaque-cube simulator. No claims of physical correctness or recoverability are warranted.

## Data boundary

`Experiment.input()` exposes `benchmark`, `run_policy`, `measurements_taken`, `track`, `size`, six face names, candidate adjacency strings and their indexing convention, start/goal/task, remaining budget, public optics geometry, prior reported reconstruction, unread count, recent observation history (including six face shadow panels and publicly computed readability IDs), and recent decisions without evaluation metrics. The evaluator-only `Experiment.record()` contains maze seed, truth edges and evaluation results and MUST NOT be passed to a model. `readable_edge_ids` is a geometric visibility mask, not the passage labels. In `vision-only` mode, pixel-derived ground-truth-like aids must remain disabled. Prior model decisions are included; evaluation feedback must not be included. Preserve observation image hashes and actual payload snapshots before making comparative claims.

## Reproducibility and execution

`node scripts/research-preflight.mjs --save` validates the initial 3x3/five-seed configuration and writes a timestamped manifest. `node --test tests/research.test.mjs` runs synthetic structural tests. For the existing browser, install Node.js 22+, restore the project's package manifest and Three.js dependency if missing, configure `.env` locally and run `node server.mjs`. The original `README.md` documents the existing browser and batch workflow. This uploaded archive does not contain `package.json` or `package-lock.json`; `npm ci` cannot work until those are restored.

The original model API endpoint is Anthropic Messages or OpenAI-compatible Chat Completions and defaults to 32,000 *requested output tokens*. This is not a context-window guarantee. Model-specific support for `max_completion_tokens`, seeds, reasoning outputs, image input, and actual output limits must be checked against official provider documentation per exact checkpoint before execution. Existing server uses no seed parameter. A `reason` field is a decision explanation, NOT private chain-of-thought. API raw reasoning and activations are unavailable unless explicitly returned. Existing save endpoint stores full records but does not resume an interrupted generation.

## Not yet implemented / requires validation

Verified Qwen ~27B and Gemma ~31B checkpoint loading, CUDA memory/offload checks, local token streaming, activation hooks, LoRA/QLoRA training, seed-disjoint activation probing, provider-specific reasoning provenance, exact payload/image hashing per call, runner pause/resume, Kaggle notebook, RunPod UI, claim-map visualization and end-to-end GPU validation are not implemented. Do not interpret this scaffold as evidence that these systems run. The original browser's own controls are not a substitute for the requested research monitor. Avoid training on evaluation maze seeds. Never attach an untrained adapter and call it an improvement.

## Security

Keep `.env` out of distributed archives, do not commit tokens, and do not send `Experiment.record()` to any model. Do not automatically retry provider failures. Existing experimental results must be retained separately from new manifests.
