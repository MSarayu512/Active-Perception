import {generate,topology,FACES,faceWalls,edgeKey} from '/src/maze.js';
import {Experiment} from '/src/experiment.js';
import {baselineDecision,reconstructFromPixels,edgeSite,edgeReadable} from '/src/pixel-baseline.js';
import {receiverHalf,shadowOffset,captureResolution,maxLightHeight} from '/src/shadows.js';
import {View} from '/view.js';
import {Evidence} from '/src/evidence.js';
const $=id=>document.getElementById(id);let view,experiment,worker,busy=false,auto=false,healthy=false,config={},serial=0,pixelHistory=[];
let RES=512,evidence;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function state(){
 for(const id of ['new','measure','demo','step','auto','apply'])$(id).disabled=busy||(id!=='new'&&(!healthy||experiment?.done));
 if(experiment){$('measure').disabled ||= experiment.observations.length>=experiment.budget;}
 $('track').disabled=busy||!!experiment?.observations.length;
 $('step').disabled ||= !config.configured;$('auto').disabled ||= !config.configured;$('pause').disabled=!auto;
 for(const id of ['seed','size','budget'])$(id).disabled=busy;
}
function panel(container,title){const div=document.createElement('div');div.className='panel';const b=document.createElement('b');b.textContent=title;const canvas=document.createElement('canvas');canvas.width=canvas.height=RES;div.append(b,canvas);container.append(div);return canvas;}
async function showCapture(index){
 const obs=experiment.observations[index];if(!obs)return;$('panels').replaceChildren();
 const canvases=await Promise.all(obs.panels.map(p=>new Promise(resolve=>{
  const c=panel($('panels'),p.face+' · '+Math.round(100*(p.lit_fraction??0))+'% lit'),image=new Image();
  image.onload=()=>{c.getContext('2d').drawImage(image,0,0);resolve(c);};c.style.cursor='zoom-in';c.title='Click to view labeled model image at full resolution';c.onclick=()=>{const dialog=document.createElement('dialog');const img=new Image();img.src=p.model_png||p.png;img.style.maxWidth='85vw';const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(img,close);document.body.append(dialog);dialog.showModal();};image.src=p.png;
 })));
 if(Number($('history').value)===index)view.showShadows(canvases);
}


function annotate(raw,face,size,light){
 const R=receiverHalf(size),scale=RES/(2*R),inset=(R-size/2)*scale; // cell grid sits inside the margin
 const pad=48,out=document.createElement('canvas');out.width=out.height=RES+2*pad;const ctx=out.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(raw,pad,pad);
 ctx.fillStyle='#143f80';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.fillText(face,22,22);
 for(let i=0;i<size;i++){const pos=pad+inset+(i+.5)*size*scale/size;ctx.fillText('c'+i,pos,23);ctx.fillText('r'+i,23,pos);}
 // Blue dotted grid is calibration, not maze walls. Do not draw over dark wall pixels.
 ctx.strokeStyle='rgba(30,100,190,0.25)';ctx.lineWidth=1;ctx.setLineDash([2,5]);
 for(let i=0;i<=size;i++){const q=pad+inset+i*scale;ctx.beginPath();ctx.moveTo(q,pad+inset);ctx.lineTo(q,pad+inset+size*scale);ctx.moveTo(pad+inset,q);ctx.lineTo(pad+inset+size*scale,q);ctx.stroke();}
 ctx.setLineDash([]);ctx.font=`${Math.max(10,Math.min(17,RES/size*.2))}px sans-serif`;
 for(let r=0;r<size;r++)for(let c=0;c<size;c++){const x=pad+inset+(c+.5)*scale,y=pad+inset+(r+.5)*scale;ctx.fillStyle='#5f9adc';ctx.fillText(`${r},${c}`,x,y);}
 // Public edge ids outside the wall sample, with cyan pointers to predicted shadow positions.
 const faceIndex=FACES.findIndex(f=>f.name===face),byId=new Map(experiment.maze.nodes.map(n=>[n.id,n]));
 ctx.font='bold 10px monospace';ctx.textAlign='left';
 experiment.maze.edges.forEach(({a,b},id)=>{const aa=byId.get(a),bb=byId.get(b);let first,second;
  if(aa.f===faceIndex){first=aa;second=bb;}else if(bb.f===faceIndex){first=bb;second=aa;}else return;
  const site=edgeSite(size,first,second);if(!edgeReadable(size,light,site))return;
  const [sx,sy]=shadowOffset(light,site.x,site.y),x=pad+(sx+R)*scale,y=pad+(R-sy)*scale;
  ctx.fillStyle='#006a85';ctx.fillText(String(id),x+5,y-8);ctx.strokeStyle='#00a7ba';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+4,y-5);ctx.lineTo(x,y);ctx.stroke();
 });
 return out.toDataURL('image/png');
}
function providerInput(){
 const input=experiment.input();
 input.evidence_policy='pixel-evidence-gated: claims must match captured readings; route edges must be claimed and observed open; shortest requires no possible shorter path through unknown edges. Mixed or conflicting readings are unknown.';
 // The evaluator must not correct the model's claims. Preserve feedback only in evaluator logs.
 if(experiment.track==='pixel-assisted'){
  const index=experiment.observations.length-1;
  if(index<0)throw Error('Pixel-assisted track requires at least one capture first.');
  const obs=experiment.observations[index];
  input.pixel_evidence={source:'Deterministic threshold samples of observation '+(index+1)+', not ground truth; unreadable edges are ?',edge_states:reconstructFromPixels(topology(experiment.maze.size),pixelHistory[index],RES,obs.light).map(u=>u.state==='open'?'O':u.state==='closed'?'C':'?').join('')};
 }
 return input;
}

function drawMaps(){
 $('maps').replaceChildren();const n=experiment.maze.size,margin=20,cell=(RES-2*margin)/n;
 for(let f=0;f<6;f++){
  const canvas=panel($('maps'),FACES[f].name),ctx=canvas.getContext('2d');ctx.fillStyle='#0c1626';ctx.fillRect(0,0,RES,RES);
  const nodes=experiment.maze.nodes.filter(x=>x.f===f),byId=new Map(experiment.maze.nodes.map(x=>[x.id,x]));
  for(const a of nodes){const x=margin+(a.c+.5)*cell,y=margin+(a.r+.5)*cell;
   for(const bId of experiment.maze.adjacency.get(a.id)){
    const b=byId.get(bId);if(b.f!==f)continue;const value=experiment.map.get(edgeKey(a.id,bId));ctx.strokeStyle=value==='open'?'#65dfb9':value==='closed'?'#ff8f8f':'#354762';ctx.lineWidth=value?6:2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(margin+(b.c+.5)*cell,margin+(b.r+.5)*cell);ctx.stroke();
   }ctx.fillStyle=a.id===experiment.start?'#ffda6b':a.id===experiment.goal?'#c8a2ff':'#9ab2cb';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();
  }
 }
 $('claims').textContent=JSON.stringify({edges:[...experiment.map],answer:experiment.decisions.find(d=>d.type==='answer')?.path||null},null,2);
}
function refresh(){
 const m=experiment.metrics();$('measurements').textContent=experiment.autonomous?`${experiment.observations.length} · autonomous`:`${experiment.observations.length} / ${experiment.budget}`;$('coverage').textContent=(100*m.coverage).toFixed(1)+'%';$('accuracy').textContent=m.accuracy===null?'—':(100*m.accuracy).toFixed(1)+'%';$('confidence').textContent=experiment.decisions.at(-1)?.confidence??'—';
 $('query').textContent=`START ${experiment.start} → GOAL ${experiment.goal} · shortest route across cube faces`;
 $('timeline').replaceChildren();for(const d of experiment.decisions){const el=document.createElement('div');el.className='entry';el.textContent=`${d.elapsed_seconds.toFixed(1)}s · ${d.type} · ${d.map_updates?.length||0} edge updates · confidence ${d.confidence}\n${d.reason||''}`;$('timeline').append(el);}
 for(const e of experiment.errors){const el=document.createElement('div');el.className='entry';el.textContent=`PAUSED · ${e.error}`;$('timeline').append(el);}
 $('timing').textContent=JSON.stringify({timing:experiment.record().timing,metrics:m,result:experiment.result,stop:experiment.stop,run_policy:experiment.autonomous?'autonomous':'budgeted',api_calls:experiment.calls.length},null,2);drawMaps();state();
}
async function save(){
 const r=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...experiment.record(),evidence:evidence?.record()})});if(!r.ok)throw Error('Could not autosave. Use Export run JSON.');
}
function makeWorker(){worker?.terminate();worker=new Worker('/shadow-worker.js',{type:'module'});healthy=true;}
async function newMaze(){
 const seed=Number($('seed').value),size=Number($('size').value),budget=$('budget').value.trim()===''?null:Number($('budget').value);
 if(!Number.isInteger(seed)||seed<0||seed>4294967295||(budget!==null&&(!Number.isInteger(budget)||budget<1)))throw Error('Seed must be 0–4294967295; optional budget must be a positive integer');
 if(!Number.isSafeInteger(size)||size<2)throw Error('Cells per side must be an integer of at least 2');
 RES=captureResolution(size);$('height').max=String(maxLightHeight(size));
 auto=false;makeWorker();experiment=new Experiment(generate(size,seed),{budget,model:config.model||'manual',track:$('track').value});pixelHistory=[];evidence=new Evidence(topology(size));view.build(experiment.maze);$('explode').checked=false;$('walls').checked=true;$('face').value='-1';$('panels').replaceChildren();$('history').replaceChildren(new Option('No captures',''));refresh();status('Ready. Capture shadows or run the free pixel demo.');await save();
}
function captureWorker(light){
 return new Promise((resolve,reject)=>{
 const id=++serial,timer=setTimeout(()=>{healthy=false;worker.terminate();reject(Error('Shadow capture timed out for this maze on this device; create a smaller maze or restart the renderer.'));},Math.max(30000,RES*RES/4));
  const cleanup=()=>{clearTimeout(timer);worker.onmessage=null;worker.onerror=null;};
  worker.onerror=()=>{cleanup();healthy=false;reject(Error('Shadow worker failed; create a new maze to restart it.'));};
  worker.onmessage=({data})=>{if(data.id!==id)return;cleanup();if(data.error){healthy=false;reject(Error(data.error));}else resolve(data.output);};
  worker.postMessage({id,size:experiment.maze.size,light,resolution:RES,faces:FACES.map((f,i)=>({face:f.name,boxes:faceWalls(experiment.maze,i)}))});
 });
}
async function capture(light){
 if(!healthy||view.lost)throw Error('Renderer unavailable. Reload the page or create a new maze.');
 experiment.validate({type:'measure',light,confidence:0});status('Computing six calibrated shadow receivers…');
 const start=performance.now(),output=await captureWorker(light),panels=[];
 for(const p of output){if(!p.pixels||p.pixels.length!==RES*RES*4||!Number.isFinite(p.darkFraction))throw Error('Invalid receiver output');const c=document.createElement('canvas');c.width=c.height=RES;c.getContext('2d').putImageData(new ImageData(p.pixels,RES,RES),0,0);panels.push({face:p.face,png:c.toDataURL('image/png'),model_png:annotate(c,p.face,experiment.maze.size,light),dark_fraction:p.darkFraction,lit_fraction:p.litFraction,lit_region:p.lit_region});}
 const obs={step:experiment.observations.length+1,light:[...light],resolution:RES,panels};experiment.recordObservation(obs,(performance.now()-start)/1000);pixelHistory.push(output.map(p=>p.pixels));
 evidence.observe(output.map(p=>p.pixels),RES,light,obs.step);
 for(const key of evidence.conflicts)experiment.map.delete(key);
 $('history').replaceChildren(...experiment.observations.map((o,i)=>new Option(`Measurement ${o.step} · control ${o.light.join(', ')}`,i)));$('history').value=String(experiment.observations.length-1);showCapture(experiment.observations.length-1);refresh();await save();return obs;
}
async function applyDecision(d){
 d=experiment.normalize(d);experiment.validate(d);
 if(d.type==='answer'&&(d.path[0]!==experiment.start||d.path.at(-1)!==experiment.goal))throw Error('Route must connect the task start and goal');
 d=evidence.prepare(d,experiment.map);
 // Commit claims only after the requested capture succeeds. Failure cannot create a fictitious measurement.
 if(d.type==='measure'){await capture(d.light);d=evidence.prepare(d,experiment.map);experiment.apply(d,{measured:true});}else experiment.apply(d);
 if(d.type==='answer'){view.showRoute(d.path);if($('explode').checked)view.setExploded(1);}
 refresh();await save();if(d.type==='abstain'&&!experiment.done){auto=false;status('Model uncertain: paused with progress saved. Resume Run LLM to continue; no final answer was recorded.');}
 if(experiment.done){
  const st=experiment.stop,ctx=st?` After ${st.measurements_used} measurement(s), ${st.budget_unused===null?'no fixed measurement limit':st.budget_unused+' budget unused'}, ${st.unread_edges} edges never read (${(100*st.coverage).toFixed(0)}% coverage).`:'';
  status((experiment.result.status==='abstained'?'Run ended: model abstained.':`Run ended: route ${experiment.result.valid?'valid':'invalid'}; ${experiment.result.optimal?'shortest route found':'not a shortest valid route'}.`)+ctx);
 }
}
async function llmStep(){
 if(!healthy||view.lost)throw Error('Renderer unavailable; no API request sent.');
 if(!experiment.autonomous&&experiment.calls.length>=2*experiment.budget+5)throw Error('API-call cap reached. Export this run and start a new one.');
 if(!experiment.observations.length)await capture([0,0,6]);
 status(`Waiting for ${config.model}… Pause takes effect after this call and its requested capture.`);
 const started=performance.now();let payload;
 try{
  const response=await fetch('/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(providerInput()),signal:AbortSignal.timeout(config.local?1800000:130000)});payload=await response.json();
  const seconds=(performance.now()-started)/1000;experiment.timing.model_request_seconds+=seconds;experiment.calls.push({status:response.status,model:payload.model||config.model,usage:payload.usage||null,seconds});
  if(!response.ok){
   const detail=[payload.hint,payload.stop_reason?`stop_reason: ${payload.stop_reason}`:'',
    payload.output_tokens?`output tokens: ${payload.output_tokens}`:'',
    payload.text_tail?`reply ended: …${payload.text_tail.slice(-120)}`:''].filter(Boolean).join(' · ');
   throw Error((payload.error||'API request failed')+(detail?' — '+detail:''));
  }
 }catch(e){if(!payload){const seconds=(performance.now()-started)/1000;experiment.timing.model_request_seconds+=seconds;experiment.calls.push({status:'network_error',seconds});}throw e;}
 Object.assign(experiment.calls.at(-1),{decision:payload.decision,generated_text:payload.generated_text,reasoning_content:payload.reasoning_content,reasoning_provenance:payload.reasoning_provenance,finish_reason:payload.finish_reason});
 await applyDecision(payload.decision);
}
async function guarded(fn){
 if(busy)return;busy=true;state();try{await fn();}catch(e){auto=false;experiment?.errors.push({elapsed_seconds:experiment.elapsed(),error:e.message});status(e.message,true);try{await save();}catch{}console.error(e);}finally{busy=false;refresh();}
}
function download(filename,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('new').onclick=()=>guarded(newMaze);
$('measure').onclick=()=>guarded(async()=>{await capture([Number($('u').value),Number($('v').value),Number($('height').value)]);status('Six receivers captured and saved.');});
$('demo').onclick=()=>guarded(async()=>{
 if((experiment.observations.length||experiment.decisions.length)&&experiment.track!=='pixel-baseline')throw Error('Create a new maze before the pixel demo to keep model runs separate.');
 experiment.model='pixel-baseline-evidence-gated';experiment.track='pixel-baseline';
 let light=experiment.decisions.at(-1)?.light||[0,0,6],claims=new Map(experiment.map);
 const attempted=new Set();auto=true;state();
 while(auto&&!experiment.done){
  const attempt=JSON.stringify([light,claims.size]);
  if(attempted.has(attempt))throw Error('No new pixel evidence at the planned control. Paused without guessing.');
  attempted.add(attempt);
  await capture(light);
  if(evidence.conflicts.size)throw Error('Contradictory pixel observations. Conflicting edges remain unknown; create a new maze run to investigate.');
  claims=new Map(experiment.map);
  const d=baselineDecision(topology(experiment.maze.size),pixelHistory.at(-1),RES,experiment.start,experiment.goal,light,claims);
  for(const u of d.map_updates)if(u.state!=='unknown')claims.set(edgeKey(u.a,u.b),u.state);
  if(d.type==='measure'){
   if(experiment.observations.length>=experiment.budget){await applyDecision({type:'abstain',confidence:0.5,reason:'Budget exhausted before full coverage.',map_updates:d.map_updates});break;}
   evidence.validate(d,experiment.map);light=d.light;experiment.apply({...d,type:'measure'},{measured:true});refresh();await save();
  } else {await applyDecision(d);break;}
 }
 auto=false;if(!experiment.done&&experiment.stop?.reason!=='model_uncertain_paused')status('Paused. Select Reconstruct from shadows to continue.');
});
$('step').onclick=()=>guarded(async()=>{await llmStep();if(!experiment.done&&experiment.stop?.reason!=='model_uncertain_paused')status('Decision and capture saved. Ready for the next decision.');});
$('auto').onclick=()=>guarded(async()=>{auto=true;state();while(auto&&!experiment.done){await llmStep();await new Promise(r=>setTimeout(r,0));}auto=false;if(!experiment.done&&experiment.stop?.reason!=='model_uncertain_paused')status('Paused. The current decision was saved.');});
$('pause').onclick=()=>{auto=false;state();status('Pause requested; waiting for the current call/capture to finish.');};
$('apply').onclick=()=>guarded(()=>applyDecision(JSON.parse($('manual').value)));
$('export').onclick=()=>download(`lumen-${experiment.id}.json`,JSON.stringify({...experiment.record(),evidence:evidence?.record()},null,2),'application/json');
$('csv').onclick=()=>{const r=experiment.record(),values={id:r.id,seed:r.seed,size:r.size,model:r.model,track:r.track,run_policy:r.run_policy,measurements:r.observations.length,api_calls:r.calls.length,...r.metrics,...r.timing,valid:r.result?.valid??'',optimal:r.result?.optimal??''};const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';download(`lumen-${r.id}.csv`,Object.keys(values).join(',')+'\n'+Object.values(values).map(quote).join(',')+'\n','text/csv');};
$('history').onchange=()=>showCapture(Number($('history').value));$('explode').onchange=()=>view.setExploded($('explode').checked?1:0);$('walls').onchange=()=>view.setWalls($('walls').checked);$('face').onchange=()=>view.focus(Number($('face').value));
$('viewport').addEventListener('renderfailure',()=>{healthy=false;auto=false;status('WebGL context lost. No further model calls will be sent. Export this run, then reload.',true);state();});
try{view=new View($('viewport'));config=await(await fetch('/api/config')).json();$('provider').textContent=config.configured?config.model:'FREE DEMO READY';if(!config.configured)$('configHelp').textContent='LLM disabled until LLM_MODEL and LLM_API_KEY are set in .env. Free demo needs no key.';await newMaze();}catch(e){status('Startup failed: '+e.message,true);healthy=false;state();}
// Read-only diagnostics for browser smoke tests; no truth data is sent to providers.
window.lumenDiagnostics=()=>({busy,healthy,done:experiment?.done,metrics:experiment?.metrics(),result:experiment?.result,measurements:experiment?.observations.length,errors:experiment?.errors,stop:experiment?.stop,autonomous:experiment?.autonomous,track:experiment?.track});
