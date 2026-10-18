// Lab-only reference model. Pure: no filesystem, network, process, transport or product import.
// Builds the closed launch order of an agent from the user's harness configuration alone.
import {isHarnessConfig} from './harness-config.mjs';

const label = /^[A-Za-z0-9_-]{1,64}$/;
const unsafe = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const TARGET_KEYS = ['machineId', 'tunnelId', 'projectId', 'pathSpace', 'root', 'configVersion'];
const built = new WeakSet();

const fail = code => { throw Error(code); };
const id = x => typeof x === 'string' && label.test(x);

// Shallow snapshot of an untrusted plain object, or null; getters never run.
function plain(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

// The shape of an allowed phase 1 resolution target. Root containment was checked by the
// registry; here the root is only carried, never parsed, joined or placed in argv.
function readTarget(value) {
  const t = plain(value);
  if (!t || Object.keys(t).sort().join(',') !== [...TARGET_KEYS].sort().join(',')) return null;
  const ok = id(t.machineId) && id(t.tunnelId) && id(t.projectId) &&
    (t.pathSpace === 'windows' || t.pathSpace === 'wsl') &&
    typeof t.root === 'string' && t.root.length > 0 && t.root.length <= 4096 && !unsafe.test(t.root) &&
    Number.isSafeInteger(t.configVersion) && t.configVersion >= 0;
  return ok ? t : null;
}

// dot chooses only agentId. Program, arguments and working directory come from the harness
// configuration and the resolved target; safe-mode arguments are always appended.
export function buildLaunchOrder(harness, target, agentId) {
  if (!isHarnessConfig(harness) || !id(agentId)) fail('LAUNCH_INVALID');
  const t = readTarget(target);
  if (!t) fail('LAUNCH_INVALID');
  const project = harness.projects.find(p => p.machineId === t.machineId && p.projectId === t.projectId);
  if (!project) fail('LAUNCH_UNKNOWN_PROJECT');
  if (!project.agentIds.includes(agentId)) fail('LAUNCH_AGENT_NOT_ALLOWED');
  const profile = harness.launchProfiles.find(p => p.profileId === project.launchProfileId);
  const agent = harness.agents.find(a => a.agentId === agentId);
  const order = Object.freeze({
    schema: 1, harnessVersion: harness.version, machineId: t.machineId, projectId: t.projectId,
    agentId, profileId: profile.profileId, kind: profile.kind, pathSpace: t.pathSpace,
    workingDirectory: t.root,
    argv: Object.freeze([...profile.argv, ...agent.argv, ...agent.safeModeArgv])
  });
  built.add(order);
  return order;
}

export const isLaunchOrder = value => built.has(value);
