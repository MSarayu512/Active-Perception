// Optional real-render check: npm run test:render. No API calls or saved research runs.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',LLM_MODEL:'',LLM_API_KEY:''},stdio:['ignore','pipe','pipe']});
let browser;
let serverErrors='';server.stderr.on('data',chunk=>{serverErrors+=chunk;});
try{
 const startup=await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`Server exited ${code}: ${serverErrors}`)));});
 const port=String(startup).match(/localhost:(\d+)/)[1];
 browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 const records=[];
 await page.route('**/api/save',route=>{records.push(route.request().postDataJSON());return route.fulfill({json:{saved:true}});});
 await page.route('**/api/model',()=>{throw Error('Rendering checks must never call a paid provider');});
 await page.goto(`http://127.0.0.1:${port}`);
 await page.waitForFunction(()=>window.lumenDiagnostics?.().healthy&&!window.lumenDiagnostics().busy);
 assert.equal(await page.locator('#viewport canvas').count(),1);
 await page.click('#demo');
 await page.waitForFunction(()=>window.lumenDiagnostics().done&&!window.lumenDiagnostics().busy);
 const result=await page.evaluate(()=>window.lumenDiagnostics());
 assert.equal(result.metrics.coverage,1);assert.equal(result.result.optimal,true);
 assert.equal(records.at(-1).evidence.policy,'pixel-evidence-gated');
 const shots=await mkdtemp(path.join(tmpdir(),'lumen-render-'));
 await page.screenshot({path:path.join(shots,'maze-and-shadows.png')});
 // A size above the former ceiling, with a tall off-centre capture.
 await page.fill('#size','12');await page.click('#new');
 await page.waitForFunction(()=>!window.lumenDiagnostics().busy&&window.lumenDiagnostics().measurements===0);
 await page.getByText('Observation controls',{exact:true}).click();
 await page.fill('#u','5');await page.fill('#v','-5');await page.fill('#height','24');
 await page.click('#measure');
 await page.waitForFunction(()=>!window.lumenDiagnostics().busy&&window.lumenDiagnostics().measurements===1);
 const capture=records.at(-1).observations[0];
 assert.equal(capture.resolution,717);assert.equal(capture.panels.length,6);
 assert(capture.panels.every(p=>p.png.startsWith('data:image/png;base64,')&&p.lit_fraction>0));
 await page.selectOption('#face','4');await page.click('#explode');
 await page.screenshot({path:path.join(shots,'12-cell-faces.png')});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Regression: an unsupported claim must not block a requested observation,
 // and the next model request must explain that rejection. No real API calls.
 await page.route('**/api/config',route=>route.fulfill({json:{configured:true,model:'mock',provider:'anthropic'}}));
 await page.unroute('**/api/model');
 let calls=0;
 await page.route('**/api/model',route=>{
  const input=route.request().postDataJSON();calls++;
  if(calls===1)return route.fulfill({json:{decision:{type:'measure',control:[0,0,6],confidence:.5,edge_states_sparse:{0:'O'}}}});
  assert.equal(input.measurements_taken,2);
  assert(input.validation_feedback.some(f=>f.type==='claims_rejected'&&f.claims.some(c=>c.reason==='not_observed_clearly')));
  assert.deepEqual(input.reconstruction,{});
  return route.fulfill({json:{decision:{type:'abstain',confidence:0,reason:'Need a different observation'}}});
 });
 await page.reload();
 await page.waitForFunction(()=>window.lumenDiagnostics?.().healthy&&!window.lumenDiagnostics().busy);
 await page.click('#auto');
 await page.waitForFunction(()=>!window.lumenDiagnostics().busy&&window.lumenDiagnostics().stop?.reason==='model_uncertain_paused');
 assert.equal(calls,2);assert.equal((await page.evaluate(()=>window.lumenDiagnostics())).measurements,2);
 assert(records.at(-1).evidence.feedback.some(f=>f.type==='claims_rejected'));
 assert.deepEqual(errors,[]);
 console.log(`Maze render passed: actual worker captures, PNG encoding, evidence-gated demo, 12-cell faces, responsive layout. Screenshots: ${shots}`);
}finally{await browser?.close();server.kill();}
