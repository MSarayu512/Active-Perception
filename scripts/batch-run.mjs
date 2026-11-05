// Drives the production UI: identical annotated images, evidence gate and provider payload.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCSV,selectRetries,waitForServerIdle} from './batch-recovery.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+name);return args[i+1];};
const planFile=value('--plan')||path.join(root,'seeded-runs.csv');
const lines=(await readFile(planFile,'utf8')).trim().split(/\r?\n/);
const headers=lines.shift().split(',');
let plan=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v])));
for(const row of plan){
 for(const name of ['face_size','seed','max_model_calls','max_elapsed_minutes','max_consecutive_network_failures','max_consecutive_rejected_answers']){
  row[name]=Number(row[name]);if(!Number.isSafeInteger(row[name])||row[name]<1)throw Error('Invalid '+name);
 }
 if(row.face_size<2||!['vision-only','pixel-assisted'].includes(row.track)||row.stop_on_abstain!=='true')throw Error('Unsupported plan settings');
}
if(args.includes('--pilot'))plan=plan.filter(r=>r.pilot==='true');
const retryFrom=value('--retry-from');
const priorRows=retryFrom?parseCSV(await readFile(retryFrom,'utf8')):[];
if(retryFrom)plan=selectRetries(plan,priorRows);
if(!plan.length)throw Error('No runs selected');
if(args.includes('--dry-run')){console.table(plan);console.log(plan.length+' runs; no provider calls made.');process.exit(0);}
const url=value('--url')||'http://127.0.0.1:8000';
const configResponse=await fetch(url+'/api/config',{signal:AbortSignal.timeout(5000)});
if(!configResponse.ok)throw Error('Cannot read local server configuration');
const config=await configResponse.json();
if(!config.configured)throw Error('Configure the server model and credentials before running a batch');
if(retryFrom&&priorRows.some(r=>r.outcome==='infrastructure_failure'&&plan.some(p=>p.face_size===Number(r.face_size)&&p.seed===Number(r.seed)&&p.track===r.track)&&(r.model!==config.model||r.provider!==config.provider)))throw Error('Retry model/provider must match the original failed runs.');
await waitForServerIdle(url);
let chromium;
try{({chromium}=await import('playwright'));}catch{throw Error('Install browser tooling first: npm install --no-save playwright && npx playwright install chromium');}
const output=path.resolve(value('--out')||path.join(root,'batch-results',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(path.dirname(output),{recursive:true});
await mkdir(output); // Refuse an existing directory so prior results are never overwritten.
await writeFile(path.join(output,'settings.json'),JSON.stringify({config,plan,retry_source:retryFrom?path.resolve(retryFrom):null,started_at:new Date().toISOString()},null,2));
const results=[];
const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
async function saveResults(){
 if(!results.length)return;
 const keys=Object.keys(results[0]);
 await writeFile(path.join(output,'results.csv'),[keys.map(csv).join(','),...results.map(row=>keys.map(k=>csv(row[k])).join(','))].join('\n')+'\n');
}
const browser=await chromium.launch({headless:!args.includes('--headed'),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let interrupted=false,haltBatch=false;
process.on('SIGINT',()=>{interrupted=true;console.log('Stopping after the current decision and saving progress…');});
try{
 for(const settings of plan){
  if(interrupted||haltBatch)break;
  try{if(!await waitForServerIdle(url,{cancelled:()=>interrupted}))break;}
  catch(error){console.error(error.message);process.exitCode=1;break;}
  const page=await browser.newPage();
  page.setDefaultTimeout(150000);
  let record=null,outcome='infrastructure_failure',reason='',networkFailures=0,rejections=0,attempts=0,started=Date.now();
  page.on('request',request=>{
   if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/save'){
    try{record=request.postDataJSON();}catch{}
   }
  });
  try{
   await page.goto(url);
   await page.waitForFunction(()=>window.lumenDiagnostics?.().healthy&&!window.lumenDiagnostics().busy);
   await page.locator('#size').fill(String(settings.face_size));
   await page.locator('#seed').fill(String(settings.seed));
   await page.locator('summary').filter({hasText:'Model & run settings'}).click();
   await page.locator('#budget').fill('');
   await page.locator('#track').selectOption(settings.track);
   await page.locator('#new').click();
   await page.waitForFunction(()=>!window.lumenDiagnostics().busy);
   started=Date.now();
   console.log(config.model+' size='+settings.face_size+' seed='+settings.seed);
   for(;;){
    if(interrupted){outcome='interrupted';break;}
    if(attempts>=settings.max_model_calls){outcome='limit_reached';reason='model_call_limit';break;}
    if(Date.now()-started>=settings.max_elapsed_minutes*60000){outcome='limit_reached';reason='elapsed_time_limit';break;}
    try{
     if(!await waitForServerIdle(url,{cancelled:()=>interrupted})){outcome='interrupted';break;}
    }catch(error){haltBatch=true;throw error;}
    if(Date.now()-started>=settings.max_elapsed_minutes*60000){outcome='limit_reached';reason='elapsed_time_limit';break;}
    const previousErrors=record?.errors?.length||0;
    await page.locator('#step').click();attempts++;
    await page.waitForFunction(()=>!window.lumenDiagnostics().busy);
    const state=await page.evaluate(()=>window.lumenDiagnostics());
    if(!record)throw Error('No run record captured');
    await writeFile(path.join(output,'size-'+settings.face_size+'-seed-'+settings.seed+'.json'),JSON.stringify(record));
    if(state.done){outcome=state.result?.optimal?'solved':state.result?.status==='abstained'?'abstained':'invalid_answer';reason='';break;}
    if(state.stop?.reason==='model_uncertain_paused'){outcome='abstained';reason='';break;}
    const error=record.errors?.length>previousErrors?record.errors.at(-1).error:'';
    const call=record.calls?.at(-1);
    if(error){
     reason=error;
     if(call?.status===409){
      // Another tab or a disconnected request may still hold the server lock.
      // The next iteration polls readiness without starting a paid request.
      networkFailures=0;rejections=0;
     }else if(call?.status===502||call?.status==='network_error'){
      networkFailures++;rejections=0;
      if(networkFailures>=settings.max_consecutive_network_failures){outcome='infrastructure_failure';break;}
     }else if(call?.status===200&&call?.decision?.type==='answer'){
      networkFailures=0;rejections++;
      if(rejections>=settings.max_consecutive_rejected_answers){outcome='validation_failure';break;}
     }else if(call?.status===422){networkFailures=0;rejections=0;}
     else{outcome='infrastructure_failure';break;}
    }else{networkFailures=0;rejections=0;reason='';}
   }
  }catch(error){reason=error.message;outcome='infrastructure_failure';haltBatch=true;process.exitCode=1;}
  finally{
   if(record)await writeFile(path.join(output,'size-'+settings.face_size+'-seed-'+settings.seed+'.json'),JSON.stringify(record));
   const m=record?.metrics||{},t=record?.timing||{},r=record?.result;
   const usages=(record?.calls||[]).map(c=>c.usage).filter(Boolean);
   const tokens=names=>{const values=usages.map(u=>names.map(n=>u[n]).find(Number.isFinite)).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0):null;};
   results.push({model:config.model,provider:config.provider,face_size:settings.face_size,seed:settings.seed,track:settings.track,outcome,reason,
    run_id:record?.id,api_calls:record?.calls?.length||0,measurements:record?.observations?.length||0,
    coverage:m.coverage,accuracy:m.accuracy,open_edge_f1:m.open_edge_f1,valid:r?.valid,optimal:r?.optimal,
    route_length:r?.length,shortest_length:r?.shortest_length,elapsed_seconds:(Date.now()-started)/1000,
    reported_input_tokens:tokens(['input_tokens','prompt_tokens']),reported_output_tokens:tokens(['output_tokens','completion_tokens']),
    measurement_seconds:t.measurement_seconds,model_request_seconds:t.model_request_seconds,
    task_answer_seconds:t.task_answer_seconds,task_success_seconds:t.task_success_seconds,
    first_reconstruction_seconds:t.first_reconstruction_seconds,first_complete_reconstruction_seconds:t.first_complete_reconstruction_seconds,
    first_exact_reconstruction_seconds:t.first_exact_reconstruction_seconds,
    max_model_calls:settings.max_model_calls,max_elapsed_minutes:settings.max_elapsed_minutes});
   await saveResults();await page.close();
   console.log(outcome+'; saved '+results.length+'/'+plan.length+' runs');
  }
 }
}finally{await browser.close();}
console.log('Results: '+path.join(output,'results.csv'));
