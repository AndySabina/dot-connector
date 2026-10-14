import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readFrames,attachLocalClient} from '../src/tmux-local.mjs';
import {bindTmuxOwner,TmuxSession} from '../src/tmux-session.mjs';

class FakeSocket extends EventEmitter {
  destroyed=false;writableLength=0;writes=[];
  write(bytes){this.writes.push(bytes);return true;}
  destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}
}
const frame=value=>Buffer.from(JSON.stringify(value)+'\n');
test('P2: two valid 2146-byte frames coalesced in one chunk both parse',()=>{
  const socket=new FakeSocket(),got=[];let invalid=0;
  readFrames(socket,v=>got.push(v),()=>invalid++);
  const a=frame({x:'a'.repeat(2137)});assert.equal(a.length,2146);
  socket.emit('data',Buffer.concat([a,a]));assert.equal(got.length,2);assert.equal(invalid,0);
});
test('P2: framing is invariant across every split of two records and UTF-8 bytes',()=>{
  const values=[{x:'á😀'.repeat(350)},{x:'b'.repeat(2137)}],bytes=Buffer.concat(values.map(frame));
  for(let i=0;i<=bytes.length;i++) {
    const s=new FakeSocket(),got=[];let invalid=0;readFrames(s,v=>got.push(v),()=>invalid++);
    s.emit('data',bytes.subarray(0,i));s.emit('data',bytes.subarray(i));
    assert.deepEqual(got,values);assert.equal(invalid,0);
  }
});
test('P2: oversize complete or fragmented frame is terminal, once only',()=>{
  for(const chunks of [[Buffer.from('x'.repeat(4097)+'\n')],[Buffer.from('x'.repeat(4096)),Buffer.from('x\n')]]) {
    const s=new FakeSocket(),got=[];let invalid=0;readFrames(s,v=>got.push(v),()=>invalid++);
    for(const c of chunks)s.emit('data',c);s.emit('data',frame({action:'stop'}));
    assert.equal(invalid,1);assert.equal(got.length,0);
  }
});
test('P3: invalid request followed by stop in same or later chunk never reaches dispatcher',async()=>{
  const s=new FakeSocket();let stops=0,closed=0;
  const session={connect:()=> 'human',status:()=>({}),disconnect:()=>closed++,stop:()=>stops++};
  attachLocalClient(session,s);
  s.emit('data',frame({id:'hello',action:'hello',role:'human'}));await new Promise(r=>setImmediate(r));
  s.emit('data',Buffer.concat([frame({id:'invalid id'}),frame({id:'stop',action:'stop'})]));
  s.emit('data',frame({id:'later',action:'stop'}));await new Promise(r=>setImmediate(r));
  assert.equal(s.destroyed,true);assert.equal(stops,0);assert.equal(closed,1);
});
test('P3: callback false, callback destruction, and malformed JSON all terminate parsing',()=>{
  for(const mode of ['false','destroy','json']) {
    const s=new FakeSocket();let seen=0,invalid=0;
    readFrames(s,()=>{seen++;if(mode==='destroy')s.destroy();return false;},()=>invalid++);
    s.emit('data',Buffer.concat([mode==='json'?Buffer.from('invalid\n'):frame({}),frame({action:'stop'})]));
    assert.equal(seen,mode==='json'?0:1);assert.equal(invalid,1);
  }
});

function boundFixture() {
  const identity={machineId:'fake',projectId:'synthetic',incarnation:'00000000-0000-0000-0000-000000000001',
    sessionName:'dot-00000000-0000-0000-0000-000000000001',session:'$0',pane:'%0'};
  const processes=[{pid:'100',start:'1000',state:'S'},{pid:'101',start:'1001',state:'S'}];
  let socket={dev:'1',ino:'22'},current=processes.map(p=>({...p}));
  let report=`$0:%0:100:101:${identity.sessionName}`,atDispatch=false;const mutations=[];
  const invoke=async args=>{
    if(args[0]==='display-message')return report;
    assert.equal(args[0],'if-shell');assert.equal(args[1],'-F');
    if(atDispatch)return 'DOT_IDENTITY_REJECTED';
    mutations.push(args);return args[5]==='kill-server'?'':'DOT_MUTATION_ACK';
  };
  const owner=bindTmuxOwner({identity,processes,socketIdentity:socket,
    readSocket:async()=>socket,readProcess:async pid=>current.find(x=>x?.pid===pid)??null,invoke});
  return {owner,identity,mutations,invoke,setSocket:v=>socket=v,setProcesses:v=>current=v,
    setReport:v=>report=v,replaceAtDispatch:()=>atDispatch=true};
}
test('P1: recycled session/pane IDs with new process, PID reuse or replaced socket block mutation',async()=>{
  for(const replace of [
    f=>f.setProcesses([{pid:'100',start:'2000',state:'S'},{pid:'101',start:'1001',state:'S'}]),
    f=>f.setProcesses([]),
    f=>f.setSocket({dev:'1',ino:'99'}),
    f=>f.setReport('$0:%0:900:901:replacement'),
    f=>f.setProcesses([{pid:'100',start:'1000',state:'S'},{pid:'101',start:'9999',state:'S'}])]) {
    const f=boundFixture();replace(f);
    await assert.rejects(f.owner.mutate(['send-keys','-t','%0','-l','--','x']),/TMUX_IDENTITY_CHANGED/);
    await assert.rejects(f.owner.mutate(['kill-server']),/TMUX_IDENTITY_CHANGED/);
    assert.equal(f.mutations.length,0);
  }
});
test('P1: recipient guard rejects replacement after preflight, for send and stop',async()=>{
  for(const args of [['send-keys','-t','%0','-l','--','x'],['kill-server']]) {
    const f=boundFixture();await assert.rejects(f.owner.mutate(args,()=>f.replaceAtDispatch()),/TMUX_IDENTITY_CHANGED/);
    assert.equal(f.mutations.length,0);
  }
});
test('P1: guarded mutation binds real IDs plus unique session incarnation and hex-encodes syntax',async()=>{
  const f=boundFixture(),payload="'; kill-server; $HOME á😀";
  await f.owner.mutate(['send-keys','-t','%0','-l','--',payload]);
  const args=f.mutations[0];assert.ok(args[4].includes('#{pid},100'));assert.ok(args[4].includes('#{pane_pid},101'));
  assert.ok(args[4].includes(f.identity.sessionName));assert.ok(!args[5].includes(payload));
  const encoded=args[5].split(' -H ')[1].split(' ; ')[0];
  assert.deepEqual(Buffer.from(encoded.split(' ').map(x=>parseInt(x,16))),Buffer.from(payload));
  assert.equal(args[6],'display-message -p DOT_IDENTITY_REJECTED');
});
test('P1: session stop validates original owner before kill and preserves replacement',async t=>{
  const f=boundFixture(),dir=await mkdtemp(path.join(tmpdir(),'dot-review-'));await mkdir(path.join(dir,'operations'));
  t.after(()=>rm(dir,{recursive:true,force:true}));let proofs=0;
  const session=new TmuxSession({identity:f.identity,dir,invoke:f.invoke,validateOwner:f.owner.validate,
    mutate:f.owner.mutate,proveExit:async()=>{proofs++;return true;}}),h=session.connect('human');
  f.setReport('$0:%0:900:901:replacement');
  await assert.rejects(session.input(h,{operationId:'replaced',kind:'paste',text:'blocked'}),/TMUX_IDENTITY_CHANGED/);
  assert.equal(session.operation(h,'replaced').phase,'revoked');
  const result=await session.stop(h);assert.equal(result.status,'identity_lost');assert.equal(result.verified,false);
  assert.equal(f.mutations.length,0);assert.equal(proofs,0);
});
