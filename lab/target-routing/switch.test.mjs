import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionContext, bindRequest} from './context.mjs';
import {openWorkspace, queueOperation, markDispatched, completeOperation, switchProject} from './switch.mjs';

// Fictional identifiers and paths only.
const shop = {machineId: 'm-alpha', tunnelId: 't-alpha', projectId: 'p-shop', pathSpace: 'windows',
  root: 'C:\\work\\shop', configVersion: 3};
const blog = {machineId: 'm-alpha', tunnelId: 't-alpha', projectId: 'p-blog', pathSpace: 'wsl',
  root: '/home/dev/blog', configVersion: 3};
const incarnation = n => `${n}1111111-2222-4333-8444-555555555555`;
const context = (target, n = 1) => createSessionContext(target, {sessionId: 's-' + n, incarnation: incarnation(n)});
const resultFor = (ctx, operationId) => ({...bindRequest(ctx, operationId), data: 'done'});

test('a ledger starts from a verified context and rejects forged state', () => {
  const state = openWorkspace(context(shop));
  assert.deepEqual(state.operations, []);
  assert.ok(Object.isFrozen(state));
  assert.throws(() => openWorkspace({...context(shop)}), {message: 'CONTEXT_UNVERIFIED'});
  assert.throws(() => queueOperation({...state}, 'op-1'), {message: 'LEDGER_INVALID'});
  assert.throws(() => queueOperation(state, 'op 1'), {message: 'REQUEST_INVALID'});
});

test('queue, dispatch and a matching result complete an operation without changing earlier states', () => {
  const ctx = context(shop);
  const opened = openWorkspace(ctx);
  const queued = queueOperation(opened, 'op-1');
  const dispatched = markDispatched(queued, 'op-1');
  const {verdict, state} = completeOperation(dispatched, resultFor(ctx, 'op-1'));
  assert.equal(verdict.reason, 'ACCEPTED');
  assert.deepEqual(state.operations, [{operationId: 'op-1', status: 'completed'}]);
  assert.deepEqual(opened.operations, []);
  assert.deepEqual(queued.operations, [{operationId: 'op-1', status: 'queued'}]);
  assert.deepEqual(dispatched.operations, [{operationId: 'op-1', status: 'dispatched'}]);
  assert.throws(() => queueOperation(state, 'op-1'), {message: 'OPERATION_ID_REUSED'});
  assert.throws(() => markDispatched(state, 'op-1'), {message: 'OPERATION_NOT_QUEUED'});
});

test('results for unknown, undispatched or completed operations are refused and change nothing', () => {
  const ctx = context(shop);
  const queued = queueOperation(openWorkspace(ctx), 'op-1');
  const notSent = completeOperation(queued, resultFor(ctx, 'op-1'));
  assert.deepEqual({...notSent.verdict}, {accepted: false, reason: 'RESULT_UNKNOWN_OPERATION', operationId: 'op-1'});
  assert.equal(notSent.state, queued);
  assert.equal(completeOperation(queued, resultFor(ctx, 'op-9')).verdict.reason, 'RESULT_UNKNOWN_OPERATION');
  const done = completeOperation(markDispatched(queued, 'op-1'), resultFor(ctx, 'op-1')).state;
  const again = completeOperation(done, resultFor(ctx, 'op-1'));
  assert.equal(again.verdict.reason, 'RESULT_ALREADY_COMPLETED');
  assert.equal(again.state, done);
});

test('a switch cancels queued work, keeps dispatched work uncertain and starts empty', () => {
  const ctx = context(shop);
  let state = openWorkspace(ctx);
  for (const id of ['op-sent', 'op-waiting', 'op-done']) state = queueOperation(state, id);
  state = markDispatched(markDispatched(state, 'op-sent'), 'op-done');
  state = completeOperation(state, resultFor(ctx, 'op-done')).state;
  const before = state;
  const next = context(blog, 2);
  const switched = switchProject(state, next);
  assert.deepEqual(switched.previous, [
    {operationId: 'op-sent', status: 'uncertain'},
    {operationId: 'op-waiting', status: 'cancelled'}
  ]);
  assert.equal(switched.state.context, next);
  assert.deepEqual(switched.state.operations, []);
  assert.deepEqual(Object.keys(switched.state).sort(), ['context', 'operations', 'retired']);
  assert.equal(state, before);
  assert.equal(before.operations.length, 3);
});

test('a late result from the previous project is rejected after the switch', () => {
  const old = context(shop);
  const state = markDispatched(queueOperation(openWorkspace(old), 'op-1'), 'op-1');
  const {state: current} = switchProject(state, context(blog, 2));
  const late = completeOperation(current, resultFor(old, 'op-1'));
  assert.deepEqual({...late.verdict}, {accepted: false, reason: 'RESULT_TARGET_MISMATCH', operationId: 'op-1'});
  assert.equal(late.state, current);
});

test('cancelled and uncertain operations are never queued again', () => {
  let state = openWorkspace(context(shop));
  state = markDispatched(queueOperation(queueOperation(state, 'op-sent'), 'op-waiting'), 'op-sent');
  const {state: current} = switchProject(state, context(blog, 2));
  assert.throws(() => queueOperation(current, 'op-sent'), {message: 'OPERATION_ID_REUSED'});
  assert.throws(() => queueOperation(current, 'op-waiting'), {message: 'OPERATION_ID_REUSED'});
  const {state: later} = switchProject(current, context(shop, 3));
  assert.throws(() => queueOperation(later, 'op-sent'), {message: 'OPERATION_ID_REUSED'});
  assert.deepEqual(queueOperation(later, 'op-new').operations, [{operationId: 'op-new', status: 'queued'}]);
});

test('a switch needs a verified context with a new incarnation', () => {
  const ctx = context(shop);
  const state = openWorkspace(ctx);
  assert.throws(() => switchProject(state, ctx), {message: 'SWITCH_INCARNATION_REUSED'});
  assert.throws(() => switchProject(state, context(blog, 1)), {message: 'SWITCH_INCARNATION_REUSED'});
  assert.throws(() => switchProject(state, {...context(blog, 2)}), {message: 'CONTEXT_UNVERIFIED'});
  assert.throws(() => switchProject({...state}, context(blog, 2)), {message: 'LEDGER_INVALID'});
  const {state: onBlog} = switchProject(state, context(blog, 2));
  assert.throws(() => switchProject(onBlog, context(shop, 1)), {message: 'SWITCH_INCARNATION_REUSED'});
});

test('restarting the same project is a switch and old results become a session mismatch', () => {
  const old = context(shop);
  const state = markDispatched(queueOperation(openWorkspace(old), 'op-1'), 'op-1');
  const {state: restarted, previous} = switchProject(state, context(shop, 2));
  assert.deepEqual(previous, [{operationId: 'op-1', status: 'uncertain'}]);
  assert.equal(completeOperation(restarted, resultFor(old, 'op-1')).verdict.reason, 'RESULT_SESSION_MISMATCH');
});
