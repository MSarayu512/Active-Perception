#!/usr/bin/env python3
"""Launch exactly one supported vision-language model via the official vLLM CLI."""
import argparse, importlib.util, json, os, shutil, subprocess, sys
from pathlib import Path

MODELS = {
    'qwen': ('Qwen/Qwen3.5-27B', 32000),
    'gemma': ('google/gemma-4-31B-it', 32000),
}

def command(args):
    model, output_limit = MODELS[args.model]
    if not 1 <= args.max_model_len <= 262144:
        raise ValueError('Invalid total context length')
    if args.tensor_parallel_size < 1:
        raise ValueError('tensor parallel must be positive')
    if not 0 < args.gpu_memory_utilization <= 1:
        raise ValueError('GPU memory fraction must be in (0,1]')
    if args.max_model_len > 262144:
        raise ValueError('Configured context exceeds the documented native 262144-token context')
    cmd = ['vllm', 'serve', model, '--host', '127.0.0.1', '--port', str(args.port),
           '--tensor-parallel-size', str(args.tensor_parallel_size),
           '--max-model-len', str(args.max_model_len),
           '--gpu-memory-utilization', str(args.gpu_memory_utilization),
           '--dtype', args.dtype]
    if args.revision:
        cmd += ['--revision', args.revision]
    if args.quantization != 'none':
        cmd += ['--quantization', args.quantization]
    return cmd, model, output_limit

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, choices=MODELS)
    parser.add_argument('--port', type=int, default=8001)
    parser.add_argument('--max-model-len', type=int, default=65536)
    parser.add_argument('--tensor-parallel-size', type=int, default=1)
    parser.add_argument('--gpu-memory-utilization', type=float, default=.85)
    parser.add_argument('--dtype', choices=['auto', 'half', 'bfloat16', 'float16', 'float32'], default='auto')
    parser.add_argument('--quantization', choices=['none', 'awq', 'gptq', 'bitsandbytes', 'fp8'], default='none')
    parser.add_argument('--revision')
    parser.add_argument('--preflight', action='store_true')
    args = parser.parse_args()
    cmd, model, output_limit = command(args)
    if args.max_model_len <= output_limit:
        sys.exit('Total context must exceed the requested 32000 output tokens to fit shadow images and prompt')
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,compute_cap', '--format=csv,noheader'], capture_output=True, text=True) if shutil.which('nvidia-smi') else None
    result = {'checkpoint': model, 'revision': args.revision or 'main (unpinned)', 'output_cap_requested': 32000,
              'configured_output_cap': output_limit, 'context_length_configured': args.max_model_len,
              'gpu': gpu.stdout.strip() if gpu and gpu.returncode == 0 else 'unavailable',
              'vllm_installed': bool(shutil.which('vllm')), 'command': cmd,
              'warning': 'GPU execution and memory fit NOT validated by preflight. 32000 output tokens is a request, not a guaranteed generation length. Quantization requires a compatible checkpoint and kernels.'}
    print(json.dumps(result, indent=2), flush=True)
    if args.preflight:
        return
    if not shutil.which('vllm'):
        sys.exit('Install vLLM first: python -m pip install vllm')
    if not gpu or gpu.returncode != 0:
        sys.exit('No NVIDIA GPU detected; refusing expensive model loading')
    os.execvp(cmd[0], cmd)

if __name__ == '__main__':
    main()
