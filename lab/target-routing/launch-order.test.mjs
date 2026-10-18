import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateHarnessConfig} from './harness-config.mjs';
import {buildLaunchOrder, isLaunchOrder} from './launch-order.mjs';

// Fictional programs and flags only; ['herdr', 'run', '--'] is not the real herdr syntax.
const harness = validateHarnessConfig({
  schema: 1, version: 7,
  launchProfiles: [
    {profileId: 'lp-herdr', kind: 'multiplexer', argv: ['herdr', 'run', '--']},
    {profileId: 'lp-term', kind: 'terminal', argv: ['example-term', '--new-window', '--']}
  ],
  agents: [
    {agentId: 'a-codex', argv: ['codex-example'], safeModeArgv: ['--example-safe', '--example-no-network']},
    {agentId: 'a-claude', argv: ['claude-example'], safeModeArgv: []},
    {agentId: 'a-other', argv: ['other-example'], safeModeArgv: []}
  ],
  projects: [
    {machineId: 'm-alpha', projectId: 'p-shop', launchProfileId: 'lp-herdr', agentIds: ['a-codex', 'a-claude']},
    {machineId: 'm-beta', projectId: 'p-shop', launchProfileId: 'lp-term', agentIds: ['a-claude']}
  ]
});
// Shape of an allowed phase 1 resolution target.
const target = (over = {}) => ({machineId: 'm-alpha', tunnelId: 't-alpha', projectId: 'p-shop',
  pathSpace: 'windows', root: 'C:\\work\\shop; rm -rf $(x)', configVersion: 3, ...over});
const rejects = (h, t, a, code) => assert.throws(() => buildLaunchOrder(h, t, a), {message: code});

test('a multiplexer launch order: profile, agent and safe mode argv, root only as working directory', () => {
  const order = buildLaunchOrder(harness, target(), 'a-codex');
  assert.deepEqual(order, {schema: 1, harnessVersion: 7, machineId: 'm-alpha', projectId: 'p-shop',
    agentId: 'a-codex', profileId: 'lp-herdr', kind: 'multiplexer', pathSpace: 'windows',
    workingDirectory: 'C:\\work\\shop; rm -rf $(x)',
    argv: ['herdr', 'run', '--', 'codex-example', '--example-safe', '--example-no-network']});
  assert.ok(Object.isFrozen(order) && Object.isFrozen(order.argv));
  assert.ok(isLaunchOrder(order));
  assert.ok(!order.argv.some(a => a.includes('shop') || a.includes('rm -rf')));
});

test('a plain terminal launch order on another machine with the same project id', () => {
  const order = buildLaunchOrder(harness, target({machineId: 'm-beta', tunnelId: 't-beta',
    pathSpace: 'wsl', root: '/home/u/shop'}), 'a-claude');
  assert.equal(order.kind, 'terminal');
  assert.equal(order.workingDirectory, '/home/u/shop');
  assert.deepEqual(order.argv, ['example-term', '--new-window', '--', 'claude-example']);
});

test('the same inputs give the same order; results are recognized only when built here', () => {
  assert.deepEqual(buildLaunchOrder(harness, target(), 'a-claude'), buildLaunchOrder(harness, target(), 'a-claude'));
  assert.equal(isLaunchOrder(structuredClone(buildLaunchOrder(harness, target(), 'a-claude'))), false);
  assert.equal(isLaunchOrder(null), false);
});

test('an agent outside the project allowed list is refused, even if it is in the catalog', () => {
  rejects(harness, target(), 'a-other', 'LAUNCH_AGENT_NOT_ALLOWED');
  rejects(harness, target(), 'a-missing', 'LAUNCH_AGENT_NOT_ALLOWED');
  rejects(harness, target({machineId: 'm-beta'}), 'a-codex', 'LAUNCH_AGENT_NOT_ALLOWED');
});

test('a target without a harness project is refused', () => {
  rejects(harness, target({projectId: 'p-blog'}), 'a-codex', 'LAUNCH_UNKNOWN_PROJECT');
  rejects(harness, target({machineId: 'm-gamma'}), 'a-codex', 'LAUNCH_UNKNOWN_PROJECT');
});

test('anything dot could add to the command line is invalid: only a plain agent id is accepted', () => {
  for (const agentId of ['a-codex --dangerous', 'a-codex;bash', '', 'a'.repeat(65), ['a-codex'], {agentId: 'a-codex'}, null]) {
    rejects(harness, target(), agentId, 'LAUNCH_INVALID');
  }
});

test('an unverified harness or a malformed or hostile target is invalid', () => {
  rejects(structuredClone(harness), target(), 'a-codex', 'LAUNCH_INVALID');
  rejects(null, target(), 'a-codex', 'LAUNCH_INVALID');
  const bad = [null, [], {...target(), extra: 1}, target({pathSpace: 'unc'}), target({root: ''}),
    target({root: 'C:\\work\nshop'}), target({root: 'x'.repeat(4097)}), target({configVersion: -1}),
    target({tunnelId: 't alpha'})];
  for (const t of bad) rejects(harness, t, 'a-codex', 'LAUNCH_INVALID');
  let reads = 0;
  const getter = target();
  Object.defineProperty(getter, 'root', {enumerable: true, get: () => { reads++; return 'C:\\work\\shop'; }});
  rejects(harness, getter, 'a-codex', 'LAUNCH_INVALID');
  assert.equal(reads, 0);
  const trap = () => { throw Error('TRAP'); };
  rejects(harness, new Proxy(target(), {ownKeys: trap}), 'a-codex', 'LAUNCH_INVALID');
  rejects(harness, Object.assign(Object.create({}), target()), 'a-codex', 'LAUNCH_INVALID');
});
