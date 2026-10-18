// Lab-only reference model. Pure text checks: no filesystem access, so links,
// junctions, mounts, short names and per-directory case rules are executor checks.
import path from 'node:path';

const INPUT_LIMIT = 1024;
const ROOT_LIMIT = 512;
const controls = /[\x00-\x1f\x7f-\x9f]/;
const forbidden = /[:*?"<>|]/;
const reserved = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const driveAbsolute = /^[A-Za-z]:\\/;
const uncPrefix = /^\\\\[^\\]+\\[^\\]+(\\|$)/;

const verdict = value => Object.freeze(value);
const refuse = reason => verdict({ok: false, reason});

// Segment problems Windows would hide by stripping or reinterpreting the name.
function segmentProblem(text) {
  for (const segment of text.split('\\')) {
    if (!segment || segment === '.' || segment === '..' || /^[A-Za-z]:$/.test(segment)) continue;
    // Win32 trims spaces before the extension, so `nul .txt` still opens NUL.
    if (reserved.test(segment.split('.')[0].replace(/ +$/, ''))) return 'PATH_RESERVED_NAME';
    if (/[. ]$/.test(segment)) return 'PATH_TRAILING_DOT_SPACE';
  }
  return null;
}

function validWindowsRoot(root) {
  if (typeof root !== 'string' || root.length > ROOT_LIMIT || controls.test(root) || root.includes('/')) return false;
  // Drive roots only: a UNC share lives on another machine than the project declares.
  if (!driveAbsolute.test(root)) return false;
  if (path.win32.normalize(root) !== root || (root.endsWith('\\') && root.length !== 3)) return false;
  return !forbidden.test(root.replace(/^[A-Za-z]:/, '')) && segmentProblem(root) === null;
}

export function resolveWindowsPath(root, input) {
  if (!validWindowsRoot(root)) return refuse('ROOT_INVALID');
  if (typeof input !== 'string' || input.length === 0 || input.length > INPUT_LIMIT || controls.test(input)) {
    return refuse('PATH_INVALID');
  }
  const text = input.replaceAll('/', '\\');
  if (/^\\\\[?.]\\/.test(text)) return refuse('PATH_DEVICE_NAMESPACE');
  if (/^[A-Za-z]:(?!\\)/.test(text)) return refuse('PATH_DRIVE_RELATIVE');
  if (text.startsWith('\\') && !text.startsWith('\\\\')) return refuse('PATH_ROOT_RELATIVE');
  if (text.startsWith('\\\\') && !uncPrefix.test(text)) return refuse('PATH_INVALID');
  if (forbidden.test(text.replace(/^[A-Za-z]:/, ''))) return refuse('PATH_INVALID_CHARACTER');
  const problem = segmentProblem(text);
  if (problem) return refuse(problem);

  const absolute = driveAbsolute.test(text) || text.startsWith('\\\\');
  let candidate = path.win32.normalize(absolute ? text : root + '\\' + text);
  if (candidate.endsWith('\\') && !/^[A-Za-z]:\\$/.test(candidate)) candidate = candidate.replace(/\\+$/, '');

  // Windows compares names case-insensitively by default. Only ASCII is folded here:
  // Unicode folding can change lengths, and real Unicode case rules are an executor check.
  const segments = value => value.split('\\').filter((part, i, all) => part || i < all.length - 1);
  const rootParts = segments(root);
  const parts = segments(candidate);
  const ascii = /^[\x00-\x7f]*$/;
  const same = (a, b) => a === b || (ascii.test(a) && ascii.test(b) && a.toLowerCase() === b.toLowerCase());
  if (parts.length < rootParts.length || !rootParts.every((part, i) => same(parts[i], part))) {
    return refuse('PATH_OUTSIDE_ROOT');
  }
  const relative = parts.slice(rootParts.length).join('\\');
  if (!relative) return verdict({ok: true, path: root, relative: ''});
  return verdict({ok: true, path: (root.endsWith('\\') ? root : root + '\\') + relative, relative});
}

function validWslRoot(root) {
  return typeof root === 'string' && root.length <= ROOT_LIMIT && !controls.test(root) && !root.includes('\\') &&
    path.posix.isAbsolute(root) && path.posix.normalize(root) === root && (root === '/' || !root.endsWith('/'));
}

// WSL names are case sensitive. C:\ and /mnt/c/ are never treated as equivalent here.
export function resolveWslPath(root, input) {
  if (!validWslRoot(root)) return refuse('ROOT_INVALID');
  if (typeof input !== 'string' || input.length === 0 || input.length > INPUT_LIMIT || controls.test(input)) {
    return refuse('PATH_INVALID');
  }
  if (/^[A-Za-z]:/.test(input) || input.includes('\\')) return refuse('PATH_SPACE_MISMATCH');
  let candidate = path.posix.normalize(input.startsWith('/') ? input : root + '/' + input);
  if (candidate.length > 1 && candidate.endsWith('/')) candidate = candidate.replace(/\/+$/, '');

  const prefix = root === '/' ? '/' : root + '/';
  if (candidate === root) return verdict({ok: true, path: root, relative: ''});
  if (!candidate.startsWith(prefix)) return refuse('PATH_OUTSIDE_ROOT');
  const relative = candidate.slice(prefix.length);
  return verdict({ok: true, path: prefix + relative, relative});
}

export function resolvePath(project, input) {
  if (project?.pathSpace === 'wsl') return resolveWslPath(project.root, input);
  if (project?.pathSpace !== 'windows') return refuse('PATH_SPACE_INVALID');
  if (typeof input === 'string' && /^\/mnt\/[A-Za-z](\/|$)/.test(input)) return refuse('PATH_SPACE_MISMATCH');
  return resolveWindowsPath(project.root, input);
}
