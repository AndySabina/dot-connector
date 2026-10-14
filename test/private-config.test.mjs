import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,chmod,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {initConfig,readConfig,writeConfig,validateConfig,parseConfig,redactedConfig,configReadiness} from '../src/private-config.mjs';
const native=process.platform==='linux';
test('private config common API: revision conflicts, redaction and label preservation',{skip:!native},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dot-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'user','config.json');
 await initConfig(file);const c=await readConfig(file);c.machineId='SYNTHETIC_PRIVATE_LABEL';
 assert.equal((await writeConfig(file,c,0)).revision,1);
 await assert.rejects(writeConfig(file,c,0),/REVISION_CONFLICT/);assert.equal((await readConfig(file)).machineId,c.machineId);
 const result=await promisify(execFile)(process.execPath,['scripts/private-config.mjs','show','--file',file]);assert.ok(!result.stdout.includes(c.machineId));assert.equal(JSON.parse(result.stdout).result.credentialsRequired,false);
 const current=await readConfig(file);const results=await Promise.allSettled([writeConfig(file,current,1),writeConfig(file,current,1)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await readConfig(file)).revision,2);assert.ok(!JSON.stringify(redactedConfig(current)).includes(c.machineId));
});
test('missing, empty, invalid and unsupported configuration fail without prompts or secret output',{skip:!native},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dot-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'user','config.json');
 assert.equal((await configReadiness(file)).field,'config.json');
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/tmux-bridge.mjs','--experimental-synthetic','--config',file],{timeout:3000}),e=>e.stdout===''&&JSON.parse(e.stderr).error.code==='CONFIG_NOT_FOUND');
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/private-config.mjs','doctor','--file',file],{timeout:3000}),e=>{const r=JSON.parse(e.stdout);return r.ok===false&&r.result.code==='CONFIG_NOT_FOUND'&&r.result.action.includes(' init ');});
 await initConfig(file);assert.equal((await configReadiness(file)).ready,true);
 const c=await readConfig(file);delete c.machineId;assert.throws(()=>validateConfig(c),/MISSING_MACHINEID/);
 c.machineId='';assert.throws(()=>validateConfig(c),/INVALID_LABEL/);c.machineId='local';c.secrets={fixture:'SYNTHETIC_SECRET'};assert.throws(()=>validateConfig(c),/INVALID_SCHEMA/);
 await writeFile(file,'');assert.equal((await configReadiness(file)).code,'CONFIG_INVALID_JSON');
 await writeFile(file,'SYNTHETIC_TEST_SECRET');const invalid=await configReadiness(file);assert.ok(!JSON.stringify(invalid).includes('SYNTHETIC_TEST_SECRET'));
 assert.equal((await configReadiness(file,'dot-remote')).code,'CONNECTION_NOT_IMPLEMENTED');
});
test('private config refuses unsafe files, git locations and unknown connection schema',{skip:!native},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dot-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'user','config.json');await initConfig(file);
 const c=await readConfig(file);assert.throws(()=>validateConfig({...c,endpoint:'https://invalid.example'}),/INVALID_SCHEMA/);assert.throws(()=>parseConfig('x'.repeat(32769)),/TOO_LARGE/);
 await chmod(file,0o644);await assert.rejects(readConfig(file),/PRIVATE_FILE/);await chmod(file,0o600);
 const original=await readFile(file);await rm(file);await symlink(path.join(dir,'target'),file);await assert.rejects(readConfig(file));await rm(file);await writeFile(file,original,{mode:0o600});
 await chmod(path.dirname(file),0o755);await assert.rejects(readConfig(file),/PRIVATE_DIRECTORY/);
 await mkdir(path.join(dir,'.git'));await assert.rejects(initConfig(path.join(dir,'other','config.json')),/OUTSIDE_GIT/);
});
