import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Evidence} from '../src/evidence.js';
import {generate,topology,faceWalls,edgeKey,shortestPath} from '../src/maze.js';
import {captureResolution,maxLightHeight,shadowPixels,shadowOffset,receiverHalf} from '../src/shadows.js';
import {baselineDecision,reconstructFromPixels,edgeSite} from '../src/pixel-baseline.js';

function pixels(maze,control,resolution){return Array.from({length:6},(_,f)=>shadowPixels(THREE,faceWalls(maze,f),maze.size,control,resolution).data);}

for(const size of [2,3,4,5,6,7,8,9,12])for(const seed of [1,7,19]){
 test(`pixel-supported reconstruction size ${size}, seed ${seed}, production resolution`,()=>{
  const maze=generate(size,seed),graph=topology(size),resolution=captureResolution(size),evidence=new Evidence(graph);
  let control=[0,0,6],claims=new Map(),answer=null;
  const start=maze.nodes[0].id,goal=maze.nodes.at(-1).id;
  for(let step=1;step<=30;step++){
   const panels=pixels(maze,control,resolution);
   evidence.observe(panels,resolution,control,step);
   const decision=baselineDecision(graph,panels,resolution,start,goal,control,claims);
   evidence.validate(decision,claims);
   for(const u of decision.map_updates)claims.set(edgeKey(u.a,u.b),u.state);
   // Truth is used only by the assertion, never by the reader/planner/gate.
   for(const [key,state] of claims)assert.equal(state==='open',maze.open.has(key));
   if(decision.type!=='measure'){answer=decision;break;}
   control=decision.light;
  }
  assert.equal(answer?.type,'answer','must finish rather than repeat ambiguous captures');
  assert.equal(claims.size,graph.edges.length);assert.equal(evidence.conflicts.size,0);
  assert.equal(answer.path.length,shortestPath(maze,start,goal).length);
 });
}

test('unseen and contradictory claims are rejected; conflicts stay unresolved',()=>{
 const graph=topology(3),e=new Evidence(graph),edge=graph.edges[0],r=captureResolution(3);
 const decision={type:'measure',map_updates:[{...edge,state:'open'}]};
 assert.throws(()=>e.validate(decision,new Map()),/Unsupported/);
 const bright=Array.from({length:6},()=>new Uint8ClampedArray(r*r*4).fill(240));
 e.observe(bright,r,[0,0,6],1);
 const [key]=e.readings.keys(),[a,b]=key.split('|');
 assert.doesNotThrow(()=>e.validate({type:'measure',map_updates:[{a,b,state:'open'}]},new Map()));
 assert.throws(()=>e.validate({type:'measure',map_updates:[{a,b,state:'closed'}]},new Map()),/Unsupported/);
 const dark=Array.from({length:6},()=>new Uint8ClampedArray(r*r*4).fill(24));
 e.observe(dark,r,[0,0,6],2);assert(e.conflicts.has(key));assert(!e.readings.has(key));
 e.observe(bright,r,[0,0,6],3);assert(!e.readings.has(key));
 assert.throws(()=>e.validate({type:'answer',path:[a,b]},new Map([[key,'open']])),/unobserved/);
 assert.throws(()=>e.observe(bright,64,[0,0,6],4),/resolution/);
});

test('an unseen shortcut prevents a shortest-route claim',()=>{
 const graph=topology(2),e=new Evidence(graph),maze=generate(2,7);
 const path=shortestPath(maze,maze.nodes[0].id,maze.nodes.at(-1).id),claims=new Map();
 for(let i=1;i<path.length;i++){const key=edgeKey(path[i-1],path[i]);claims.set(key,'open');e.readings.set(key,{state:'open',step:1});}
 assert.throws(()=>e.validate({type:'answer',path},claims),/Shortest route/);
 assert.throws(()=>e.validate({type:'answer',path:[]},claims),/observed route/);
});

test('large topology has no 8-cell ceiling and optics scale with dimensions',()=>{
 for(const size of [9,16,32]){
  const graph=topology(size);assert.equal(graph.nodes.length,6*size*size);
  assert.equal(graph.edges.length,12*size*size);assert(maxLightHeight(size)>=2*size);
  assert(captureResolution(size)>512);
 }
});

test('missing receivers cannot be interpreted as open passages',()=>{
 assert.throws(()=>reconstructFromPixels(topology(2),[],512,[0,0,6]),/RGBA/);
});

test('mixed shadow samples remain unknown instead of a majority-vote guess',()=>{
 const graph=topology(3),r=512,control=[0,0,16];
 const panels=Array.from({length:6},()=>new Uint8ClampedArray(r*r*4).fill(240));
 const a=graph.nodes.find(n=>n.id==='+X:1:0'),b=graph.nodes.find(n=>n.id==='+X:1:1');
 const site=edgeSite(3,a,b),[x,y]=shadowOffset(control,site.x,site.y),half=receiverHalf(3);
 const col=Math.floor((x+half)/(2*half)*r),row=Math.floor((half-y)/(2*half)*r);
 panels[0][4*(row*r+col)]=24;
 const reading=reconstructFromPixels(graph,panels,r,control).find(u=>edgeKey(u.a,u.b)===edgeKey(a.id,b.id));
 assert.equal(reading.state,'unknown');
});

test('fractional aperture and corner captures never label unsupported pixels',()=>{
 const maze=generate(4,29),graph=topology(4),r=512;
 for(const control of [[.25,-.75,3.5],[-1.25,1.75,8.5],[2,-2,16],[-2,2,16],[4,4,3]]){
  const readings=reconstructFromPixels(graph,pixels(maze,control,r),r,control);
  for(const u of readings)if(u.state!=='unknown')assert.equal(u.state==='open',maze.open.has(edgeKey(u.a,u.b)));
 }
});

test('known cube seam fixtures pair front-face borders with correct neighboring cells',()=>{
 for(const n of [2,5,12]){
  const graph=topology(n);
  for(let i=0;i<n;i++){
   assert(graph.adjacency.get(`+Z:0:${i}`).includes(`+Y:${n-1}:${i}`));
   assert(graph.adjacency.get(`+Z:${i}:${n-1}`).includes(`+X:${i}:0`));
   assert(graph.adjacency.get(`+Z:${i}:0`).includes(`-X:${i}:${n-1}`));
  }
 }
});

test('independent single wall fixture blocks its boundary and preserves a neighboring passage',()=>{
 const graph=topology(3),resolution=512,control=[0,0,16];
 // Hand-placed vertical wall between row 1 columns 0 and 1 on +X.
 const wall={min:[-.5375,-.5375,0],max:[-.4625,.5375,.25]};
 const panels=Array.from({length:6},(_,f)=>shadowPixels(THREE,f===0?[wall]:[],3,control,resolution).data);
 const readings=new Map(reconstructFromPixels(graph,panels,resolution,control).map(u=>[edgeKey(u.a,u.b),u.state]));
 assert.equal(readings.get(edgeKey('+X:1:0','+X:1:1')),'closed');
 assert.equal(readings.get(edgeKey('+X:1:1','+X:1:2')),'open');
});
