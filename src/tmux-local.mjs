// Local Unix-domain IPC only. Roles are cooperative, not same-UID authentication.
import net from 'node:net';
import path from 'node:path';
import {chmod} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export function readFrames(socket,onFrame,onInvalid,maxFrameBytes=4096) {
  let pending=Buffer.alloc(0), invalid=false;
  const reject=()=>{if(invalid)return;invalid=true;pending=Buffer.alloc(0);onInvalid();};
  socket.on('data',chunk=>{
    if(invalid||socket.destroyed)return;
    let offset=0;
    while(offset<chunk.length) {
      const end=chunk.indexOf(10,offset), last=end<0;
      const fragment=chunk.subarray(offset,last?chunk.length:end);
      if(pending.length+fragment.length>maxFrameBytes){reject();return;}
      const frame=pending.length?Buffer.concat([pending,fragment]):fragment;
      if(last){pending=Buffer.from(frame);return;}
      pending=Buffer.alloc(0);
      let keepGoing;
      try {keepGoing=onFrame(JSON.parse(frame.toString('utf8')));}
      catch {reject();return;}
      // Destruction/rejection is terminal, including later records in this chunk.
      if(keepGoing===false||socket.destroyed){reject();return;}
      offset=end+1;
    }
  });
}

export function attachLocalClient(session,socket,onClose=()=>{}) {
    let clientId=null, inflight=0;
    const send=message=>{
      const line=JSON.stringify(message)+'\n';
      if(socket.destroyed || Buffer.byteLength(line)>32768 || socket.writableLength>65536) {socket.destroy();return;}
      socket.write(line);
    };
    socket.on('error',()=>{});
    socket.on('close',()=>{onClose();if(clientId)session.disconnect(clientId);});
    readFrames(socket,request=>{
      if(socket.destroyed||!request || typeof request.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(request.id) || inflight>=8) {
        return false;
      }
      inflight++;
      (async()=>{
        if(!clientId) {
          if(request.action!=='hello')throw Error('HELLO_REQUIRED');
          clientId=session.connect(request.role??'observer');
          return {clientId,...session.status(clientId)};
        }
        switch(request.action) {
          case 'status': return session.status(clientId);
          case 'snapshot': return session.snapshot(clientId);
          case 'grant': return session.grant(clientId,request.clientId,request.ttlMs);
          case 'revoke': return session.revoke(clientId);
          case 'input': return session.input(clientId,request);
          case 'operation': return session.operation(clientId,request.operationId);
          case 'stop': return session.stop(clientId);
          default: throw Error('UNKNOWN_ACTION');
        }
      })().then(result=>send({id:request.id,ok:true,result}),error=>send({id:request.id,ok:false,
        error:/^[A-Z_]+$/.test(error.message)?error.message:'OPERATION_FAILED'})).finally(()=>inflight--);
      return true;
    },()=>socket.destroy());
}

export async function serveLocal(session) {
  const socketPath=path.join(session.dir,'broker.sock'), sockets=new Set();
  const server=net.createServer(socket=>{
    if(sockets.size>=8) {socket.destroy();return;}
    sockets.add(socket);
    attachLocalClient(session,socket,()=>sockets.delete(socket));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  try {await chmod(socketPath,0o600);}
  catch(error) {for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));throw error;}
  return {socketPath,async close(){
    for(const s of sockets)s.destroy();
    await new Promise(resolve=>server.close(resolve));
  }};
}

export async function connectLocal(socketPath,role='observer') {
  const socket=net.createConnection({path:socketPath}), pending=new Map();
  const failAll=()=>{for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error('CONNECTION_LOST_OUTCOME_UNKNOWN'));}pending.clear();};
  socket.on('error',failAll); socket.on('close',failAll);
  readFrames(socket,message=>{
      const waiter=pending.get(message.id);if(!waiter)return;
      clearTimeout(waiter.timer);pending.delete(message.id);
      message.ok?waiter.resolve(message.result):waiter.reject(Error(message.error));
  },()=>socket.destroy(),32768);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const request=body=>new Promise((resolve,reject)=>{
    if(socket.destroyed || pending.size>=8){reject(Error('CLIENT_UNAVAILABLE'));return;}
    const id=randomUUID(),line=JSON.stringify({...body,id})+'\n';
    if(Buffer.byteLength(line)>4096){reject(Error('REQUEST_LIMIT'));return;}
    const timer=setTimeout(()=>{socket.destroy();failAll();},8000);
    pending.set(id,{resolve,reject,timer});socket.write(line);
  });
  let hello;
  try {hello=await request({action:'hello',role});}
  catch(error) {socket.destroy();throw error;}
  return {clientId:hello.clientId,identity:hello.identity,request,close:()=>socket.destroy()};
}
