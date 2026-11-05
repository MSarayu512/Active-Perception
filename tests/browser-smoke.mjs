// Optional: npm install --no-save --package-lock=false playwright
// Then: npx playwright install chromium && node tests/browser-smoke.mjs
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'8019'},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));});
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8019');await page.waitForFunction(()=>window.lumenDiagnostics?.().healthy);
 await page.click('#demo');await page.waitForFunction(()=>window.lumenDiagnostics?.().done&&!window.lumenDiagnostics().busy);
 const d=await page.evaluate(()=>window.lumenDiagnostics());assert.equal(d.metrics.coverage,1);assert.equal(d.metrics.accuracy,1);assert(d.result.optimal);assert.equal(d.result.length,d.result.shortest_length);
 await page.click('#explode');await page.selectOption('#face','3');await page.click('#walls');
 const pending=page.waitForEvent('download');await page.click('#export');assert((await pending).suggestedFilename().endsWith('.json'));
 await page.click('#new');await page.waitForFunction(()=>!window.lumenDiagnostics().busy);await page.fill('#u','1');await page.click('#measure');await page.waitForFunction(()=>window.lumenDiagnostics().measurements===1&&!window.lumenDiagnostics().busy);
 assert.equal((await page.request.get('http://127.0.0.1:8019/.env')).status(),404);
 assert.equal((await page.request.get('http://127.0.0.1:8019/api/config',{headers:{Origin:'https://example.com'}})).status(),403);
 // Mock API responses: no provider request or key is required.
 await page.route('**/api/config',route=>route.fulfill({json:{provider:'anthropic',model:'mock-model',configured:true}}));
 let requests=0;
 await page.route('**/api/model',async route=>{requests++;const data=route.request().postDataJSON();assert(!('seed' in data));assert(!('truth_open_edges'in data));assert.equal(data.budget_remaining,null);assert(data.history.at(-1).panels.every(p=>p.lit_fraction>0&&p.lit_region));await new Promise(r=>setTimeout(r,500));await route.fulfill({json:{decision:{type:'measure',light:[1,0,6],confidence:.3,map_updates:[],reason:'test'},model:'mock-model'}});});
 await page.reload();await page.waitForFunction(()=>window.lumenDiagnostics?.().healthy);await page.click('#auto');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Waiting for'));await page.click('#pause');await page.waitForFunction(()=>!window.lumenDiagnostics().busy);assert.equal(requests,1);assert.equal((await page.evaluate(()=>window.lumenDiagnostics())).measurements,2);
 await page.evaluate(()=>document.querySelector('#viewport canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));assert(await page.locator('#step').isDisabled());assert(await page.locator('#auto').isDisabled());
 assert.deepEqual(errors,[]);console.log('Browser smoke passed: demo, exports, capture, controls, pause, context-loss guard and request isolation.');
}finally{await browser?.close();server.kill();}
