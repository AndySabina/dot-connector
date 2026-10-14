import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {initConfig} from '../src/private-config.mjs';
import {listInstances} from '../src/human-instances.mjs';
const native=process.platform==='linux'&&process.env.DOT_TMUX_LAB_TEST==='1';
async function wait(fn){for(let i=0;i<150;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,25));}throw Error('EVIDENCE_TIMEOUT');}
test('native private discovery selects own sessions without stderr and removes records on verified EOF shutdown',
 {skip:!native,timeout:20000},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'hd-')),config=path.join(root,'private','config.json');
 await initConfig(config,'discovery-lab','synthetic');
 const instances=[];
 t.after(async()=>{
  const failures=[];
  for(const instance of instances){
   try{
    await instance.client.close();
    const stopped=await wait(()=>instance.events().find(e=>e.event==='closed'));
    assert.equal(stopped.result.verified,true,JSON.stringify(stopped));
    assert.equal(path.dirname(stopped.retainedState),tmpdir());
    assert(path.basename(stopped.retainedState).startsWith('dot-tmux-session-'));
    await rm(stopped.retainedState,{recursive:true,force:true});
   }catch(e){failures.push(e);}
  }
  if(failures.length)throw new AggregateError(failures,'OWNED_SESSION_CLEANUP_NOT_VERIFIED');
  assert.deepEqual(await listInstances(config),[]);await rm(root,{recursive:true,force:true});
 });
 for(let i=0;i<2;i++){
  const transport=new StdioClientTransport({command:process.execPath,args:['scripts/tmux-bridge.mjs','--experimental-synthetic','--config',config],
   env:{PATH:process.env.PATH,TMPDIR:tmpdir(),HOME:process.env.HOME},stderr:'pipe'});
  let stderr='';transport.stderr.on('data',b=>{stderr=(stderr+b).slice(-32768);});
  const client=new Client({name:'discovery-native-proof',version:'1'});
  instances.push({client,transport,events:()=>stderr.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}})});
  await client.connect(transport);
 }
 // Discovery deliberately uses the registry, never the ready event/socket in stderr.
 const list=await wait(async()=>{const rows=await listInstances(config);return rows.length===2&&rows.every(r=>r.state==='available')?rows:null;});
 assert.notEqual(list[0].id,list[1].id);
 for(const instance of instances){
  const {client}=instance;
  const response=await client.callTool({name:'bridge_status',arguments:{}});
  assert(!response.isError);const status=JSON.parse(response.content[0].text);
  assert.equal(status.paused,true);assert.equal(status.humanConnected,false);
  assert(list.some(r=>r.id===status.binding.incarnation));
  instance.id=status.binding.incarnation;
  assert(!JSON.stringify(response).includes('human-view.sock'));
  assert(!JSON.stringify(response).includes(config));
 }
 const view=await promisify(execFile)(process.execPath,['scripts/tmux-bridge-view.mjs','--config',config,'--instance',list[0].id,'--once']);
 assert.match(view.stdout,/NOT a VT stream/);
 for(const {client} of instances){
  await wait(async()=>{
   const status=JSON.parse((await client.callTool({name:'bridge_status',arguments:{}})).content[0].text);
   assert.equal(status.paused,true);return !status.humanConnected;
  });
 }
 // Signal only the PID returned by our own StdioClientTransport spawn.
 assert(Number.isSafeInteger(instances[0].transport.pid));
 process.kill(instances[0].transport.pid,'SIGTERM');
 const stopped=await wait(()=>instances[0].events().find(e=>e.event==='closed'));
 assert.equal(stopped.result.verified,true);
 const remaining=await listInstances(config);assert.deepEqual(remaining.map(r=>r.id),[instances[1].id]);
 // after-hook closes the other owned process via EOF, verifies empty registry.
});
test('native publication failure verifies owned session shutdown and retains no descriptor',
 {skip:!native,timeout:20000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'hd-fail-')),config=path.join(root,'private','config.json');
 await initConfig(config,'discovery-lab','synthetic');
 // A regular file blocks creation; do not change permissions of any existing state.
 await writeFile(path.join(root,'private','instances'),'fixture',{mode:0o600});
 let failure;
 try{await promisify(execFile)(process.execPath,['scripts/tmux-bridge.mjs','--experimental-synthetic','--config',config],{timeout:10000});}
 catch(e){failure=e;}
 assert.equal(failure?.code,1);assert.match(failure.stderr,/BRIDGE_START_FAILED/);
 const events=failure.stderr.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 assert(!events.some(e=>e.event==='ready'));
 const closed=events.find(e=>e.event==='closed');assert.equal(closed?.result.verified,true);
 assert.equal(path.dirname(closed.retainedState),tmpdir());assert(path.basename(closed.retainedState).startsWith('dot-tmux-session-'));
 await rm(closed.retainedState,{recursive:true,force:true});await rm(root,{recursive:true,force:true});
});
