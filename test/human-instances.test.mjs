import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFrames} from '../src/tmux-local.mjs';
import {mkdtemp,mkdir,chmod,rm,readFile,writeFile,symlink,lstat,unlink} from 'node:fs/promises';
import {initConfig} from '../src/private-config.mjs';
import {publishInstance,listInstances,resolveInstance,pruneInstance,sameBinding} from '../src/human-instances.mjs';
const linux=process.platform==='linux';
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'dot-discovery-test-')),config=path.join(root,'private','config.json');
 await initConfig(config);const servers=[];let connections=0;
 t.after(async()=>{for(const s of servers)await new Promise(resolve=>s.close(resolve));await rm(root,{recursive:true,force:true});});
 async function instance(onConnection){
  const id=randomUUID(),dir=path.join(root,'s'+servers.length);await mkdir(dir,{mode:0o700});
  const socket=path.join(dir,'human-view.sock'),server=net.createServer(c=>{connections++;if(onConnection)onConnection(c);else c.destroy();});servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});await chmod(socket,0o600);
  const binding={machineId:'local',projectId:'synthetic',incarnation:id,session:'$0',pane:'%0'};
  const registration=await publishInstance(config,binding,socket);
  return {id,binding,socket,registration,file:path.join(path.dirname(config),'instances',id+'.json')};
 }
 return {root,config,instance,connections:()=>connections};
}
test('private discovery: multiple instances, explicit identity, no connection or lease', {skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance(),b=await f.instance();
 const list=await listInstances(f.config);assert.equal(list.length,2);assert(list.every(x=>x.state==='available'));assert(!JSON.stringify(list).includes('human-view.sock'));
 assert.deepEqual(await resolveInstance(f.config,a.id),{socket:a.socket,binding:a.binding});
 await assert.rejects(resolveInstance(f.config,undefined),/INSTANCE_INVALID_ID/);
 assert.equal(f.connections(),0);assert.equal((await lstat(a.file)).mode&0o777,0o600);
 assert.equal((await lstat(path.dirname(a.file))).mode&0o777,0o700);
 await a.registration.remove();assert.deepEqual((await listInstances(f.config)).map(x=>x.id),[b.id]);
});
test('stale PID incarnation is refused; explicit prune only removes record',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance(),d=JSON.parse(await readFile(a.file,'utf8'));d.start='0';await writeFile(a.file,JSON.stringify(d));
 assert.equal((await listInstances(f.config))[0].state,'stale');await assert.rejects(resolveInstance(f.config,a.id),/INSTANCE_NOT_AVAILABLE/);
 assert.deepEqual(await pruneInstance(f.config,a.id),{removed:a.id,sessionShutdownVerified:false});assert((await lstat(a.socket)).isSocket());
});
test('live instance cannot be pruned and replaced descriptor cannot be removed by old owner',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance();await assert.rejects(pruneInstance(f.config,a.id),/INSTANCE_NOT_STALE/);
 const d=JSON.parse(await readFile(a.file,'utf8'));d.binding.projectId='changed';await writeFile(a.file,JSON.stringify(d));
 await assert.rejects(a.registration.remove(),/INSTANCE_CHANGED/);assert((await lstat(a.file)).isFile());
});
test('missing socket is unavailable, not proof of dead broker',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance();await unlink(a.socket);
 assert.equal((await listInstances(f.config))[0].state,'unavailable');await assert.rejects(pruneInstance(f.config,a.id),/INSTANCE_NOT_STALE/);
});
test('descriptor symlink, broad mode, oversized JSON, invalid identity fail closed',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance(),raw=await readFile(a.file);
 await chmod(a.file,0o644);await assert.rejects(resolveInstance(f.config,a.id),/INSTANCE_UNSAFE_DESCRIPTOR/);await chmod(a.file,0o600);
 await writeFile(a.file,'x'.repeat(4097));await assert.rejects(resolveInstance(f.config,a.id),/INSTANCE_UNSAFE_DESCRIPTOR/);
 await writeFile(a.file,'{}');assert.equal((await listInstances(f.config))[0].state,'invalid');
 await unlink(a.file);const target=path.join(f.root,'target');await writeFile(target,raw,{mode:0o600});await symlink(target,a.file);
 await assert.rejects(resolveInstance(f.config,a.id));await assert.rejects(pruneInstance(f.config,a.id));assert.deepEqual(await readFile(target),raw);
});
test('unsafe registry is rejected without changing existing permissions',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance(),dir=path.dirname(a.file);await chmod(dir,0o755);
 await assert.rejects(listInstances(f.config),/INSTANCE_UNSAFE_DIRECTORY/);assert.equal((await lstat(dir)).mode&0o777,0o755);
});
test('bounded registry and missing configuration fail explicitly',{skip:!linux},async t=>{
 const f=await fixture(t);assert.deepEqual(await listInstances(f.config),[]);
 await assert.rejects(listInstances(path.join(f.root,'missing','config.json')));
 const a=await f.instance(),dir=path.dirname(a.file);for(let i=0;i<64;i++)await writeFile(path.join(dir,'junk'+i),'');
 await assert.rejects(listInstances(f.config),/INSTANCE_REGISTRY_FULL/);
});
test('binding equality requires every exact identity field',()=>{
 const a={machineId:'m',projectId:'p',incarnation:randomUUID(),session:'$0',pane:'%0'};
 assert(sameBinding(a,{...a}));for(const key of Object.keys(a))assert(!sameBinding(a,{...a,[key]:'other'}));assert(!sameBinding(a,{...a,extra:true}));
});
test('viewer checks selected handshake before read or control; list remains offline',{skip:!linux},async t=>{
 const f=await fixture(t),actions=[];
 const a=await f.instance(socket=>readFrames(socket,r=>{
  actions.push(r.action);socket.write(JSON.stringify({id:r.id,ok:true,result:{clientId:'human',identity:{...a.binding,incarnation:randomUUID()}}})+'\n');
 },()=>socket.destroy()));
 const exec=promisify(execFile);
 const list=await exec(process.execPath,['scripts/tmux-instances.mjs','list','--config',f.config]);assert.equal(JSON.parse(list.stdout).length,1);assert.equal(f.connections(),0);
 await assert.rejects(exec(process.execPath,['scripts/tmux-bridge-view.mjs','--config',f.config,'--instance',a.id,'--once']),e=>e.code===1&&/INSTANCE_BINDING_MISMATCH/.test(e.stderr));
 assert.deepEqual(actions,['hello']);
});
test('coercible start and binding types are invalid, never stale or prunable',{skip:!linux},async t=>{
 const f=await fixture(t),a=await f.instance(),original=JSON.parse(await readFile(a.file,'utf8'));
 const mutations=[d=>{d.start=Number(d.start);},d=>{d.start=['123'];},...Object.keys(original.binding).map(key=>d=>{d.binding[key]=[d.binding[key]];})];
 for(const mutate of mutations){
  const d=structuredClone(original);mutate(d);await writeFile(a.file,JSON.stringify(d));
  assert.equal((await listInstances(f.config))[0].state,'invalid');
  await assert.rejects(resolveInstance(f.config,a.id),/INSTANCE_INVALID/);
  await assert.rejects(pruneInstance(f.config,a.id),/INSTANCE_INVALID/);
  assert((await lstat(a.file)).isFile());
 }
});
