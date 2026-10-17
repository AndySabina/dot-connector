// Only fresh synthetic processes created here; never discovers/adopts a terminal.
import {spawn} from 'node:child_process';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
// QA-only diagnostics (#12): phases, millisecond timings and close causes.
// Raw output is never kept: only event names, known markers and UPPER_CASE codes.
const DIAGNOSTIC_LIMIT=200;
const MARKERS=[['Read-only browser view: ','view-url'],['Local cooperative human.','cli-ready'],['"status":"dispatched"','dispatched']];
export function createDiagnostics(){
 const started=performance.now(),entries=[],partial=new Map();let dropped=0;
 const record=entry=>{if(entries.length>=DIAGNOSTIC_LIMIT){dropped++;return;}entries.push({ms:Math.round(performance.now()-started),...entry});};
 // Codes come only from stderr lines made entirely of UPPER_CASE codes; stdout
 // can echo synthetic pane content, so it contributes events and markers only.
 const line=(source,stream,text)=>{
  try{const event=JSON.parse(text)?.event;if(typeof event==='string'&&/^[a-z][a-z_-]{0,31}$/.test(event))return record({source,kind:'event',name:event});}catch{}
  const marker=MARKERS.find(([needle])=>text.includes(needle));if(marker)return record({source,kind:'marker',name:marker[1]});
  const codes=text.trim().split(/\s+/);
  if(stream==='stderr'&&codes.length<=8&&codes.every(code=>code.length<=64&&/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(code)))record({source,kind:'codes',codes});
 };
 return {
  step:name=>record({kind:'step',name}),
  phase:(phase,state)=>record({phase,state}),
  output(source,stream,chunk){
   const key=source+':'+stream,lines=((partial.get(key)??'')+chunk).split('\n');
   partial.set(key,lines.pop().slice(-4096));for(const text of lines)line(source,stream,text.slice(0,4096));
  },
  exit:(source,code,signal)=>record({source,kind:'exit',code,signal}),
  snapshot:()=>({limit:DIAGNOSTIC_LIMIT,dropped,entries:structuredClone(entries)})
 };
}
export async function until(fn,{phase='unlabeled',diagnostics}={}){
 diagnostics?.phase(phase,'wait');
 for(let i=0;i<240;i++){const value=await fn();if(value){diagnostics?.phase(phase,'ok');return value;}await new Promise(r=>setTimeout(r,25));}
 diagnostics?.phase(phase,'expired');throw Object.assign(Error('OWNED_VIEW_TIMEOUT'),{phase});
}
function launch(args,source,diagnostics){
 const child=spawn(process.execPath,args,{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:tmpdir()},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';for(const [stream,key]of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',b=>{diagnostics.output(source,key,String(b));if(key==='stdout')stdout+=b;else stderr+=b;if(stdout.length+stderr.length>65536)child.kill('SIGTERM');});
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{diagnostics.exit(source,code,signal);resolve({code,signal});});});
 return {child,exit,out:()=>stdout,err:()=>stderr};
}
export async function startHumanView(){
 const diagnostics=createDiagnostics();
 const runtime=launch(['scripts/tmux-bridge.mjs','--experimental-synthetic','human-view-lab','synthetic','--ordered-output-v2'],'runtime',diagnostics);
 const events=()=>runtime.err().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 let cli,closing;
 const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OWNED_EXIT_UNVERIFIED')),10000);})]);}finally{clearTimeout(timer);}};
 const close=()=>closing??=(async()=>{
  diagnostics.step('close');
  if(cli){cli.child.stdin.end('/quit\n');assert.deepEqual(await bounded(cli.exit),{code:0,signal:null},cli.err());}
  runtime.child.stdin.end();assert.deepEqual(await bounded(runtime.exit),{code:0,signal:null},runtime.err());
  const event=events().find(e=>e.event==='closed');assert.equal(event?.result.verified,true,runtime.err());
  assert.equal(path.dirname(event.retainedState),tmpdir());assert(path.basename(event.retainedState).startsWith('dot-tmux-session-'));
  await rm(event.retainedState,{recursive:true,force:true});return {runtimeExit:0,cliExit:0,verified:true,fixturesRemoved:true};
 })();
 try{
  const ready=await until(()=>events().find(e=>e.event==='ready'),{phase:'runtime-ready',diagnostics});
  cli=launch(['scripts/tmux-bridge-view.mjs',ready.humanSocket,'--ordered-view'],'cli',diagnostics);
  const url=await until(()=>cli.out().match(/Read-only browser view: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1],{phase:'view-url',diagnostics});
  await until(()=>cli.out().includes('Local cooperative human.'),{phase:'cli-ready',diagnostics});
  return {url,ready,cli,close,runtimeError:runtime.err,step:diagnostics.step,diagnostics:diagnostics.snapshot,async marker(){
   // Explicit harness-owned human command to seed its own cat pane. Browser has no writer.
   cli.child.stdin.write('/paste LIVE_HUMAN_VIEW\n');await until(()=>cli.out().includes('"status":"dispatched"'),{phase:'marker-dispatched',diagnostics});
  }};
 }catch(error){await close();throw error;}
}
