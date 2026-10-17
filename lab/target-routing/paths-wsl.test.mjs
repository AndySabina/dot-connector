import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveWslPath, resolvePath} from './paths.mjs';

// Fictional roots and paths only.
const root = '/home/dev/blog';
const reason = (r, input) => resolveWslPath(r, input).reason;
const windowsProject = {pathSpace: 'windows', root: 'C:\\work\\shop'};
const mountedProject = {pathSpace: 'wsl', root: '/mnt/c/work/shop'};

test('WSL paths resolve against the root with case-sensitive POSIX rules', () => {
  assert.deepEqual(resolveWslPath(root, 'src/app.js'), {ok: true, path: '/home/dev/blog/src/app.js', relative: 'src/app.js'});
  assert.deepEqual(resolveWslPath(root, 'src/../docs/./a.md'), {ok: true, path: '/home/dev/blog/docs/a.md', relative: 'docs/a.md'});
  assert.deepEqual(resolveWslPath(root, '/home/dev/blog/src/'), {ok: true, path: '/home/dev/blog/src', relative: 'src'});
  assert.deepEqual(resolveWslPath(root, '.'), {ok: true, path: '/home/dev/blog', relative: ''});
  assert.ok(Object.isFrozen(resolveWslPath(root, 'src')));
});

test('WSL escapes are rejected', () => {
  assert.equal(reason(root, '../../etc/passwd'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, '/home/dev/blog2/x'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, '/home/dev/Blog/x'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(mountedProject.root, '/mnt/C/work/shop/x'), 'PATH_OUTSIDE_ROOT');
  assert.deepEqual(resolveWslPath(root, '..'), {ok: false, reason: 'PATH_OUTSIDE_ROOT'});
});

test('Windows spellings sent to a WSL project are a path-space mismatch', () => {
  assert.equal(reason(root, 'C:\\work\\blog'), 'PATH_SPACE_MISMATCH');
  assert.equal(reason(root, 'C:/work/blog'), 'PATH_SPACE_MISMATCH');
  assert.equal(reason(root, 'src\\app.js'), 'PATH_SPACE_MISMATCH');
  assert.equal(resolvePath(mountedProject, 'C:\\work\\shop\\src').reason, 'PATH_SPACE_MISMATCH');
  assert.equal(resolvePath(mountedProject, 'src/app.js').path, '/mnt/c/work/shop/src/app.js');
});

test('/mnt paths sent to a Windows project are a path-space mismatch', () => {
  assert.deepEqual(resolvePath(windowsProject, '/mnt/c/work/shop/src'), {ok: false, reason: 'PATH_SPACE_MISMATCH'});
  assert.equal(resolvePath(windowsProject, '/mnt/d').reason, 'PATH_SPACE_MISMATCH');
  assert.deepEqual(resolvePath(windowsProject, 'src\\app.js'), {ok: true, path: 'C:\\work\\shop\\src\\app.js', relative: 'src\\app.js'});
  assert.equal(resolvePath(windowsProject, '\\Windows').reason, 'PATH_ROOT_RELATIVE');
});

test('the dispatcher rejects unknown path spaces and invalid input', () => {
  assert.equal(resolvePath({pathSpace: 'linux', root}, 'src').reason, 'PATH_SPACE_INVALID');
  assert.equal(resolvePath(null, 'src').reason, 'PATH_SPACE_INVALID');
  assert.equal(resolvePath({...mountedProject, machineId: 'm-alpha'}, 'src').ok, true);
  assert.equal(reason(root, ''), 'PATH_INVALID');
  assert.equal(reason(root, 'src\u0000x'), 'PATH_INVALID');
  assert.equal(reason(root, 7), 'PATH_INVALID');
  for (const bad of ['home/dev/blog', '/home/dev/blog/', '/home/dev/../blog', 'C:\\home', '/home/dev\\blog', 42]) {
    assert.equal(reason(bad, 'src'), 'ROOT_INVALID', String(bad));
  }
});
