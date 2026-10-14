#!/usr/bin/env node
import {initConfig,readConfig,writeConfig,parseConfig,redactedConfig,configProblem,configReadiness} from '../src/private-config.mjs';
const emit=x=>process.stdout.write(JSON.stringify(x)+'\n');
try{
 const [command,...args]=process.argv.slice(2),opts={};
 while(args.length){const k=args.shift();if(!['--file','--machine','--project','--revision','--feature'].includes(k)||Object.hasOwn(opts,k)||!args.length)throw Error('CONFIG_INVALID_OPTIONS');opts[k]=args.shift();}
 const permitted=command==='init'?['--file','--machine','--project']:command==='write'?['--file','--revision']:command==='doctor'?['--file','--feature']:['--file'];
 if(!opts['--file']||Object.keys(opts).some(k=>!permitted.includes(k)))throw Error('CONFIG_INVALID_OPTIONS');
 let result;
 if(command==='init')result=await initConfig(opts['--file'],opts['--machine'],opts['--project']);
 else if(command==='check'||command==='show')result=redactedConfig(await readConfig(opts['--file']));
 else if(command==='doctor'){result=await configReadiness(opts['--file'],opts['--feature']);if(!result.ready){emit({ok:false,result});process.exitCode=1;}}
 else if(command==='write'){
  if(!/^(0|[1-9]\d*)$/.test(opts['--revision']??''))throw Error('CONFIG_REVISION_REQUIRED');
  let size=0;const parts=[];for await(const b of process.stdin){size+=b.length;if(size>32768)throw Error('CONFIG_TOO_LARGE');parts.push(b);}
  result=await writeConfig(opts['--file'],parseConfig(Buffer.concat(parts)),Number(opts['--revision']));
 }else throw Error('CONFIG_INVALID_OPTIONS');
 if(!process.exitCode)emit({ok:true,result});
}catch(e){emit({ok:false,error:configProblem(e)});process.exitCode=1;}
