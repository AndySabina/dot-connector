// Operator-only local registry. Never imported by MCP tool handlers.
import path from 'node:path';
import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open,opendir,unlink,readFile} from 'node:fs/promises';
import {readConfig} from './private-config.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keys=['machineId','projectId','incarnation','session','pane'];
const fail=code=>{throw Error(code);};
async function privateDir(dir){
 const s=await lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||(await realpath(dir))!==dir)fail('INSTANCE_UNSAFE_DIRECTORY');
}
async function registry(config,create=false){
 await readConfig(config);
 const dir=path.join(path.dirname(config),'instances');
 if(create)await mkdir(dir,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 await privateDir(dir);return dir;
}
function valid(d,id){
 if(typeof d?.start!=='string'||!d.binding||typeof d.binding!=='object'||Array.isArray(d.binding)||!keys.every(k=>typeof d.binding[k]==='string'))fail('INSTANCE_INVALID');
 if(!d||Object.keys(d).sort().join()!=='binding,pid,schema,socket,socketDev,socketIno,start'||d.schema!==1||!Number.isSafeInteger(d.pid)||d.pid<1||!/^\d+$/.test(d.start)||typeof d.socket!=='string'||!path.isAbsolute(d.socket)||path.normalize(d.socket)!==d.socket||path.basename(d.socket)!=='human-view.sock'||!Number.isSafeInteger(d.socketDev)||!Number.isSafeInteger(d.socketIno))fail('INSTANCE_INVALID');
 if(!d.binding||Object.keys(d.binding).sort().join()!==[...keys].sort().join()||d.binding.incarnation!==id||!uuid.test(id)||!['machineId','projectId'].every(k=>/^[A-Za-z0-9_-]{1,64}$/.test(d.binding[k]))||!/^\$\d+$/.test(d.binding.session)||!/^%\d+$/.test(d.binding.pane))fail('INSTANCE_INVALID');
 return d;
}
async function start(pid){
 try{const text=await readFile(`/proc/${pid}/stat`,'utf8');return text.slice(text.lastIndexOf(')')+2).split(' ')[19];}
 catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}
}
async function socketStat(socket){
 await privateDir(path.dirname(socket));const s=await lstat(socket);
 if(!s.isSocket()||s.uid!==process.getuid()||(s.mode&0o077)||s.nlink!==1)fail('INSTANCE_UNSAFE_SOCKET');
 return s;
}
async function load(dir,id){
 if(!uuid.test(id))fail('INSTANCE_INVALID_ID');
 const file=path.join(dir,`${id}.json`),h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>4096)fail('INSTANCE_UNSAFE_DESCRIPTOR');
  const bytes=Buffer.alloc(4097),{bytesRead}=await h.read(bytes,0,4097,0);if(bytesRead>4096)fail('INSTANCE_TOO_LARGE');
  const raw=bytes.subarray(0,bytesRead).toString('utf8');let d;try{d=JSON.parse(raw);}catch{fail('INSTANCE_INVALID');}
  return {d:valid(d,id),raw,file};
 }finally{await h.close();}
}
async function state(d){
 if(await start(d.pid)!==d.start)return 'stale';
 try{const s=await socketStat(d.socket);return s.dev===d.socketDev&&s.ino===d.socketIno?'available':'unavailable';}
 catch{return 'unavailable';}
}
async function names(dir){
 const entries=[];for await(const entry of await opendir(dir)){
  if(entries.length===64)fail('INSTANCE_REGISTRY_FULL');entries.push(entry.name);
 }return entries;
}
export async function publishInstance(config,binding,socket){
 const dir=await registry(config,true);if((await names(dir)).length>=64)fail('INSTANCE_REGISTRY_FULL');
 const s=await socketStat(socket),id=binding.incarnation;
 const d=valid({schema:1,binding,pid:process.pid,start:await start(process.pid),socket,socketDev:s.dev,socketIno:s.ino},id);
 const raw=JSON.stringify(d)+'\n',file=path.join(dir,`${id}.json`);
 const h=await open(file,'wx',0o600);
 try{await h.writeFile(raw);await h.sync();}catch(e){await h.close();await unlink(file).catch(()=>{});throw e;}await h.close();
 return {id,async remove(){
  // Identity check prevents an older process removing a replacement record.
  await registry(config);const current=await load(dir,id);if(current.raw!==raw)fail('INSTANCE_CHANGED');await unlink(file);
 }};
}
export async function listInstances(config){
 await readConfig(config);
 let dir;try{dir=await registry(config);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const out=[];for(const name of await names(dir)){
  if(!name.endsWith('.json')||!uuid.test(name.slice(0,-5)))fail('INSTANCE_UNKNOWN_ENTRY');
  const id=name.slice(0,-5);
  try{const {d}=await load(dir,id);out.push({id,binding:d.binding,state:await state(d)});}
  catch{out.push({id,state:'invalid'});}
 }return out.sort((a,b)=>a.id.localeCompare(b.id));
}
export async function resolveInstance(config,id){
 const dir=await registry(config),{d}=await load(dir,id);
 if(await state(d)!=='available')fail('INSTANCE_NOT_AVAILABLE');return {socket:d.socket,binding:d.binding};
}
export async function pruneInstance(config,id){
 const dir=await registry(config),record=await load(dir,id);
 if(await state(record.d)!=='stale')fail('INSTANCE_NOT_STALE');
 const current=await load(dir,id);if(current.raw!==record.raw)fail('INSTANCE_CHANGED');
 await unlink(record.file);return {removed:id,sessionShutdownVerified:false};
}
export function sameBinding(a,b){return a&&b&&keys.every(k=>a[k]===b[k])&&Object.keys(a).length===keys.length&&Object.keys(b).length===keys.length;}
