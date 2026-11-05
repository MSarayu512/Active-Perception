# RunPod deployment for existing LUMEN

**Status:** launch and orchestration tested synthetically, **not tested on RunPod GPUs**. No guarantee of 32k completed output or model accuracy. This retains the existing independent-face aperture-shadow renderer, pixel evidence gate, and UI; it does **not** convert it to an assembled opaque-cube shadow-only experiment. Do not label results as physically validated.

## RunPod instructions

1. Create a **GPU Pod**, not a serverless endpoint, using a current CUDA/PyTorch image with SSH access and persistent volume. Start with **2×80GB NVIDIA GPUs**, or more if necessary. For a single 80GB GPU, VRAM headroom is uncertain. Set `LUMEN_TP=2` for two GPUs. Keep at least ~150GB persistent disk for weights, cache and logs; size depends on selected model and cache. Only one model is loaded at a time.
2. Accept Gemma's license/access requirements on Hugging Face if applicable. Set `HF_TOKEN` through RunPod secrets/environment, never write it to files in the project.
3. Upload/extract this ZIP into `/workspace/lumen`. In a RunPod terminal:

```bash
cd /workspace/lumen
bash runpod/setup.sh
export LUMEN_TP=2
bash runpod/start.sh qwen
# stop with Ctrl-C, then: bash runpod/start.sh gemma
```

4. **Access safely:** forward port 8000 through the RunPod SSH connection using the SSH command shown by RunPod, adding `-L 8000:127.0.0.1:8000`. Then browse `http://127.0.0.1:8000` on your own machine. Do not publish ports 8000 or 8001: LUMEN enforces loopback Host/Origin and does not provide user authentication.

5. Check readiness with `curl -f http://127.0.0.1:8000/api/config` and `curl -f http://127.0.0.1:8001/health` **inside the Pod**. Read `runpod/logs/vllm.log` for CUDA/OOM/model compatibility issues.

## Configuration

`LUMEN_CONTEXT` (default 65536 total context), `LUMEN_TP` (default 1), `LUMEN_GPU_UTIL` (default .85), `LUMEN_REVISION` (optional pinned checkpoint commit), `LUMEN_STARTUP_TIMEOUT` (default 2400 seconds), `HF_TOKEN` (if required). Output request is 32000 tokens. No quantization/offloading is enabled by default. Inference can fail when prompts/images consume too much context or VRAM.

## Recovery and research boundaries

The existing UI saves completed run state under `runs/`. Preserve the Pod volume. The launcher writes logs and launch metadata to `runpod/logs/`. Restarting the launcher does **not** resume a half-generated model response. The existing application lacks a full research-runner pause/resume/activation-capture implementation. The current evidence gate and annotated inputs require independent audit before calling this a strict shadow-only evaluation.
