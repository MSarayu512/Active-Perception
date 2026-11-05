import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {View} from '../public/view.js';
import {FACES,generate,faceWalls,shortestPath} from '../src/maze.js';

// Exercise the actual visualization methods with real Three.js objects.
// Only renderer/DOM initialization is omitted: these are scene-geometry tests,
// not screenshot, GPU shading, or website-control tests.
function viewFor(t,maze=generate(3,7)){
 const view=Object.create(View.prototype);
 Object.assign(view,{scene:new THREE.Scene(),root:new THREE.Group(),groups:[],textures:[],
  camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}}});
 view.scene.add(view.root);view.build(maze);
 t.after(()=>{view.showRoute(null);view.clear();});
 return view;
}
function near(actual,expected,tolerance=1e-6){
 assert.equal(actual.length,expected.length);
 actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<tolerance,`${actual} != ${expected}`));
}

test('maze visualization places all six correctly oriented faces at every supported size',t=>{
 for(let size=2;size<=8;size++){
  const v=viewFor(t,generate(size,7));assert.equal(v.root.children.length,6);
  v.groups.forEach((g,i)=>{
   const f=FACES[i];near(g.position.toArray(),f.n.map(x=>x*size/2));
   for(const [axis,basis] of [[[1,0,0],f.u],[[0,1,0],f.v],[[0,0,1],f.n]])
    near(new THREE.Vector3(...axis).applyQuaternion(g.quaternion).toArray(),basis);
   const floor=g.children[0];assert.equal(floor.geometry.parameters.width,size);
   assert.equal(floor.geometry.parameters.height,size);assert.equal(floor.receiveShadow,true);
  });
 }
});

test('rendered wall meshes exactly match shadow-occluder boxes on every face',t=>{
 const v=viewFor(t);
 v.groups.forEach((g,f)=>{
  const boxes=faceWalls(v.maze,f),walls=g.children.slice(1);assert.equal(walls.length,boxes.length);
  walls.forEach((wall,i)=>{
   wall.geometry.computeBoundingBox();
   const bounds=wall.geometry.boundingBox.clone().translate(wall.position);
   near(bounds.min.toArray(),boxes[i].min);near(bounds.max.toArray(),boxes[i].max);
   assert.equal(wall.castShadow,true);assert.equal(wall.receiveShadow,true);assert.equal(wall.userData.wall,true);
  });
 });
});

test('fully open maze renders floors without any walls',t=>{
 const v=viewFor(t,generate(4,7,1));assert(v.groups.every(g=>g.children.length===1));
});

test('route visualization follows cells and bends around cube seams outside the cube',t=>{
 const v=viewFor(t),path=shortestPath(v.maze,v.maze.nodes[0].id,v.maze.nodes.at(-1).id);
 v.showRoute(path);
 const points=v.route.geometry.getAttribute('position'),seams=path.slice(1).filter((id,i)=>id.split(':')[0]!==path[i].split(':')[0]).length;
 assert(seams>0);assert.equal(points.count,path.length+seams);
 const nodes=new Map(v.maze.nodes.map(n=>[n.id,n]));let cursor=0;
 path.forEach((id,i)=>{
  if(i&&id.split(':')[0]!==path[i-1].split(':')[0])cursor++;
  const a=nodes.get(id),f=FACES[a.f];
  const expected=f.n.map((x,k)=>x*(v.maze.size/2+.3)+f.u[k]*(a.c+.5-v.maze.size/2)+f.v[k]*(v.maze.size/2-a.r-.5));
  near([points.getX(cursor),points.getY(cursor),points.getZ(cursor)],expected);cursor++;
 });
 // Every line segment stays on or beyond one outer cube plane, never cuts through it.
 for(let i=1;i<points.count;i++){
  const a=new THREE.Vector3().fromBufferAttribute(points,i-1),b=new THREE.Vector3().fromBufferAttribute(points,i);
  const midpoint=a.add(b).multiplyScalar(.5);
  assert(Math.max(...midpoint.toArray().map(Math.abs))>=v.maze.size/2+.3-1e-6);
 }
});

test('exploded faces, wall visibility and face focus preserve maze geometry',t=>{
 const v=viewFor(t);v.showRoute([v.maze.nodes[0].id]);
 v.setExploded(1);assert.equal(v.route.visible,false);
 v.groups.forEach((g,i)=>near(g.position.toArray(),FACES[i].n.map(x=>x*3)));
 v.setWalls(false);assert(v.groups.every(g=>g.children[0].visible&&g.children.slice(1).every(w=>!w.visible)));
 v.setWalls(true);v.setExploded(0);assert.equal(v.route.visible,true);
 v.groups.forEach((g,i)=>near(g.position.toArray(),FACES[i].n.map(x=>x*1.5)));
 FACES.forEach((f,i)=>{v.focus(i);near(v.camera.position.toArray(),f.n.map(x=>x*9));near(v.camera.up.toArray(),f.v);});
 v.focus(-1);near(v.camera.position.toArray(),[4.65,3.75,5.25]);near(v.camera.up.toArray(),[0,1,0]);
});

test('shadow textures crop the receiver margin and release replaced textures',t=>{
 const v=viewFor(t),panels=Array.from({length:6},()=>({width:512,height:512}));
 v.showShadows(panels);let disposed=0;
 v.groups.forEach((g,i)=>{
  const texture=g.children[0].material.map;assert.equal(texture.image,panels[i]);
  near(texture.offset.toArray(),[1/5,1/5]);near(texture.repeat.toArray(),[3/5,3/5]);
  assert.equal(texture.colorSpace,THREE.SRGBColorSpace);texture.addEventListener('dispose',()=>disposed++);
 });
 v.showShadows(panels);assert.equal(disposed,6);
});

test('rebuilding a maze removes the old route and disposes old scene resources',t=>{
 const v=viewFor(t);v.showRoute([v.maze.nodes[0].id]);
 const oldRoute=v.route;let routeDisposed=0,geometryDisposed=0;
 oldRoute.geometry.addEventListener('dispose',()=>routeDisposed++);
 const oldMeshes=v.groups.flatMap(g=>g.children);
 oldMeshes.forEach(m=>m.geometry.addEventListener('dispose',()=>geometryDisposed++));
 v.build(generate(2,19));assert.equal(routeDisposed,1);assert.equal(geometryDisposed,oldMeshes.length);
 assert.equal(v.scene.children.includes(oldRoute),false);assert.equal(v.route,null);
 assert.equal(v.groups.length,6);assert.equal(v.root.children.length,6);assert.equal(v.maze.size,2);
});
