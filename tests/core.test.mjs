import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {generate,topology,shortestPath,faceWalls,scoreRoute} from '../src/maze.js';
import {shadowPixels,sampleShadow,litRegion,isLit,receiverHalf,obliquityAt,lampPosition} from '../src/shadows.js';
import {baselineDecision,reconstructFromPixels,planNextLight,mergeClaims,MIN_READ_RESOLUTION} from '../src/pixel-baseline.js';
import {edgeKey} from '../src/maze.js';
import {Experiment} from '../src/experiment.js';
import {validateLight,shadowOffset} from '../src/shadows.js';
import {buildMessages,parseDecision,diagnoseDecision} from '../server.mjs';

test('all supported dimensions and invalid dimension boundaries',()=>{
 for(let n=2;n<=8;n++){
  const t=topology(n);assert.equal(t.nodes.length,6*n*n);assert.equal(t.edges.length,12*n*n);
  assert.equal(t.edges.filter(e=>e.a.split(':')[0]!==e.b.split(':')[0]).length,12*n);
 }
 for(const n of [null,'4',1,2.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>topology(n),/Face size/);
});

test('generation supports a spanning tree or fully open surface; walls duplicate only seams',()=>{
 const tree=generate(3,7,0),full=generate(3,7,1);
 assert.equal(tree.open.size,tree.nodes.length-1);
 assert.equal(full.open.size,full.edges.length);
 for(let f=0;f<6;f++)assert.deepEqual(faceWalls(full,f),[]);
 const closed={...full,open:new Set()};
 for(let f=0;f<6;f++){
  const walls=faceWalls(closed,f);assert.equal(walls.length,2*3*2+4*3);
  assert(walls.every(w=>w.min[2]===0&&w.max[2]===.25));
 }
});

test('routes distinguish unreachable, invalid, optimal and valid non-optimal paths',()=>{
 const m=generate(2,7),start=m.nodes[0].id,goal=m.nodes.at(-1).id;
 const p=shortestPath(m,start,goal);
 assert.deepEqual(shortestPath(m,start,start),[start]);
 assert.equal(shortestPath(m,start,goal,new Set()),null);
 for(const path of [null,[],[goal,start],[start,'missing',goal]])assert.equal(scoreRoute(m,path,start,goal).valid,false);
 const detour=[p[0],p[1],p[0],...p.slice(1)];
 assert.equal(scoreRoute(m,detour,start,goal).valid,true);
 assert.equal(scoreRoute(m,detour,start,goal).optimal,false);
 assert.equal(scoreRoute(m,detour,start,goal).length,p.length+1);
});

test('controls enforce finite values, dimensionality and inclusive bounds',()=>{
 for(const control of [[-4,4,3],[4,-4,16],[0,0,6]])assert.deepEqual(validateLight(control,4),control);
 for(const control of [null,{},[],[0,0],[0,0,6,1],[NaN,0,6],[0,Infinity,6],[0,0,'6'],[4.01,0,6],[0,-4.01,6],[0,0,2.99],[0,0,16.01]])
  assert.throws(()=>validateLight(control,4),/Control must/);
 assert.deepEqual(shadowOffset([0,0,4],3,-3),[3.2,-3.2]);
 assert(litRegion(4,[0,0,3]).half>litRegion(4,[0,0,16]).half);
});

test('occlusion ignores objects beyond the lamp; empty receiver statistics match its pixels',()=>{
 const beyond=new THREE.Box3(new THREE.Vector3(-1,-1,7),new THREE.Vector3(1,1,8));
 assert.equal(sampleShadow(THREE,[beyond],[0,0,0],[0,0,6]),false);
 const result=shadowPixels(THREE,[],3,[0,0,6],32);
 let dark=0;
 for(let i=0;i<result.data.length;i+=4){
  const value=result.data[i];assert([24,240].includes(value));
  assert.equal(result.data[i+1],value);assert.equal(result.data[i+2],value);assert.equal(result.data[i+3],255);
  if(value===24)dark++;
 }
 assert.equal(result.darkFraction,dark/1024);
 assert.equal(result.litFraction,1-result.darkFraction);
 const unlit=shadowPixels(THREE,[],3,[3,3,6],32);
 assert.equal(unlit.litFraction,0);assert.equal(unlit.darkFraction,1);
});

test('invalid decisions and mixed updates leave prior state unchanged',()=>{
 const e=new Experiment(generate(2,7));
 const good={type:'measure',light:[0,0,6],confidence:.5};
 const edge=e.maze.edges[0];
 e.apply({...good,map_updates:[{...edge,state:'open'}]},{measured:true});
 const snapshot=JSON.stringify(e.record());
 const bad=[null,{}, {...good,type:'stop'},...[-1,1.01,NaN,Infinity,'0.5'].map(confidence=>({...good,confidence})),
  {...good,map_updates:{}},{...good,map_updates:[{...edge,state:'closed'},{a:'bad',b:'bad',state:'open'}]},
  {type:'answer',confidence:.5,path:['bad']},
  {type:'answer',confidence:.5,path:Array(e.maze.nodes.length*2+1).fill(e.start)}];
 for(const d of bad){assert.throws(()=>e.apply(d));assert.equal(e.map.get(edge.key),'open');assert.equal(e.decisions.length,1);}
 assert.equal(JSON.parse(snapshot).result,null);assert.equal(e.result,null);
});

test('malformed sparse and positional formats are rejected',()=>{
 const e=new Experiment(generate(2,7));
 for(const sparse of [null,[],2,{'01':'O'},{'-1':'C'},{'1.5':'O'},{0:'bad'}])
  assert.throws(()=>e.normalize({edge_states_sparse:sparse}));
 for(const states of [null,42,'O','X'.repeat(48)])assert.throws(()=>e.normalize({edge_states:states}));
 assert.throws(()=>e.normalize({edge_states_sparse:{},edge_states:'?'.repeat(48)}));
 assert.throws(()=>e.normalize({edge_states:'?'.repeat(48),map_updates:[{}]}));
});

test('explicit unknown retracts a claim while compact unknown preserves it',()=>{
 const e=new Experiment(generate(2,7)),edge=e.maze.edges[0];
 const d={type:'measure',control:[0,0,6],confidence:.5};
 e.apply({...d,edge_states_sparse:{0:'O'}},{measured:true});
 e.apply({...d,edge_states_sparse:{0:'?'}},{measured:true});assert.equal(e.map.size,1);
 e.apply({...d,map_updates:[{a:edge.b,b:edge.a,state:'unknown'}]},{measured:true});
 assert.equal(e.map.size,0);assert.deepEqual(e.reconstructionSparse(),{});
});

test('coverage, accuracy and F1 count wrong and unclaimed passages correctly',()=>{
 const m=generate(2,7),e=new Experiment(m);
 assert.deepEqual(e.metrics(),{labeled:0,total:48,coverage:0,accuracy:null,open_edge_f1:0});
 const open=m.edges.filter(x=>m.open.has(x.key)),closed=m.edges.filter(x=>!m.open.has(x.key));
 e.apply({type:'measure',light:[0,0,6],confidence:.5,map_updates:[
  {...open[0],state:'open'},{...open[1],state:'closed'},
  {...closed[0],state:'open'},{...closed[1],state:'closed'}
 ]},{measured:true});
 assert.deepEqual(e.metrics(),{labeled:4,total:48,coverage:4/48,accuracy:.5,open_edge_f1:2/(m.open.size+2)});
});

test('milestones use first achievement, retain pause time and distinguish complete from exact',()=>{
 let clock=1000;const m=generate(2,7),e=new Experiment(m,{now:()=>clock});
 const d={type:'measure',light:[0,0,6],confidence:.5};
 clock=2000;e.apply({...d,edge_states_sparse:{0:'O'}},{measured:true});
 clock=3000;e.apply({...d,edge_states:'C'.repeat(48)},{measured:true});
 assert.equal(e.timing.first_reconstruction_seconds,1);assert.equal(e.timing.first_complete_reconstruction_seconds,2);
 assert.equal(e.timing.first_exact_reconstruction_seconds,null);
 clock=4000;e.apply({type:'abstain',confidence:0});
 clock=10000;e.apply({...d,edge_states:m.edges.map(x=>m.open.has(x.key)?'O':'C').join('')},{measured:true});
 assert.equal(e.stop,null);assert.equal(e.timing.first_exact_reconstruction_seconds,9);
 clock=11000;e.apply({type:'answer',confidence:1,path:shortestPath(m,e.start,e.goal)});
 assert.equal(e.timing.task_success_seconds,10);assert.equal(e.timing.task_answer_seconds,10);
 assert.equal(e.timing.first_complete_reconstruction_seconds,2);
 assert.throws(()=>e.apply(d),/ended/);assert.throws(()=>e.recordObservation({},.1),/ended/);
});

test('budget and minimum-measurement policy permit terminal answers at exhaustion',()=>{
 for(const budget of [0,-1,1.5,NaN,Infinity,'2'])assert.throws(()=>new Experiment(generate(2,7),{budget}));
 const e=new Experiment(generate(2,7),{budget:1,requireMeasurements:3});
 assert.throws(()=>e.apply({type:'abstain',confidence:0}),/at least/);
 e.recordObservation({step:1,panels:[]},.25);
 assert.equal(e.input().budget_remaining,0);assert.throws(()=>e.recordObservation({},.1),/budget/);
 e.apply({type:'answer',confidence:0,path:[]});
 assert.equal(e.result.valid,false);assert.equal(e.timing.task_success_seconds,null);
 assert.equal(e.stop.budget_unused,0);assert.equal(e.timing.measurement_seconds,.25);
});

test('input windows retain cumulative claims and export retains full history',()=>{
 const e=new Experiment(generate(2,7),{readableMask:false});
 for(let i=1;i<=25;i++){
  e.recordObservation({step:i,light:[0,0,6],panels:[]},.1);
  e.apply({type:'measure',control:[0,0,6],confidence:.5,edge_states_sparse:{0:'O'}},{measured:true});
 }
 const input=e.input();assert.deepEqual(input.history.map(o=>o.step),[18,19,20,21,22,23,24,25]);
 assert.equal(input.decisions.length,16);assert.equal(input.reconstruction[0],'O');
 assert(input.decisions.every(d=>!('metrics' in d)));assert(input.history.every(o=>!('readable_edge_ids' in o)));
 const record=JSON.parse(JSON.stringify(e.record()));
 assert.equal(record.observations.length,25);assert.equal(record.decisions.length,25);
 assert.equal(record.budget,null);assert.equal(record.stop,null);assert.equal(record.result,null);
 assert.equal(record.truth_open_edges.length,e.maze.open.size);
});

test('public readability does not depend on the maze seed or hidden walls',()=>{
 const a=new Experiment(generate(4,1)),b=new Experiment(generate(4,19));
 for(const light of [[0,0,6],[-2,2,16],[4,4,3]])assert.deepEqual(a.readable(light),b.readable(light));
});

test('planner terminates on complete claims and baseline abstains when no route exists',()=>{
 const graph=topology(2),known=new Map(graph.edges.map(e=>[e.key,'closed']));
 assert.equal(planNextLight(graph,known),null);
 assert.equal(planNextLight(graph,new Map(),{heights:[]}),null);
 const before=new Map(known),edge=graph.edges[0];
 const merged=mergeClaims(known,[{...edge,state:'unknown'}]);assert.deepEqual(known,before);assert.deepEqual(merged,known);assert.notEqual(merged,known);
 const d=baselineDecision(graph,Array.from({length:6},()=>new Uint8ClampedArray(32*32*4)),32,graph.nodes[0].id,graph.nodes.at(-1).id,[0,0,6],known);
 assert.equal(d.type,'abstain');assert.deepEqual(d.map_updates,[]);
});

test('both provider formats cap images, preserve metadata, and never mutate input',()=>{
 const png='data:image/png;base64,YQ==',annotated='data:image/png;base64,Yg==';
 const input={history:Array.from({length:10},(_,i)=>({step:i+1,light:[0,0,6],panels:[{face:'+X',png,model_png:annotated}]}))};
 const before=structuredClone(input);
 for(const kind of ['anthropic','openai-compatible']){
  const content=buildMessages(input,kind),meta=JSON.parse(content[0].text);
  assert.equal(content.length,17);assert.equal(meta.history.length,10);
  assert.match(meta.history[0].panels[0].images_omitted,/older/);
  assert(!content[0].text.includes('base64'));
  const images=content.filter(x=>x.type===(kind==='anthropic'?'image':'image_url'));
  assert.equal(images.length,8);
  for(const image of images)assert.equal(kind==='anthropic'?image.source.data:image.image_url.url,kind==='anthropic'?'Yg==':annotated);
 }
 assert.deepEqual(input,before);
 for(const png of [undefined,'https://example.com/image.png','data:text/plain;base64,YQ==','data:image/png;base64,!'])
  assert.throws(()=>buildMessages({history:[{panels:[{png}]}]},'anthropic'),/Invalid panel PNG/);
 assert.deepEqual(buildMessages({},'anthropic'),[{type:'text',text:'{}'}]);
});

test('cube topology: every cell has four reciprocal neighbors, including all seams',()=>{
 for(const size of [2,3,4,6,8]){const t=topology(size);assert.equal(t.nodes.length,6*size*size);assert.equal(t.edges.length,12*size*size);
  for(const [a,neighbors] of t.adjacency){assert.equal(new Set(neighbors).size,4);for(const b of neighbors)assert(t.adjacency.get(b).includes(a));}}
});
test('seed reproducibility, connected generation, and route validation',()=>{
 for(let seed=0;seed<20;seed++){const m=generate(3,seed);assert.deepEqual([...m.open],[...generate(3,seed).open]);for(const node of m.nodes)assert(shortestPath(m,m.nodes[0].id,node.id));const start=m.nodes[0].id,goal=m.nodes.at(-1).id,p=shortestPath(m,start,goal);assert(scoreRoute(m,p,start,goal).optimal);assert(!scoreRoute(m,[start,goal],start,goal).valid);}
});
test('exact shadows: the aperture limits the patch, the patch follows the aperture, rays stay steep',()=>{
 const box={min:[-.25,-.25,0],max:[.25,.25,.25]};
 const empty=shadowPixels(THREE,[],2,[0,0,6],64),over=shadowPixels(THREE,[box],2,[0,0,6],64),side=shadowPixels(THREE,[box],2,[1,0,6],64);
 assert(empty.darkFraction>0,'aperture must leave unlit area');
 assert(empty.litFraction>0&&empty.litFraction<1,'one measurement must never light the whole receiver');
 assert(over.darkFraction>empty.darkFraction,'a wall inside the patch must add shadow');
 assert.notDeepEqual(over.data,side.data,'moving the aperture must change the image');
 // The patch now FOLLOWS the aperture rather than opposing it; that is what keeps rays steep.
 assert(litRegion(4,[2,0,6]).cx>0&&litRegion(4,[-2,0,6]).cx<0);
 for(const h of [3,4,6,8,10])assert(2*litRegion(4,[0,0,h]).half<2*receiverHalf(4),`height ${h} must not cover the receiver`);
 // The lamp stays central, so obliquity is bounded by receiverHalf/height everywhere.
 for(const h of [3,6,10])assert(obliquityAt([3,3,h],receiverHalf(4),receiverHalf(4))<=receiverHalf(4)*Math.SQRT2/h+1e-9);
 assert.deepEqual(lampPosition([2,-1,6]),[0,0,6],'the agent must not move the lamp sideways');
 assert(isLit(4,[0,0,6],0,0)&&!isLit(4,[0,0,6],2.9,2.9));
 const b=new THREE.Box3(new THREE.Vector3(...box.min),new THREE.Vector3(...box.max));
 assert(sampleShadow(THREE,[b],[0,0,.0001],[0,0,6]));assert(!sampleShadow(THREE,[b],[.8,.8,.0001],[0,0,6]));
});
test('no single measurement can resolve every edge, and repeating one light adds nothing',()=>{
 const size=4,m=generate(size,3),topo=topology(size),RES=192;
 for(const light of [[0,0,3],[0,0,6],[0,0,10],[2,2,6]]){
  const panels=Array.from({length:6},(_,f)=>shadowPixels(THREE,faceWalls(m,f),size,light,RES).data);
  const rec=reconstructFromPixels(topo,panels,RES,light);
  const known=rec.filter(u=>u.state!=='unknown').length;
  assert(known<topo.edges.length,`light ${light} must not resolve every edge`);
  for(const u of rec)if(u.state!=='unknown')assert.equal(u.state==='open',m.open.has(edgeKey(u.a,u.b)),'readable edges must be read correctly');
 }
 const light=[0,0,6];const panels=Array.from({length:6},(_,f)=>shadowPixels(THREE,faceWalls(m,f),size,light,RES).data);
 let map=new Map();for(let i=0;i<5;i++)map=mergeClaims(map,reconstructFromPixels(topo,panels,RES,light));
 assert(map.size<topo.edges.length,'repeating the same light must not reach full coverage');
});
test('an active light sequence reaches full, exact coverage and solves the route',()=>{
 for(const size of [2,3,4])for(const seed of [1,7,19]){
  const m=generate(size,seed),topo=topology(size),RES=MIN_READ_RESOLUTION,e=new Experiment(m,{budget:20});
  let map=new Map(),light=[0,0,6],steps=0,decision=null;
  while(steps<20){
   const panels=Array.from({length:6},(_,f)=>shadowPixels(THREE,faceWalls(m,f),size,light,RES).data);
   e.recordObservation({step:++steps,light,panels:[]},.01);
   decision=baselineDecision(topo,panels,RES,e.start,e.goal,light,map);
   map=mergeClaims(map,decision.map_updates);
   if(decision.type!=='measure')break;
   light=decision.light;
  }
  e.apply({...decision,map_updates:[...map].map(([k,state])=>{const [a,b]=k.split('|');return {a,b,state};})});
  assert.equal(e.metrics().coverage,1,`size ${size} seed ${seed} coverage`);
  assert.equal(e.metrics().accuracy,1,`size ${size} seed ${seed} accuracy`);
  assert(e.result.optimal,`size ${size} seed ${seed} route`);
  assert(steps>1,`size ${size} seed ${seed} must need more than one measurement`);
 }
});
test('invalid updates are atomic; budgets, abstention and timings are honest',()=>{
 let clock=0;const e=new Experiment(generate(2,7),{budget:1,now:()=>clock});clock=1200;
 assert.throws(()=>e.apply({type:'answer',confidence:2,path:[]}));assert.equal(e.map.size,0);
 e.recordObservation({step:1,panels:[]},.2);assert.throws(()=>e.validate({type:'measure',light:[0,0,8],confidence:.1}));assert.throws(()=>e.validate({type:'measure',light:[0,0,1],confidence:.1},true),/height/);

 assert.throws(()=>e.apply({type:'abstain',confidence:.1,map_updates:[{a:'bad',b:'bad',state:'open'}]}));assert(!e.done);
 e.apply({type:'abstain',confidence:.1,reason:'insufficient evidence',map_updates:[]});assert(e.done);assert.equal(e.timing.task_answer_seconds,1.2);assert.equal(e.timing.task_success_seconds,null);assert.equal(e.timing.first_reconstruction_seconds,null);
});
test('last allowed capture can commit its decision',()=>{
 const e=new Experiment(generate(2,7),{budget:1}),d={type:'measure',light:[0,0,8],confidence:.1};e.validate(d);e.recordObservation({panels:[]},.1);e.apply(d,{measured:true});assert.equal(e.decisions.length,1);
});
test('provider input excludes truth, seed, accuracy and keys',()=>{
 const e=new Experiment(generate(2,7));const s=JSON.stringify(e.input());for(const name of ['truth','seed','accuracy','api_key'])assert(!s.includes(name));
 const image='data:image/png;base64,YQ==';e.recordObservation({step:1,light:[0,0,8],panels:[{face:'+X',png:image}]},.1);
 for(const provider of ['anthropic','openai-compatible']){const messages=buildMessages(e.input(),provider);assert.equal(messages.length,3);assert(!messages[0].text.includes('YQ=='));}
 assert.deepEqual(parseDecision('```json\n{"type":"abstain"}\n```'),{type:'abstain'});
});

test('compact reconstruction expands atomically and remains valid when normalized twice',()=>{
 const m=generate(2,7),e=new Experiment(m),states=m.edges.map(x=>m.open.has(x.key)?'O':'C').join('');
 const d={type:'answer',path:shortestPath(m,e.start,e.goal),confidence:.7,edge_states:states};
 e.apply(e.normalize(d));assert.equal(e.metrics().accuracy,1);assert.equal(e.metrics().coverage,1);assert(e.result.optimal);
 const e2=new Experiment(m);assert.throws(()=>e2.normalize({...d,edge_states:'OC'}));assert.equal(e2.map.size,0);
});
test('annotated model images replace raw images in provider content',()=>{
 const input={history:[{step:1,light:[0,0,8],panels:[{face:'+X',png:'data:image/png;base64,YQ==',model_png:'data:image/png;base64,Yg=='}]}]};
 const messages=buildMessages(input,'anthropic');assert.equal(messages[2].source.data,'Yg==');assert(!messages[0].text.includes('model_png'));assert(!messages[0].text.includes('YQ=='));
});

test('decision parsing survives fences and prose, and failures explain themselves',()=>{
 assert.equal(parseDecision('{"type":"abstain"}').type,'abstain');
 assert.equal(parseDecision('```json\n{"type":"abstain"}\n```').type,'abstain');
 assert.equal(parseDecision('Here it is:\n{"type":"measure","light":[0,0,3]}\nmore text').type,'measure');
 // A brace or escaped quote inside a string must not end the object early.
 assert.equal(parseDecision('{"type":"abstain","reason":"a { and a \\"quote\\""}').reason,'a { and a "quote"');
 assert.throws(()=>parseDecision('{"type":"answer","map_updates":[{"a":"+X:0:0","b'));
 assert.throws(()=>parseDecision('no object here'));
 const capped=diagnoseDecision('{"type":"answer","map_updates":[{"a','max_tokens',{output_tokens:8192});
 assert.match(capped.hint,/token cap/);assert.equal(capped.stop_reason,'max_tokens');
 assert.match(diagnoseDecision('I cannot tell.','end_turn',{}).hint,/no JSON object/);
 assert.match(diagnoseDecision('{"type":"answer","map','end_turn',{}).hint,/cut off/);
});

test('the control key is accepted as an alias for light',()=>{
 const e=new Experiment(generate(2,7),{budget:3});
 const d=e.normalize({type:'measure',control:[0,0,6],confidence:.5});
 assert.deepEqual(d.light,[0,0,6]);assert.doesNotThrow(()=>e.validate(d));
});

test('sparse index-keyed reconstruction is accepted and the payload stays compact',()=>{
 const m=generate(8,1),e=new Experiment(m,{budget:14});
 e.recordObservation({step:1,light:[0,0,6],panels:[]},.01);
 const input=e.input();
 assert.equal(typeof input.candidate_edges[0],'string','candidate_edges must be compact strings indexed by id');
 assert.equal(input.candidate_edges.length,768);
 const ids=input.history[0].readable_edge_ids;
 assert(Array.isArray(ids)&&ids.length>0&&ids.length<768,'a measurement must expose some but not all edges');
 // Claim only the readable ids, exactly as the prompt instructs.
 const sparse=Object.fromEntries(ids.map(i=>[i,m.open.has(edgeKey(m.edges[i].a,m.edges[i].b))?'O':'C']));
 const d=e.normalize({type:'measure',control:[0,0,6],confidence:.5,edge_states_sparse:sparse});
 assert.equal(d.map_updates.length,ids.length);
 e.apply(d,{measured:true});
 assert.equal(e.metrics().labeled,ids.length);
 assert.equal(e.metrics().accuracy,1);
 assert.equal(e.input().reconstruction[ids[0]],sparse[ids[0]],'reconstruction echoes the same ids');
 // Bad keys and values are rejected, and the formats are mutually exclusive.
 assert.throws(()=>e.normalize({type:'measure',control:[0,0,6],edge_states_sparse:{'9999':'O'}}),/candidate edge id/);
 assert.throws(()=>e.normalize({type:'measure',control:[0,0,6],edge_states_sparse:{'0':'X'}}),/O, C or \?/);
 assert.throws(()=>e.normalize({type:'measure',control:[0,0,6],edge_states_sparse:{'0':'O'},map_updates:[{a:'+X:0:0',b:'+X:0:1',state:'open'}]}),/exactly one/);
});

test('autonomous mode has no measurement count deadline and uncertainty preserves a resumable run',()=>{
 const e=new Experiment(generate(2,1));assert.equal(e.input().budget_remaining,null);
 for(let i=0;i<25;i++)e.recordObservation({step:i+1,light:[0,0,6],panels:[]},.01);
 assert.doesNotThrow(()=>e.validate({type:'measure',light:[0,0,6],confidence:.1}));
 e.apply({type:'abstain',confidence:.1,reason:'need clearer view'});assert.equal(e.done,false);assert.equal(e.result,null);assert.equal(e.stop.reason,'model_uncertain_paused');assert.equal(e.timing.task_answer_seconds,null);
 assert.equal(e.input().history.length,8);assert.equal(e.input().measurements_taken,25);assert.equal(e.record().budget,null);
});

test('unknown compact entries cannot erase previously learned edges',()=>{
 const e=new Experiment(generate(2,1));e.apply({type:'measure',control:[0,0,6],confidence:.5,edge_states_sparse:{0:'O'}},{measured:true});
 e.apply({type:'measure',control:[0,0,6],confidence:.5,edge_states_sparse:{0:'?',1:'C'}},{measured:true});assert.equal(e.map.size,2);
 e.apply({type:'measure',control:[0,0,6],confidence:.5,edge_states:'?'.repeat(48)},{measured:true});assert.equal(e.map.size,2);
});

test('size 8 permits every candidate edge and every seam to become readable',()=>{
 const e=new Experiment(generate(8,7)),union=new Set();
 for(let u=-8;u<=8;u++)for(let v=-8;v<=8;v++)for(const id of e.readable([u,v,16]))union.add(id);
 assert.equal(union.size,768);
 const seams=e.maze.edges.map((edge,id)=>({...edge,id})).filter(e=>e.a.split(':')[0]!==e.b.split(':')[0]);
 assert.equal(seams.length,96);assert(seams.every(e=>union.has(e.id)));
 assert.deepEqual(e.geometry().light_height_range,[3,16]);assert.equal(e.geometry().corner_readability_height,12);
 assert.doesNotThrow(()=>e.validate({type:'measure',light:[-3,3,16],confidence:.2}));
});
