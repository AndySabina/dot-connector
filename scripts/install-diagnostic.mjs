#!/usr/bin/env node
// Explicit isolated bootstrap without preparing Windows helpers or starting MCP.
import {bootstrap,updateError} from '../src/update-release.mjs';
try{
 const args=process.argv.slice(2),options={};
 while(args.length){const k=args.shift();if(!['--root','--version'].includes(k)||Object.hasOwn(options,k)||!args.length)throw Error('UPDATE_INVALID_OPTIONS');options[k]=args.shift();}
 if(!options['--root']||!options['--version'])throw Error('UPDATE_INVALID_OPTIONS');
 const result=await bootstrap(options['--root'],options['--version']);
 console.log(JSON.stringify({ok:true,result,terminalStarted:false,windowsHelperPrepared:false}));
}catch(e){console.log(JSON.stringify({ok:false,error:updateError(e)}));process.exitCode=1;}
