import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {parseCSV,selectRetries,waitForServerIdle} from '../scripts/batch-recovery.mjs';

test('retry selection excludes success and abstention and parses multiline quoted errors',()=>{
 const rows=parseCSV('face_size,seed,track,outcome,reason\r\n4,101,vision-only,solved,""\r\n4,102,vision-only,abstained,""\r\n8,101,vision-only,infrastructure_failure,"busy, then\nfailed ""again"""\r\n');
 assert.equal(rows[2].reason,'busy, then\nfailed "again"');
 const plan=[{face_size:4,seed:101,track:'vision-only'},{face_size:4,seed:102,track:'vision-only'},{face_size:8,seed:101,track:'vision-only'}];
 assert.deepEqual(selectRetries(plan,rows),[plan[2]]);
});
test('busy server is polled until idle without a model request',async()=>{
 let clock=0,calls=0;
 assert.equal(await waitForServerIdle('http://local',{now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async url=>{
  assert.equal(url,'http://local/api/status');return {ok:true,json:async()=>({active:++calls<3})};
 }}),true);
 assert.equal(calls,3);
});
test('permanently busy and unreachable servers have bounded recovery',async()=>{
 for(const unreachable of [false,true]){
  let clock=0;
  await assert.rejects(waitForServerIdle('http://local',{timeoutMs:10,pollMs:2,now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async()=>{
   if(unreachable)throw Error('offline');return {ok:true,json:async()=>({active:true})};
  }}),/batch stopped/);
  assert.equal(clock,10);
 }
});
test('old servers require restart and cancellation prevents polling',async()=>{
 await assert.rejects(waitForServerIdle('http://local',{fetcher:async()=>({status:404})}),/Restart npm start/);
 assert.equal(await waitForServerIdle('http://local',{cancelled:()=>true,fetcher:()=>{throw Error('must not call');}}),false);
});
test('server releases its busy lock when the client disconnects',{timeout:15000},async t=>{
 const child=spawn(process.execPath,['--import','./tests/fixtures/disconnected-provider.mjs','server.mjs'],{
  cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',LLM_PROVIDER:'openai-compatible',LLM_MODEL:'mock',LLM_API_KEY:'test-only',LLM_BASE_URL:'https://mock.invalid/v1'},stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}});
 const startup=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test server exited');})]);
 const port=String(startup[0]).match(/localhost:(\d+)/)[1],url='http://127.0.0.1:'+port;
 assert.deepEqual(await (await fetch(url+'/api/status')).json(),{active:false});
 const controller=new AbortController();
 const pending=fetch(url+'/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({history:[]}),signal:controller.signal}).catch(e=>e);
 t.after(()=>controller.abort());
 for(let i=0;i<100;i++){
  if((await (await fetch(url+'/api/status')).json()).active)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal((await (await fetch(url+'/api/status')).json()).active,true);
 assert.equal((await fetch(url+'/api/model',{method:'POST',body:'{}'})).status,409);
 controller.abort();await pending;
 assert.equal(await waitForServerIdle(url,{timeoutMs:3000,pollMs:10}),true);
});
