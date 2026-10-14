import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {rm,lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {createSyntheticSession,bindTmuxOwner} from '../src/tmux-session.mjs';
import {serveLocal,connectLocal} from '../src/tmux-local.mjs';

const native=process.platform==='linux' && process.env.DOT_TMUX_LAB_TEST==='1';

test('real Unicode hex input preserves UTF-8 and literal tmux syntax',
  {skip:!native,timeout:20000},async t=>{
  const s=await createSyntheticSession(),h=s.connect('human'),a=s.connect();
  t.after(async()=>{const result=await s.stop(h);
    if(result.verified)await rm(s.dir,{recursive:true,force:true});
    else t.diagnostic(JSON.stringify({retainedDirectory:s.dir,...result}));
    assert.equal(result.verified,true,JSON.stringify(result));});
  const text='HEX: café 中文 🧪 e\u0301 ; #{pid} "quotes" \\ $HOME';
  const lease=s.grant(h,a,5000),snap=await s.snapshot(a);
  assert.equal((await s.input(a,{operationId:'unicode',kind:'paste',text,
    generation:lease.generation,snapshotId:snap.snapshotId})).status,'dispatched');
  let observed='';
  for(let i=0;i<30;i++) {observed=(await s.snapshot(a)).text;if(observed.includes(text))break;
    await new Promise(r=>setTimeout(r,20));}
  assert.ok(observed.includes(text),JSON.stringify(observed));
  assert.ok(!observed.includes('\ufffd'));
  const fresh=await s.snapshot(a);
  assert.equal((await s.input(a,{operationId:'unicode-submit',kind:'submit',
    generation:lease.generation,snapshotId:fresh.snapshotId})).status,'dispatched');
});

for(const operation of ['input','stop'])test(`real recipient guard rejects ${operation} after preflight server replacement`,
  {skip:!native,timeout:20000},async t=>{
  const s=await createSyntheticSession(),h=s.connect('human');
  const readIdentity=async pid=>{
    try {const text=await readFile(`/proc/${pid}/stat`,'utf8'),f=text.slice(text.lastIndexOf(')')+2).split(' ');
      return {pid,start:f[19],state:f[0]};}
    catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}
  };
  const readSocket=async()=>{const info=await lstat(path.join(s.dir,'tmux.sock'),{bigint:true});
    if(!info.isSocket())throw Error('TMUX_IDENTITY_CHANGED');return {dev:String(info.dev),ino:String(info.ino)};};
  const replacement=replacementFixture({dir:s.dir,invoke:s.invoke,readIdentity,readSocket});
  t.after(async()=>{const result=replacement.attempted?await replacement.cleanup():await s.stop(h);
    if(result.verified)await rm(s.dir,{recursive:true,force:true});
    else t.diagnostic(JSON.stringify({retainedDirectory:s.dir,...result}));
    assert.equal(result.verified,true,JSON.stringify(result));});
  const pids=(await s.invoke(['display-message','-p','-t',s.identity.pane,'#{pid} #{pane_pid}'])).split(' ');
  let fenced=false,interceptions=0,replaced;
  const guarded=bindTmuxOwner({identity:s.identity,processes:await Promise.all(pids.map(readIdentity)),
    socketIdentity:await readSocket(),readProcess:readIdentity,readSocket,invoke:async args=>{
      if(args[0]==='if-shell') {
        assert.equal(fenced,true);assert.equal(++interceptions,1);
        // Deterministically hold the actual command launch after successful preflight.
        // Replace only this test's disposable server before sending the real guard.
        await s.mutate(['kill-server']);assert.equal(await s.proveExit(),true);
        replaced=await replacement.start();
        assert.equal(replaced.session,s.identity.session);assert.equal(replaced.pane,s.identity.pane);
        assert.notEqual(replaced.sessionName,s.identity.sessionName);
      }
      return s.invoke(args);
    }});
  const args=operation==='stop'?['kill-server']:['send-keys','-t',s.identity.pane,'-l','--','RACE_MUST_NOT_APPEAR'];
  await assert.rejects(guarded.mutate(args,()=>{fenced=true;}),/TMUX_IDENTITY_CHANGED/);
  assert.equal(interceptions,1);
  assert.equal(await s.invoke(['display-message','-p','-t',replaced.pane,'#{session_name}']),replaced.sessionName);
  assert.ok(!(await s.invoke(['capture-pane','-p','-t',replaced.pane])).includes('RACE_MUST_NOT_APPEAR'));
});

// Register the attempted replacement BEFORE creation, and bind its identity
// BEFORE the caller can assert recycled IDs. Cleanup never falls back to the old owner.
function replacementFixture({dir,invoke,readIdentity,readSocket,pause=ms=>new Promise(r=>setTimeout(r,ms))}) {
  let attempted=false,identity=null,processes=null,owner=null,cleanupPromise=null;
  const retained=reason=>({status:'retained',verified:false,reason,directory:dir,identity});
  return {
    get attempted(){return attempted;},
    async start(){
      if(attempted)throw Error('REPLACEMENT_ALREADY_ATTEMPTED');
      attempted=true;
      const sessionName=`dot-${randomUUID()}`;
      const raw=await invoke(['new-session','-d','-s',sessionName,'-c',dir,
        '-P','-F','#{session_id} #{pane_id} #{pid} #{pane_pid}','/bin/cat']);
      const [session,pane,pid,panePid,...extra]=raw.split(' ');
      identity={session,pane,sessionName,pid,panePid};
      if(extra.length||!/^\$\d+$/.test(session??'')||!/^%\d+$/.test(pane??'')||
        !/^\d+$/.test(pid??'')||!/^\d+$/.test(panePid??''))throw Error('REPLACEMENT_IDENTITY_UNVERIFIED');
      processes=await Promise.all([pid,panePid].map(readIdentity));
      if(processes.some(x=>!x))throw Error('REPLACEMENT_IDENTITY_UNVERIFIED');
      owner=bindTmuxOwner({identity,processes,socketIdentity:await readSocket(),
        readProcess:readIdentity,readSocket,invoke});
      await owner.validate();
      return {...identity};
    },
    cleanup(){
      if(cleanupPromise)return cleanupPromise;
      cleanupPromise=(async()=>{
        if(!owner)return retained(attempted?'OWNERSHIP_UNVERIFIED':'NOT_STARTED');
        try {
          await owner.mutate(['kill-server']); // validates process, socket and receiving server
          for(let i=0;i<40;i++) {
            const current=await Promise.all(processes.map(x=>readIdentity(x.pid)));
            if(current.every((x,j)=>!x||x.start!==processes[j].start||x.state==='Z'))
              return {status:'stopped',verified:true,identity};
            await pause(25);
          }
          return retained('EXIT_UNVERIFIED');
        } catch(error) {return retained(/^[A-Z_]+$/.test(error.message)?error.message:'CLEANUP_EVIDENCE_UNAVAILABLE');}
      })();
      return cleanupPromise;
    }
  };
}

function simulatedReplacement({session='$1',pane='%1',captureFails=false}={}) {
  let name='',killed=false,changed=false;const mutations=[];
  const invoke=async args=>{
    if(args[0]==='new-session'){name=args[args.indexOf('-s')+1];return `${session} ${pane} 700 701`;}
    if(args[0]==='display-message')return `${session}:${pane}:700:701:${name}`;
    assert.equal(args[0],'if-shell');assert.equal(args[5],'kill-server');
    mutations.push(args);killed=true;return '';
  };
  const fixture=replacementFixture({dir:'synthetic-fixture-only',invoke,
    readIdentity:async pid=>{if(captureFails)throw Error('SIMULATED_CAPTURE_FAILURE');return killed?null:{pid,start:`1${pid}`,state:'S'};},
    readSocket:async()=>({dev:'1',ino:changed?'other':'original'}),pause:async()=>{}});
  return {fixture,mutations,replaceOwner:()=>{changed=true;}};
}

test('replacement cleanup survives either recycled-ID assertion failing after creation',async()=>{
  for(const ids of [{session:'$9',pane:'%0'},{session:'$0',pane:'%9'}]) {
    const {fixture,mutations}=simulatedReplacement(ids);let cleanup;
    try {
      const actual=await fixture.start();
      assert.throws(()=>{assert.equal(actual.session,'$0');assert.equal(actual.pane,'%0');});
    } finally {cleanup=await fixture.cleanup();}
    assert.equal(cleanup.verified,true);assert.equal(mutations.length,1);
    assert.equal(await fixture.cleanup(),cleanup);assert.equal(mutations.length,1);
  }
});
test('replacement capture failure explicitly retains state and never stops the original',async()=>{
  const {fixture,mutations}=simulatedReplacement({captureFails:true});
  await assert.rejects(fixture.start(),/SIMULATED_CAPTURE_FAILURE/);
  assert.equal(fixture.attempted,true);
  const result=await fixture.cleanup();assert.equal(result.status,'retained');
  assert.equal(result.reason,'OWNERSHIP_UNVERIFIED');assert.equal(result.directory,'synthetic-fixture-only');
  assert.equal(result.identity.pid,'700');assert.equal(mutations.length,0);
});
test('replacement cleanup refuses changed ownership and retains explicit evidence',async()=>{
  const {fixture,mutations,replaceOwner}=simulatedReplacement();await fixture.start();replaceOwner();
  const result=await fixture.cleanup();assert.equal(result.status,'retained');assert.equal(result.verified,false);
  assert.equal(result.reason,'TMUX_IDENTITY_CHANGED');assert.equal(mutations.length,0);
});
function cli(socket,role) {
  const p=spawn(process.execPath,['scripts/tmux-lab.mjs','client',socket,role],{stdio:['pipe','pipe','pipe']});
  const queue=[],waiters=[];let error='';p.stderr.on('data',b=>{error+=b.toString().slice(0,2048);});
  const lines=createInterface({input:p.stdout});lines.on('line',line=>{
    const value=JSON.parse(line);if(waiters.length)waiters.shift()(value);else queue.push(value);
  });
  const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CLI_RESPONSE_TIMEOUT '+error)),8000);
    waiters.push(value=>{clearTimeout(timer);resolve(value);});
  });
  const exit=new Promise(resolve=>p.on('close',code=>resolve(code)));
  return {p,next,exit,async request(body){p.stdin.write(JSON.stringify(body)+'\n');return next();}};
}
test('real tmux: two local CLI processes observe one pane, explicit grant/revoke and verified stop',
  {skip:!native,timeout:30000},async t=>{
  const session=await createSyntheticSession({machineId:'lab-machine',projectId:'synthetic'});
  const owner=session.connect('human'),server=await serveLocal(session);const clients=[];
  t.after(async()=>{
    for(const c of clients)c.p.stdin.end();
    const result=await session.stop(owner);await server.close();
    for(const c of clients)await c.exit;
    if(result.verified)await rm(session.dir,{recursive:true,force:true});
    assert.equal(result.verified,true,JSON.stringify(result));
  });
  assert.equal((await lstat(session.dir)).mode&0o777,0o700);
  assert.equal((await lstat(server.socketPath)).mode&0o777,0o600);
  const human=cli(server.socketPath,'human'),agent=cli(server.socketPath,'observer');clients.push(human,agent);
  const [h,a]=await Promise.all([human.next(),agent.next()]);assert.deepEqual(h.identity,a.identity);
  assert.equal((await agent.request({action:'status'})).result.paused,true);
  assert.equal((await agent.request({action:'grant',clientId:a.clientId,ttlMs:5000})).error,'HUMAN_REQUIRED');
  assert.equal((await agent.request({action:'input',operationId:'denied',kind:'submit'})).error,'NO_CURRENT_GRANT');
  const lease=(await human.request({action:'grant',clientId:a.clientId,ttlMs:5000})).result;
  const snap=(await agent.request({action:'snapshot'})).result;
  const input={action:'input',operationId:'paste-once',kind:'paste',text:'DOT_TMUX_SYNTHETIC',
    generation:lease.generation,snapshotId:snap.snapshotId};
  assert.equal((await agent.request(input)).result.status,'dispatched');
  assert.equal((await agent.request(input)).error,'REPLAY_REJECTED');
  let left,right;
  for(let i=0;i<20;i++) {
    left=(await human.request({action:'snapshot'})).result;
    right=(await agent.request({action:'snapshot'})).result;
    if(left.text.includes(input.text)&&left.text===right.text)break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(left.text.includes(input.text));assert.equal(left.text,right.text);
  const fresh=(await agent.request({action:'snapshot'})).result;
  assert.equal((await agent.request({...input,operationId:'submit-once',kind:'submit',snapshotId:fresh.snapshotId})).result.status,'dispatched');
  await human.request({action:'revoke'});
  assert.equal((await agent.request({...input,operationId:'after-revoke'})).error,'NO_CURRENT_GRANT');
  assert.equal((await agent.request({action:'stop'})).error,'HUMAN_REQUIRED');
  const stopped=(await human.request({action:'stop'})).result;
  assert.equal(stopped.verified,true);assert.equal(stopped.status,'stopped');
  assert.equal((await agent.request({action:'status'})).result.state,'stopped');
});

test('real local IPC rejects oversized input and revoked lease after client reconnect',
  {skip:!native,timeout:20000},async t=>{
  const session=await createSyntheticSession(),owner=session.connect('human'),server=await serveLocal(session);
  const clients=[];
  t.after(async()=>{for(const c of clients)c.close();const result=await session.stop(owner);await server.close();
    if(result.verified)await rm(session.dir,{recursive:true,force:true});assert.equal(result.verified,true,JSON.stringify(result));});
  const human=await connectLocal(server.socketPath,'human'),agent=await connectLocal(server.socketPath);clients.push(human,agent);
  const lease=await human.request({action:'grant',clientId:agent.clientId,ttlMs:5000});agent.close();
  const replacement=await connectLocal(server.socketPath);clients.push(replacement);
  await assert.rejects(replacement.request({action:'input',operationId:'old',kind:'submit',generation:lease.generation}),/NO_CURRENT_GRANT/);
  const raw=net.createConnection({path:server.socketPath});raw.on('error',()=>{});
  await new Promise(resolve=>raw.once('connect',resolve));const closed=new Promise(resolve=>raw.once('close',resolve));
  raw.write('x'.repeat(4097));await closed;assert.equal(raw.destroyed,true);
});

test('real replacement server recycling session/pane IDs receives neither input nor stop',
  {skip:!native,timeout:20000},async t=>{
  const s=await createSyntheticSession(),h=s.connect('human'),a=s.connect();
  const readIdentity=async pid=>{
    try {const text=await readFile(`/proc/${pid}/stat`,'utf8');const f=text.slice(text.lastIndexOf(')')+2).split(' ');
      return {pid,start:f[19],state:f[0]};}
    catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}
  };
  const replacement=replacementFixture({dir:s.dir,invoke:s.invoke,readIdentity,readSocket:async()=>{
    const info=await lstat(path.join(s.dir,'tmux.sock'),{bigint:true});
    if(!info.isSocket())throw Error('TMUX_IDENTITY_CHANGED');
    return {dev:String(info.dev),ino:String(info.ino)};
  }});
  t.after(async()=>{
    const result=replacement.attempted?await replacement.cleanup():await s.stop(h);
    if(result.verified)await rm(s.dir,{recursive:true,force:true});
    else t.diagnostic(JSON.stringify({retainedDirectory:s.dir,...result}));
    assert.equal(result.verified,true,JSON.stringify(result));
  });
  const lease=s.grant(h,a,5000),snap=await s.snapshot(a);
  // Deliberately replace only this disposable server, never a user's session.
  await s.mutate(['kill-server']);assert.equal(await s.proveExit(),true);
  const {session,pane,sessionName}=await replacement.start();
  assert.equal(session,s.identity.session);assert.equal(pane,s.identity.pane);
  await assert.rejects(s.input(a,{operationId:'replacement-denied',kind:'paste',text:'MUST_NOT_APPEAR',
    generation:lease.generation,snapshotId:snap.snapshotId}),/TMUX_IDENTITY_CHANGED/);
  assert.equal((await s.stop(h)).status,'identity_lost');
  assert.equal(await s.invoke(['display-message','-p','-t',pane,'#{session_name}']),sessionName);
  assert.ok(!(await s.invoke(['capture-pane','-p','-t',pane])).includes('MUST_NOT_APPEAR'));
});
