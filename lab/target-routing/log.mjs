// Lab-only reference model. Pure: no filesystem, clock, network or product import.
// Entries hold identifiers, a decision and a reason code only: never commands,
// prompts, output content or paths.
const label = /^[A-Za-z0-9_-]{1,64}$/;
const operationLabel = /^[A-Za-z0-9_-]{1,80}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reasonCode = /^[A-Z][A-Z0-9_]{1,63}$/;
const KINDS = ['resolution', 'result', 'switch', 'path'];
const DECISIONS = ['allow', 'deny', 'accepted', 'rejected', 'cancelled', 'uncertain'];
const OPERATIONS = ['observe', 'write', 'execute'];
const REQUIRED = ['schema', 'sequence', 'kind', 'decision', 'reason', 'operation'];
const OPTIONAL = {
  machineId: v => typeof v === 'string' && label.test(v),
  tunnelId: v => typeof v === 'string' && label.test(v),
  projectId: v => typeof v === 'string' && label.test(v),
  sessionId: v => typeof v === 'string' && label.test(v),
  incarnation: v => typeof v === 'string' && uuid.test(v),
  operationId: v => typeof v === 'string' && operationLabel.test(v)
};
const FIELDS = [...REQUIRED, ...Object.keys(OPTIONAL)];
const entries = new WeakSet();

const fail = code => { throw Error(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function createLogEntry(fields) {
  if (!object(fields)) fail('LOG_INVALID');
  if (Object.keys(fields).some(k => !FIELDS.includes(k))) fail('LOG_FIELD_FORBIDDEN');
  const valid = REQUIRED.every(k => Object.hasOwn(fields, k)) && fields.schema === 1 &&
    Number.isSafeInteger(fields.sequence) && fields.sequence >= 0 && KINDS.includes(fields.kind) &&
    DECISIONS.includes(fields.decision) && typeof fields.reason === 'string' && reasonCode.test(fields.reason) &&
    (fields.operation === null || OPERATIONS.includes(fields.operation)) &&
    Object.entries(OPTIONAL).every(([k, check]) => !Object.hasOwn(fields, k) || check(fields[k]));
  if (!valid) fail('LOG_INVALID');
  const entry = Object.freeze(Object.fromEntries(FIELDS.filter(k => Object.hasOwn(fields, k)).map(k => [k, fields[k]])));
  entries.add(entry);
  return entry;
}

const pick = (source, keys) => Object.fromEntries(keys.filter(k => object(source) && Object.hasOwn(source, k)).map(k => [k, source[k]]));

// Reads phase 1 decisions and phase 2 verdicts by shape; drops root, pathSpace and data.
export function toLogEntry(sequence, kind, source) {
  if (!object(source)) fail('LOG_INVALID');
  const base = {schema: 1, sequence, kind};
  if (Object.hasOwn(source, 'decision')) {
    return createLogEntry({...base, decision: source.decision, reason: source.reason, operation: source.operation ?? null,
      ...pick(source.target, ['machineId', 'tunnelId', 'projectId'])});
  }
  if (typeof source.accepted === 'boolean') {
    return createLogEntry({...base, decision: source.accepted ? 'accepted' : 'rejected', reason: source.reason,
      operation: null, ...(source.operationId == null ? {} : {operationId: source.operationId}),
      ...pick(source.binding, ['machineId', 'tunnelId', 'projectId', 'sessionId', 'incarnation'])});
  }
  return fail('LOG_INVALID');
}

export function serializeLogEntry(entry) {
  if (!entries.has(entry)) fail('LOG_INVALID');
  return JSON.stringify(Object.fromEntries(Object.keys(entry).sort().map(k => [k, entry[k]])));
}
