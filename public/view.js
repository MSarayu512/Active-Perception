import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {FACES,faceWalls} from '../src/maze.js';
export class View{
 constructor(container){
  this.container=container;this.renderer=new THREE.WebGLRenderer({antialias:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;container.append(this.renderer.domElement);
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#0e1728');this.camera=new THREE.PerspectiveCamera(40,1,.1,100);this.camera.position.set(9,8,10);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;
  this.scene.add(new THREE.AmbientLight(0xffffff,.7));const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(6,10,8);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.1,far:40});key.shadow.bias=-.0002;this.scene.add(key);
  this.root=new THREE.Group();this.scene.add(this.root);this.groups=[];this.textures=[];
  new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}).observe(container);
  this.renderer.setAnimationLoop(()=>{this.controls.update();this.renderer.render(this.scene,this.camera);});
  this.lost=false;this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;container.dispatchEvent(new Event('renderfailure'));});
 }
 clear(){for(const t of this.textures)t.dispose();this.textures=[];this.root.traverse(o=>{o.material?.map?.dispose();o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.root.clear();this.groups=[];}
 build(maze){
  this.showRoute(null);this.clear();this.maze=maze;const size=maze.size;this.camera.far=Math.max(100,size*10);this.camera.updateProjectionMatrix();this.camera.position.set(size*1.55,size*1.25,size*1.75);this.controls.target.set(0,0,0);
  const light=this.scene.children.find(o=>o.isDirectionalLight);
  if(light){light.position.set(size*1.5,size*2,size*2);Object.assign(light.shadow.camera,{left:-size*1.5,right:size*1.5,top:size*1.5,bottom:-size*1.5,far:size*10});light.shadow.camera.updateProjectionMatrix();}
  FACES.forEach((f,index)=>{
   const g=new THREE.Group(),basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.u),new THREE.Vector3(...f.v),new THREE.Vector3(...f.n));g.quaternion.setFromRotationMatrix(basis);g.position.fromArray(f.n).multiplyScalar(size/2);this.root.add(g);this.groups.push(g);
   const floor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({color:0x7dd3c7,roughness:.85,side:THREE.DoubleSide}));floor.receiveShadow=true;g.add(floor);
   for(const box of faceWalls(maze,index)){
    const dim=box.max.map((v,i)=>v-box.min[i]),center=box.max.map((v,i)=>(v+box.min[i])/2);
    const wall=new THREE.Mesh(new THREE.BoxGeometry(...dim),new THREE.MeshStandardMaterial({color:0xc1d4e3,roughness:.7}));wall.position.fromArray(center);wall.castShadow=true;wall.receiveShadow=true;wall.userData.wall=true;g.add(wall);
   }

  });
 }
 showRoute(path){
  if(this.route){this.scene.remove(this.route);this.route.geometry.dispose();this.route.material.dispose();this.route=null;}
  if(!path?.length)return;
  const nodes=new Map(this.maze.nodes.map(n=>[n.id,n])),points=[];
  const point=a=>new THREE.Vector3().fromArray(FACES[a.f].n).multiplyScalar(this.maze.size/2+.3).addScaledVector(new THREE.Vector3(...FACES[a.f].u),a.c+.5-this.maze.size/2).addScaledVector(new THREE.Vector3(...FACES[a.f].v),this.maze.size/2-a.r-.5);
  for(let i=0;i<path.length;i++){const a=nodes.get(path[i]);if(!a)continue;if(i){const b=nodes.get(path[i-1]);if(b&&a.f!==b.f){const seam=point(a).add(point(b)).multiplyScalar(.5);for(let k=0;k<3;k++)if(FACES[a.f].n[k]||FACES[b.f].n[k])seam.setComponent(k,(FACES[a.f].n[k]+FACES[b.f].n[k])*(this.maze.size/2+.3));points.push(seam);}}points.push(point(a));}
  this.route=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xffd76b}));this.scene.add(this.route);
 }
 setExploded(value){if(this.route)this.route.visible=!value;this.groups.forEach((g,i)=>g.position.fromArray(FACES[i].n).multiplyScalar(this.maze.size/2+value*1.5));}
 showShadows(panels){
  this.groups.forEach((g,i)=>{const floor=g.children[0];if(floor.material.map)floor.material.map.dispose();const texture=new THREE.CanvasTexture(panels[i]);texture.colorSpace=THREE.SRGBColorSpace;const span=this.maze.size+2;texture.offset.set(1/span,1/span);texture.repeat.set(this.maze.size/span,this.maze.size/span);floor.material.map=texture;floor.material.color.set(0x69c5b0);floor.material.needsUpdate=true;});
 }
 setWalls(visible){this.root.traverse(o=>{if(o.userData.wall)o.visible=visible;});}
 focus(index){if(index<0){this.camera.position.set(this.maze.size*1.55,this.maze.size*1.25,this.maze.size*1.75);this.camera.up.set(0,1,0);}else{const f=FACES[index];this.camera.position.fromArray(f.n).multiplyScalar(this.maze.size*3);this.camera.up.fromArray(f.v);}this.controls.target.set(0,0,0);this.controls.update();}
}
