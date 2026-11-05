#!/usr/bin/env python3
"""Run one vLLM process plus local-only LUMEN, no public port exposure."""
import argparse, json, os, pathlib, signal, subprocess, sys, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
MODELS={'qwen':'Qwen/Qwen3.5-27B','gemma':'google/gemma-4-31B-it'}

def ready(url):
    try:
        with urllib.request.urlopen(url,timeout=3) as r: return r.status==200
    except Exception: return False

def main():
    p=argparse.ArgumentParser();p.add_argument('--model',choices=MODELS,required=True);p.add_argument('--max-model-len',type=int,default=65536);p.add_argument('--tp',type=int,default=1);p.add_argument('--gpu-util',type=float,default=.85);a=p.parse_args()
    if a.max_model_len<=32000: p.error('Context must exceed output cap (32000)')
    if not 0<a.gpu_util<1: p.error('GPU utilization must be in (0,1)')
    if a.tp<1: p.error('Tensor parallel must be positive')
    gpu=subprocess.run(['nvidia-smi','--query-gpu=index,name,memory.total','--format=csv,noheader'],capture_output=True,text=True)
    if gpu.returncode: sys.exit('GPU check failed: '+gpu.stderr)
    if len(gpu.stdout.strip().splitlines())<a.tp: sys.exit('Not enough visible GPUs for tensor parallel setting')
    if ready('http://127.0.0.1:8001/health') or ready('http://127.0.0.1:8000/api/status'): sys.exit('Existing service detected. Stop it before starting another.')
    checkpoint=MODELS[a.model]
    command=['vllm','serve',checkpoint,'--host','127.0.0.1','--port','8010', '--max-num-seqs', '8', '--tensor-parallel-size',str(a.tp),'--max-model-len',str(a.max_model_len),'--gpu-memory-utilization',str(a.gpu_util),'--dtype','auto']
    if os.getenv('LUMEN_REVISION'): command+=['--revision',os.environ['LUMEN_REVISION']]
    env=os.environ.copy();env.update(LLM_PROVIDER='local-vllm',LLM_MODEL=checkpoint,LLM_BASE_URL='http://127.0.0.1:8001/v1',LLM_MAX_TOKENS='32000',PORT='8000')
    logs=ROOT/'runpod'/'logs';logs.mkdir(exist_ok=True)
    (logs/'launch.json').write_text(json.dumps({'model':checkpoint,'command':command,'gpu':gpu.stdout,'revision':env.get('LUMEN_REVISION','unpinned'),'started':time.time()},indent=2))
    processes=[]
    def shutdown(*_):
        for proc in reversed(processes):
            if proc.poll() is None: proc.terminate()
        for proc in reversed(processes):
            try: proc.wait(timeout=15)
            except subprocess.TimeoutExpired: proc.kill()
    signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)
    try:
        with (logs/'vllm.log').open('a') as vl, (logs/'lumen.log').open('a') as nl:
            model=subprocess.Popen(command,cwd=ROOT,env=env,stdout=vl,stderr=subprocess.STDOUT,start_new_session=True);processes.append(model)
            print('Loading',checkpoint,'; log:',logs/'vllm.log',flush=True)
            deadline=time.monotonic()+int(env.get('LUMEN_STARTUP_TIMEOUT','2400'))
            while time.monotonic()<deadline:
                if model.poll() is not None: sys.exit('vLLM exited early. Inspect runpod/logs/vllm.log')
                if ready('http://127.0.0.1:8001/health'): break
                time.sleep(5)
            else: sys.exit('vLLM readiness timeout; inspect log and VRAM')
            node=subprocess.Popen(['node','server.mjs'],cwd=ROOT,env=env,stdout=nl,stderr=subprocess.STDOUT,start_new_session=True);processes.append(node)
            for _ in range(20):
                if ready('http://127.0.0.1:8000/api/config'): break
                if node.poll() is not None: sys.exit('LUMEN exited; inspect runpod/logs/lumen.log')
                time.sleep(1)
            else: sys.exit('LUMEN readiness timeout')
            print('READY: LUMEN at 127.0.0.1:8000. Access through SSH tunnel; vLLM stays loopback-only.',flush=True)
            while model.poll() is None and node.poll() is None: time.sleep(3)
            sys.exit('Service stopped unexpectedly; check runpod/logs')
    finally: shutdown()
if __name__=='__main__': main()
