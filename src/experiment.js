import {edgeKey,scoreRoute} from './maze.js';
import {validateLight,apertureSide,receiverHalf,CANOPY_Z,WALL_HEIGHT,LIGHT_MIN_HEIGHT,maxLightHeight,apertureBound} from './shadows.js';
import {edgeSite,edgeReadable,MAX_OBLIQUITY} from './pixel-baseline.js';
export class Experiment{
 constructor(maze,{budget=null,model='manual',track='vision-only',readableMask=true,requireMeasurements=0,now=()=>performance.now()}={}){
  if(budget!==null&&(!Number.isInteger(budget)||budget<1))throw Error('Budget must be null or a positive integer');
  this.autonomous=budget===null;this.readableMask=readableMask;this.requireMeasurements=requireMeasurements;
  this.maze=maze;this.track=track;this.budget=budget===null?Infinity:budget;this.model=model;this.now=now;this.started=now();this.id=globalThis.crypto.randomUUID();
  this.start=maze.nodes[0].id;this.goal=maze.nodes.find(x=>x.f===5&&x.r===maze.size-1&&x.c===maze.size-1).id;
  this.stop=null;this.observations=[];this.decisions=[];this.errors=[];this.calls=[];this.map=new Map();this.done=false;this.result=null;
  this.timing={first_reconstruction_seconds:null,first_complete_reconstruction_seconds:null,first_exact_reconstruction_seconds:null,task_answer_seconds:null,task_success_seconds:null,measurement_seconds:0,model_request_seconds:0};
 }
 elapsed(){return (this.now()-this.started)/1000;}
 recordObservation(observation,seconds){if(this.done||this.observations.length>=this.budget)throw Error('Measurement budget exhausted or run ended');this.observations.push(observation);this.timing.measurement_seconds+=seconds;}
 normalize(d){
  if(!d||typeof d!=='object')throw Error('Decision must be a JSON object');
  // v4 renamed the action to "control" ([aperture_u, aperture_v, lamp_height]); "light" still accepted.
  if(d.control!==undefined&&d.light===undefined){const {control,...rest}=d;d={...rest,light:control};}
  // Sparse, index-keyed updates: the practical format once there are hundreds of edges.
  if(d.edge_states_sparse!==undefined){
   const sparse=d.edge_states_sparse;
   if(!sparse||typeof sparse!=='object'||Array.isArray(sparse))throw Error('edge_states_sparse must be an object mapping candidate edge id to O, C or ?');
   if(d.edge_states!==undefined||d.map_updates?.length)throw Error('Use exactly one of edge_states_sparse, edge_states or map_updates');
   const {edge_states_sparse,...rest}=d;
   return {...rest,map_updates:Object.entries(sparse).map(([key,ch])=>{
    if(!/^(0|[1-9][0-9]*)$/.test(key))throw Error('Invalid candidate edge id');
    const i=Number(key);
    if(!Number.isInteger(i)||i<0||i>=this.maze.edges.length)throw Error(`edge_states_sparse key ${key} is not a candidate edge id in 0..${this.maze.edges.length-1}`);
    const state={O:'open',C:'closed','?':'unknown'}[ch];
    if(!state)throw Error(`edge_states_sparse value for id ${key} must be O, C or ?`);
    const {a,b}=this.maze.edges[i];return {a,b,state};
   }).filter(u=>u.state!=='unknown')};
  }
  if(d.edge_states!==undefined){
   if(typeof d.edge_states!=='string'||d.edge_states.length!==this.maze.edges.length||!/^[OC?]+$/.test(d.edge_states))throw Error(`edge_states must have exactly ${this.maze.edges.length} characters: O=open, C=closed, ?=unknown`);
   if(d.map_updates?.length)throw Error('Use edge_states OR map_updates, not both');
   const {edge_states,...rest}=d;return {...rest,map_updates:this.maze.edges.map(({a,b},i)=>({a,b,state:{O:'open',C:'closed','?':'unknown'}[d.edge_states[i]]})).filter(u=>u.state!=='unknown')};
  }
  return d;
 }
 validate(d,measured=false){
  if(!d||!['measure','answer','abstain'].includes(d.type))throw Error('Expected type measure, answer or abstain');
  if(!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>1)throw Error('Confidence must be 0–1');
  if(d.type==='measure'){
   if(!measured&&this.observations.length>=this.budget)throw Error('No measurement budget remains');
   validateLight(d.light,this.maze.size);
  }
  if(d.type!=='measure'&&this.requireMeasurements&&this.observations.length<this.requireMeasurements&&this.observations.length<this.budget)
   throw Error(`Cannot ${d.type} after ${this.observations.length} measurement(s): at least ${this.requireMeasurements} are required while budget remains`);
  if(d.type==='answer'&&(!Array.isArray(d.path)||d.path.length>this.maze.nodes.length*2||!d.path.every(x=>this.maze.adjacency.has(x))))throw Error('Answer path must contain valid cell IDs');
  const valid=new Set(this.maze.edges.map(e=>e.key)),updates=d.map_updates??[];
  if(!Array.isArray(updates)||updates.length>valid.size)throw Error('Invalid map_updates');
  for(const u of updates)if(!u||!valid.has(edgeKey(u.a,u.b))||!['open','closed','unknown'].includes(u.state))throw Error('Map update must identify a candidate edge and open/closed/unknown state');
  return updates;
 }
 apply(d,{measured=false}={}){
  if(this.done)throw Error('Run already ended');d=this.normalize(d);const updates=this.validate(d,measured);
  for(const u of updates){const k=edgeKey(u.a,u.b);if(u.state==='unknown')this.map.delete(k);else this.map.set(k,u.state);}
  const metrics=this.metrics(),t=this.elapsed();
  if(this.map.size&&this.timing.first_reconstruction_seconds===null)this.timing.first_reconstruction_seconds=t;
  if(metrics.coverage===1&&this.timing.first_complete_reconstruction_seconds===null)this.timing.first_complete_reconstruction_seconds=t;
  if(metrics.coverage===1&&metrics.accuracy===1&&this.timing.first_exact_reconstruction_seconds===null)this.timing.first_exact_reconstruction_seconds=t;
  if(d.type==='measure')this.stop=null;
  this.decisions.push({...d,elapsed_seconds:t,measurement_count:this.observations.length,metrics});
  if(d.type==='abstain'&&this.autonomous){
   this.stop={reason:'model_uncertain_paused',measurements_used:this.observations.length,budget_unused:null,unread_edges:this.maze.edges.length-this.map.size,coverage:metrics.coverage};
   return;
  }
  if(d.type!=='measure'){
   this.done=true;this.timing.task_answer_seconds=t;
   // Why the run ended, and what was still available when it did.
   this.stop={reason:d.type==='abstain'?'model_abstained':'model_answered',
    measurements_used:this.observations.length,budget_unused:this.autonomous?null:this.budget-this.observations.length,
    unread_edges:this.maze.edges.length-this.map.size,coverage:metrics.coverage};
   this.result=d.type==='abstain'?{status:'abstained',valid:false,optimal:false}:{status:'answered',...scoreRoute(this.maze,d.path,this.start,this.goal)};
   if(this.result.valid)this.timing.task_success_seconds=t;
  }
 }
 metrics(){let correct=0,tp=0,fp=0,fn=0;for(const [k,v] of this.map){const truth=this.maze.open.has(k);if((v==='open')===truth)correct++;if(v==='open'&&truth)tp++;if(v==='open'&&!truth)fp++;}for(const k of this.maze.open)if(this.map.get(k)!=='open')fn++;
  return {labeled:this.map.size,total:this.maze.edges.length,coverage:this.map.size/this.maze.edges.length,accuracy:this.map.size?correct/this.map.size:null,open_edge_f1:2*tp/(2*tp+fp+fn||1)};
 }
 // Which candidate edges a given light COULD expose. Derived from public topology and the
 // published lit-patch rule only — no pixels, no truth. Saves the model 432 arithmetic steps.
 readable(light){
  const n=this.maze.size,byId=new Map(this.maze.nodes.map(a=>[a.id,a])),ids=[];
  this.maze.edges.forEach(({a,b},i)=>{const aa=byId.get(a),bb=byId.get(b);
   const sites=aa.f===bb.f?[edgeSite(n,aa,bb)]:[edgeSite(n,aa,bb),edgeSite(n,bb,aa)];
   if(sites.some(s=>edgeReadable(n,light,s)))ids.push(i);});
  return ids;
 }
 // Claims so far, keyed by candidate edge id, so the payload stays small at large sizes.
 reconstructionSparse(){
  const index=new Map(this.maze.edges.map(({a,b},i)=>[edgeKey(a,b),i])),out={};
  for(const [k,v] of this.map)out[index.get(k)]=v==='open'?'O':'C';
  return out;
 }
 // Public optics. One light illuminates only the square patch below the canopy aperture,
 // so no single measurement can reveal a whole face.
 geometry(){const n=this.maze.size;return {readability_max_obliquity:MAX_OBLIQUITY,readability_rule:'Every base/shadow sample must be lit, inside the receiver, and hypot(x,y)/height <= readability_max_obliquity. A dark region outside the aperture is unlit, not a wall.',control_axes:'positive aperture_u moves the patch RIGHT; positive aperture_v moves it UP toward row 0. Height changes ray steepness; u/v alone cannot fix an oblique corner view.',corner_readability_height:Math.ceil(Math.hypot(n/2,n/2)/MAX_OBLIQUITY),receiver_span:[-receiverHalf(n),receiverHalf(n)],cells_span:[-n/2,n/2],canopy_height:CANOPY_Z,aperture_side:apertureSide(n),wall_height:WALL_HEIGHT,wall_thickness:0.075,light_height_range:[LIGHT_MIN_HEIGHT,maxLightHeight(n)],aperture_uv_bound:apertureBound(n),lamp_position:'(0,0,height); only the aperture moves laterally',lit_patch_rule:'k = 1 - canopy_height/height; half_width = aperture_side/(2*k); centre = [aperture_u,aperture_v]/k — the patch follows the aperture',shadow_rule:'the lamp is central, so a wall at (x,y) casts its shadow at height/(height-wall_height) * [x,y] — displaced radially outward'};}
 // Truth, seed, observer pixels and grading metrics are deliberately excluded.
 input(){return {benchmark:'LUMEN cube-surface shadows v6',run_policy:this.autonomous?'autonomous':'budgeted',measurements_taken:this.observations.length,track:this.track,size:this.maze.size,faces:['+X','-X','+Y','-Y','+Z','-Z'],candidate_edges:this.maze.edges.map(({a,b})=>a+'|'+b),candidate_edge_format:'array index = candidate edge id; value is "cellA|cellB"',query:{start:this.start,goal:this.goal,task:'Return a shortest traversable path as cell IDs'},budget_remaining:this.autonomous?null:this.budget-this.observations.length,geometry:this.geometry(),reconstruction:this.reconstructionSparse(),unread_edge_count:this.maze.edges.length-this.map.size,history:this.observations.slice(-8).map(o=>this.readableMask&&o.light?{...o,readable_edge_ids:this.readable(o.light)}:o),decisions:this.decisions.slice(-16).map(({metrics,...d})=>d)};}
 record(){return {schema_version:2,track:this.track,id:this.id,backend:'threejs-exact-face-shadows',task_geometry:'cube-surface',seed:this.maze.seed,size:this.maze.size,budget:this.autonomous?null:this.budget,run_policy:this.autonomous?'autonomous':'budgeted',model:this.model,query:{start:this.start,goal:this.goal},observations:this.observations,decisions:this.decisions,reconstruction:[...this.map],metrics:this.metrics(),result:this.result,stop:this.stop??null,timing:{...this.timing,elapsed_seconds:this.elapsed(),clock:'performance.now monotonic; elapsed includes user pauses'},calls:this.calls,errors:this.errors,truth_open_edges:[...this.maze.open]};}
}
