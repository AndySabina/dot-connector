import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics,until,startHumanView,closeEach} from '../scripts/human-view-qa-helper.mjs';
const native={skip:process.platform!=='linux'||process.env.DOT_TMUX_LAB_TEST!=='1',timeout:30000};

test('until records its phase with timings and keeps OWNED_VIEW_TIMEOUT on expiry',async()=>{
 const diagnostics=createDiagnostics();let calls=0;
 assert.equal(await until(()=>++calls===3&&'value',{phase:'sample-ok',diagnostics}),'value');
 const started=Date.now();
 const error=await until(()=>false,{phase:'sample-expired',diagnostics}).then(()=>null,e=>e);
 assert.equal(error.message,'OWNED_VIEW_TIMEOUT');assert.equal(error.phase,'sample-expired');
 assert.ok(Date.now()-started>=5900,'the existing ~6 s bound is unchanged');
 const {entries}=diagnostics.snapshot();
 assert.deepEqual(entries.map(e=>[e.phase,e.state]),[['sample-ok','wait'],['sample-ok','ok'],['sample-expired','wait'],['sample-expired','expired']]);
 assert.ok(entries.every(e=>Number.isInteger(e.ms)&&e.ms>=0));
 assert.ok(entries[3].ms-entries[2].ms>=5900);
 assert.equal(await until(()=>'plain'),'plain','labels are optional for existing callers');
});

test('output is reduced to event names, known markers and error codes without raw content',()=>{
 // Built at runtime so the release secret scanner never sees a token-shaped literal.
 const fakeToken=['sk','proj','x'.repeat(26)].join('-');
 const diagnostics=createDiagnostics();
 const ready=JSON.stringify({event:'ready',humanSocket:'/home/someone/.private/human-view.sock',binding:{machineId:'SYNTH_SECRET_MACHINE'}});
 diagnostics.output('runtime','stderr',ready.slice(0,20));diagnostics.output('runtime','stderr',ready.slice(20)+'\n');
 diagnostics.output('cli','stdout','Read-only browser view: http://127.0.0.1:43210/\nLocal cooperative human.\n{"status":"dispatched","text":"SYNTH_SECRET_PASTE"}\nSYNTH_PANE_CONTENT\n');
 diagnostics.output('cli','stderr','VIEW_DISCONNECTED_OR_UNAVAILABLE\nORDERED_VIEW_READ_FAILED CONNECTION_LOST_OUTCOME_UNKNOWN\nSYNTH_MIXED_CODE /home/someone/x '+fakeToken+'\nplain human words only\n');
 diagnostics.exit('cli',1,null);diagnostics.exit('runtime',null,'SIGTERM');
 const snapshot=diagnostics.snapshot(),text=JSON.stringify(snapshot);
 for(const leak of ['/home','someone','.sock','127.0.0.1','43210','SYNTH_SECRET','SYNTH_PANE_CONTENT','SYNTH_MIXED_CODE','sk-proj','plain human words','humanSocket'])assert.ok(!text.includes(leak),leak);
 assert.deepEqual(snapshot.entries.map(({ms,...e})=>e),[
  {source:'runtime',kind:'event',name:'ready'},
  {source:'cli',kind:'marker',name:'view-url'},
  {source:'cli',kind:'marker',name:'cli-ready'},
  {source:'cli',kind:'marker',name:'dispatched'},
  {source:'cli',kind:'codes',codes:['VIEW_DISCONNECTED_OR_UNAVAILABLE']},
  {source:'cli',kind:'codes',codes:['ORDERED_VIEW_READ_FAILED','CONNECTION_LOST_OUTCOME_UNKNOWN']},
  {source:'cli',kind:'exit',code:1,signal:null},
  {source:'runtime',kind:'exit',code:null,signal:'SIGTERM'}
 ]);
});

test('events are recorded only by known name from runtime stderr; JSON-shaped pane text is dropped',()=>{
 const diagnostics=createDiagnostics();
 diagnostics.output('runtime','stderr','{"event":"ready"}\n{"event":"closed"}\n{"event":"synthforged"}\n');
 diagnostics.output('runtime','stdout','{"event":"ready"}\n');
 // The CLI echoes pane content on stdout, so JSON there must never become an event or a code.
 diagnostics.output('cli','stdout','{"event":"ready"}\n{"event":"closed","note":"SYNTH_ECHO"}\n');
 diagnostics.output('cli','stderr','{"event":"ready"}\n');
 const snapshot=diagnostics.snapshot();
 assert.deepEqual(snapshot.entries.map(({ms,...e})=>e),[
  {source:'runtime',kind:'event',name:'ready'},
  {source:'runtime',kind:'event',name:'closed'}
 ]);
 assert.ok(!JSON.stringify(snapshot).includes('synthforged'));
 assert.ok(!JSON.stringify(snapshot).includes('SYNTH_ECHO'));
});

test('diagnostics stay bounded and count what they drop',()=>{
 const diagnostics=createDiagnostics();
 for(let i=0;i<500;i++)diagnostics.step('repeat');
 diagnostics.output('cli','stderr','X'.repeat(100000));
 const snapshot=diagnostics.snapshot();
 assert.equal(snapshot.entries.length,200);assert.equal(snapshot.limit,200);assert.equal(snapshot.dropped,300);
 assert.ok(JSON.stringify(snapshot).length<20000);
});

// Synthetic stand-ins that stop at a given startup phase and exit 0 once stdin ends.
const idle='process.stdin.resume();process.stdin.on("end",()=>process.exit(0));';
const readyRuntime=['-e','console.error(JSON.stringify({event:"ready",humanSocket:"SYNTH_SOCKET"}));'+idle];
const stalls={
 'runtime-ready':{runtime:['-e',idle]},
 'view-url':{runtime:readyRuntime,cli:()=>['-e',idle]},
 'cli-ready':{runtime:readyRuntime,cli:()=>['-e','console.log("Read-only browser view: http://127.0.0.1:1/");'+idle]}
};

test('startup failures keep the caller collector, the expired phase and cleanup errors apart',{timeout:30000},async()=>{
 await Promise.all(Object.entries(stalls).map(async([phase,commands])=>{
  const diagnostics=createDiagnostics();
  const error=await startHumanView({diagnostics,commands}).then(()=>null,e=>e);
  assert.equal(error?.message,'OWNED_VIEW_TIMEOUT',phase);assert.equal(error.phase,phase);
  const {entries}=diagnostics.snapshot();
  assert.deepEqual(entries.filter(e=>e.phase===phase).map(e=>e.state),['wait','expired'],phase);
  assert.deepEqual(error.diagnostics(),diagnostics.snapshot(),phase);
  // No closed event from the stand-in runtime: cleanup fails, reported separately from the primary error.
  assert.deepEqual(error.cleanupErrors.map(({resource,code})=>[resource,code]),[['runtime-closed','ERR_ASSERTION'],['fixtures','OWNED_FIXTURES_UNVERIFIED']],phase);
  assert.deepEqual(entries.filter(e=>e.kind==='cleanup').map(({resource,code})=>[resource,code]),[['runtime-closed','ERR_ASSERTION'],['fixtures','OWNED_FIXTURES_UNVERIFIED']],phase);
  assert.deepEqual(entries.filter(e=>e.kind==='exit').map(e=>[e.source,e.code,e.signal]).sort(),phase==='runtime-ready'?[['runtime',0,null]]:[['cli',0,null],['runtime',0,null]],phase);
  assert.ok(!JSON.stringify(entries).includes('SYNTH_SOCKET'),phase);
 }));
});

test('closeEach attempts every resource and keeps each failure with a sanitized code',async()=>{
 const diagnostics=createDiagnostics(),ran=[];
 const errors=await closeEach([
  ['first',async()=>{ran.push('first');throw Error('SYNTH raw stderr /home/someone');}],
  ['second',()=>{ran.push('second');}],
  ['third',async()=>{ran.push('third');throw Error('OWNED_EXIT_UNVERIFIED');}]
 ],diagnostics);
 assert.deepEqual(ran,['first','second','third']);
 assert.deepEqual(errors.map(({resource,code})=>[resource,code]),[['first','CLEANUP_FAILED'],['third','OWNED_EXIT_UNVERIFIED']]);
 assert.equal(errors[0].error.message,'SYNTH raw stderr /home/someone','the original error stays available to the caller');
 const text=JSON.stringify(diagnostics.snapshot());
 assert.ok(!text.includes('SYNTH')&&!text.includes('/home'));
 assert.deepEqual(await closeEach([['ok',()=>{}]],diagnostics),[]);
});

test('a real synthetic human view exposes phases and verified exits without raw content',native,async()=>{
 const fixture=await startHumanView();let closed;
 try{await fixture.marker();}finally{closed=await fixture.close();}
 assert.equal(closed.verified,true);
 const snapshot=fixture.diagnostics(),text=JSON.stringify(snapshot);
 for(const phase of ['runtime-ready','view-url','cli-ready','marker-dispatched'])
  assert.deepEqual(snapshot.entries.filter(e=>e.phase===phase).map(e=>e.state),['wait','ok'],phase);
 assert.ok(snapshot.entries.some(e=>e.source==='runtime'&&e.kind==='event'&&e.name==='ready'));
 assert.deepEqual(snapshot.entries.filter(e=>e.kind==='exit').map(e=>[e.source,e.code,e.signal]).sort(),[['cli',0,null],['runtime',0,null]]);
 for(const leak of ['/tmp','127.0.0.1','LIVE_HUMAN_VIEW',process.env.HOME])assert.ok(!text.includes(leak),leak);
 assert.ok(snapshot.entries.some(e=>e.kind==='step'&&e.name==='close'));
});
