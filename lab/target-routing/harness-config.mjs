// Lab-only reference model. Pure: no filesystem, network, process, transport or product import.
// Every harness project is agent-only; there is no mode and no shell program.
const label = /^[A-Za-z0-9_-]{1,64}$/;
const unsafe = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'wsl']);
const KINDS = ['multiplexer', 'terminal'];
const validated = new WeakSet();

const fail = code => { throw Error(code); };
const exact = (x, keys) => x !== null && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const id = x => typeof x === 'string' && label.test(x);
const arg = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && !unsafe.test(x);

// Shallow snapshot of an untrusted plain object, or null. Each key and descriptor is read once and
// getters never run, so later reads cannot differ from what was validated.
function plain(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

// Snapshot of an untrusted array with min..max elements, or null: only index keys plus length,
// no holes, no accessors, read through descriptors.
function list(value, min, max) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < min || length > max) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;
    const copy = [];
    for (let i = 0; i < length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return null;
  }
}

// Reads a plain object with exactly the given keys, or fails.
function record(value, keys) {
  const copy = plain(value);
  if (!exact(copy, keys)) fail('HARNESS_INVALID');
  return copy;
}

function items(value, min, max, check) {
  const copy = list(value, min, max);
  if (!copy || !copy.every(check)) fail('HARNESS_INVALID');
  return copy;
}

function profile(value) {
  const p = record(value, ['profileId', 'kind', 'argv']);
  if (!id(p.profileId) || !KINDS.includes(p.kind)) fail('HARNESS_INVALID');
  return {profileId: p.profileId, kind: p.kind, argv: items(p.argv, 1, 16, arg)};
}

function agent(value) {
  const a = record(value, ['agentId', 'argv', 'safeModeArgv']);
  if (!id(a.agentId)) fail('HARNESS_INVALID');
  return {agentId: a.agentId, argv: items(a.argv, 1, 16, arg), safeModeArgv: items(a.safeModeArgv, 0, 16, arg)};
}

function project(value) {
  const p = record(value, ['machineId', 'projectId', 'launchProfileId', 'agentIds']);
  if (![p.machineId, p.projectId, p.launchProfileId].every(id)) fail('HARNESS_INVALID');
  const agentIds = items(p.agentIds, 1, 16, id);
  if (new Set(agentIds).size !== agentIds.length) fail('HARNESS_INVALID');
  return {machineId: p.machineId, projectId: p.projectId, launchProfileId: p.launchProfileId, agentIds};
}

function unique(keys) {
  if (new Set(keys).size !== keys.length) fail('HARNESS_DUPLICATE_ID');
}

// Windows ignores trailing dots and spaces and runs .exe or .com, so 'cmd.' and 'cmd.com' are cmd.
const baseName = program =>
  program.split(/[\\/]/).pop().toLowerCase().replace(/[. ]+$/, '').replace(/\.(exe|com)$/, '');

// A guard, not a guarantee: a configured program could still start a shell itself.
// env runs its first non-assignment argument, so that argument is checked too; env options
// (such as -S, which splits a string into a command) cannot be checked and are refused.
function notShell(argv) {
  let index = 0;
  if (baseName(argv[0]) === 'env') {
    index = 1;
    while (index < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index])) index++;
    if (index === argv.length || argv[index].startsWith('-')) fail('HARNESS_SHELL_PROGRAM');
  }
  if (SHELLS.has(baseName(argv[index]))) fail('HARNESS_SHELL_PROGRAM');
}

function deepFreeze(x) {
  for (const value of Object.values(x)) if (value && typeof value === 'object') deepFreeze(value);
  return Object.freeze(x);
}

export function validateHarnessConfig(document) {
  const d = record(document, ['schema', 'version', 'launchProfiles', 'agents', 'projects']);
  if (d.schema !== 1 || !Number.isSafeInteger(d.version) || d.version < 0) fail('HARNESS_INVALID');
  const launchProfiles = items(d.launchProfiles, 1, 16, () => true).map(profile);
  const agents = items(d.agents, 1, 32, () => true).map(agent);
  const projects = items(d.projects, 1, 64, () => true).map(project);

  unique(launchProfiles.map(p => p.profileId));
  unique(agents.map(a => a.agentId));
  unique(projects.map(p => p.machineId + '/' + p.projectId));
  const profileIds = new Set(launchProfiles.map(p => p.profileId));
  const agentIds = new Set(agents.map(a => a.agentId));
  for (const p of projects) {
    if (!profileIds.has(p.launchProfileId)) fail('HARNESS_UNKNOWN_PROFILE');
    if (!p.agentIds.every(a => agentIds.has(a))) fail('HARNESS_UNKNOWN_AGENT');
  }
  for (const entry of [...launchProfiles, ...agents]) notShell(entry.argv);

  const harness = deepFreeze({schema: 1, version: d.version, launchProfiles, agents, projects});
  validated.add(harness);
  return harness;
}

export const isHarnessConfig = value => validated.has(value);
