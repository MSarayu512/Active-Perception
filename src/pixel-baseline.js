import {FACES, shortestPath, edgeKey} from './maze.js';
import {isLit, shadowOffset, obliquityAt, apertureBound, receiverHalf, maxLightHeight, validateLight} from './shadows.js';
// Reads only supplied receiver pixels and PUBLIC topology, never maze.open or wall boxes.

// Local receiver coordinates of the boundary between two adjacent cells, plus its orientation.
export function edgeSite(topologySize, a, b) {
 const n = topologySize;
 let x = a.c + .5 - n / 2, y = n / 2 - a.r - .5, vertical;
 if (a.f === b.f) { x = (a.c + b.c + 1) / 2 - n / 2; y = n / 2 - (a.r + b.r + 1) / 2; vertical = a.c !== b.c; }
 else {
  const f = FACES[a.f], bn = FACES[b.f].n;
  const du = bn.reduce((s, v, i) => s + v * f.u[i], 0), dv = bn.reduce((s, v, i) => s + v * f.v[i], 0);
  x += du * .5; y += dv * .5; vertical = du !== 0;
 }
 return {x, y, vertical};
}
// Below this receiver resolution the displaced shadow of a .075-thick wall is under ~3 px
// and the deterministic reader starts misclassifying edges. Measured, not assumed.
export const MIN_READ_RESOLUTION = 384;
// A ray that leaves the receiver too flat is blocked by walls far from the sample, so a
// grazing reading reports a wall that is not there. Refuse to read above this ratio of
// horizontal distance to light height. Measured below; see README.
export const MAX_OBLIQUITY = 0.5;
const SAMPLES = [-.15, 0, .15];
// An edge is READABLE only when all of its sample points fall inside this light's lit patch.
export function edgeReadable(size, light, site) {
 return SAMPLES.every(o => {
  const x = site.x + (site.vertical ? 0 : o), y = site.y + (site.vertical ? o : 0);
  const [sx, sy] = shadowOffset(light, x, y);
  // Both the wall base and where its shadow would fall must lie inside the lit patch,
  // and the view must not be so flat that a distant wall occludes the sample.
  const obliquity = obliquityAt(light, x, y);
  return obliquity <= MAX_OBLIQUITY && isLit(size, light, x, y) && isLit(size, light, sx, sy)
   && Math.abs(sx) <= receiverHalf(size) && Math.abs(sy) <= receiverHalf(size);
 });
}
function vote(size, panels, resolution, face, site, light) {
 let dark = 0;
 for (const o of SAMPLES) {
  // Sample where this wall's shadow actually lands, not under the wall itself.
  const [u, v] = shadowOffset(light, site.x + (site.vertical ? 0 : o), site.y + (site.vertical ? o : 0));
  const R = receiverHalf(size);
  const c = Math.max(0, Math.min(resolution - 1, Math.floor((u + R) / (2 * R) * resolution)));
  const r = Math.max(0, Math.min(resolution - 1, Math.floor((R - v) / (2 * R) * resolution)));
  if (panels[face][4 * (r * resolution + c)] < 128) dark++;
 }
 // Mixed samples are ambiguous, not a majority-vote guess.
 return dark===3?true:dark===0?false:null;
}
// Single observation: edges outside the lit patch are reported 'unknown', never guessed.
export function reconstructFromPixels(topology, panels, resolution, light) {
 validateLight(light, topology.size);
 if(!Number.isInteger(resolution)||resolution<1||!Array.isArray(panels)||panels.length!==6||panels.some(p=>!(p instanceof Uint8ClampedArray)||p.length!==resolution*resolution*4))throw Error('Six complete RGBA receivers are required');
 const n = topology.size, byId = new Map(topology.nodes.map(a => [a.id, a]));
 return topology.edges.map(({a, b}) => {
  const aa = byId.get(a), bb = byId.get(b);
  const sa = edgeSite(n, aa, bb), readableA = edgeReadable(n, light, sa);
  const sb = aa.f !== bb.f ? edgeSite(n, bb, aa) : null, readableB = sb ? edgeReadable(n, light, sb) : false;
  if (!readableA && !readableB) return {a, b, state: 'unknown'};
  const votes=[];
  if(readableA)votes.push(vote(n,panels,resolution,aa.f,sa,light));
  if(readableB)votes.push(vote(n,panels,resolution,bb.f,sb,light));
  if(votes.includes(null)||votes.some(v=>v!==votes[0]))return {a,b,state:'unknown'};
  const closed = votes[0];
  return {a, b, state: closed ? 'closed' : 'open'};
 });
}
// Greedy next light: maximise the number of still-unknown edges that become readable.
export function planNextLight(topology, known, {heights = [...new Set([3, 4, 5, 6, 8, 10, 12, 16, maxLightHeight(topology.size)])]} = {}) {
 const n = topology.size, byId = new Map(topology.nodes.map(a => [a.id, a]));
 const pending = [];
 for (const {a, b} of topology.edges) {
  if (known.has(edgeKey(a, b))) continue;
  const aa = byId.get(a), bb = byId.get(b);
  pending.push(aa.f === bb.f ? [edgeSite(n, aa, bb)] : [edgeSite(n, aa, bb), edgeSite(n, bb, aa)]);
 }
 if (!pending.length) return null;
 const bound = apertureBound(n);
 let best = null, bestCount = -1, bestObliquity = Infinity;
 for (const h of heights) for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
  const light = [bound * i / 8, bound * j / 8, h];
  let count = 0, obliquity = 0;
  for (const sites of pending) {
   const site = sites.find(s => edgeReadable(n, light, s));
   if (!site) continue;
   count++;
   obliquity = Math.max(obliquity, obliquityAt(light, site.x, site.y));
  }
  // Prefer the light that reads the most new edges; break ties toward the least oblique view,
  // because oblique shadows from neighbouring walls are what corrupt a reading.
  if (count > bestCount || (count === bestCount && count > 0 && obliquity < bestObliquity)) {
   bestCount = count; bestObliquity = obliquity; best = light;
  }
 }
 return bestCount > 0 ? {light: best, newly_readable: bestCount, obliquity: Number(bestObliquity.toFixed(3))} : null;
}
// Accumulate claims across observations; later readable observations overwrite 'unknown'.
export function mergeClaims(previous, updates) {
 const map = new Map(previous);
 for (const u of updates) if (u.state !== 'unknown') map.set(edgeKey(u.a, u.b), u.state);
 return map;
}
export function baselineDecision(topology, panels, resolution, start, goal, light, previous = new Map()) {
 const updates = reconstructFromPixels(topology, panels, resolution, light);
 const map = mergeClaims(previous, updates);
 const fresh = updates.filter(u => u.state !== 'unknown' && previous.get(edgeKey(u.a, u.b)) !== u.state);
 const plan = planNextLight(topology, map);
 if (plan) return {type: 'measure', light: plan.light, confidence: 0.5,
   reason: `Deterministic pixel baseline: ${map.size}/${topology.edges.length} edges resolved; next light exposes ${plan.newly_readable} unread edges. Confidence is a fixed heuristic, not calibrated.`,
   map_updates: fresh};
 const open = new Set([...map].filter(([, v]) => v === 'open').map(([k]) => k));
 const path = shortestPath(topology, start, goal, open);
 return {type: path ? 'answer' : 'abstain', ...(path ? {path} : {}), confidence: 0.5,
  reason: `Deterministic pixel baseline: ${map.size}/${topology.edges.length} candidate edges read across ${'multiple'} apertures. Confidence is a fixed heuristic, not calibrated.`,
  map_updates: fresh};
}
