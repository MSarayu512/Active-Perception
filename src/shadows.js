// Exact segment/box occlusion, using Three.js geometry. No GPU shadow-map precision dependence.
// Each face is measured on its own local receiver under the same calibrated control setting.
//
// APERTURE MODEL (v4). The lamp hangs HIGH and CENTRED above each face at (0,0,height).
// An opaque canopy at z = CANOPY_Z carries one square hole whose centre the agent moves.
// Light reaches the floor only through that hole, so one measurement lights only a square
// patch. Moving the APERTURE sweeps the patch; raising the LAMP narrows the patch but makes
// every ray steeper and therefore easier to read. Control vector = [aperture_u, aperture_v, height].
export const CANOPY_Z = 1;
export const WALL_HEIGHT = 0.25;
// The receiver extends one cell beyond the grid so shadows of seam walls still land on it.
export const MARGIN = 1;
export const receiverHalf = size => size / 2 + MARGIN;
export const LIGHT_MIN_HEIGHT = 3;
export const LIGHT_MAX_HEIGHT = 16;
export const maxLightHeight = size => Math.max(LIGHT_MAX_HEIGHT, 2 * size);
export const captureResolution = size => Math.max(512, Math.ceil((size + 2) * 51.2));
export const apertureSide = size => 0.45 * size;
export const apertureBound = size => size;

// Closed-form lit square on the receiver plane for a control [au, av, h].
export function litRegion(size, control) {
 const [au, av, h] = control, k = 1 - CANOPY_Z / h;
 return {half: apertureSide(size) / (2 * k), cx: au / k, cy: av / k};
}
export function isLit(size, control, x, y) {
 const {half, cx, cy} = litRegion(size, control);
 return Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
}
// The lamp itself, which the agent does not move laterally.
export const lampPosition = control => [0, 0, control[2]];
// Where a wall standing at (x,y) casts its shadow. The lamp is central, so displacement is radial.
export function shadowOffset(control, x, y) {
 const t = control[2] / (control[2] - WALL_HEIGHT);
 return [t * x, t * y];
}
// How flat the ray to the lamp is at (x,y). Bounded by receiverHalf/height, unlike v3.
export const obliquityAt = (control, x, y) => Math.hypot(x, y) / control[2];
export function validateLight(control, size) {
 const b = apertureBound(size);
 if (!Array.isArray(control) || control.length !== 3 || !control.every(Number.isFinite)
  || control[2] < LIGHT_MIN_HEIGHT || control[2] > maxLightHeight(size)
  || Math.abs(control[0]) > b || Math.abs(control[1]) > b)
  throw Error(`Control must be [aperture_u, aperture_v, height], height ${LIGHT_MIN_HEIGHT}-${maxLightHeight(size)}, |aperture_u| and |aperture_v| <= ${b}`);
 return control;
}
export const lightBound = apertureBound;
export function sampleShadow(THREE, boxes, point, light) {
 const {Vector3, Ray} = THREE;
 const origin = new Vector3(...point), dir = new Vector3(...light).sub(origin), distance = dir.length(); dir.normalize();
 const ray = new Ray(origin, dir), hit = new Vector3();
 return boxes.some(box => ray.intersectBox(box, hit) !== null && hit.distanceTo(origin) < distance - 1e-6);
}
export function shadowPixels(THREE, rawBoxes, size, control, resolution = 160) {
 const {Vector3, Box3} = THREE;
 validateLight(control, size);
 const boxes = rawBoxes.map(b => new Box3(new Vector3(...b.min), new Vector3(...b.max)));
 const lamp = lampPosition(control);
 const data = new Uint8ClampedArray(resolution * resolution * 4);
 let dark = 0, lit = 0;
 for (let r = 0; r < resolution; r++) for (let c = 0; c < resolution; c++) {
  const R = receiverHalf(size);
  const x = (c + .5) * 2 * R / resolution - R, y = R - (r + .5) * 2 * R / resolution;
  const inPatch = isLit(size, control, x, y);
  const blocked = !inPatch || sampleShadow(THREE, boxes, [x, y, .0001], lamp);
  if (inPatch) lit++;
  if (blocked) dark++;
  const v = blocked ? 24 : 240, i = 4 * (r * resolution + c);
  data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
 }
 const {half, cx, cy} = litRegion(size, control);
 return {data, darkFraction: dark / (resolution * resolution), litFraction: lit / (resolution * resolution),
         lit_region: {centre: [Number(cx.toFixed(4)), Number(cy.toFixed(4))], half_width: Number(half.toFixed(4))}};
}
