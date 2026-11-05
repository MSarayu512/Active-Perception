// A connected maze on all SIX surfaces of a cube. Units: one cell = 1.
// Face basis: right U, up V, outward N. Row zero is the TOP of a face.
export const FACES = [
 {name:'+X',n:[1,0,0],u:[0,0,-1],v:[0,1,0]},
 {name:'-X',n:[-1,0,0],u:[0,0,1],v:[0,1,0]},
 {name:'+Y',n:[0,1,0],u:[1,0,0],v:[0,0,-1]},
 {name:'-Y',n:[0,-1,0],u:[1,0,0],v:[0,0,1]},
 {name:'+Z',n:[0,0,1],u:[1,0,0],v:[0,1,0]},
 {name:'-Z',n:[0,0,-1],u:[-1,0,0],v:[0,1,0]}
];
export const edgeKey=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
export function random(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function topology(size){
 if(!Number.isSafeInteger(size)||size<2||!Number.isSafeInteger(12*size*size))throw Error('Face size must be a safe integer of at least 2');
 const nodes=[], edges=new Map(), boundary=new Map();
 const id=(f,r,c)=>`${FACES[f].name}:${r}:${c}`;
 const add=(a,b)=>{const key=edgeKey(a,b);edges.set(key,{key,a,b});};
 const point=(f,x,y)=>f.n.map((v,i)=>v*size/2+f.u[i]*x+f.v[i]*y);
 for(let f=0;f<6;f++)for(let r=0;r<size;r++)for(let c=0;c<size;c++){
  const a=id(f,r,c);nodes.push({id:a,f,r,c});
  if(c<size-1)add(a,id(f,r,c+1));if(r<size-1)add(a,id(f,r+1,c));
  for(const [side,yes,x,y] of [['left',c===0,-size/2,size/2-r-.5],['right',c===size-1,size/2,size/2-r-.5],['top',r===0,c+.5-size/2,size/2],['bottom',r===size-1,c+.5-size/2,-size/2]]){
   if(!yes)continue;const p=point(FACES[f],x,y).join(',');
   if(boundary.has(p)){add(a,boundary.get(p).a);boundary.delete(p);}else boundary.set(p,{a,side});
  }
 }
 if(boundary.size)throw Error('Unpaired cube seams');
 const adjacency=new Map(nodes.map(n=>[n.id,[]]));
 for(const e of edges.values()){adjacency.get(e.a).push(e.b);adjacency.get(e.b).push(e.a);}
 return {size,nodes,edges:[...edges.values()],adjacency};
}
export function generate(size=4,seed=1,loops=.08){
 const t=topology(size),rng=random(seed),open=new Set(),seen=new Set([t.nodes[0].id]),stack=[t.nodes[0].id];
 while(stack.length){const a=stack.at(-1),options=t.adjacency.get(a).filter(b=>!seen.has(b));
  if(!options.length){stack.pop();continue;}const b=options[Math.floor(rng()*options.length)];open.add(edgeKey(a,b));seen.add(b);stack.push(b);}
 for(const e of t.edges)if(!open.has(e.key)&&rng()<loops)open.add(e.key);
 return {...t,seed,open};
}
export function shortestPath(maze,start,goal,open=maze.open){
 const prev=new Map([[start,null]]),q=[start];
 for(let i=0;i<q.length&&!prev.has(goal);i++)for(const b of maze.adjacency.get(q[i])||[])
  if(open.has(edgeKey(q[i],b))&&!prev.has(b)){prev.set(b,q[i]);q.push(b);}
 if(!prev.has(goal))return null;const path=[];for(let a=goal;a!==null;a=prev.get(a))path.push(a);return path.reverse();
}
export function scoreRoute(maze,path,start,goal){
 if(!Array.isArray(path)||path[0]!==start||path.at(-1)!==goal)return {valid:false,optimal:false};
 const valid=path.every((a,i)=>maze.adjacency.has(a)&&(!i||maze.open.has(edgeKey(a,path[i-1]))));
 const reference=shortestPath(maze,start,goal);
 const best=reference?reference.length-1:null;
 return {valid,optimal:valid&&best!==null&&path.length-1===best,length:path.length-1,shortest_length:best};
}
// Rectangular walls in LOCAL face coordinates. Shared seam walls appear on both faces.
export function faceWalls(maze,f){
 const n=maze.size,boxes=[],nodes=maze.nodes.filter(x=>x.f===f),byId=new Map(maze.nodes.map(x=>[x.id,x]));
 function wall(x,y,sx,sy){boxes.push({min:[x-sx/2,y-sy/2,0],max:[x+sx/2,y+sy/2,.25]});}
 for(const a of nodes){
  const x=a.c+.5-n/2,y=n/2-a.r-.5;
  for(const bId of maze.adjacency.get(a.id)){
   if(maze.open.has(edgeKey(a.id,bId)))continue;
   const b=byId.get(bId);
   if(b.f===f){if(b.c>a.c)wall(x+.5,y,.075,1.075);if(b.r>a.r)wall(x,y-.5,1.075,.075);}
   else {
    // Match shared edge midpoint using the outward normal of the adjacent face.
    const face=FACES[f],bn=FACES[b.f].n;
    const du=bn.reduce((s,v,i)=>s+v*face.u[i],0),dv=bn.reduce((s,v,i)=>s+v*face.v[i],0);
    if(du)wall(x+du*.5,y,.075,1.075);else wall(x,y+dv*.5,1.075,.075);
   }
  }
 }
 return boxes;
}
