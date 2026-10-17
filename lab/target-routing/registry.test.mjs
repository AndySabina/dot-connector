import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRegistry, isRegistry} from './registry.mjs';

// Fictional identifiers and paths only.
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
        grants: [{principalId: 'u-dot', observe: true, write: true, execute: true}]},
      {machineId: 'm-beta', projectId: 'p-shop', tunnelId: 't-beta', pathSpace: 'windows', root: 'C:\\work\\shop',
        grants: [{principalId: 'u-dot', observe: true, write: true, execute: true}]}
    ]
  };
}
function rejects(change, code) {
  const input = document();
  change(input);
  const before = structuredClone(input);
  assert.throws(() => validateRegistry(input), {message: code});
  assert.deepEqual(input, before);
}

test('a valid document returns a deeply frozen copy', () => {
  const input = document();
  const registry = validateRegistry(input);
  assert.deepEqual(registry, document());
  assert.ok(isRegistry(registry));
  assert.ok(Object.isFrozen(registry) && Object.isFrozen(registry.projects[0].grants[0]));
  assert.throws(() => { registry.projects[0].grants[0].execute = true; }, TypeError);
  input.projects[0].grants[0].execute = true;
  assert.equal(registry.projects[0].grants[0].execute, false);
  assert.deepEqual(input.projects[0].grants[0], {principalId: 'u-dot', observe: true, write: false, execute: true});
});

test('only values produced by validateRegistry are recognized', () => {
  assert.equal(isRegistry(structuredClone(validateRegistry(document()))), false);
  assert.equal(isRegistry(document()), false);
  assert.equal(isRegistry(null), false);
});

test('tunnels and projects must name existing machines and tunnels', () => {
  rejects(d => d.tunnels.push({tunnelId: 't-ghost', machineId: 'm-ghost'}), 'REGISTRY_UNKNOWN_MACHINE');
  rejects(d => { d.projects[0].machineId = 'm-ghost'; }, 'REGISTRY_UNKNOWN_MACHINE');
  rejects(d => { d.projects[0].tunnelId = 't-ghost'; }, 'REGISTRY_UNKNOWN_TUNNEL');
  rejects(d => { d.projects[0].tunnelId = 't-beta'; }, 'REGISTRY_TUNNEL_MACHINE_MISMATCH');
});

test('identities are unique', () => {
  rejects(d => d.machines.push({machineId: 'm-alpha'}), 'REGISTRY_DUPLICATE_ID');
  rejects(d => d.tunnels.push({tunnelId: 't-alpha', machineId: 'm-beta'}), 'REGISTRY_DUPLICATE_ID');
  rejects(d => d.projects.push(structuredClone(d.projects[0])), 'REGISTRY_DUPLICATE_ID');
  rejects(d => d.projects[0].grants.push({principalId: 'u-dot', observe: false, write: false, execute: false}), 'REGISTRY_DUPLICATE_ID');
});

test('shape, labels and values are validated', () => {
  rejects(d => { d.projects[0].command = 'anything'; }, 'REGISTRY_INVALID');
  rejects(d => { delete d.projects[0].grants[0].execute; }, 'REGISTRY_INVALID');
  rejects(d => { d.projects[0].grants[0].execute = 'yes'; }, 'REGISTRY_INVALID');
  rejects(d => { d.schema = 2; }, 'REGISTRY_INVALID');
  rejects(d => { d.version = -1; }, 'REGISTRY_INVALID');
  rejects(d => { d.version = 1.5; }, 'REGISTRY_INVALID');
  rejects(d => { d.machines = []; }, 'REGISTRY_INVALID');
  rejects(d => { d.machines[0].machineId = 'm alpha'; }, 'REGISTRY_INVALID');
  rejects(d => { d.projects[0].pathSpace = 'linux'; }, 'REGISTRY_INVALID');
  rejects(d => { for (let i = 0; i < 64; i++) d.machines.push({machineId: 'm-extra-' + i}); }, 'REGISTRY_INVALID');
  assert.throws(() => validateRegistry(null), {message: 'REGISTRY_INVALID'});
  assert.throws(() => validateRegistry([]), {message: 'REGISTRY_INVALID'});
});

test('project roots must be absolute and normalized in their declared path space', () => {
  rejects(d => { d.projects[0].root = 'work\\shop'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:/work/shop'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = '/mnt/c/work/shop'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\work\\..\\shop'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[1].root = 'C:\\home\\dev\\blog'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[1].root = '/home/dev/../blog'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[1].root = '/home/dev/\u0007blog'; }, 'REGISTRY_INVALID_ROOT');
  // Contract shared with paths.mjs: a UNC share is not on the declared machine, so it is never a root.
  rejects(d => { d.projects[0].root = '\\\\files\\team\\shop'; }, 'REGISTRY_INVALID_ROOT');
  const mounted = document();
  mounted.projects[1].root = '/mnt/c/work/blog';
  assert.equal(validateRegistry(mounted).projects[1].root, '/mnt/c/work/blog');
});

test('Windows roots follow the segment rules of paths.mjs', () => {
  rejects(d => { d.projects[0].root = 'C:\\work\\nul'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\work\\shop.'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\work\\shop '; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\com1\\x'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\work\\Aux .txt'; }, 'REGISTRY_INVALID_ROOT');
  rejects(d => { d.projects[0].root = 'C:\\work\\lpt\u00b9'; }, 'REGISTRY_INVALID_ROOT');
  for (const c of [':', '*', '?', '"', '<', '>', '|']) {
    rejects(d => { d.projects[0].root = 'C:\\work\\a' + c + 'b'; }, 'REGISTRY_INVALID_ROOT');
  }
  const named = document();
  named.projects[0].root = 'C:\\work\\console.d\\nul-x';
  assert.equal(validateRegistry(named).projects[0].root, 'C:\\work\\console.d\\nul-x');
});

test('projects on one machine cannot have equal or nested roots', () => {
  const project = (projectId, pathSpace, root) => ({machineId: 'm-alpha', projectId, tunnelId: 't-alpha', pathSpace, root,
    grants: [{principalId: 'u-dot', observe: true, write: true, execute: false}]});
  // The three roots of JD-B-003: nested, case-variant and equal.
  rejects(d => { d.projects.push(project('p-outer', 'windows', 'C:\\work')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-twin', 'windows', 'C:\\WORK\\shop')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-same', 'windows', 'C:\\work\\shop')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-inner', 'windows', 'c:\\Work\\Shop\\inner')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-drive', 'windows', 'C:\\')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-all', 'wsl', '/')); }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects.push(project('p-dev', 'wsl', '/home/dev')); }, 'REGISTRY_ROOT_OVERLAP');
  // WSL /mnt/<letter> roots are mapped to the drive only to refuse overlaps.
  rejects(d => { d.projects[1].root = '/mnt/c/work'; }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects[1].root = '/mnt/c/WORK/shop/x'; }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects[1].root = '/mnt/c'; }, 'REGISTRY_ROOT_OVERLAP');
  // WSL roots that contain the drive mounts ('/', '/mnt') contain every Windows root of that machine.
  rejects(d => { d.projects[1].root = '/mnt'; }, 'REGISTRY_ROOT_OVERLAP');
  rejects(d => { d.projects[1].root = '/'; }, 'REGISTRY_ROOT_OVERLAP');
  // Cross-machine: same nested shape on m-beta does not overlap m-alpha.
  rejects(d => { d.projects[2].root = 'C:\\work'; d.projects[2].machineId = 'm-alpha'; d.projects[2].tunnelId = 't-alpha';
    d.projects[2].projectId = 'p-outer'; }, 'REGISTRY_ROOT_OVERLAP');
  const apart = document();
  apart.projects[2].root = 'C:\\work';
  assert.equal(validateRegistry(apart).projects[2].root, 'C:\\work');

  const siblings = document();
  siblings.projects.push(project('p-shop2', 'windows', 'C:\\work\\shop2'));
  siblings.projects.push(project('p-blog2', 'wsl', '/home/dev/blog2'));
  siblings.projects.push(project('p-mounted', 'wsl', '/mnt/d/work/shop'));
  siblings.projects.push(project('p-other-drive', 'windows', 'D:\\work\\blog'));
  assert.equal(validateRegistry(siblings).projects.length, 7);
  // Identical roots on different machines remain valid (fixture: p-shop on m-alpha and m-beta).
  assert.equal(validateRegistry(document()).projects[2].root, 'C:\\work\\shop');
});

test('root validity is checked before overlap', () => {
  rejects(d => { d.projects.push({...structuredClone(d.projects[0]), projectId: 'p-dot', root: 'C:\\work\\shop.'}); },
    'REGISTRY_INVALID_ROOT');
});

test('tunnel sharing is allowed but not required', () => {
  const separate = document();
  separate.tunnels.push({tunnelId: 't-alpha-2', machineId: 'm-alpha'});
  separate.projects[1].tunnelId = 't-alpha-2';
  const registry = validateRegistry(separate);
  assert.equal(registry.projects[0].tunnelId, 't-alpha');
  assert.equal(registry.projects[1].tunnelId, 't-alpha-2');
});
