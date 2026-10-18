// Lab-only reference model. Pure: no filesystem, network, transport or product import.
import {isRegistry} from './registry.mjs';

const OPERATIONS = ['observe', 'write', 'execute'];
const REQUIRED = ['schema', 'configVersion', 'projectId', 'operation'];
const OPTIONAL = ['machineId', 'tunnelId'];
const label = /^[A-Za-z0-9_-]{1,64}$/;

const id = x => typeof x === 'string' && label.test(x);

// One read of a plain object: own enumerable string-keyed data properties only.
// Accessors, symbol keys, other prototypes and throwing proxy traps yield null.
function snapshot(x) {
  try {
    if (x === null || typeof x !== 'object') return null;
    const proto = Reflect.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return null;
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(x)) {
      if (typeof key !== 'string') return null;
      const d = Object.getOwnPropertyDescriptor(x, key);
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return null;
      copy[key] = d.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function validRequest(r) {
  if (!r) return false;
  const keys = Object.keys(r);
  if (!REQUIRED.every(k => keys.includes(k)) || keys.some(k => !REQUIRED.includes(k) && !OPTIONAL.includes(k))) return false;
  return r.schema === 1 && Number.isSafeInteger(r.configVersion) && r.configVersion >= 0 && id(r.projectId) &&
    OPERATIONS.includes(r.operation) && OPTIONAL.every(k => !Object.hasOwn(r, k) || id(r[k]));
}

// The context comes from the caller's trusted mechanism, never from the request.
function contextSnapshot(c) {
  const copy = snapshot(c);
  if (!copy || Object.keys(copy).sort().join(',') !== 'principalId,tunnelStatus' || !id(copy.principalId)) return null;
  const tunnelStatus = snapshot(copy.tunnelStatus);
  if (!tunnelStatus || !Object.values(tunnelStatus).every(s => s === 'up' || s === 'down')) return null;
  return {principalId: copy.principalId, tunnelStatus};
}

function decide(decision, reason, operation, target) {
  const result = {decision, reason, operation};
  if (target) result.target = Object.freeze(target);
  return Object.freeze(result);
}

// A project is visible only to a principal holding at least one allowed operation in it.
const visibleTo = (project, principalId) =>
  project.grants.some(g => g.principalId === principalId && OPERATIONS.some(op => g[op] === true));

export function resolveTarget(registry, context, rawRequest) {
  const request = snapshot(rawRequest);
  const operation = request && OPERATIONS.includes(request.operation) ? request.operation : null;
  const deny = reason => decide('deny', reason, operation);

  if (!isRegistry(registry)) return deny('REGISTRY_UNVERIFIED');
  if (!validRequest(request)) return decide('deny', 'REQUEST_INVALID', null);
  const trusted = contextSnapshot(context);
  if (!trusted) return deny('REQUESTER_UNVERIFIED');

  // Lookup runs over visible projects only, so a principal without a grant
  // cannot tell unknown, ambiguous, misplaced or stale targets apart.
  const named = registry.projects.filter(p => p.projectId === request.projectId);
  const visible = named.filter(p => visibleTo(p, trusted.principalId));
  if (visible.length === 0) return deny('TARGET_UNKNOWN');
  let project;
  if (Object.hasOwn(request, 'machineId')) {
    project = visible.find(p => p.machineId === request.machineId);
    if (!project) return deny('TARGET_UNKNOWN');
  } else {
    if (named.length > 1) return deny('TARGET_AMBIGUOUS');
    project = visible[0];
  }
  if (Object.hasOwn(request, 'tunnelId') && request.tunnelId !== project.tunnelId) return deny('TARGET_INCONSISTENT');
  if (request.configVersion !== registry.version) return deny('CONFIG_STALE');

  const grant = project.grants.find(g => g.principalId === trusted.principalId);
  if (grant[operation] !== true) return deny('PERMISSION_DENIED');
  // Never fall back to another tunnel, machine or project.
  if (!Object.hasOwn(trusted.tunnelStatus, project.tunnelId) || trusted.tunnelStatus[project.tunnelId] !== 'up') {
    return deny('TUNNEL_UNAVAILABLE');
  }

  return decide('allow', 'ALLOWED', operation, {machineId: project.machineId, tunnelId: project.tunnelId,
    projectId: project.projectId, pathSpace: project.pathSpace, root: project.root, configVersion: registry.version});
}
