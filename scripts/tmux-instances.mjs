#!/usr/bin/env node
// Explicit local operator entrypoint; no MCP registration or socket connections.
import {listInstances,pruneInstance} from '../src/human-instances.mjs';
const [command,flag,config,selection,id,...extra]=process.argv.slice(2);
try{
 if(flag!=='--config'||!config||extra.length||!['list','prune'].includes(command)||
   (command==='list'&&(selection||id))||(command==='prune'&&(selection!=='--instance'||!id)))throw Error('INSTANCE_USAGE');
 console.log(JSON.stringify(command==='list'?await listInstances(config):await pruneInstance(config,id),null,2));
}catch(e){console.error(/^(INSTANCE|CONFIG)_[A-Z_]+$/.test(e.message)?e.message:'INSTANCE_OPERATION_FAILED');process.exitCode=1;}
