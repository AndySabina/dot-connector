import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {SnapshotBridge,safeScreen} from '../src/tmux-bridge.mjs';
import {BoundedMcpStdio} from '../src/bounded-mcp-stdio.mjs';
import {registerBridgeTools} from '../src/tmux-bridge-mcp.mjs';

function fixture() {
  let next=0;const calls=[];
  const session={identity:{machineId:'machine',projectId:'synthetic',incarnation:'12345678-1234-4234-8234-123456789abc',session:'$0',pane:'%0'},
    connect:role=>{const id=String(++next);calls.push(['connect',id,role]);return id;},
    status:()=>({paused:true}),snapshot:async()=>({text:'screen',snapshotId:'12345678-1234-4234-8234-123456789def',generation:1}),
    input:async(id,r)=>{calls.push(['input',id,r]);return {status:'dispatched'};},
    revoke:id=>{calls.push(['revoke',id]);return {inflight:false};},
    operation:(id,op)=>({operationId:op,phase:'not_seen'}),grant:(id,agent,ttl)=>{calls.push(['grant',id,agent,ttl]);return {generation:1};},
    disconnect:id=>calls.push(['disconnect',id]),stop:async id=>{calls.push(['stop',id]);return {verified:true};}};
  return {bridge:new SnapshotBridge(session),session,calls};
}
test('bridge binds every read/write/control to machine project incarnation and pane',async()=>{
  const {bridge:b,calls}=fixture();
  for(const key of Object.keys(b.binding)){
    const binding={...b.binding,[key]:'wrong'};
    await assert.rejects(b.read(b.agent,binding,0),/BINDING_MISMATCH/);
    assert.throws(()=>b.cancel(binding),/BINDING_MISMATCH/);
    assert.throws(()=>b.input({binding}),/BINDING_MISMATCH/);
  }
  assert.equal(calls.filter(c=>c[0]==='input'||c[0]==='revoke').length,0);
});
test('bounded snapshots expose cursor gaps and require the latest agent view',async()=>{
  const {bridge:b}=fixture(),h=b.openHuman();
  const first=await b.read(b.agent,b.binding,0);await b.read(h,b.binding,first.sequence);
  const latest=await b.read(b.agent,b.binding,first.sequence);assert.equal(latest.resync,true);assert.equal(latest.skippedSnapshots,1);
  assert.throws(()=>b.input({...first,binding:b.binding}),/FRESH_BRIDGE_VIEW_REQUIRED/);
  await assert.rejects(b.read(b.agent,b.binding,99),/INVALID_CURSOR/);
  await assert.rejects(b.read(b.agent,b.binding,-1),/INVALID_CURSOR/);
});
test('human reconnect requires fresh authority; close is idempotent and cancels reads',async()=>{
  const {bridge:b,calls}=fixture(),human=b.openHuman();assert.throws(()=>b.openHuman(),/HUMAN_ALREADY_CONNECTED/);
  b.disconnectHuman(human);const replacement=b.openHuman();assert.notEqual(human,replacement);
  await assert.rejects(b.humanRequest(human,{action:'grant',binding:b.binding,ttlMs:5000}),/UNKNOWN_HUMAN/);
  assert.equal(calls.filter(c=>c[0]==='grant').length,0);
  const first=b.close();assert.equal(b.close(),first);await first;
  await assert.rejects(b.read(b.agent,b.binding,0),/BRIDGE_CLOSED/);assert.equal(calls.filter(c=>c[0]==='stop').length,1);
});
test('output controls and bidi are inert text; Unicode byte truncation is bounded',()=>{
  const s=safeScreen('\x1b]52;c;clipboard\x07\r\u202e 🧪\n');
  assert.ok(!/[\x1b\x07\r\u202e]/.test(s.text));assert.ok(s.text.includes('\\u001b'));assert.ok(s.text.includes('🧪\n'));
  const large=safeScreen('🧪'.repeat(4000));assert.equal(Buffer.byteLength(large.text),8192);assert.equal(large.truncated,true);assert.ok(!large.text.includes('\ufffd'));
});
test('long history retains CURRENT_PROMPT at the newest end within 8192 bytes',async()=>{
  const {bridge:b,session}=fixture(),marker='CURRENT_PROMPT_🧪';
  session.snapshot=async()=>({text:'old history\n'.repeat(900)+marker,snapshotId:'latest',generation:1});
  const view=await b.read(b.agent,b.binding,0);
  assert.equal(view.truncated,true);assert.ok(view.text.endsWith(marker));assert.ok(Buffer.byteLength(view.text)<=8192);
});
test('suffix cut preserves complete Unicode code points and whole escaped controls',()=>{
  assert.deepEqual(safeScreen('old\x1b🧪Z',10),{text:'🧪Z',truncated:true});
  assert.deepEqual(safeScreen('old\x1b🧪Z',11),{text:'\\u001b🧪Z',truncated:true});
  assert.deepEqual(safeScreen('old🧪Z',4),{text:'Z',truncated:true});
  assert.deepEqual(safeScreen('old🧪Z',5),{text:'🧪Z',truncated:true});
  assert.ok(!safeScreen('🧪'.repeat(3000)+'CURRENT_PROMPT').text.includes('\ufffd'));
});
test('MCP exposes no role grant, attach, destination, shell or stop method',async()=>{
  const {bridge:b}=fixture(),registered=new Map();registerBridgeTools({tool:(n,d,s,f)=>registered.set(n,f)},b);
  assert.deepEqual([...registered.keys()].sort(),['bridge_cancel','bridge_input','bridge_operation','bridge_read','bridge_status']);
  const cancelled=await registered.get('bridge_cancel')({binding:b.binding});assert.equal(cancelled.isError,undefined);
  assert.match(JSON.parse(cancelled.content[0].text).semantics,/cannot recall/);
});
test('agent cancellation cannot revoke a pending human input; human pause still can',async()=>{
  const {bridge:b,session,calls}=fixture(),h=b.openHuman();let complete;
  session.input=()=>new Promise(resolve=>{complete=resolve;});
  const pending=b.humanRequest(h,{action:'input',binding:b.binding,kind:'paste',text:'human',operationId:'h'});
  assert.equal(b.cancel(b.binding).humanPriority,true);
  assert.equal(calls.filter(c=>c[0]==='revoke').length,0);
  await assert.rejects(b.humanRequest(h,{action:'input',binding:b.binding}),/BUSY_NO_QUEUE/);
  await b.humanRequest(h,{action:'pause',binding:b.binding});assert.equal(calls.filter(c=>c[0]==='revoke').length,1);
  complete({status:'dispatched'});await pending;assert.equal(b.humanInputActive,false);
});
test('stdio rejects oversize and malformed frames terminally before subsequent commands',async()=>{
  for(const chunk of ['x'.repeat(16385),'{bad}\n']){
    const input=new PassThrough(),output=new PassThrough(),t=new BoundedMcpStdio(input,output),seen=[];
    t.onmessage=m=>seen.push(m);await t.start();input.write(chunk+'{"jsonrpc":"2.0","method":"tools/list","id":1}\n');
    assert.equal(t.closed,true);assert.equal(seen.length,0);input.destroy();output.destroy();
  }
});
test('stdio caps outstanding requests and accepts fragmented/coalesced messages',async()=>{
  const input=new PassThrough(),output=new PassThrough(),t=new BoundedMcpStdio(input,output),seen=[];
  t.onmessage=m=>seen.push(m);await t.start();const line=id=>JSON.stringify({jsonrpc:'2.0',method:'tools/list',id})+'\n';
  const first=line(1);input.write(first.slice(0,10));input.write(first.slice(10)+line(2));assert.equal(seen.length,2);
  await t.send({jsonrpc:'2.0',id:1,result:{}});input.write(line(3)+line(4)+line(5));assert.equal(seen.length,5);
  input.write(line(6));assert.equal(t.closed,true);assert.equal(seen.length,5);input.destroy();output.destroy();
});
test('stdio enforces output bound and close rejects stalled writes',async()=>{
  const input=new PassThrough(),output=new Writable({write(chunk,encoding,callback){}});
  const t=new BoundedMcpStdio(input,output);const pending=t.send({jsonrpc:'2.0',id:1,result:{}});
  const rejected=assert.rejects(pending,/MCP_CLOSED_OUTCOME_UNKNOWN/);await t.close();await rejected;
  const other=new BoundedMcpStdio(new PassThrough(),new PassThrough());
  await assert.rejects(other.send({jsonrpc:'2.0',id:1,result:{text:'x'.repeat(32768)}}),/MCP_OUTPUT_LIMIT/);
  assert.equal(other.closed,true);input.destroy();output.destroy();
});
