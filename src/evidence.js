import {edgeKey, shortestPath} from './maze.js';
import {reconstructFromPixels} from './pixel-baseline.js';
import {captureResolution} from './shadows.js';

// Receives public topology and raw captured pixels only; never maze.open or wall boxes.
// This is an image-derived guard, not proof that an LLM internally reasoned correctly.
export class Evidence {
 constructor(graph){this.graph=graph;this.readings=new Map();this.conflicts=new Set();this.feedback=[];}
 prepare(decision,previous){
  const rejected=[],accepted=[];
  for(const update of decision.map_updates||[]){
   const key=edgeKey(update.a,update.b),reading=this.readings.get(key);
   if(update.state==='unknown'||(!this.conflicts.has(key)&&reading?.state===update.state))accepted.push(update);
   else rejected.push({edge:key,proposed_state:update.state,reason:this.conflicts.has(key)?'conflicting_observations':reading?'does_not_match_pixels':'not_observed_clearly'});
  }
  if(rejected.length)this.feedback.push({type:'claims_rejected',claims:rejected,
   instruction:'These claims were NOT accepted. Omit them or inspect the edges with a different aperture/height. Do not repeat the rejected claims without new supporting evidence. Conflicting observations remain unresolved for this run.'});
  // Only nonterminal actions may proceed with a supported subset. Never turn a
  // rejected answer into a successful one or invent a replacement wall state.
  const prepared=decision.type==='answer'?decision:{...decision,map_updates:accepted,...(rejected.length?{rejected_updates:rejected}:{})};
  try{this.validate(prepared,previous);}catch(error){
   this.feedback.push({type:'action_rejected',action:decision.type,reason:error.message,instruction:'Request a new observation or abstain. The rejected action did not finish the run.'});
   throw error;
  }
  return prepared;
 }
 observe(panels,resolution,control,step){
  if(resolution<captureResolution(this.graph.size))throw Error('Capture resolution is too low to verify this maze');
  const updates=reconstructFromPixels(this.graph,panels,resolution,control);
  for(const {a,b,state} of updates){
   if(state==='unknown')continue;
   const key=edgeKey(a,b),old=this.readings.get(key);
   if(old&&old.state!==state){this.conflicts.add(key);this.readings.delete(key);}
   if(!this.conflicts.has(key))this.readings.set(key,{state,step,control:[...control]});
  }
 }
 validate(decision,previous){
  const claims=new Map(previous);
  for(const u of decision.map_updates||[]){
   const key=edgeKey(u.a,u.b);
   if(u.state==='unknown'){claims.delete(key);continue;}
   if(this.conflicts.has(key)||this.readings.get(key)?.state!==u.state)
    throw Error(`Unsupported claim for ${key}: capture clear matching pixel evidence first`);
   claims.set(key,u.state);
  }
  if(decision.type!=='answer')return;
  const path=decision.path;
  if(!path?.length)throw Error('An answer requires an observed route');
  for(let i=1;i<path.length;i++){
   const key=edgeKey(path[i-1],path[i]);
   if(claims.get(key)!=='open'||this.readings.get(key)?.state!=='open'||this.conflicts.has(key))
    throw Error('Route contains an unobserved, conflicting, or closed passage');
  }
  // Unknown connections remain potentially open. Only certify shortest when even
  // this optimistic graph cannot provide a shorter route. No hidden truth is used.
  const possible=new Set(this.graph.edges.filter(e=>this.conflicts.has(e.key)||this.readings.get(e.key)?.state!=='closed').map(e=>e.key));
  const optimistic=shortestPath(this.graph,path[0],path.at(-1),possible);
  if(!optimistic||optimistic.length!==path.length)throw Error('Shortest route is not established: inspect unresolved passages');
 }
 record(){return {policy:'pixel-evidence-gated',readings:[...this.readings],conflicts:[...this.conflicts],feedback:this.feedback};}
}
