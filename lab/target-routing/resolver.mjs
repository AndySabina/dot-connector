// Lab-only reference model. Pure: no filesystem, network, transport or product import.
import {isRegistry} from './registry.mjs';

const OPERATIONS = ['observe', 'write', 'execute'];
const REQUIRED = ['schema', 'configVersion', 'projectId', 'operation'];
const OPTIONAL = ['machineId', 'tunnelId'];
const label = /^[A-Za-z0-9_-]{1,64}$/;

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && label.test(x);

function validRequest(r) {
  if (!object(r)) return false;
  const keys = Object.keys(r);
  if (!REQUIRED.every(k => keys.includes(k)) || keys.some(k => !REQUIRED.includes(k) && !OPTIONAL.includes(k))) return false;
  return r.schema === 1 && Number.isSafeInteger(r.configVersion) && r.configVersion >= 0 && id(r.projectId) &&
    OPERATIONS.includes(r.operation) && OPTIONAL.every(k => !Object.hasOwn(r, k) || id(r[k]));
}

// The context comes from the caller's trusted mechanism, never from the request.
function validContext(c) {
  return object(c) && Object.keys(c).sort().join(',') === 'principalId,tunnelStatus' && id(c.principalId) &&
    object(c.tunnelStatus) && Object.values(c.tunnelStatus).every(s => s === 'up' || s === 'down');
}

function decide(decision, reason, operation, target) {
  const result = {decision, reason, operation};
  if (target) result.target = Object.freeze(target);
  return Object.freeze(result);
}

export function resolveTarget(registry, context, request) {
  const operation = object(request) && OPERATIONS.includes(request.operation) ? request.operation : null;
  const deny = reason => decide('deny', reason, operation);

  if (!isRegistry(registry)) return deny('REGISTRY_UNVERIFIED');
  if (!validRequest(request)) return decide('deny', 'REQUEST_INVALID', null);
  if (!validContext(context)) return deny('REQUESTER_UNVERIFIED');
  if (request.configVersion !== registry.version) return deny('CONFIG_STALE');

  const named = registry.projects.filter(p => p.projectId === request.projectId);
  const matches = Object.hasOwn(request, 'machineId') ? named.filter(p => p.machineId === request.machineId) : named;
  if (matches.length === 0) return deny(named.length === 0 ? 'TARGET_UNKNOWN' : 'TARGET_INCONSISTENT');
  if (matches.length > 1) return deny('TARGET_AMBIGUOUS');
  const project = matches[0];
  if (Object.hasOwn(request, 'tunnelId') && request.tunnelId !== project.tunnelId) return deny('TARGET_INCONSISTENT');

  const grant = project.grants.find(g => g.principalId === context.principalId);
  if (!grant) return deny('PERMISSION_MISSING');
  if (grant[operation] !== true) return deny('PERMISSION_DENIED');
  // Never fall back to another tunnel, machine or project.
  if (!Object.hasOwn(context.tunnelStatus, project.tunnelId) || context.tunnelStatus[project.tunnelId] !== 'up') {
    return deny('TUNNEL_UNAVAILABLE');
  }

  return decide('allow', 'ALLOWED', operation, {machineId: project.machineId, tunnelId: project.tunnelId,
    projectId: project.projectId, pathSpace: project.pathSpace, root: project.root, configVersion: registry.version});
}
