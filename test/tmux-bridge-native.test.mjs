import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {connectLocal} from '../src/tmux-local.mjs';
import {readFile,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const native=process.platform==='linux'&&process.env.DOT_TMUX_LAB_TEST==='1';
const wait=async predicate=>{for(let i=0;i<100;i++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('EVIDENCE_TIMEOUT');};
async function start(t) {
  const transport=new StdioClientTransport({command:process.execPath,args:['scripts/tmux-bridge.mjs','--experimental-synthetic','bridge-lab','synthetic'],
    env:{PATH:process.env.PATH,TMPDIR:tmpdir(),HOME:process.env.HOME},stderr:'pipe'});
  let text='';transport.stderr.on('data',b=>{text+=b;if(text.length>32768)throw Error('DIAGNOSTIC_LIMIT');});
  const events=()=>text.split(/\r?\n/).flatMap(s=>{try{return [JSON.parse(s)];}catch{return [];}});
  const client=new Client({name:'bridge-proof',version:'1'});let ready,human;
  t.after(async()=>{
    if(human)human.close();await client.close();
    const stopped=await wait(()=>events().find(e=>e.event==='closed'));
    assert.equal(stopped.result.verified,true,JSON.stringify(stopped));
    assert.equal(path.dirname(stopped.retainedState),tmpdir());assert.ok(path.basename(stopped.retainedState).startsWith('dot-tmux-session-'));
    if(ready)assert.equal(path.dirname(ready.humanSocket),stopped.retainedState);
    await rm(stopped.retainedState,{recursive:true,force:true});
  });
  await client.connect(transport);ready=await wait(()=>events().find(e=>e.event==='ready'));
  return {client,ready,async human(){human=await connectLocal(ready.humanSocket,'human');return human;},events};
}
test('real experimental MCP and human view share one session, require grant and fence reconnect',
  {skip:!native,timeout:20000},async t=>{
  const x=await start(t),binding=x.ready.binding;
  assert.equal((await lstat(x.ready.humanSocket)).mode&0o777,0o600);
  const tool=async(name,args={})=>x.client.callTool({name,arguments:args});
  const value=async(name,args)=>{const r=await tool(name,args);assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  assert.equal((await value('bridge_status',{})).paused,true);
  assert.equal((await tool('bridge_grant',{})).isError,true);
  assert.equal((await tool('bridge_read',{binding:{...binding,projectId:'other'},after:0})).isError,true);
  let read=await value('bridge_read',{binding,after:0});
  const input={binding,operationId:'once',kind:'paste',text:'BRIDGE_é_🧪',sequence:read.sequence,snapshotId:read.snapshotId,generation:read.generation};
  assert.equal((await tool('bridge_input',input)).isError,true);
  const h=await x.human();assert.deepEqual(h.identity,binding);
  const grant=await h.request({action:'grant',binding,ttlMs:5000});
  read=await value('bridge_read',{binding,after:read.sequence});
  Object.assign(input,{sequence:read.sequence,snapshotId:read.snapshotId,generation:grant.generation});
  assert.equal((await value('bridge_input',input)).status,'dispatched');
  assert.equal((await tool('bridge_input',input)).isError,true);
  let humanView;
  for(let i=0;i<20;i++){humanView=await h.request({action:'read',binding,after:0});if(humanView.text.includes(input.text))break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(humanView.text.includes(input.text));
  const agentView=await value('bridge_read',{binding,after:read.sequence});assert.equal(agentView.text,humanView.text);assert.equal(agentView.resync,true);
  const cancel=await value('bridge_cancel',{binding,operationId:'once'});assert.equal(cancel.operation.phase,'dispatched');
  assert.equal((await value('bridge_status',{})).paused,true);
  await h.request({action:'grant',binding,ttlMs:5000});h.close();
  for(let i=0;i<20;i++){if((await value('bridge_status',{})).paused)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal((await value('bridge_status',{})).paused,true);
  const rendered=await promisify(execFile)(process.execPath,['scripts/tmux-bridge-view.mjs',x.ready.humanSocket,'--once']);
  assert.ok(rendered.stdout.includes(input.text));assert.match(rendered.stdout,/NOT a VT stream/);
  for(let i=0;i<20;i++){if(!(await value('bridge_status',{})).humanConnected)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal((await value('bridge_status',{})).humanConnected,false);
  const reconnect=await x.human();assert.equal((await reconnect.request({action:'status'})).paused,true);
  const stop=await reconnect.request({action:'stop',binding});assert.equal(stop.verified,true);
  assert.equal((await tool('bridge_read',{binding,after:0})).isError,true);
});
test('real new MCP process has new incarnation and rejects a previous session binding',
  {skip:!native,timeout:20000},async t=>{
  const a=await start(t),b=await start(t);
  assert.notEqual(a.ready.binding.incarnation,b.ready.binding.incarnation);
  const r=await b.client.callTool({name:'bridge_cancel',arguments:{binding:a.ready.binding}});
  assert.equal(r.isError,true);assert.equal(r.content[0].text,'BINDING_MISMATCH');
});
test('real long tmux history and CLI preserve final prompt and disclose truncation',
  {skip:!native,timeout:20000},async t=>{
  const x=await start(t),binding=x.ready.binding,h=await x.human();
  for(let i=0;i<55;i++){
    await h.request({action:'input',binding,operationId:`history-${i}`,kind:'paste',text:'旧'.repeat(60)});
    await h.request({action:'input',binding,operationId:`newline-${i}`,kind:'submit'});
  }
  const marker='CURRENT_PROMPT_🧪';
  await h.request({action:'input',binding,operationId:'current-prompt',kind:'paste',text:marker});
  const r=await x.client.callTool({name:'bridge_read',arguments:{binding,after:0}});
  assert.ok(!r.isError);const view=JSON.parse(r.content[0].text);
  assert.equal(view.truncated,true);assert.ok(view.text.trimEnd().endsWith(marker));assert.ok(Buffer.byteLength(view.text)<=8192);
  h.close();
  for(let i=0;i<30;i++){
    const status=JSON.parse((await x.client.callTool({name:'bridge_status',arguments:{}})).content[0].text);
    if(!status.humanConnected)break;await new Promise(r=>setTimeout(r,20));
  }
  const output=await promisify(execFile)(process.execPath,['scripts/tmux-bridge-view.mjs',x.ready.humanSocket,'--once']);
  assert.match(output.stdout,/truncated=true/);assert.ok(output.stdout.trimEnd().endsWith(marker));assert.ok(!output.stdout.includes('\ufffd'));
});
test('experimental bridge is absent from installed default entrypoint',async()=>{
  const mcp=JSON.parse(await readFile('.mcp.json'));
  assert.deepEqual(mcp.mcpServers['dot-connector'].args,['src/plugin-server.mjs']);
  assert.ok(!(await readFile('src/plugin-server.mjs','utf8')).includes('tmux-bridge'));
});
test('bridge refuses startup without explicit opt-in before creating a session',async()=>{
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/tmux-bridge.mjs']),e=>{
    assert.equal(e.code,2);assert.match(e.stderr,/Explicit opt-in required/);assert.equal(e.stdout,'');return true;
  });
});
