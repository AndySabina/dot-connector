import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateHarnessConfig, isHarnessConfig} from './harness-config.mjs';

// Fictional programs and flags only; ['herdr', 'run', '--'] is not the real herdr syntax.
const config = () => ({
  schema: 1, version: 4,
  launchProfiles: [
    {profileId: 'lp-herdr', kind: 'multiplexer', argv: ['herdr', 'run', '--']},
    {profileId: 'lp-term', kind: 'terminal', argv: ['example-term', '--new-window']}
  ],
  agents: [
    {agentId: 'a-codex', argv: ['codex-example'], safeModeArgv: ['--example-safe']},
    {agentId: 'a-claude', argv: ['claude-example', '--fictional'], safeModeArgv: []}
  ],
  projects: [
    {machineId: 'm-alpha', projectId: 'p-shop', launchProfileId: 'lp-herdr', agentIds: ['a-codex', 'a-claude']},
    {machineId: 'm-alpha', projectId: 'p-blog', launchProfileId: 'lp-term', agentIds: ['a-claude']},
    {machineId: 'm-beta', projectId: 'p-shop', launchProfileId: 'lp-term', agentIds: ['a-codex']}
  ]
});
const rejects = (document, code) => assert.throws(() => validateHarnessConfig(document), {message: code});
const withProfileArgv = argv => { const d = config(); d.launchProfiles[0].argv = argv; return d; };
const withAgentArgv = (argv, key = 'argv') => { const d = config(); d.agents[0][key] = argv; return d; };

const frozenDeep = x => Object.isFrozen(x) && Object.values(x).every(v => typeof v !== 'object' || frozenDeep(v));

test('a valid configuration becomes a deeply frozen, independent copy', () => {
  const input = config();
  const harness = validateHarnessConfig(input);
  assert.deepEqual(harness, config());
  assert.ok(frozenDeep(harness));
  assert.ok(isHarnessConfig(harness));
  assert.deepEqual(input, config());
  input.agents[0].argv.push('--injected');
  input.projects[0].agentIds.push('a-other');
  assert.deepEqual(harness, config());
  assert.notEqual(harness.agents, input.agents);
});

test('only validated configurations are recognized', () => {
  assert.equal(isHarnessConfig(structuredClone(validateHarnessConfig(config()))), false);
  assert.equal(isHarnessConfig(config()), false);
  assert.equal(isHarnessConfig(null), false);
});

test('a project mode key is rejected: every harness project is agent-only', () => {
  const d = config();
  d.projects[0].mode = 'agent-only';
  rejects(d, 'HARNESS_INVALID');
});

test('wrong shapes and values are rejected as invalid', () => {
  const cases = [
    d => { d.schema = 2; }, d => { d.version = -1; }, d => { d.version = 1.5; }, d => { d.extra = true; },
    d => { delete d.agents; }, d => { d.launchProfiles = []; }, d => { d.agents = []; }, d => { d.projects = []; },
    d => { d.launchProfiles[0].kind = 'shell'; }, d => { d.launchProfiles[0].profileId = 'lp herdr'; },
    d => { d.agents[0].agentId = 'a'.repeat(65); }, d => { d.projects[0].agentIds = []; },
    d => { d.projects[0].agentIds = ['a-codex', 'a-codex']; }, d => { d.agents[0].argv = []; },
    d => { d.agents[0].argv = [42]; }, d => { d.agents[0].safeModeArgv = 'none'; },
    d => { d.projects = Array.from({length: 65}, (_, i) => ({...d.projects[0], projectId: 'p' + i})); }
  ];
  for (const change of cases) { const d = config(); change(d); rejects(d, 'HARNESS_INVALID'); }
  rejects(null, 'HARNESS_INVALID');
  rejects([], 'HARNESS_INVALID');
});

test('every error code by its case', () => {
  const d1 = config(); d1.launchProfiles[1].profileId = 'lp-herdr'; rejects(d1, 'HARNESS_DUPLICATE_ID');
  const d2 = config(); d2.agents[1].agentId = 'a-codex'; rejects(d2, 'HARNESS_DUPLICATE_ID');
  const d3 = config(); d3.projects[1].projectId = 'p-shop'; rejects(d3, 'HARNESS_DUPLICATE_ID');
  const d4 = config(); d4.projects[0].launchProfileId = 'lp-missing'; rejects(d4, 'HARNESS_UNKNOWN_PROFILE');
  const d5 = config(); d5.projects[1].agentIds = ['a-missing']; rejects(d5, 'HARNESS_UNKNOWN_AGENT');
  rejects(withAgentArgv(['bash']), 'HARNESS_SHELL_PROGRAM');
});

test('unsafe or oversized argv strings and lists are rejected', () => {
  const bad = [['herdr\nrm'], ['herdr', 'run\x1b[2J'], ['herdr\u202e'], ['herdr', '\u2066x'], ['herdr', ''],
    ['x'.repeat(257)], Array(17).fill('x'), ['\x85']];
  for (const argv of bad) {
    rejects(withProfileArgv(argv), 'HARNESS_INVALID');
    rejects(withAgentArgv(argv), 'HARNESS_INVALID');
    rejects(withAgentArgv([...argv].slice(0, 17), 'safeModeArgv'), 'HARNESS_INVALID');
  }
  assert.ok(validateHarnessConfig(withProfileArgv(['x'.repeat(256), ...Array(15).fill('y')])));
});

test('a shell as the first program of a profile or agent is refused', () => {
  for (const program of ['bash', '/bin/sh', 'C:\\Windows\\System32\\cmd.exe', 'PowerShell.EXE', 'pwsh', 'wsl', 'ZSH', '/usr/bin/fish']) {
    rejects(withProfileArgv([program, '-c', 'x']), 'HARNESS_SHELL_PROGRAM');
    rejects(withAgentArgv([program]), 'HARNESS_SHELL_PROGRAM');
  }
  for (const program of ['bashful', 'fisher', 'cmdline-tool', '/opt/shelly/bin/kshx']) {
    assert.ok(isHarnessConfig(validateHarnessConfig(withProfileArgv([program]))));
    assert.ok(isHarnessConfig(validateHarnessConfig(withAgentArgv([program]))));
  }
  assert.ok(validateHarnessConfig(withAgentArgv(['agent-example', 'bash'])));
});

test('hostile inputs are rejected as invalid without running getters or leaking trap errors', () => {
  let reads = 0;
  const getter = config();
  Object.defineProperty(getter.agents[0], 'argv', {enumerable: true, get: () => { reads++; return ['codex-example']; }});
  rejects(getter, 'HARNESS_INVALID');
  const getterArray = config();
  Object.defineProperty(getterArray.projects[0].agentIds, 0, {enumerable: true, get: () => { reads++; return 'a-codex'; }});
  rejects(getterArray, 'HARNESS_INVALID');
  assert.equal(reads, 0);

  const trap = () => { throw Error('TRAP'); };
  const throwing = new Proxy(config(), {ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap});
  rejects(throwing, 'HARNESS_INVALID');
  const throwingArray = config();
  throwingArray.agents = new Proxy(throwingArray.agents, {ownKeys: trap});
  rejects(throwingArray, 'HARNESS_INVALID');
  const {proxy, revoke} = Proxy.revocable(config(), {});
  revoke();
  rejects(proxy, 'HARNESS_INVALID');

  const symbol = config(); symbol.agents[1][Symbol('x')] = 1; rejects(symbol, 'HARNESS_INVALID');
  const sparse = config(); sparse.agents[0].argv = ['codex-example', , 'x']; rejects(sparse, 'HARNESS_INVALID');
  const extra = config(); extra.launchProfiles[0].argv.note = 'x'; rejects(extra, 'HARNESS_INVALID');
  const proto = config(); proto.agents[0] = Object.assign(Object.create({}), proto.agents[0]); rejects(proto, 'HARNESS_INVALID');
  const hidden = config(); Object.defineProperty(hidden, 'note', {value: 1}); rejects(hidden, 'HARNESS_INVALID');
  const fake = config(); fake.projects[0].agentIds = {0: 'a-codex', length: 1}; rejects(fake, 'HARNESS_INVALID');
});

test('disguised shells are refused: Windows trailing dots or spaces, .com, and env wrappers', () => {
  const disguised = [['cmd.'], ['CMD.EXE '], ['cmd.com'], ['C:\\Windows\\bash.exe. .'], ['/usr/bin/env', 'bash'],
    ['env', 'A=1', 'B=2', '/bin/zsh'], ['env', '-S', 'bash -c x'], ['env', '--split-string=sh -c x'], ['env'], ['ENV.EXE', 'pwsh']];
  for (const argv of disguised) {
    rejects(withProfileArgv(argv), 'HARNESS_SHELL_PROGRAM');
    rejects(withAgentArgv(argv), 'HARNESS_SHELL_PROGRAM');
  }
  for (const argv of [['env', 'NODE_ENV=dev', 'agent-example'], ['environment-tool', 'bash'], ['cmdx.exe']]) {
    assert.ok(isHarnessConfig(validateHarnessConfig(withAgentArgv(argv))));
  }
});
