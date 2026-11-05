import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const launch=readFileSync(new URL('../local_models/launch.py',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
test('verified dense multimodal checkpoints and no stale identifiers',()=>{
 assert.match(launch,/Qwen\/Qwen3\.5-27B/);
 assert.match(launch,/google\/gemma-4-31B-it/);
 for(const bad of ['Qwen3-VL-30B-A3B-Instruct','gemma-3-27b-it']) {
  assert.ok(!launch.includes(bad)); assert.ok(!server.includes(bad));
 }
});
