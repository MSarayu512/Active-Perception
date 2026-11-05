import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {buildMessages} from '../server.mjs';

const image='data:image/png;base64,iVBORw0KGgo=';
test('local adapter passes labeled shadow PNGs and public metadata only',()=>{
 const content=buildMessages({history:[{step:1,light:[0,0,6],panels:[{face:'+X',png:image}]}],candidate_edges:['a|b']},'local-vllm');
 assert.equal(content[1].type,'text');assert.equal(content[2].image_url.url,image);
 assert.ok(!JSON.stringify(content).includes('hidden_wall'));
});
test('synthetic vLLM response reaches existing LUMEN endpoint and records raw text',async()=>{
 const mock=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const input=JSON.parse(body);
  assert.equal(input.model,'google/gemma-4-31B-it');
  assert.equal(input.max_tokens,32000);
  assert.equal(input.messages[1].content[2].type,'image_url');
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({model:input.model,choices:[{message:{content:'{"type":"abstain","confidence":0.1,"reason":"uncertain","edge_states_sparse":{}}'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:22}}));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const mockPort=mock.address().port;
 const port=18000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),LLM_PROVIDER:'local-vllm',LLM_MODEL:'google/gemma-4-31B-it',LLM_BASE_URL:`http://127.0.0.1:${mockPort}/v1`,LLM_MAX_TOKENS:'32000'},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/config`);if(r.ok){ready=true;break;}}catch{}await delay(50);}
  assert.equal(ready,true,'LUMEN server started');
  const r=await fetch(`http://127.0.0.1:${port}/api/model`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({history:[{step:1,light:[0,0,6],panels:[{face:'+X',png:image}]}]})});
  const payload=await r.json();assert.equal(r.status,200,JSON.stringify(payload));
  assert.equal(payload.decision.type,'abstain');assert.equal(payload.usage.completion_tokens,22);
  assert.match(payload.generated_text,/uncertain/);
 }finally{child.kill();await new Promise(resolve=>mock.close(resolve));}
});
