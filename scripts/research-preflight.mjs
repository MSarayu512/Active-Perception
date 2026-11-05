import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {generate} from '../src/maze.js';
import {Experiment} from '../src/experiment.js';
import {validateLight} from '../src/shadows.js';
import {assertModelPayloadSafe} from '../research/claims.mjs';
const config=JSON.parse(await readFile(new URL('../research/config.json',import.meta.url)));
if(config.experiment!=='shadow-only-six-uncovered-faces'||config.face_size!==3||new Set(config.maze_seeds).size!==5)throw Error('Invalid initial benchmark specification');
if(!Number.isInteger(config.measurement_budget)||config.measurement_budget<1||!Number.isInteger(config.model_call_budget)||config.model_call_budget<config.measurement_budget+1)throw Error('Invalid budgets');
if(config.max_output_tokens!==32000)throw Error('Output cap changed');
validateLight(config.initial_control,config.face_size);
const manifests=[];
for(const seed of config.maze_seeds){const maze=generate(config.face_size,seed),experiment=new Experiment(maze,{budget:config.measurement_budget});const payload=experiment.input();assertModelPayloadSafe(payload,maze);manifests.push({maze_seed:seed,nodes:maze.nodes.length,candidate_edges:maze.edges.length,public_payload_sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});}
const manifest={created_at:new Date().toISOString(),config,software:{node:process.version,platform:process.platform,arch:process.arch},hardware:{cpus:os.cpus().length,total_memory_bytes:os.totalmem()},runs:manifests,renderer:'independent-local-face-receivers; NOT physically assembled opaque cube',execution:'preflight only; no model calls'};
const out=process.argv.includes('--save');if(out){await mkdir('research-results',{recursive:true});const file=`research-results/preflight-${Date.now()}.json`;await writeFile(file,JSON.stringify(manifest,null,2));console.log(file);}else console.log(JSON.stringify(manifest,null,2));
