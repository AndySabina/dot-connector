import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRegistry} from './registry.mjs';
import {resolveTarget} from './resolver.mjs';

// Fictional identifiers and paths only.
const allowAll = {observe: true, write: true, execute: true};
function document() {
  return {
    schema: 1,
    version: 3,
    machines: [{machineId: 'm-alpha'}, {machineId: 'm-beta'}],
    tunnels: [
      {tunnelId: 't-alpha', machineId: 'm-alpha'},
      {tunnelId: 't-beta', machineId: 'm-beta'}
    ],
    projects: [
      {machineId: 'm-alpha', projectId: 'p-shop', tunnelId: 't-alpha', pathSpace: 'windows', root: 'C:\\work\\shop',
        grants: [{principalId: 'u-dot', observe: true, write: false, execute: false}]},
      {machineId: 'm-alpha', projectId: 'p-blog', tunnelId: 't-alpha', pathSpace: 'wsl', root: '/home/dev/blog',
        grants: [{principalId: 'u-dot', ...allowAll}]},
      {machineId: 'm-beta', projectId: 'p-shop', tunnelId: 't-beta', pathSpace: 'windows', root: 'C:\\work\\shop',
        grants: [{principalId: 'u-dot', ...allowAll}]}
    ]
  };
}
const up = {'t-alpha': 'up', 't-beta': 'up'};
const context = (tunnelStatus = up) => ({principalId: 'u-dot', tunnelStatus});
const request = fields => ({schema: 1, configVersion: 3, operation: 'observe', ...fields});

test('two projects on the same tunnel keep their own permissions', () => {
  const registry = validateRegistry(document());
  const shopObserve = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-shop'}));
  assert.equal(shopObserve.decision, 'allow');
  assert.deepEqual(shopObserve.target, {machineId: 'm-alpha', tunnelId: 't-alpha', projectId: 'p-shop',
    pathSpace: 'windows', root: 'C:\\work\\shop', configVersion: 3});
  const shopExecute = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-shop', operation: 'execute'}));
  assert.deepEqual({...shopExecute}, {decision: 'deny', reason: 'PERMISSION_DENIED', operation: 'execute'});
  const blogExecute = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-blog', operation: 'execute'}));
  assert.equal(blogExecute.decision, 'allow');
  assert.equal(blogExecute.target.projectId, 'p-blog');
});

test('matching project names and roots on two machines resolve only by machine identity', () => {
  const registry = validateRegistry(document());
  const ambiguous = resolveTarget(registry, context(), request({projectId: 'p-shop'}));
  assert.deepEqual({...ambiguous}, {decision: 'deny', reason: 'TARGET_AMBIGUOUS', operation: 'observe'});
  const beta = resolveTarget(registry, context(), request({machineId: 'm-beta', projectId: 'p-shop', operation: 'write'}));
  assert.equal(beta.decision, 'allow');
  assert.equal(beta.target.machineId, 'm-beta');
  assert.equal(beta.target.tunnelId, 't-beta');
  const alpha = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-shop', operation: 'write'}));
  assert.equal(alpha.reason, 'PERMISSION_DENIED');
});

test('missing grant and denied operation are both refused', () => {
  const registry = validateRegistry(document());
  const stranger = resolveTarget(registry, {principalId: 'u-other', tunnelStatus: up}, request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.equal(stranger.reason, 'TARGET_UNKNOWN');
  const denied = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-shop', operation: 'write'}));
  assert.equal(denied.reason, 'PERMISSION_DENIED');
});

test('unknown project, operation or field is refused', () => {
  const registry = validateRegistry(document());
  assert.equal(resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-none'})).reason, 'TARGET_UNKNOWN');
  const badOperation = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-blog', operation: 'delete'}));
  assert.deepEqual({...badOperation}, {decision: 'deny', reason: 'REQUEST_INVALID', operation: null});
  assert.equal(resolveTarget(registry, context(), request({projectId: 'p-blog', machineId: 'm-alpha', command: 'ls'})).reason, 'REQUEST_INVALID');
  assert.equal(resolveTarget(registry, context(), {configVersion: 3, projectId: 'p-blog', operation: 'observe'}).reason, 'REQUEST_INVALID');
  assert.equal(resolveTarget(registry, context(), null).reason, 'REQUEST_INVALID');
});

test('inconsistent machine or tunnel identity is refused', () => {
  const registry = validateRegistry(document());
  const wrongTunnel = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-blog', tunnelId: 't-beta'}));
  assert.equal(wrongTunnel.reason, 'TARGET_INCONSISTENT');
  // The principal cannot see p-blog on m-beta, so the machine is not confirmed as inconsistent.
  const wrongMachine = resolveTarget(registry, context(), request({machineId: 'm-beta', projectId: 'p-blog'}));
  assert.equal(wrongMachine.reason, 'TARGET_UNKNOWN');
});

test('an ungranted principal cannot map projects, machines, tunnels or the version', () => {
  const registry = validateRegistry(document());
  const stranger = {principalId: 'u-other', tunnelStatus: up};
  const probes = [
    request({machineId: 'm-alpha', projectId: 'p-blog'}),
    request({projectId: 'p-blog'}),
    request({projectId: 'p-shop'}),
    request({machineId: 'm-beta', projectId: 'p-blog'}),
    request({machineId: 'm-alpha', projectId: 'p-blog', tunnelId: 't-beta'}),
    request({machineId: 'm-alpha', projectId: 'p-blog', configVersion: 2}),
    request({projectId: 'p-shop', configVersion: 99}),
    request({machineId: 'm-alpha', projectId: 'p-none'})
  ];
  for (const probe of probes) {
    assert.deepEqual({...resolveTarget(registry, stranger, probe)}, {decision: 'deny', reason: 'TARGET_UNKNOWN', operation: 'observe'});
  }
});

test('a grant with no allowed operation behaves as no grant', () => {
  const doc = document();
  doc.projects[1].grants.push({principalId: 'u-idle', observe: false, write: false, execute: false});
  const registry = validateRegistry(doc);
  const idle = {principalId: 'u-idle', tunnelStatus: up};
  for (const fields of [{machineId: 'm-alpha', projectId: 'p-blog'}, {projectId: 'p-blog', operation: 'execute'},
    {machineId: 'm-alpha', projectId: 'p-blog', tunnelId: 't-beta'}, {machineId: 'm-alpha', projectId: 'p-blog', configVersion: 2}]) {
    assert.equal(resolveTarget(registry, idle, request(fields)).reason, 'TARGET_UNKNOWN');
  }
});

test('ambiguity is reported even when only one of the matching projects is visible', () => {
  const doc = document();
  doc.projects[0].grants.push({principalId: 'u-alpha', ...allowAll});
  const registry = validateRegistry(doc);
  const alphaOnly = {principalId: 'u-alpha', tunnelStatus: up};
  assert.equal(resolveTarget(registry, alphaOnly, request({projectId: 'p-shop'})).reason, 'TARGET_AMBIGUOUS');
  assert.equal(resolveTarget(registry, alphaOnly, request({machineId: 'm-beta', projectId: 'p-shop'})).reason, 'TARGET_UNKNOWN');
  assert.equal(resolveTarget(registry, alphaOnly, request({machineId: 'm-alpha', projectId: 'p-shop'})).decision, 'allow');
});

test('hostile requests and contexts are denied without throwing', () => {
  const registry = validateRegistry(document());
  const valid = () => request({machineId: 'm-alpha', projectId: 'p-blog'});
  const throwingGetter = valid();
  Object.defineProperty(throwingGetter, 'operation', {enumerable: true, get() { throw Error('boom'); }});
  const accessor = valid();
  Object.defineProperty(accessor, 'projectId', {enumerable: true, get: () => 'p-blog'});
  const hidden = valid();
  Object.defineProperty(hidden, 'tunnelId', {enumerable: false, value: 't-alpha'});
  const symbol = {...valid(), [Symbol('extra')]: 1};
  const foreign = Object.assign(Object.create({inherited: true}), valid());
  const throwingKeys = new Proxy(valid(), {ownKeys() { throw Error('boom'); }});
  const throwingDescriptor = new Proxy(valid(), {getOwnPropertyDescriptor() { throw Error('boom'); }});
  const {proxy: revoked, revoke} = Proxy.revocable(valid(), {});
  revoke();
  for (const hostile of [throwingGetter, accessor, hidden, symbol, foreign, throwingKeys, throwingDescriptor, revoked]) {
    const decision = resolveTarget(registry, context(), hostile);
    assert.deepEqual({...decision}, {decision: 'deny', reason: 'REQUEST_INVALID', operation: null});
    assert.ok(Object.isFrozen(decision));
  }

  const throwingContext = new Proxy(context(), {ownKeys() { throw Error('boom'); }});
  const throwingProto = new Proxy(context(), {getPrototypeOf() { throw Error('boom'); }});
  const accessorContext = context();
  Object.defineProperty(accessorContext, 'principalId', {enumerable: true, get: () => 'u-dot'});
  const throwingStatus = context(new Proxy({...up}, {getOwnPropertyDescriptor() { throw Error('boom'); }}));
  const accessorStatus = {...up};
  Object.defineProperty(accessorStatus, 't-alpha', {enumerable: true, get: () => 'up'});
  for (const hostile of [throwingContext, throwingProto, accessorContext, throwingStatus, context(accessorStatus)]) {
    const decision = resolveTarget(registry, hostile, valid());
    assert.deepEqual({...decision}, {decision: 'deny', reason: 'REQUESTER_UNVERIFIED', operation: 'observe'});
    assert.ok(Object.isFrozen(decision));
  }
});

test('a stale configuration version is refused', () => {
  const registry = validateRegistry(document());
  const stale = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-blog', configVersion: 2}));
  assert.equal(stale.reason, 'CONFIG_STALE');
});

test('a down tunnel returns an error without falling back to another machine', () => {
  const registry = validateRegistry(document());
  const down = resolveTarget(registry, context({'t-alpha': 'down', 't-beta': 'up'}), request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.deepEqual({...down}, {decision: 'deny', reason: 'TUNNEL_UNAVAILABLE', operation: 'observe'});
  const unknownStatus = resolveTarget(registry, context({'t-beta': 'up'}), request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.equal(unknownStatus.reason, 'TUNNEL_UNAVAILABLE');
});

test('requester identity comes only from the trusted context, never from the request', () => {
  const registry = validateRegistry(document());
  const forged = resolveTarget(registry, {principalId: 'u-other', tunnelStatus: up},
    request({machineId: 'm-alpha', projectId: 'p-blog', principalId: 'u-dot'}));
  assert.equal(forged.reason, 'REQUEST_INVALID');
  const anonymous = resolveTarget(registry, {tunnelStatus: up}, request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.equal(anonymous.reason, 'REQUESTER_UNVERIFIED');
  assert.equal(resolveTarget(registry, {principalId: 'u-dot', tunnelStatus: {'t-alpha': true}},
    request({machineId: 'm-alpha', projectId: 'p-blog'})).reason, 'REQUESTER_UNVERIFIED');
});

test('decisions are deeply frozen against accidental mutation', () => {
  const registry = validateRegistry(document());
  const allowed = resolveTarget(registry, context(), request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.deepEqual(allowed, {decision: 'allow', reason: 'ALLOWED', operation: 'observe', target: {machineId: 'm-alpha',
    tunnelId: 't-alpha', projectId: 'p-blog', pathSpace: 'wsl', root: '/home/dev/blog', configVersion: 3}});
  assert.ok(Object.isFrozen(allowed) && Object.isFrozen(allowed.target));
  assert.throws(() => { allowed.target.machineId = 'm-beta'; }, TypeError);
});

test('only registries produced by validateRegistry are accepted', () => {
  const copy = structuredClone(validateRegistry(document()));
  assert.equal(resolveTarget(copy, context(), request({machineId: 'm-alpha', projectId: 'p-blog'})).reason, 'REGISTRY_UNVERIFIED');
});

test('tunnel sharing is allowed but not required', () => {
  const separate = document();
  separate.tunnels.push({tunnelId: 't-alpha-2', machineId: 'm-alpha'});
  separate.projects[1].tunnelId = 't-alpha-2';
  const registry = validateRegistry(separate);
  const blog = resolveTarget(registry, context({'t-alpha': 'down', 't-alpha-2': 'up'}), request({machineId: 'm-alpha', projectId: 'p-blog'}));
  assert.equal(blog.decision, 'allow');
  assert.equal(blog.target.tunnelId, 't-alpha-2');
});

