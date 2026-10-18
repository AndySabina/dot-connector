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

// Shallow snapshot of a plain object, read once: own string keys whose descriptors
// are enumerable data properties. Anything else, including a throwing trap, is null.
function plain(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return null;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !('value' in d)) return null;
      copy[key] = d.value;
    }
    return copy;
  } catch {
    return null;
  }
}

export function createLogEntry(fields) {
  const f = plain(fields);
  if (!f) fail('LOG_INVALID');
  if (Object.keys(f).some(k => !FIELDS.includes(k))) fail('LOG_FIELD_FORBIDDEN');
  const valid = REQUIRED.every(k => Object.hasOwn(f, k)) && f.schema === 1 &&
    Number.isSafeInteger(f.sequence) && f.sequence >= 0 && KINDS.includes(f.kind) &&
    DECISIONS.includes(f.decision) && typeof f.reason === 'string' && reasonCode.test(f.reason) &&
    (f.operation === null || OPERATIONS.includes(f.operation)) &&
    Object.entries(OPTIONAL).every(([k, check]) => !Object.hasOwn(f, k) || check(f[k]));
  if (!valid) fail('LOG_INVALID');
  const entry = Object.freeze(Object.fromEntries(FIELDS.filter(k => Object.hasOwn(f, k)).map(k => [k, f[k]])));
  entries.add(entry);
  return entry;
}

// Snapshot of an optional nested object: absent or null gives {}, anything not plain fails.
const nested = value => value == null ? {} : plain(value) ?? fail('LOG_INVALID');
const pick = (source, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(source, k)).map(k => [k, source[k]]));

// Reads phase 1 decisions and phase 2 verdicts by shape; drops root, pathSpace and data.
export function toLogEntry(sequence, kind, source) {
  const s = plain(source);
  if (!s) fail('LOG_INVALID');
  const base = {schema: 1, sequence, kind};
  if (Object.hasOwn(s, 'decision')) {
    return createLogEntry({...base, decision: s.decision, reason: s.reason, operation: s.operation ?? null,
      ...pick(nested(s.target), ['machineId', 'tunnelId', 'projectId'])});
  }
  if (typeof s.accepted === 'boolean') {
    return createLogEntry({...base, decision: s.accepted ? 'accepted' : 'rejected', reason: s.reason,
      operation: null, ...(s.operationId == null ? {} : {operationId: s.operationId}),
      ...pick(nested(s.binding), ['machineId', 'tunnelId', 'projectId', 'sessionId', 'incarnation'])});
  }
  return fail('LOG_INVALID');
}

export function serializeLogEntry(entry) {
  if (!entries.has(entry)) fail('LOG_INVALID');
  return JSON.stringify(Object.fromEntries(Object.keys(entry).sort().map(k => [k, entry[k]])));
}
