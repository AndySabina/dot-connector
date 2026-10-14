#!/usr/bin/env node
// Explicit experimental entrypoint; installed plugin manifest remains diagnostic-only.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {createSyntheticSession} from '../src/tmux-session.mjs';
import {SnapshotBridge,serveHumanView} from '../src/tmux-bridge.mjs';
import {BoundedMcpStdio} from '../src/bounded-mcp-stdio.mjs';
import {registerBridgeTools} from '../src/tmux-bridge-mcp.mjs';
import {readConfig,configProblem} from '../src/private-config.mjs';

let [flag,machineId,projectId,...extra]=process.argv.slice(2);
if(flag==='--experimental-synthetic'&&machineId==='--config'&&projectId&&!extra.length){
 try{const config=await readConfig(projectId);machineId=config.machineId;projectId=config.projectId;}
 catch(e){console.error(JSON.stringify({ok:false,error:configProblem(e)}));process.exit(2);}
}
if(flag!=='--experimental-synthetic'||extra.length||!machineId||!projectId){
  console.error('Explicit opt-in required: --experimental-synthetic MACHINE_LABEL SYNTHETIC_PROJECT_LABEL');process.exitCode=2;
} else {
  const session=await createSyntheticSession({machineId,projectId}),bridge=new SnapshotBridge(session);
  let local,closing;
  const transport=new BoundedMcpStdio(),server=new McpServer({name:'dot-snapshot-bridge-experimental',version:'0.1.0'});
  const close=()=>closing??=(async()=>{
    const result=await bridge.close();if(local)await local.close();await transport.close();
    console.error(JSON.stringify({event:'closed',result,retainedState:session.dir}));process.exitCode=result.verified?0:1;
  })();
  server.server.onclose=()=>{void close();};
  process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
  try {
    local=await serveHumanView(bridge);registerBridgeTools(server,bridge);
    await server.connect(transport);
    console.error(JSON.stringify({event:'ready',humanSocket:local.socketPath,binding:bridge.binding,paused:true}));
  } catch {console.error('BRIDGE_START_FAILED');await close();process.exitCode=1;}
}
