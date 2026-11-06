import http from 'node:http';
import { randomUUID } from "node:crypto";
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
let port=Number(process.env.PORT||8000);
const provider=process.env.LLM_PROVIDER||'anthropic',model=process.env.LLM_MODEL||'',key=process.env.LLM_API_KEY||'';
const localProvider=provider==='local-vllm';
const base=(process.env.LLM_BASE_URL||(provider==='anthropic'?'https://api.anthropic.com/v1':'https://api.openai.com/v1')).replace(/\/$/,'');
const system=`EVIDENCE GATE. Every claim is checked against captured raw pixels before acceptance. Ambiguous or conflicting readings stay unknown. A route must use observed, claimed-open edges, and cannot be certified shortest while unresolved edges allow a shorter route. Do not answer prematurely. This is a pixel-verified experiment even when only images are shown to you. Receiver resolution varies with maze size; use each observation's resolution and geometry, not fixed pixel dimensions.
You are solving a maze on the SIX SURFACES of a cube, not its interior. Each face has size x size cells. IDs are FACE:row:column, row 0 at top, column 0 at left. Candidate edges list all geometrically adjacent cell pairs, including cube seams, but do NOT reveal passages. A closed edge has a raised wall; an open edge has no wall. All cells exist.
OPTICS. The lamp hangs HIGH and CENTRED above each face at (0,0,height). You do not move it sideways. An opaque canopy below it carries ONE square hole, and you move that HOLE. Light reaches the floor only through the hole, so a single measurement lights only a SQUARE PATCH of each face. Everything outside the patch is dark because it is unlit, NOT because a wall shadows it; never read unlit area as walls. Your action is "control": [aperture_u, aperture_v, lamp_height]. geometry.lit_patch_rule gives the patch: it FOLLOWS the aperture, centre = aperture/k with k = 1 - canopy_height/lamp_height, half-width = aperture_side/(2k). A LOWER lamp gives a WIDER patch but flatter rays that are harder to read; a HIGHER lamp gives a narrower, crisper patch. geometry.shadow_rule: the lamp is central, so a wall at (x,y) throws its shadow radially outward to height/(height-0.25) * [x,y]. Look for a wall's shadow slightly further from the centre than the wall itself.
STOPPING. run_policy=autonomous means there is no preset measurement count: budget_remaining is null, NOT zero. Iterate by selecting informative controls and recording supported partial claims. Answer when you have a route supported by your observed open edges. You do not need to reconstruct irrelevant edges before answering. If evidence is insufficient, choose another region or height; do not fabricate claims. If you genuinely cannot make progress, abstain with a specific reason; in autonomous mode this pauses for operator review instead of discarding the run. In budgeted mode, budget_remaining=0 means answer or abstain.
CALIBRATION. Positive aperture_u moves the lit patch right; positive aperture_v moves it UP toward row 0. Corner seams can require a taller lamp; moving only u/v cannot reduce obliquity. See geometry.corner_readability_height and geometry.light_height_range. At size 8, height 12 or 16 can expose corner seams that height 6 cannot. Absence from a current readable_edge_ids list does NOT mean an edge can never be read.
PARTIAL PROGRESS. Prefer a small, supported partial reconstruction over zero updates. Record edges you can actually read in this measurement, even a handful, and omit unread edges. Claims accumulate across calls, so zero updates wastes the measurement you just paid for.
Each observation carries readable_edge_ids, derived only from public geometry and the control settings. Cyan edge-id labels and short pointers in the annotated images identify predicted shadow sample positions. Labels and pointers are calibration, NOT walls. Inspect black shadows versus illuminated floor near the pointer. Only label edges that the image actually supports.
NO SINGLE LIGHT CAN READ A WHOLE FACE. Plan a sequence of lights that sweeps the patch over every region you still need, and prefer the least oblique light that reaches the cells you want. Each observation reports lit_region and lit_fraction; use them to judge how much of the maze that measurement could possibly have shown and move the light accordingly.
IMAGES. Blue calibration labels: r=row, c=column; faint dotted blue lines are the public cell grid, NOT walls. Dark pixels are unlit or shadowed; white is lit floor. The raw receiver has observation.resolution pixels per side inside a 48px labeled margin and spans geometry.receiver_span in both axes; the cells occupy only geometry.cells_span, so there is a blank margin where seam shadows land. Six receivers are measured simultaneously with the same LOCAL light [u,v,height] on each face. Wall height .25, thickness .075. Pixel rows run top to bottom. Seams have walls on BOTH bordering faces when closed.
OUTPUT SIZE. Reply with the JSON object ONLY: no preamble, no explanation outside it, no markdown fences. Keep the reason field under 200 characters. Return at most 256 edge updates per reply, prioritizing newly observed edges relevant to the route. Do not repeat unchanged reconstruction entries or include unknown entries. If more edges are readable, report a supported subset; claims accumulate across calls.
HOW TO RECORD WHAT YOU READ. Every observation lists readable_edge_ids: the candidate edge ids whose walls that measurement could actually show. For each of those ids, decide O (no wall, open) or C (wall, closed) from the image, and return them in "edge_states_sparse": an object keyed by candidate edge id, for example {"20":"O","22":"C","24":"O"}. Report ONLY ids you looked at; omit the rest. Do NOT return a full-length positional string and do NOT return hundreds of {a,b,state} objects. candidate_edges is an array where the ARRAY INDEX is the id and the value is "cellA|cellB", so id 20 means candidate_edges[20]. reconstruction shows what you have already claimed, keyed by the same ids.
When evidence is ambiguous, leave it unclaimed and choose a new observation. Do not invent edge states just to increase coverage.
RECONSTRUCTION. Return edge_states_sparse only. Never output edge_states or map_updates. Claims accumulate across calls; omitted ids preserve earlier claims. In pixel-assisted track ONLY, pixel_evidence is a deterministic image-derived estimate as a positional string with ? for unread edges. You may use it, but it is not ground truth.
TASK. Reconstruct open/closed candidate edges and return a shortest path from query.start to query.goal. Use only provided evidence. Return ONLY a JSON object: {"type":"measure","light":[0,0,4],"confidence":0.5,"reason":"...","edge_states_sparse":{"20":"O","22":"C"}} OR {"type":"answer","path":["cell ID","..."],"confidence":0.7,"reason":"...","edge_states_sparse":{}} OR {"type":"abstain","confidence":0.1,"reason":"...","edge_states_sparse":{}}. lamp_height and |aperture_u|,|aperture_v| must respect geometry.light_height_range and geometry.aperture_uv_bound. The legacy key "light" is still accepted for the same vector. When budget_remaining=0, answer or abstain. Confidence is your self assessment. Do not fabricate certainty. A valid route and a shortest route are scored separately.`;
let active=false;
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>96*1024*1024)throw Error('Request too large');}return JSON.parse(text||'{}');}
function safeError(error){return String(error.message||error).replaceAll(key||'__no_key__','[redacted]').slice(0,400);}
export function providerConnectionError(error){
 const codes=[error?.cause?.code,...(error?.cause?.errors||[]).map(e=>e.code)].filter(code=>typeof code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(code));
 const code=[...new Set(codes)].join(', ');
 const timedOut=error?.name==='TimeoutError'||codes.some(c=>c.includes('TIMEOUT')||c==='ETIMEDOUT');
 return new Error(`Model provider ${timedOut?'request timed out':'connection failed'}${code?' ('+code+')':''}. The run is paused; existing progress is retained. Check network/VPN/proxy connectivity, then resume. No automatic retry was made.`,{cause:error});
}
// Providers cap images per request (Anthropic ~100) and every measurement adds six.
// Keep the newest observations as images; older ones survive as metadata in the JSON.
export const IMAGE_OBSERVATION_LIMIT=8;
export function buildMessages(input,kind){
 const clean=structuredClone(input),images=[];
 const history=clean.history||[],cut=Math.max(0,history.length-IMAGE_OBSERVATION_LIMIT);
 for(let i=0;i<cut;i++)for(const panel of history[i].panels||[]){delete panel.png;delete panel.model_png;panel.images_omitted='older than the most recent '+IMAGE_OBSERVATION_LIMIT+' measurements';}
 for(const obs of history.slice(cut))for(const panel of obs.panels||[]){
  const png=panel.model_png||panel.png;
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png))throw Error('Invalid panel PNG');
  images.push({label:`Measurement ${obs.step}, face ${panel.face}, aperture/height control ${JSON.stringify(obs.light)}`,url:png});delete panel.png;delete panel.model_png;
 }
 const content=kind==='anthropic'?[{type:'text',text:JSON.stringify(clean)}]:[{type:'text',text:JSON.stringify(clean)}];
 for(const image of images){content.push({type:'text',text:image.label});content.push(kind==='anthropic'?{type:'image',source:{type:'base64',media_type:'image/png',data:image.url.split(',')[1]}}:{type:'image_url',image_url:{url:image.url}});}
 return content;
}
// Extract the first balanced top-level JSON object, ignoring braces inside strings.
export function extractJSON(text){
 const start=text.indexOf('{');if(start<0)return null;
 let depth=0,inString=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const ch=text[i];
  if(escaped){escaped=false;continue;}
  if(ch==='\\'){escaped=true;continue;}
  if(ch==='"'){inString=!inString;continue;}
  if(inString)continue;
  if(ch==='{')depth++;
  else if(ch==='}'&&--depth===0)return text.slice(start,i+1);
 }
 return null;
}
export function parseDecision(text){
 const stripped=text.trim().replace(/```(?:json)?/gi,'').trim();
 try{return JSON.parse(stripped);}catch{}
 const candidate=extractJSON(stripped);
 if(candidate===null)throw Error(text.includes('{')?'truncated':'no-json');
 return JSON.parse(candidate);
}
// Why a response could not be parsed, in terms the operator can act on.
export function diagnoseDecision(text,stopReason,usage){
 const trimmed=(text||'').trim(),capped=/max_tokens|length/i.test(String(stopReason||''));
 const hint=capped
  ?'The response hit the token cap. Return "edge_states_sparse" for only observed edge IDs instead of map_updates objects, raise LLM_MAX_TOKENS, or use a smaller face size.'
  :!trimmed.includes('{')?'The model returned prose with no JSON object. It must reply with the JSON decision only.'
  :extractJSON(trimmed)===null?'The JSON object is unbalanced, so the reply was cut off mid-object. Raise LLM_MAX_TOKENS or use sparse updates for observed edge IDs.'
  :'A JSON object was found but did not parse. Check for trailing commas, comments or duplicated keys.';
 return {error:'Provider returned invalid or truncated JSON. Run paused.',hint,stop_reason:stopReason??null,
  output_tokens:usage?.output_tokens??usage?.completion_tokens??null,text_length:trimmed.length,
  text_head:trimmed.slice(0,300),text_tail:trimmed.length>300?trimmed.slice(-300):''};
}
const server=http.createServer(async(req,res)=>{
 try{
  const expected=`localhost:${port}`,host=req.headers.host;
  if(![expected,`127.0.0.1:${port}`].includes(host)){json(res,403,{error:'Local requests only'});return;}
  if(req.headers.origin&&!['http://'+expected,`http://127.0.0.1:${port}`].includes(req.headers.origin)){json(res,403,{error:'Origin rejected'});return;}
  const url=new URL(req.url,`http://${expected}`);
  if(req.method==='GET'&&url.pathname==='/api/config'){json(res,200,{provider,model,configured:!!(model&&(key||localProvider)),local:localProvider,output_cap:Math.min(32000,Number(process.env.LLM_MAX_TOKENS)||32000)});return;}
  if(req.method==='GET'&&url.pathname==='/api/status'){json(res,200,{active});return;}
  if(req.method==='POST'&&url.pathname==='/api/model'){
   if(active){json(res,409,{error:'A model call is already in flight'});return;}
   if(!model||(!key&&!localProvider)){json(res,400,{error:'Configure LLM_MODEL and provider credentials (not required for local-vllm)'});return;}
   active=true;const started=performance.now(),disconnected=new AbortController();
   const onClose=()=>{if(!res.writableEnded)disconnected.abort();};
   res.on('close',onClose);
   try{
    const input=await body(req);if(!Array.isArray(input.history)||input.history.length>20)throw Error('Invalid observation history');
    if(input.history.reduce((n,o)=>n+(o.panels?.length||0),0)>20*6)throw Error('Observation history too large');
    const anthropic=provider==='anthropic';if(!anthropic&&provider!=='openai-compatible'&&!localProvider)throw Error('Unsupported LLM_PROVIDER');
    const endpoint=new URL(base+(anthropic?'/messages':'/chat/completions'));if(endpoint.protocol!=='https:'&&!(localProvider&&endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)))throw Error('Provider URL must use HTTPS, except loopback local-vllm');
    const content=buildMessages(input,provider),max_tokens=Math.min(32000,Math.max(512,Number(process.env.LLM_MAX_TOKENS)||32000));
    // const payload=anthropic?{model,max_tokens,system,messages:[{role:'user',content}]}:{model,max_tokens,messages:[{role:'system',content:system},{role:'user',content}]};
    const payload = anthropic? {
      model,
      max_tokens,
      system,
      messages: [{ role: 'user', content }]
    }
    : {
      model,
      [localProvider?'max_tokens':'max_completion_tokens']: max_tokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    };
    let response;
    try{response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(anthropic?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:`Bearer ${key||'local'}`})},body:JSON.stringify(payload),signal:AbortSignal.any([AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS)||1800000),disconnected.signal]),redirect:'error'});}
    catch(error){throw providerConnectionError(error);}
    if(!response.ok)throw Error(`Provider HTTP ${response.status}. No automatic retry was made.`);
    const raw = await response.json();

    const text = anthropic
      ? (raw.content || [])
          .filter(c => c.type === "text")
          .map(c => c.text)
          .join("\n")
      : raw.choices?.[0]?.message?.content;

    const stopReason = anthropic
      ? raw.stop_reason
      : raw.choices?.[0]?.finish_reason;

    const reasoningContent = anthropic
      ? null
      : raw.choices?.[0]?.message?.reasoning_content ?? null;

    const generationId = randomUUID();

    const record = {
      id: generationId,
      timestamp: new Date().toISOString(),
      model: raw.model || model,
      generated_text: text ?? null,
      reasoning_content: reasoningContent,
      reasoning_provenance: reasoningContent
        ? "provider_exposed"
        : "not_separately_exposed",
      usage: raw.usage ?? null,
      finish_reason: stopReason ?? null,
      validation_error: null
    };

    const saveDir = path.join(root, "runs", "raw-generations");

    await mkdir(saveDir, { recursive: true });

    const savePath = path.join(saveDir, `${generationId}.json`);

    async function saveGeneration() {
      await writeFile(
        savePath,
        JSON.stringify(record, null, 2),
        { mode: 0o600 }
      );
    }

    // Save before parsing.
    await saveGeneration();

    if (typeof text !== "string") {
      record.validation_error = "Provider returned no text";
      await saveGeneration();

      json(res, 422, {
        error: record.validation_error,
        generation_id: generationId,
        generated_text: text ?? null,
        reasoning_content: reasoningContent,
        reasoning_provenance: record.reasoning_provenance,
        usage: raw.usage ?? null,
        finish_reason: stopReason ?? null
      });
    return;
  }

    let decision;

    try {
      decision = parseDecision(text);

      if (
        !decision ||
        !["measure", "answer", "abstain"].includes(decision.type)
      ) {
        throw new Error(
          "Expected type measure, answer or abstain"
        );
      }

    } catch (error) {
      record.validation_error = error.message;

      record.validation_diagnostics = {
        ...diagnoseDecision(text, stopReason, raw.usage),
        actual_decision_type: decision?.type ?? null
      };

      await saveGeneration();

      json(res, 422, {
        error: error.message,
        generation_id: generationId,
        generated_text: text,
        reasoning_content: reasoningContent,
        usage: raw.usage,
        finish_reason: stopReason,
        seconds: (performance.now() - started) / 1000
      });

      return;
    }

    json(res, 200, {
      generation_id: generationId,
      decision,
      model: raw.model || model,
      usage: raw.usage,
      generated_text: text,
      reasoning_content: reasoningContent,
      reasoning_provenance: record.reasoning_provenance,
      finish_reason: stopReason,
      seconds: (performance.now() - started) / 1000
    });
   }catch(e){if(!res.destroyed)json(res,502,{error:safeError(e),seconds:(performance.now()-started)/1000});}finally{res.off('close',onClose);active=false;}return;
  }
  if(req.method==='POST'&&url.pathname==='/api/save'){
   const data=await body(req);if(!/^[a-f0-9-]{36}$/.test(data.id||''))throw Error('Invalid run ID');
   await mkdir(path.join(root,'runs'),{recursive:true});await writeFile(path.join(root,'runs',data.id+'.json'),JSON.stringify(data,null,2));json(res,200,{saved:true});return;
  }
  if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
  let target;
  if(url.pathname==='/')target='public/index.html';
  else if(url.pathname.startsWith('/src/'))target=url.pathname.slice(1);
  else if(url.pathname==='/vendor/three.module.js')target='node_modules/three/build/three.module.js';
  else if(url.pathname==='/vendor/three.core.js')target='node_modules/three/build/three.core.js';
  else if(url.pathname==='/vendor/OrbitControls.js')target='node_modules/three/examples/jsm/controls/OrbitControls.js';
  else if(/^\/(app.js|style.css|view.js|shadow-worker.js)$/.test(url.pathname))target='public'+url.pathname;
  if(!target||target.includes('..')||!/[.](html|js|css)$/.test(target)){json(res,404,{error:'Not found'});return;}
  const data=await readFile(path.join(root,target));res.writeHead(200,{'Content-Type':target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(e){json(res,400,{error:safeError(e)});}
});
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(port,'127.0.0.1',()=>{port=server.address().port;console.log(`LUMEN: http://localhost:${port} — ${model||'demo mode; configure .env for LLM'}`);});
