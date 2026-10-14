import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeRuntime} from '../src/bridge-runtime.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(overrides={}){
 const events=[];
 const dependencies={bridge:{binding:{},async close(){events.push('stop');return {verified:true};}},
  transport:{async close(){events.push('transport-close');}},server:{async connect(){events.push('connect');}},
  async serve(){events.push('serve');return {socketPath:'synthetic',async close(){events.push('socket-close');}};},
  async publish(){events.push('publish');return {async remove(){events.push('remove');}};},
  register(){events.push('register');},configFile:'synthetic',onReady(){events.push('ready');},onClosed(){events.push('closed');},onCleanupError(){events.push('cleanup-error');},...overrides};
 return {events,dependencies};
}
test('close during publication joins acquisition, removes late registration once, never connects or announces ready',async()=>{
 const entered=deferred(),publication=deferred(),x=fixture({publish(){entered.resolve();return publication.promise;}});
 const runtime=createBridgeRuntime(x.dependencies);await entered.promise;
 const closing=runtime.close();assert.equal(runtime.close(),closing);
 await Promise.resolve();assert.deepEqual(x.events,['serve']);
 publication.resolve({async remove(){x.events.push('remove');}});
 assert.equal(await runtime.ready,false);await closing;
 assert.deepEqual(x.events,['serve','stop','socket-close','remove','transport-close','closed']);
});
test('publication failure closes acquired socket and owned bridge without fake ready',async()=>{
 const x=fixture({async publish(){throw Error('PUBLISH_FAILED');}}),runtime=createBridgeRuntime(x.dependencies);
 await assert.rejects(runtime.ready,/PUBLISH_FAILED/);assert.equal((await runtime.close()).verified,true);
 assert.deepEqual(x.events,['serve','stop','socket-close','transport-close','closed']);
});
test('close during serve disposes late socket without publishing',async()=>{
 const entered=deferred(),served=deferred(),x=fixture({serve(){entered.resolve();return served.promise;}});
 const runtime=createBridgeRuntime(x.dependencies);await entered.promise;const closing=runtime.close();
 served.resolve({async close(){x.events.push('socket-close');}});await closing;
 assert.deepEqual(x.events,['stop','socket-close','transport-close','closed']);
});
test('close during connect prevents ready after connection resolves',async()=>{
 const entered=deferred(),connected=deferred(),x=fixture({server:{connect(){entered.resolve();return connected.promise;}}});
 const runtime=createBridgeRuntime(x.dependencies);await entered.promise;const closing=runtime.close();connected.resolve();await closing;
 assert(!x.events.includes('ready'));assert.equal(x.events.filter(e=>e==='remove').length,1);assert.equal(x.events.at(-1),'closed');
});
test('unverified stop retains registration evidence',async()=>{
 const x=fixture({bridge:{binding:{},async close(){return {verified:false};}}}),runtime=createBridgeRuntime(x.dependencies);
 await runtime.ready;assert.equal((await runtime.close()).verified,false);assert(!x.events.includes('remove'));
});
test('actual SIGTERM during simulated publication waits, removes late descriptor and cannot connect',
 {skip:process.platform!=='linux',timeout:5000},async t=>{
 const source=`
 import {createBridgeRuntime} from ${JSON.stringify(new URL('../src/bridge-runtime.mjs',import.meta.url).href)};
 let release;const publication=new Promise(r=>{release=r;});
 const event=x=>console.log(x);
 const runtime=createBridgeRuntime({configFile:'synthetic',bridge:{binding:{},async close(){event('STOP');return {verified:true};}},
 transport:{async close(){event('TRANSPORT_CLOSE');}},server:{async connect(){event('MCP_CONNECT');}},
 async serve(){return {socketPath:'synthetic',async close(){event('SOCKET_CLOSE');}};},
 async publish(){event('PUBLISH_ENTERED');await publication;event('PUBLISH_FINISHED');return {async remove(){event('REMOVE');}};},
 register(){event('REGISTER');},onReady(){event('READY');},onClosed(){event('CLOSED');process.stdin.pause();},onCleanupError(){event('ERROR');}});
 process.once('SIGTERM',()=>{event('SIGNAL_RECEIVED');void runtime.close();});
 process.stdin.once('data',()=>release());
 await runtime.ready;
 `;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});
 const exit=once(child,'exit');t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 let output='',stderr='';child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',b=>{
  output+=b;
  if(output.includes('PUBLISH_ENTERED')&&!output.includes('SIGNAL_RECEIVED'))child.kill('SIGTERM');
  if(output.includes('SIGNAL_RECEIVED')&&!child.stdin.writableEnded)child.stdin.end('finish publication');
 });
 const [code,signal]=await exit;assert.equal(code,0,stderr);assert.equal(signal,null);
 assert.deepEqual(output.trim().split('\n'),['PUBLISH_ENTERED','SIGNAL_RECEIVED','PUBLISH_FINISHED','STOP','SOCKET_CLOSE','REMOVE','TRANSPORT_CLOSE','CLOSED']);
});
