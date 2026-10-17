// Lab-only reference model. Pure: no filesystem, network, transport or product import.
import path from 'node:path';

const LIMIT = 64;
const ROOT_LIMIT = 512;
const label = /^[A-Za-z0-9_-]{1,64}$/;
const controls = /[\x00-\x1f\x7f-\x9f]/;
const validated = new WeakSet();

const fail = code => { throw Error(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const id = x => typeof x === 'string' && label.test(x);
const list = x => Array.isArray(x) && x.length <= LIMIT;

function shape(x, keys, check) {
  if (!exact(x, keys) || !check(x)) fail('REGISTRY_INVALID');
  return x;
}

function grant(g) {
  shape(g, ['principalId', 'observe', 'write', 'execute'],
    g => id(g.principalId) && ['observe', 'write', 'execute'].every(k => typeof g[k] === 'boolean'));
  return {principalId: g.principalId, observe: g.observe, write: g.write, execute: g.execute};
}

function project(p) {
  shape(p, ['machineId', 'projectId', 'tunnelId', 'pathSpace', 'root', 'grants'],
    p => id(p.machineId) && id(p.projectId) && id(p.tunnelId) && ['windows', 'wsl'].includes(p.pathSpace) &&
      typeof p.root === 'string' && list(p.grants));
  return {machineId: p.machineId, projectId: p.projectId, tunnelId: p.tunnelId, pathSpace: p.pathSpace,
    root: p.root, grants: p.grants.map(grant)};
}

// Syntactic only: existence, case behavior and links are executor checks.
function validRoot(pathSpace, root) {
  if (root.length > ROOT_LIMIT || controls.test(root)) return false;
  if (pathSpace === 'windows') {
    const drive = /^[A-Za-z]:\\/.test(root);
    return drive && !/[/<>:"|?*]/.test(root.slice(2)) && path.win32.normalize(root) === root &&
      (root.length === 3 || !root.endsWith('\\'));
  }
  return path.posix.isAbsolute(root) && !root.includes('\\') && path.posix.normalize(root) === root &&
    (root === '/' || !root.endsWith('/'));
}

function unique(keys) {
  if (new Set(keys).size !== keys.length) fail('REGISTRY_DUPLICATE_ID');
}

function deepFreeze(x) {
  for (const value of Object.values(x)) if (value && typeof value === 'object') deepFreeze(value);
  return Object.freeze(x);
}

export function validateRegistry(document) {
  shape(document, ['schema', 'version', 'machines', 'tunnels', 'projects'],
    d => d.schema === 1 && Number.isSafeInteger(d.version) && d.version >= 0 &&
      list(d.machines) && d.machines.length > 0 && list(d.tunnels) && list(d.projects));
  const machines = document.machines.map(m => shape(m, ['machineId'], m => id(m.machineId))).map(m => ({machineId: m.machineId}));
  const tunnels = document.tunnels.map(t => shape(t, ['tunnelId', 'machineId'], t => id(t.tunnelId) && id(t.machineId)))
    .map(t => ({tunnelId: t.tunnelId, machineId: t.machineId}));
  const projects = document.projects.map(project);

  unique(machines.map(m => m.machineId));
  unique(tunnels.map(t => t.tunnelId));
  unique(projects.map(p => p.machineId + '/' + p.projectId));
  for (const p of projects) unique(p.grants.map(g => g.principalId));

  const machineIds = new Set(machines.map(m => m.machineId));
  const tunnelMachine = new Map(tunnels.map(t => [t.tunnelId, t.machineId]));
  for (const t of tunnels) if (!machineIds.has(t.machineId)) fail('REGISTRY_UNKNOWN_MACHINE');
  for (const p of projects) {
    if (!machineIds.has(p.machineId)) fail('REGISTRY_UNKNOWN_MACHINE');
    if (!tunnelMachine.has(p.tunnelId)) fail('REGISTRY_UNKNOWN_TUNNEL');
    if (tunnelMachine.get(p.tunnelId) !== p.machineId) fail('REGISTRY_TUNNEL_MACHINE_MISMATCH');
    if (!validRoot(p.pathSpace, p.root)) fail('REGISTRY_INVALID_ROOT');
  }

  const registry = deepFreeze({schema: 1, version: document.version, machines, tunnels, projects});
  validated.add(registry);
  return registry;
}

export const isRegistry = value => validated.has(value);
