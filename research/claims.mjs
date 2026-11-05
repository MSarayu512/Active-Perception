import {edgeKey,scoreRoute} from '../src/maze.js';
export function evaluateClaims(maze, steps) {
 const allowed=new Set(maze.edges.map(e=>e.key)), beliefs=new Map(), history=[];
 for(const [stepIndex,step] of steps.entries()){
  const transitions=[];
  for(const claim of step.claims||[]){
   const key=claim.edge_id??(claim.a&&claim.b?edgeKey(claim.a,claim.b):null);
   if(!allowed.has(key))throw Error('Claim references an invalid candidate edge');
   if(!Array.isArray(claim.supporting_observation_ids))throw Error('Missing observation references');
   const previous=beliefs.get(key),retracted=claim.retracted===true;
   if(!retracted&&(!Number.isFinite(claim.p_open)||claim.p_open<0||claim.p_open>1))throw Error('p_open must be in [0,1]');
   if(retracted)beliefs.delete(key);else beliefs.set(key,{...claim,p_open:claim.p_open});
   const truth=maze.open.has(key),classify=p=>p===undefined?'unknown':(p>=0.5)===truth?'correct':'incorrect';
   transitions.push({edge_id:key,from:classify(previous?.p_open),to:classify(retracted?undefined:claim.p_open),retracted});
  }
  let brier=0,incorrect=0,uncertainty=0;
  for(const [key,c] of beliefs){const truth=maze.open.has(key)?1:0;brier+=(c.p_open-truth)**2;incorrect+=Number((c.p_open>=.5)!==Boolean(truth));uncertainty+=1-Math.abs(2*c.p_open-1);}
  const route=step.route?scoreRoute(maze,step.route,step.start??maze.nodes[0].id,step.goal??maze.nodes.at(-1).id):null;
  history.push({step:stepIndex,coverage:beliefs.size/allowed.size,claimed:beliefs.size,unknown:allowed.size-beliefs.size,incorrect,brier:beliefs.size?brier/beliefs.size:null,mean_uncertainty:beliefs.size?uncertainty/beliefs.size:null,transitions,route});
 }
 return history;
}
export function assertModelPayloadSafe(payload,maze){
 const serialized=JSON.stringify(payload);
 for(const forbidden of ['truth_open_edges','shortest_length','ground_truth','maze_seed','seed'])if(Object.hasOwn(payload,forbidden))throw Error('Forbidden model payload field: '+forbidden);
 if(Object.hasOwn(payload,'open'))throw Error('Ground truth open set exposed');
 if(payload.candidate_edges&&payload.candidate_edges.length!==maze.edges.length)throw Error('Candidate adjacency count mismatch');
 return serialized.length;
}
