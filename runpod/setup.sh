#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PIP_DISABLE_PIP_VERSION_CHECK=1
if ! command -v nvidia-smi >/dev/null; then echo 'ERROR: NVIDIA GPU unavailable' >&2; exit 2; fi
nvidia-smi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  echo 'Installing Node 22 in user directory'
  ARCH="$(uname -m)"; case "$ARCH" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) exit 2;; esac
  mkdir -p "$HOME/.local/node22"
  curl -fL --retry 3 "https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-${ARCH}.tar.xz" | tar -xJ --strip-components=1 -C "$HOME/.local/node22"
  export PATH="$HOME/.local/node22/bin:$PATH"
fi
node --version
npm install --no-audit --no-fund --omit=optional
if ! command -v vllm >/dev/null; then
  echo 'Installing vLLM in current Python environment; check CUDA/PyTorch compatibility first'
  python -m pip install -U vllm
fi
vllm --version
node --test tests/local-model.test.mjs tests/checkpoints.test.mjs tests/research.test.mjs
printf '\nSetup complete. Start using: bash runpod/start.sh qwen (or gemma)\n'
