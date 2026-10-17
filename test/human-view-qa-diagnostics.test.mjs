import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics,until,startHumanView} from '../scripts/human-view-qa-helper.mjs';
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

test('diagnostics stay bounded and count what they drop',()=>{
 const diagnostics=createDiagnostics();
 for(let i=0;i<500;i++)diagnostics.step('repeat');
 diagnostics.output('cli','stderr','X'.repeat(100000));
 const snapshot=diagnostics.snapshot();
 assert.equal(snapshot.entries.length,200);assert.equal(snapshot.limit,200);assert.equal(snapshot.dropped,300);
 assert.ok(JSON.stringify(snapshot).length<20000);
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
