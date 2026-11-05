import * as THREE from '/vendor/three.module.js';
import {shadowPixels} from '/src/shadows.js';
self.onmessage=({data:{id,faces,size,light,resolution}})=>{
 try{
  const output=faces.map(({face,boxes})=>{const result=shadowPixels(THREE,boxes,size,light,resolution);return {face,pixels:result.data,darkFraction:result.darkFraction,litFraction:result.litFraction,lit_region:result.lit_region};});
  self.postMessage({id,output},output.map(x=>x.pixels.buffer));
 }catch(e){self.postMessage({id,error:e.message});}
};
