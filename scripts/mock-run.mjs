// Headless replay of the browser decision loop with a scripted "model". No API key, no browser.
// Usage: node scripts/mock-run.mjs [size] [seed] [budget] [policy]
//   policy: greedy (default) | answer-early | abstain-early | always-measure
import * as THREE from 'three';
import {generate,topology,faceWalls,edgeKey,shortestPath} from '../src/maze.js';
import {shadowPixels} from '../src/shadows.js';
import {baselineDecision,mergeClaims,MIN_READ_RESOLUTION as RES} from '../src/pixel-baseline.js';
import {Experiment} from '../src/experiment.js';
globalThis.performance ??= {now:()=>Date.now()};

const [size=4,seed=7,budget='auto',policy='greedy']=process.argv.slice(2);
const n=Number(size),m=generate(n,Number(seed)),topo=topology(n);
const floor=Number(process.env.REQUIRE_MEASUREMENTS||0);
const e=new Experiment(m,{budget:budget==='auto'?null:Number(budget),model:'mock-'+policy,requireMeasurements:floor});
const panelsFor=light=>[...Array(6)].map((_,f)=>shadowPixels(THREE,faceWalls(m,f),n,light,RES));

function capture(light){
 const p=panelsFor(light);
 e.validate({type:'measure',light,confidence:0});
 e.recordObservation({step:e.observations.length+1,light:[...light],resolution:RES,
  panels:p.map((x,i)=>({face:['+X','-X','+Y','-Y','+Z','-Z'][i],png:'data:image/png;base64,YQ==',
   dark_fraction:x.darkFraction,lit_fraction:x.litFraction,lit_region:x.lit_region}))},.01);
 return p.map(x=>x.data);
}
let claims=new Map(),light=[0,0,6],pixels=null,stop='unset';
try{
 pixels=capture(light); // the harness's automatic first measurement
 while(!e.done){
  if(e.calls.length>=2*e.budget+5){stop='call_cap';break;}
  e.calls.push({status:200,model:'mock',seconds:.01});
  const base=baselineDecision(topo,pixels,RES,e.start,e.goal,light,claims);
  let d=base;
  if(policy==='answer-early'&&e.observations.length===1)
   d={type:'answer',path:shortestPath(m,e.start,e.goal)??[e.start],confidence:.4,reason:'guessing early',map_updates:base.map_updates};
  if(policy==='abstain-early'&&e.observations.length===1)
   d={type:'abstain',confidence:.05,reason:'cannot read seams',map_updates:[]};
  claims=mergeClaims(claims,d.map_updates||[]);
  if(d.type!=='measure'){e.apply(d);stop=e.stop?.reason||'model_'+d.type;break;}
  if(e.observations.length>=e.budget){
   e.apply({type:'abstain',confidence:.3,reason:'budget exhausted before full coverage',map_updates:d.map_updates});
   stop='budget_exhausted';break;
  }
  light=d.light;pixels=capture(light);e.apply(d,{measured:true});
 }
}catch(err){stop='error: '+err.message;e.errors.push({error:err.message});}
const mt=e.metrics(),r=e.record();
console.log(JSON.stringify({policy,size:n,seed:Number(seed),budget:budget==='auto'?null:Number(budget),require_measurements:floor,stop,
 measurements:e.observations.length,decisions:e.decisions.length,
 coverage:+(100*mt.coverage).toFixed(1),accuracy:mt.accuracy===null?null:+(100*mt.accuracy).toFixed(1),
 result:r.result,stop_record:r.stop,errors:e.errors.map(x=>x.error)},null,1));
