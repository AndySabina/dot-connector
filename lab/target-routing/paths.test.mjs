import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveWindowsPath} from './paths.mjs';

// Fictional roots and paths only.
const root = 'C:\\work\\shop';
const unc = '\\\\files\\team\\shop';
const reason = (r, input) => resolveWindowsPath(r, input).reason;

test('relative paths resolve against the root, never a current directory', () => {
  assert.deepEqual(resolveWindowsPath(root, 'src\\app.js'), {ok: true, path: 'C:\\work\\shop\\src\\app.js', relative: 'src\\app.js'});
  assert.deepEqual(resolveWindowsPath(root, 'src/app.js'), {ok: true, path: 'C:\\work\\shop\\src\\app.js', relative: 'src\\app.js'});
  assert.deepEqual(resolveWindowsPath(root, 'src\\..\\docs\\.\\a.md'), {ok: true, path: 'C:\\work\\shop\\docs\\a.md', relative: 'docs\\a.md'});
  assert.deepEqual(resolveWindowsPath(root, '.'), {ok: true, path: 'C:\\work\\shop', relative: ''});
  assert.ok(Object.isFrozen(resolveWindowsPath(root, 'src')));
});

test('absolute paths inside the root are accepted regardless of case', () => {
  assert.deepEqual(resolveWindowsPath(root, 'c:\\WORK\\Shop\\src'), {ok: true, path: 'C:\\work\\shop\\src', relative: 'src'});
  assert.deepEqual(resolveWindowsPath(root, 'C:/work/shop/'), {ok: true, path: 'C:\\work\\shop', relative: ''});
});

test('escapes from the root are rejected', () => {
  assert.equal(reason(root, 'src\\..\\..\\secret.txt'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, '..\\shop2\\x'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, 'C:\\work\\shop2\\x'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, 'D:\\work\\shop\\x'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, '\\\\files\\team\\shop\\x'), 'PATH_OUTSIDE_ROOT');
  assert.deepEqual(resolveWindowsPath(root, '..\\..'), {ok: false, reason: 'PATH_OUTSIDE_ROOT'});
});

test('UNC shares are never project roots, and UNC input stays outside a drive root', () => {
  // A share lives on another machine than the project declares; the registry rejects it too.
  for (const input of ['a.md', '\\\\files\\team\\shop\\a.md']) {
    assert.deepEqual(resolveWindowsPath(unc, input), {ok: false, reason: 'ROOT_INVALID'});
  }
  assert.equal(reason(root, '\\\\files\\team\\shop\\a.md'), 'PATH_OUTSIDE_ROOT');
  assert.equal(reason(root, '//files/team/shop'), 'PATH_OUTSIDE_ROOT');
});

test('forms that depend on hidden state or devices are rejected', () => {
  assert.equal(reason(root, '\\\\?\\C:\\work\\shop\\x'), 'PATH_DEVICE_NAMESPACE');
  assert.equal(reason(root, '//./pipe/x'), 'PATH_DEVICE_NAMESPACE');
  assert.equal(reason(root, 'C:secret.txt'), 'PATH_DRIVE_RELATIVE');
  assert.equal(reason(root, '\\Windows\\x'), 'PATH_ROOT_RELATIVE');
});

test('names that Windows reinterprets are rejected', () => {
  assert.equal(reason(root, 'notes.txt:hidden'), 'PATH_INVALID_CHARACTER');
  assert.equal(reason(root, 'src\\*.js'), 'PATH_INVALID_CHARACTER');
  assert.equal(reason(root, 'NUL'), 'PATH_RESERVED_NAME');
  assert.equal(reason(root, 'logs\\con.txt'), 'PATH_RESERVED_NAME');
  assert.equal(reason(root, 'src.\\app.js'), 'PATH_TRAILING_DOT_SPACE');
  assert.equal(reason(root, 'src \\app.js'), 'PATH_TRAILING_DOT_SPACE');
});

test('invalid inputs and roots are rejected', () => {
  assert.equal(reason(root, ''), 'PATH_INVALID');
  assert.equal(reason(root, 42), 'PATH_INVALID');
  assert.equal(reason(root, 'src\u0000x'), 'PATH_INVALID');
  assert.equal(reason(root, 'a'.repeat(1025)), 'PATH_INVALID');
  for (const bad of ['work\\shop', 'C:/work/shop', 'C:\\work\\shop\\', 'C:\\work\\..\\shop', 'C:\\work\\NUL', '\\\\files', 42]) {
    assert.equal(reason(bad, 'src'), 'ROOT_INVALID', String(bad));
  }
});

test('containment compares segments and folds case for ASCII only (review JD-B-002)', () => {
  // U+0130 lowercases to i + U+0307, which changes the length of the folded string.
  const dotted = 'C:\\Users\\\u0130smail\\proj';
  const combining = 'C:\\Users\\i\u0307smail\\proj';
  assert.deepEqual(resolveWindowsPath(dotted, 'C:\\Users\\i\u0307smail\\proj\\Windows\\x.txt'), {ok: false, reason: 'PATH_OUTSIDE_ROOT'});
  assert.deepEqual(resolveWindowsPath(combining, 'C:\\Users\\\u0130smail\\proj\\secret.txt'), {ok: false, reason: 'PATH_OUTSIDE_ROOT'});
  assert.equal(reason('C:\\Users\\ismail\\proj', 'C:\\Users\\\u0130smail\\proj\\secret.txt'), 'PATH_OUTSIDE_ROOT');
  assert.deepEqual(resolveWindowsPath(dotted, 'C:\\Users\\\u0130smail\\proj\\secret.txt'), {ok: true, path: 'C:\\Users\\\u0130smail\\proj\\secret.txt', relative: 'secret.txt'});
  assert.deepEqual(resolveWindowsPath(dotted, 'c:\\USERS\\\u0130smail\\PROJ\\src'), {ok: true, path: 'C:\\Users\\\u0130smail\\proj\\src', relative: 'src'});
});

test('reserved names are detected before the extension after trailing spaces (review JD-B-009)', () => {
  assert.equal(reason(root, 'nul .txt'), 'PATH_RESERVED_NAME');
  assert.equal(reason(root, 'CON .log'), 'PATH_RESERVED_NAME');
  assert.equal(reason(root, 'src\\aux .x'), 'PATH_RESERVED_NAME');
  assert.equal(reason('C:\\work\\nul .d', 'src'), 'ROOT_INVALID');
  assert.deepEqual(resolveWindowsPath(root, 'nully .txt'), {ok: true, path: 'C:\\work\\shop\\nully .txt', relative: 'nully .txt'});
});
