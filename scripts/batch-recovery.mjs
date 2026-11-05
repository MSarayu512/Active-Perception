import {setTimeout as sleep} from 'node:timers/promises';

// Handles quoted commas, escaped quotes and multiline error messages in results.
export function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('Unterminated CSV quote');
 if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
 const headers=rows.shift();if(!headers)throw Error('Empty CSV');
 return rows.filter(r=>r.some(Boolean)).map(r=>{
  if(r.length!==headers.length)throw Error('CSV column count mismatch');
  return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));
 });
}
export function selectRetries(plan,rows){
 const failures=rows.filter(r=>r.outcome==='infrastructure_failure');
 return plan.filter(p=>failures.some(r=>Number(r.face_size)===p.face_size&&Number(r.seed)===p.seed&&r.track===p.track));
}
export async function waitForServerIdle(url,{timeoutMs=150000,pollMs=2000,fetcher=fetch,now=Date.now,pause=sleep,cancelled=()=>false}={}){
 const deadline=now()+timeoutMs;let last='server busy';
 while(now()<deadline){
  if(cancelled())return false;
  let status;
  try{
   const response=await fetcher(url+'/api/status',{signal:AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-now())))});
   if(response.status===404)throw Object.assign(Error('Restart npm start: the server lacks the new /api/status endpoint.'),{fatal:true});
   if(!response.ok)throw Error('Server status HTTP '+response.status);
   status=await response.json();
  }catch(error){if(error.fatal)throw error;last=error.message;}
  if(status){
   if(typeof status.active!=='boolean')throw Error('Invalid server status; restart the updated server.');
   if(!status.active)return true;
   last='server still has an active model request';
  }
  await pause(Math.max(0,Math.min(pollMs,deadline-now())));
 }
 throw Error('Server did not become available; batch stopped to avoid cascading failures ('+last+').');
}
