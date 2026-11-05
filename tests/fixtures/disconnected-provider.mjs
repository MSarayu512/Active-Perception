// Loaded only by the isolated server test; never contacts a real provider.
globalThis.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>{
 if(signal.aborted){reject(signal.reason);return;}
 signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
});
