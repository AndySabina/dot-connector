// Initialization owns resource acquisition; shutdown joins it before disposal.
export function createBridgeRuntime({bridge,transport,server,serve,publish,register,configFile,onReady,onClosed,onCleanupError}){
 let local,registration,closing,closeRequested=false;
 const ready=Promise.resolve().then(async()=>{
  if(closeRequested)return false;
  local=await serve(bridge);
  if(closeRequested)return false;
  if(configFile)registration=await publish(configFile,bridge.binding,local.socketPath);
  if(closeRequested)return false;
  register(server,bridge);
  await server.connect(transport);
  if(closeRequested)return false;
  onReady(local);return true;
 });
 const close=()=>{
  closeRequested=true;
  return closing??=(async()=>{
   // A rejected publication still settles acquisition; never await close inside ready.
   await ready.catch(()=>{});
   const result=await bridge.close();
   if(local)await local.close();
   if(result.verified&&registration)try{await registration.remove();}catch{onCleanupError();}
   await transport.close();onClosed(result);return result;
  })();
 };
 return {ready,close};
}
