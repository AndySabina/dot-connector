import path from 'node:path';
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const LIMIT=32768,sourceRoot=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const fail=code=>{throw Error(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
export function validateConfig(c){
 if(object(c))for(const key of ['schema','revision','transport','workload','machineId','projectId'])if(!Object.hasOwn(c,key))fail('CONFIG_MISSING_'+key.toUpperCase());
 if(!exact(c,['schema','revision','transport','workload','machineId','projectId'])||c.schema!==1||!Number.isSafeInteger(c.revision)||c.revision<0||c.revision>=Number.MAX_SAFE_INTEGER||c.transport!=='mcp-stdio'||c.workload!=='synthetic-cat')fail('CONFIG_INVALID_SCHEMA');
 for(const k of ['machineId','projectId'])if(typeof c[k]!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(c[k]))fail('CONFIG_INVALID_LABEL');
 if(Buffer.byteLength(JSON.stringify(c))>LIMIT)fail('CONFIG_TOO_LARGE');
 return c;
}
export const redactedConfig=c=>({schema:c.schema,revision:c.revision,transport:c.transport,workload:c.workload,machineConfigured:true,projectConfigured:true,credentialsRequired:false,remoteConnection:'NOT_IMPLEMENTED',pausedOnStart:true});
export function parseConfig(bytes){
 if(Buffer.byteLength(bytes)>LIMIT)fail('CONFIG_TOO_LARGE');
 let c;try{c=JSON.parse(bytes);}catch{fail('CONFIG_INVALID_JSON');}return validateConfig(c);
}
async function location(file){
 if(process.platform!=='linux'||!path.isAbsolute(file??'')||path.resolve(file)!==file||path.basename(file)!=='config.json')fail('CONFIG_INVALID_LOCATION');
 const dir=path.dirname(file);
 if(dir===sourceRoot||dir.startsWith(sourceRoot+'/'))fail('CONFIG_OUTSIDE_SOURCE_REQUIRED');
 for(let p=dir;;p=path.dirname(p)){
  try{await lstat(path.join(p,'.git'));fail('CONFIG_OUTSIDE_GIT_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(path.dirname(p)===p)break;
 }
 return dir;
}
async function privateDirectory(dir){
 const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||await realpath(dir)!==dir)fail('CONFIG_PRIVATE_DIRECTORY_REQUIRED');
}
export async function readConfig(file){
 const dir=await location(file);await privateDirectory(dir);
 const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>LIMIT)fail('CONFIG_PRIVATE_FILE_REQUIRED');
  const b=Buffer.alloc(LIMIT+1);const {bytesRead}=await h.read(b,0,b.length,0);return parseConfig(b.subarray(0,bytesRead));
 }finally{await h.close();}
}
export async function initConfig(file,machineId='local',projectId='synthetic'){
 const c=validateConfig({schema:1,revision:0,transport:'mcp-stdio',workload:'synthetic-cat',machineId,projectId}),dir=await location(file);
 const parent=path.dirname(dir);if(await realpath(parent)!==parent)fail('CONFIG_INVALID_LOCATION');
 await mkdir(dir,{mode:0o700});await privateDirectory(dir);
 const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify(c,null,2)+'\n');await h.sync();}finally{await h.close();}
 return redactedConfig(c);
}
// Common local API used by CLI. Never sends values to a service or logger.
export async function writeConfig(file,c,expectedRevision){
 validateConfig(c);if(!Number.isSafeInteger(expectedRevision)||c.revision!==expectedRevision)fail('CONFIG_REVISION_REQUIRED');
 const dir=await location(file);await privateDirectory(dir);
 const lock=path.join(dir,'config.lock'),temp=path.join(dir,'config.pending');
 const handle=await open(lock,'wx',0o600);let ownTemp=false;
 try{
  const old=await readConfig(file);if(old.revision!==expectedRevision)fail('CONFIG_REVISION_CONFLICT');
  const next=validateConfig({...c,revision:expectedRevision+1});
  const h=await open(temp,'wx',0o600);ownTemp=true;
  try{await h.writeFile(JSON.stringify(next,null,2)+'\n');await h.sync();}finally{await h.close();}
  await rename(temp,file);ownTemp=false;return redactedConfig(next);
 }finally{if(ownTemp)await unlink(temp);await handle.close();await unlink(lock);}
}
export function configError(e){return /^CONFIG_[A-Z_]+$/.test(e?.message??'')?e.message:({ENOENT:'CONFIG_NOT_FOUND',EEXIST:'CONFIG_EXISTS_OR_BUSY',ELOOP:'CONFIG_SYMLINK_REJECTED',EACCES:'CONFIG_ACCESS_DENIED'}[e?.code]??'CONFIG_OPERATION_FAILED');}
export function configProblem(e){
 const code=configError(e),fields={CONFIG_NOT_FOUND:'config.json',CONFIG_INVALID_LABEL:'machineId/projectId'};
 const missing={SCHEMA:'schema',REVISION:'revision',TRANSPORT:'transport',WORKLOAD:'workload',MACHINEID:'machineId',PROJECTID:'projectId'};
 return {code,field:fields[code]??missing[code.replace('CONFIG_MISSING_','')]??null,guide:'docs/PRIVATE-CONFIG.md',action:code==='CONFIG_NOT_FOUND'?'Run node scripts/private-config.mjs init --file /absolute/private-directory/config.json; parent must exist.':'Edit the private file locally, then run node scripts/private-config.mjs check --file /absolute/private-directory/config.json.',credentialInput:'No credentials are required or accepted. Never provide ChatGPT passwords, cookies or tokens.'};
}
export async function configReadiness(file,feature='synthetic'){
 if(feature==='dot-remote')return {ready:false,code:'CONNECTION_NOT_IMPLEMENTED',field:null,requiredSecrets:[],guide:'docs/PRIVATE-CONFIG.md',action:'A supported dot transport and authentication contract are required first. Do not provision keys for this placeholder.'};
 if(feature!=='synthetic')return {ready:false,code:'CONFIG_UNKNOWN_FEATURE',field:null};
 try{return {ready:true,requiredSecrets:[],configuration:redactedConfig(await readConfig(file))};}catch(e){return {ready:false,...configProblem(e)};}
}
