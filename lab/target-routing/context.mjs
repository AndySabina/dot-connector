// Lab-only reference model. Pure: no filesystem, network, transport or product import.
// The binding is an identity and context check, not a cryptographic seal or authorization.
const label = /^[A-Za-z0-9_-]{1,64}$/;
const operationLabel = /^[A-Za-z0-9_-]{1,80}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const controls = /[\x00-\x1f\x7f-\x9f]/;
const TARGET = ['machineId', 'tunnelId', 'projectId', 'pathSpace', 'root', 'configVersion'];
const SESSION = ['sessionId', 'incarnation'];
const BINDING = ['machineId', 'tunnelId', 'projectId', 'sessionId', 'incarnation', 'configVersion'];
const created = new WeakSet();

const fail = code => { throw Error(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const id = x => typeof x === 'string' && label.test(x);
const version = x => Number.isSafeInteger(x) && x >= 0;

function validTarget(t) {
  return exact(t, TARGET) && id(t.machineId) && id(t.tunnelId) && id(t.projectId) &&
    ['windows', 'wsl'].includes(t.pathSpace) && typeof t.root === 'string' && t.root.length > 0 &&
    t.root.length <= 512 && !controls.test(t.root) && version(t.configVersion);
}

const validSession = s => exact(s, SESSION) && id(s.sessionId) && typeof s.incarnation === 'string' && uuid.test(s.incarnation);

function validBinding(b) {
  return exact(b, BINDING) && id(b.machineId) && id(b.tunnelId) && id(b.projectId) && id(b.sessionId) &&
    typeof b.incarnation === 'string' && uuid.test(b.incarnation) && version(b.configVersion);
}

export function createSessionContext(target, session) {
  if (!validTarget(target) || !validSession(session)) fail('CONTEXT_INVALID');
  const context = Object.freeze({
    machineId: target.machineId, tunnelId: target.tunnelId, projectId: target.projectId, pathSpace: target.pathSpace,
    root: target.root, configVersion: target.configVersion, sessionId: session.sessionId, incarnation: session.incarnation
  });
  created.add(context);
  return context;
}

export const isSessionContext = value => created.has(value);

const bindingOf = context => Object.freeze(Object.fromEntries(BINDING.map(k => [k, context[k]])));

export function bindRequest(context, operationId) {
  if (!created.has(context)) fail('CONTEXT_UNVERIFIED');
  if (typeof operationId !== 'string' || !operationLabel.test(operationId)) fail('REQUEST_INVALID');
  return Object.freeze({operationId, binding: bindingOf(context)});
}

// Result data stays untrusted data; it is returned untouched and never interpreted.
export function checkResult(context, result) {
  const verdict = (accepted, reason, operationId, data) =>
    Object.freeze(accepted ? {accepted, reason, operationId, data} : {accepted, reason, operationId});
  if (!created.has(context)) return verdict(false, 'CONTEXT_UNVERIFIED', null);
  if (!exact(result, ['operationId', 'binding', 'data']) || typeof result.operationId !== 'string' ||
    !operationLabel.test(result.operationId) || !validBinding(result.binding)) return verdict(false, 'RESULT_INVALID', null);

  const {binding, operationId} = result;
  if (['machineId', 'tunnelId', 'projectId'].some(k => binding[k] !== context[k])) {
    return verdict(false, 'RESULT_TARGET_MISMATCH', operationId);
  }
  if (['sessionId', 'incarnation'].some(k => binding[k] !== context[k])) return verdict(false, 'RESULT_SESSION_MISMATCH', operationId);
  if (binding.configVersion !== context.configVersion) return verdict(false, 'RESULT_CONFIG_STALE', operationId);
  return verdict(true, 'ACCEPTED', operationId, result.data);
}
