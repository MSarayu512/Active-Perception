import test from 'node:test';
import assert from 'node:assert/strict';
import {Evidence} from '../src/evidence.js';
import {topology} from '../src/maze.js';

test('a measurement proceeds without unsupported claims and records actionable feedback',()=>{
 const graph=topology(9),e=new Evidence(graph);
 const edge=graph.edges.find(x=>x.a==='+X:5:7'&&x.b==='+X:5:8');
 assert(edge);
 const decision={type:'measure',light:[2,0,18],confidence:.5,map_updates:[{...edge,state:'open'}]};
 const before=structuredClone(decision),claims=new Map();
 const prepared=e.prepare(decision,claims);
 assert.deepEqual(prepared.map_updates,[]);assert.deepEqual(prepared.light,decision.light);
 assert.equal(prepared.rejected_updates[0].reason,'not_observed_clearly');
 assert.equal(e.feedback[0].claims[0].edge,edge.key);
 assert.match(e.feedback[0].instruction,/NOT accepted/);
 assert.equal(claims.size,0);assert.deepEqual(decision,before);
});

test('supported claims survive alongside rejected ones; no corrective labels are injected',()=>{
 const graph=topology(3),e=new Evidence(graph),[a,b,c]=graph.edges;
 e.readings.set(a.key,{state:'open',step:1});e.readings.set(b.key,{state:'closed',step:1});e.conflicts.add(c.key);
 const result=e.prepare({type:'measure',map_updates:[{...a,state:'open'},{...b,state:'open'},{...c,state:'closed'}]},new Map());
 assert.deepEqual(result.map_updates,[{...a,state:'open'}]);
 assert.deepEqual(result.rejected_updates.map(x=>x.reason),['does_not_match_pixels','conflicting_observations']);
 assert(result.rejected_updates.every(x=>!('correct_state' in x)));
 assert.equal(e.record().feedback.length,1);
});

test('new evidence permits a formerly unsupported claim; answers remain strictly gated',()=>{
 const graph=topology(3),e=new Evidence(graph),edge=graph.edges[0];
 const update={...edge,state:'open'};
 e.prepare({type:'measure',map_updates:[update]},new Map());
 e.readings.set(edge.key,{state:'open',step:2});
 const accepted=e.prepare({type:'measure',map_updates:[update]},new Map());
 assert.deepEqual(accepted.map_updates,[update]);
 const other=graph.edges[1];
 assert.throws(()=>e.prepare({type:'answer',path:[other.a,other.b],map_updates:[{...other,state:'open'}]},new Map()),/Unsupported/);
 assert.equal(e.feedback.at(-1).type,'action_rejected');
 assert.equal(e.feedback.at(-1).action,'answer');
});
