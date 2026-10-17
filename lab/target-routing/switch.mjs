// Lab-only reference model. Pure and immutable: every transition returns new frozen state.
// Cancelling is not undoing: dispatched work becomes uncertain and is never repeated.
import {isSessionContext, checkResult} from './context.mjs';

const operationLabel = /^[A-Za-z0-9_-]{1,80}$/;
const ledgers = new WeakSet();

const fail = code => { throw Error(code); };

function ledger(context, operations, retired) {
  const state = Object.freeze({
    context,
    operations: Object.freeze(operations.map(o => Object.freeze({operationId: o.operationId, status: o.status}))),
    retired: Object.freeze({operationIds: Object.freeze([...retired.operationIds]),
      incarnations: Object.freeze([...retired.incarnations])})
  });
  ledgers.add(state);
  return state;
}

function verified(state) {
  if (!ledgers.has(state)) fail('LEDGER_INVALID');
  return state;
}

const withStatus = (state, operationId, status) =>
  ledger(state.context, state.operations.map(o => o.operationId === operationId ? {...o, status} : o), state.retired);

export function openWorkspace(context) {
  if (!isSessionContext(context)) fail('CONTEXT_UNVERIFIED');
  return ledger(context, [], {operationIds: [], incarnations: [context.incarnation]});
}

export function queueOperation(state, operationId) {
  verified(state);
  if (typeof operationId !== 'string' || !operationLabel.test(operationId)) fail('REQUEST_INVALID');
  if (state.operations.some(o => o.operationId === operationId) || state.retired.operationIds.includes(operationId)) {
    fail('OPERATION_ID_REUSED');
  }
  return ledger(state.context, [...state.operations, {operationId, status: 'queued'}], state.retired);
}

export function markDispatched(state, operationId) {
  verified(state);
  if (!state.operations.some(o => o.operationId === operationId && o.status === 'queued')) fail('OPERATION_NOT_QUEUED');
  return withStatus(state, operationId, 'dispatched');
}

// Never throws for a result: it returns a verdict and the unchanged state when refused.
export function completeOperation(state, result) {
  verified(state);
  const verdict = checkResult(state.context, result);
  const refuse = reason => Object.freeze({
    verdict: Object.freeze({accepted: false, reason, operationId: verdict.operationId}), state});
  if (!verdict.accepted) return Object.freeze({verdict, state});
  const operation = state.operations.find(o => o.operationId === verdict.operationId);
  if (operation?.status === 'completed') return refuse('RESULT_ALREADY_COMPLETED');
  if (operation?.status !== 'dispatched') return refuse('RESULT_UNKNOWN_OPERATION');
  return Object.freeze({verdict, state: withStatus(state, operation.operationId, 'completed')});
}

// The caller must resolve the next target again (phase 1) and create a new context.
export function switchProject(state, nextContext) {
  verified(state);
  if (!isSessionContext(nextContext)) fail('CONTEXT_UNVERIFIED');
  if (state.retired.incarnations.includes(nextContext.incarnation)) fail('SWITCH_INCARNATION_REUSED');
  const previous = state.operations
    .filter(o => o.status === 'queued' || o.status === 'dispatched')
    .map(o => Object.freeze({operationId: o.operationId, status: o.status === 'queued' ? 'cancelled' : 'uncertain'}));
  const retired = {
    operationIds: [...state.retired.operationIds, ...previous.map(o => o.operationId)],
    incarnations: [...state.retired.incarnations, nextContext.incarnation]
  };
  return Object.freeze({state: ledger(nextContext, [], retired), previous: Object.freeze(previous)});
}
