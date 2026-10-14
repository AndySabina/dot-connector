#!/usr/bin/env node
// Opt-in standalone local experiment. Does not change plugin registration or profiles.
import {createSyntheticSession} from '../src/tmux-session.mjs';
import {serveLocal,connectLocal,readFrames} from '../src/tmux-local.mjs';

const [mode,...args]=process.argv.slice(2);
if(mode==='serve' && args.length<=2) {
  const session=await createSyntheticSession({machineId:args[0]??'local',projectId:args[1]??'synthetic'});
  const owner=session.connect('human');
  let broker;
  try {broker=await serveLocal(session);} catch(error) {await session.stop(owner);throw error;}
  console.log(JSON.stringify({socket:broker.socketPath,identity:session.identity,paused:true}));
  let closing=false;
  const close=async()=>{
    if(closing)return;closing=true;
    const result=await session.stop(owner);
    console.log(JSON.stringify({shutdown:result,retainedState:session.dir}));
    await broker.close();process.exitCode=result.verified?0:1;
  };
  process.once('SIGINT',close);process.once('SIGTERM',close);
} else if(mode==='client' && args.length>=1 && args.length<=2) {
  const client=await connectLocal(args[0],args[1]??'observer');
  console.log(JSON.stringify({clientId:client.clientId,identity:client.identity}));
  const jobs=new Set();
  readFrames(process.stdin,request=>{
    if(jobs.size>=8){process.stdin.destroy();client.close();process.exitCode=2;return;}
    const job=client.request(request).then(result=>console.log(JSON.stringify({ok:true,result})),
      error=>console.log(JSON.stringify({ok:false,error:error.message}))).finally(()=>jobs.delete(job));
    jobs.add(job);
  },()=>{process.stdin.destroy();client.close();process.exitCode=2;});
  process.stdin.on('end',async()=>{await Promise.allSettled([...jobs]);client.close();});
} else {
  console.error('Usage: node scripts/tmux-lab.mjs serve [machine-label] [synthetic-project-label] | client SOCKET [observer|human]');
  process.exitCode=2;
}
