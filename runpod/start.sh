#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node22/bin:$PATH"
MODEL="${1:-qwen}"
case "$MODEL" in
 qwen) CHECKPOINT='Qwen/Qwen3.5-27B';;
 gemma) CHECKPOINT='google/gemma-4-31B-it';;
 *) echo 'Usage: bash runpod/start.sh qwen|gemma' >&2; exit 2;;
esac
if ! command -v vllm >/dev/null; then echo 'vLLM missing; run bash runpod/setup.sh' >&2; exit 2; fi
if ! command -v nvidia-smi >/dev/null; then echo 'NVIDIA GPU missing' >&2; exit 2; fi
if [ -z "${HF_TOKEN:-}" ] && [ "$MODEL" = gemma ]; then echo 'Gemma may require Hugging Face license acceptance and HF_TOKEN.' >&2; fi
mkdir -p runpod/logs
exec python runpod/supervise.py --model "$MODEL" --max-model-len "${LUMEN_CONTEXT:-65536}" --tp "${LUMEN_TP:-1}" --gpu-util "${LUMEN_GPU_UTIL:-0.85}"
