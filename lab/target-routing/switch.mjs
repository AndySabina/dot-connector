// Lab-only reference model. Frozen states with a single current state per ledger: every transition
// returns new frozen state and makes the state it started from stale.
// Cancelling is not undoing: dispatched work becomes uncertain and is never repeated.
import {isSessionContext, checkResult} from './context.mjs';

const operationLabel = /^[A-Za-z0-9_-]{1,80}$/;
const lineages = new WeakMap();

const fail = code => { throw Error(code); };

function ledger(lineage, context, operations, retired) {
  const state = Object.freeze({
    context,
    operations: Object.freeze(operations.map(o => Object.freeze({operationId: o.operationId, status: o.status}))),
    retired: Object.freeze({operationIds: Object.freeze([...retired.operationIds]),
      incarnations: Object.freeze([...retired.incarnations])})
  });
  lineages.set(state, lineage);
  lineage.current = state;
  return state;
}

function verified(state) {
  if (!lineages.has(state)) fail('LEDGER_INVALID');
  return state;
}

const isCurrent = state => lineages.get(state).current === state;

function current(state) {
  if (!isCurrent(verified(state))) fail('LEDGER_STALE');
  return state;
}

const withStatus = (state, operationId, status) =>
  ledger(lineages.get(state), state.context, state.operations.map(o => o.operationId === operationId ? {...o, status} : o), state.retired);

export function openWorkspace(context) {
  if (!isSessionContext(context)) fail('CONTEXT_UNVERIFIED');
  return ledger({current: null}, context, [], {operationIds: [], incarnations: [context.incarnation]});
}

export function queueOperation(state, operationId) {
  current(state);
  if (typeof operationId !== 'string' || !operationLabel.test(operationId)) fail('REQUEST_INVALID');
  if (state.operations.some(o => o.operationId === operationId) || state.retired.operationIds.includes(operationId)) {
    fail('OPERATION_ID_REUSED');
  }
  return ledger(lineages.get(state), state.context, [...state.operations, {operationId, status: 'queued'}], state.retired);
}

export function markDispatched(state, operationId) {
  current(state);
  if (!state.operations.some(o => o.operationId === operationId && o.status === 'queued')) fail('OPERATION_NOT_QUEUED');
  return withStatus(state, operationId, 'dispatched');
}

// Never throws for a result: it returns a verdict and the unchanged state when refused,
// including when the state is stale.
export function completeOperation(state, result) {
  verified(state);
  const verdict = checkResult(state.context, result);
  const refuse = reason => Object.freeze({
    verdict: Object.freeze({accepted: false, reason, operationId: verdict.operationId}), state});
  if (!isCurrent(state)) return refuse('LEDGER_STALE');
  if (!verdict.accepted) return Object.freeze({verdict, state});
  const operation = state.operations.find(o => o.operationId === verdict.operationId);
  if (operation?.status === 'completed') return refuse('RESULT_ALREADY_COMPLETED');
  if (operation?.status !== 'dispatched') return refuse('RESULT_UNKNOWN_OPERATION');
  return Object.freeze({verdict, state: withStatus(state, operation.operationId, 'completed')});
}

// The caller must resolve the next target again (phase 1) and create a new context.
export function switchProject(state, nextContext) {
  current(state);
  if (!isSessionContext(nextContext)) fail('CONTEXT_UNVERIFIED');
  if (state.retired.incarnations.includes(nextContext.incarnation)) fail('SWITCH_INCARNATION_REUSED');
  const previous = state.operations
    .filter(o => o.status === 'queued' || o.status === 'dispatched')
    .map(o => Object.freeze({operationId: o.operationId, status: o.status === 'queued' ? 'cancelled' : 'uncertain'}));
  const retired = {
    operationIds: [...state.retired.operationIds, ...previous.map(o => o.operationId)],
    incarnations: [...state.retired.incarnations, nextContext.incarnation]
  };
  return Object.freeze({state: ledger(lineages.get(state), nextContext, [], retired), previous: Object.freeze(previous)});
}
