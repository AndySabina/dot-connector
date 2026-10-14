import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TmuxSession} from '../src/tmux-session.mjs';

async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'dot-tmux-unit-'));await mkdir(path.join(dir,'operations'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=0,hook=async()=>{};const writes=[];
  const s=new TmuxSession({dir,identity:{machineId:'test',projectId:'synthetic',incarnation:'x',session:'$0',pane:'%0'},
    validateOwner:async()=>{if(await s.invoke(['display-message'])!=='$0:%0')throw Error('TMUX_IDENTITY_CHANGED');},
    mutate:async(args,beforeDispatch=()=>{})=>{beforeDispatch();return s.invoke(args);},
    now:()=>now,proveExit:async()=>true,invoke:async args=>{
      if(args[0]==='capture-pane')return 'SYNTHETIC';
      if(args[0]==='display-message'){await hook();return '$0:%0';}
      if(args[0]==='send-keys'){writes.push(args);await hook();}
      return '';
    }});
  const h=s.connect('human'),a=s.connect(),b=s.connect();
  const ready=async()=>{const lease=s.grant(h,a,5000),snap=await s.snapshot(a);
    return {operationId:'one',kind:'paste',text:'safe',generation:lease.generation,snapshotId:snap.snapshotId};};
  return {s,h,a,b,writes,ready,setHook:f=>hook=f,setNow:n=>now=n};
}
test('tmux starts observing; clients cannot self-grant or stop',async t=>{
  const {s,h,a,b}=await fixture(t);assert.equal(s.status(a).paused,true);
  assert.throws(()=>s.grant(a,a,100),/HUMAN_REQUIRED/);assert.throws(()=>s.stop(a),/HUMAN_REQUIRED/);
  await assert.rejects(s.input(a,{operationId:'x',kind:'submit'}),/NO_CURRENT_GRANT/);
  const lease=s.grant(h,a,100);await assert.rejects(s.input(b,{operationId:'x',kind:'submit',generation:lease.generation}),/NO_CURRENT_GRANT/);
  for(const ttl of [0,-1,5001,Infinity,0.5])assert.throws(()=>s.grant(h,a,ttl),/INVALID_LEASE/);
});
test('fresh snapshot, literal text and separate submit; no replay',async t=>{
  const {s,h,a,writes,ready}=await fixture(t);const request=await ready();
  await assert.rejects(s.input(a,{...request,snapshotId:'bad'}),/FRESH_SNAPSHOT/);
  for(const text of ['x\n','\x1b','\ud800','x'.repeat(257)])await assert.rejects(s.input(a,{...request,text}),/INVALID_PASTE/);
  await s.input(a,request);assert.deepEqual(writes[0],['send-keys','-t','%0','-l','--','safe']);
  await assert.rejects(s.input(a,request),/REPLAY_REJECTED/);
  const snap=await s.snapshot(a);await s.input(a,{...request,operationId:'two',kind:'submit',snapshotId:snap.snapshotId});
  assert.equal(writes[1].at(-1),'Enter');s.revoke(h);
  await assert.rejects(s.input(a,{...request,operationId:'three'}),/NO_CURRENT_GRANT/);
});
test('revoke discards pending input after validation barrier; no queue',async t=>{
  const {s,h,a,writes,ready,setHook}=await fixture(t),request=await ready();
  let release;setHook(()=>new Promise(r=>release=r));const pending=s.input(a,request);
  while(!release)await new Promise(r=>setImmediate(r));
  await assert.rejects(s.input(a,{...request,operationId:'other'}),/BUSY_NO_QUEUE/);
  s.revoke(h);assert.equal(s.operation(a,'one').phase,'revoked');release();
  await assert.rejects(pending,/GENERATION_CHANGED/);assert.equal(writes.length,0);
  setHook(async()=>{});
  const lease=s.grant(h,a,100);const snap=await s.snapshot(a);
  await assert.rejects(s.input(a,{...request,generation:lease.generation,snapshotId:snap.snapshotId}),/REPLAY_REJECTED/);
});
test('human arrival fences pending agent input even when human must retry BUSY',async t=>{
  const {s,h,a,writes,ready,setHook}=await fixture(t),request=await ready();let release;
  setHook(()=>new Promise(r=>release=r));const pending=s.input(a,request);
  while(!release)await new Promise(r=>setImmediate(r));
  await assert.rejects(s.input(h,{operationId:'human',kind:'paste',text:'h'}),/BUSY_NO_QUEUE/);
  release();await assert.rejects(pending,/GENERATION_CHANGED/);assert.equal(writes.length,0);
  assert.equal(s.status(a).paused,true);
});
test('lease expiry at final dispatch fence denies input',async t=>{
  const {s,a,writes,ready,setHook,setNow}=await fixture(t),request=await ready();
  setHook(async()=>setNow(5000));await assert.rejects(s.input(a,request),/GENERATION_CHANGED/);assert.equal(writes.length,0);
});
test('generation change and client disconnect invalidate authority',async t=>{
  const {s,h,a,writes,ready}=await fixture(t),request=await ready();s.revoke(h);s.grant(h,a,100);
  await assert.rejects(s.input(a,request),/NO_CURRENT_GRANT/);s.disconnect(h);assert.equal(s.status(a).paused,true);
  assert.equal(writes.length,0);
});
test('unknown dispatch outcome pauses all input and never replays',async t=>{
  const {s,h,a,writes,ready,setHook}=await fixture(t),request=await ready();let calls=0;
  setHook(async()=>{if(++calls===2)throw Error('lost ACK');});
  await assert.rejects(s.input(a,request),/INPUT_OUTCOME_UNKNOWN/);
  assert.equal(s.operation(a,'one').phase,'unknown');assert.equal(s.status(a).state,'uncertain');
  await assert.rejects(s.input(a,request),/INPUT_BLOCKED/);assert.throws(()=>s.grant(h,a,1),/NOT_AVAILABLE/);
  assert.equal(writes.length,1);assert.equal((await s.stop(h)).verified,true);
});
test('revoke cannot undo a dispatch already in flight',async t=>{
  const {s,h,a,writes,ready,setHook}=await fixture(t),request=await ready();let calls=0,release;
  setHook(()=>++calls===2?new Promise(r=>release=r):Promise.resolve());const pending=s.input(a,request);
  while(!release)await new Promise(r=>setImmediate(r));assert.equal(s.revoke(h).inflight,true);
  release();assert.equal((await pending).status,'dispatched');assert.equal(writes.length,1);assert.equal(s.status(a).paused,true);
});
test('stop waits for owned operation and requires independent exit evidence',async t=>{
  const {s,h,a,ready,setHook}=await fixture(t),request=await ready();let calls=0,release,verified=false;
  setHook(()=>++calls===2?new Promise(r=>release=r):Promise.resolve());s.proveExit=async()=>{verified=true;return false;};
  const pending=s.input(a,request);while(!release)await new Promise(r=>setImmediate(r));
  const stop=s.stop(h);assert.equal(verified,false);release();await pending;
  assert.equal((await stop).status,'stop_unverified');assert.equal(await s.stop(h),await stop);
  await assert.rejects(s.input(h,{operationId:'later',kind:'submit'}),/INPUT_BLOCKED/);
});
test('identity mismatch, ledger cap, snapshots and observers are bounded',async t=>{
  const {s,a,h,ready}=await fixture(t),request=await ready();const original=s.invoke;
  s.invoke=async args=>args[0]==='display-message'?'$9:%9':original(args);
  await assert.rejects(s.input(a,request),/TMUX_IDENTITY_CHANGED/);
  // Independent capacity assertions use the fake read provider after the ownership rejection.
  s.state='observing';s.validateOwner=async()=>{};
  const newLease=s.grant(h,a,5000),newSnap=await s.snapshot(a);
  const current={...request,generation:newLease.generation,snapshotId:newSnap.snapshotId};
  for(let i=s.records.size;i<256;i++)s.records.set(`f${i}`,{});
  await assert.rejects(s.input(a,{...current,operationId:'extra'}),/OPERATION_LIMIT/);
  s.invoke=async()=> 'x'.repeat(20000);assert.equal((await s.snapshot(a)).text.length,16000);
  while(s.clients.size<8)s.connect();assert.throws(()=>s.connect(),/CLIENT_LIMIT/);
  s.disconnect(h);assert.equal(s.status(a).paused,true);
});
test('read concurrency is bounded and disconnect cannot resurrect an observation',async t=>{
  const {s,a}=await fixture(t);const releases=[];s.validateOwner=async()=>{};s.invoke=()=>new Promise(r=>releases.push(r));
  const readers=Array.from({length:4},()=>s.snapshot(a));
  await assert.rejects(s.snapshot(a),/READ_BUSY/);s.disconnect(a);
  for(const release of releases)release('late');
  for(const read of readers)await assert.rejects(read,/UNKNOWN_CLIENT/);
  assert.equal(s.reads,0);assert.equal(s.observations.size,0);
});
