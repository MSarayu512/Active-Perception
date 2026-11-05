# Qwen 3.5 27B / Gemma 4 31B — LUMEN integration

The original LUMEN shadow renderer, UI, experiment loop, and prior results are retained. This release corrects the previous **wrong checkpoint generations**. Both checkpoints accept images and are instruction/post-trained models, not raw base checkpoints.

| Selection | Exact Hugging Face checkpoint | Parameters | Native total context | Requested output cap |
|---|---|---|---|---|
| `qwen` | `Qwen/Qwen3.5-27B` | 27B | 262144 | 32000 |
| `gemma` | `google/gemma-4-31B-it` | 30.7B (~31B) | 262144 | 32000 |

Sources: https://huggingface.co/Qwen/Qwen3.5-27B and https://huggingface.co/google/gemma-4-31B-it . The 32000-token value is a **requested maximum generation length**, not a guarantee that a model or backend will generate that many tokens; the vLLM runtime may impose further constraints. Total context also includes multimodal input tokens, prompt and prior history. We default to 65536 total context to leave space for input; memory use increases with context. Do not equate output tokens with context.

## RunPod / local NVIDIA Linux

Install Node 22+ and a recent vLLM build with Qwen3.5 and Gemma4 multimodal support (verify with `vllm --version` and the current supported-model list). Before loading any weights:

```bash
npm install
python -m pip install -U vllm
python local_models/launch.py --model qwen --preflight
python local_models/launch.py --model gemma --preflight
```

Start **one** model server, in its own terminal:

```bash
python local_models/launch.py --model qwen --max-model-len 65536
# OR (stop the Qwen process first)
python local_models/launch.py --model gemma --max-model-len 65536
```

Start LUMEN in a second terminal, matching the selected model:

```bash
LLM_PROVIDER=local-vllm LLM_MODEL=Qwen/Qwen3.5-27B LLM_BASE_URL=http://127.0.0.1:8001/v1 LLM_MAX_TOKENS=32000 npm start
# OR
LLM_PROVIDER=local-vllm LLM_MODEL=google/gemma-4-31B-it LLM_BASE_URL=http://127.0.0.1:8001/v1 LLM_MAX_TOKENS=32000 npm start
```

The existing browser interface is served on port 8000. Use an authenticated SSH tunnel (`ssh -L 8000:127.0.0.1:8000 user@host`) rather than exposing the local model server. For Kaggle, run server/client inside the notebook runtime; localhost is not directly accessible from your laptop. Verify accelerator VRAM first: BF16 weights alone are roughly 54 GB for Qwen and 62 GB for Gemma, **before** KV cache, vision, and runtime overhead. No automatic CPU/disk offloading is configured; tensor parallelism and quantization require validated hardware/checkpoints. Run the preflight and check vLLM logs.

## Tests

```bash
node --test tests/local-model.test.mjs tests/checkpoints.test.mjs
npm test
```

Local tests use a **synthetic mocked vLLM endpoint**; they do not verify model weights, GPU loading, shadow accuracy or reasoning quality. Existing renderer uses independent face receivers, not a fully assembled opaque-cube optical model. Local vLLM API does not expose activations or token IDs. No streaming, mid-generation pause, or checkpointed generation resume is implemented. Existing pixel-evidence gate remains unchanged. The model revision defaults to `main`; pin `--revision` for reproducibility.
