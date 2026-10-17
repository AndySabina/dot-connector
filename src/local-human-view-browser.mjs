import {XtermObserver} from './observer.mjs';
const status=document.querySelector('#status'),surface=document.querySelector('#terminal');
let observer,controller=new AbortController(),stopped=false,timer=null,wake=null;
const finish=state=>{if(stopped)return;stopped=true;clearTimeout(timer);wake?.();controller.abort();observer?.close();status.textContent=state;};
document.querySelector('#disconnect').addEventListener('click',()=>finish('Disconnected — terminal input and CLI controls are unchanged.'));
addEventListener('pagehide',()=>finish('Disconnected'));
async function read(url){
 const response=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
 if(!response.ok)throw Error('SOURCE');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768)throw Error('LIMIT');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
try{
 const config=await read('/config');if(stopped)throw Error('CLOSED');
 observer=new XtermObserver(globalThis.Terminal,config.identity,config.geometry,{version:config.version});observer.open(surface);
 document.querySelector('#identity').textContent=`${config.identity.machineId} / ${config.identity.projectId} / ${config.identity.session} / ${config.identity.pane}`;
 while(!stopped){
  const cursor=observer.status();
  const frame=await read(`/frame?afterSeq=${cursor.seq}&offset=${cursor.offset}`);if(stopped)break;
  const next=await observer.accept(frame);
  if(next.state==='gap'){finish('Output gap — stopped. No automatic recovery; start a fresh owned session.');break;}
  if(next.state==='eof'){status.textContent='Output ended — read-only view.';break;}
  status.textContent=`Observing · 80×24 · frame ${next.seq} · ${next.offset} bytes · no input`;
  await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,frame.kind==='idle'?150:10);});wake=null;
 }
}catch{if(!stopped)finish('View unavailable or identity changed — stopped. Use the CLI for control.');}
