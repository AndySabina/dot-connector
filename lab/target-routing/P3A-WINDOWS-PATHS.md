# p3a — Windows paths

Child branch: `target-routing/p3a-windows-paths` (PR targets
`target-routing/p3-paths`). Phase: [P3-PATHS.md](P3-PATHS.md).
Reference code only; not imported by the product and not distributed.

## What this is

`resolveWindowsPath(root, input)` in `lab/target-routing/paths.mjs`: a pure
function that interprets `input` with Windows rules relative to a project
`root` and returns `{ok: true, path, relative}` when the result stays inside the
root, or `{ok: false, reason}` otherwise. It never throws and never touches the
filesystem.

## Why it exists

Windows has many ways to write the same or a surprising location. A check that
only compares strings, or that resolves against the current directory, can be
walked out of the root.

## The problem it solves

- Relative paths resolved against an unknown current directory.
- `..` climbing out of the root; sibling folders that share a text prefix.
- Another drive, a UNC share or a device namespace (`\\?\`, `\\.\`).
- Drive relative `C:file` and root relative `\file`, which depend on per-drive
  state the resolver cannot see.
- Reserved device names (`NUL`, `CON.txt`), alternate data streams
  (`file:stream`) and forbidden characters.
- Trailing dots or spaces that Windows strips, so `src.` names `src`.

## How

- **Root**: a normalized drive path (`C:\work\shop`) or UNC path
  (`\\server\share\shop`) without a trailing separator, forbidden characters,
  reserved names or trailing dots or spaces. Anything else → `ROOT_INVALID`.
- **Input**: a non-empty string of at most 1024 characters without control
  characters. `/` is accepted as a separator and normalized to `\`.
- Relative input is joined to the root, never to a current directory.
- `..` and `.` are resolved textually; the result must equal the root or start
  with the root followed by `\`. The comparison ignores case, the Windows
  default. The returned `path` keeps the root exactly as declared.
- Every segment of the input is checked before normalization, because Windows
  would silently strip or reinterpret it.

| Reason | When |
|---|---|
| `ROOT_INVALID` | The root is not an accepted Windows root |
| `PATH_INVALID` | Not a string, empty, too long or with control characters |
| `PATH_DEVICE_NAMESPACE` | Starts with `\\?\` or `\\.\` |
| `PATH_DRIVE_RELATIVE` | `C:` not followed by a separator |
| `PATH_ROOT_RELATIVE` | Starts with a single separator |
| `PATH_INVALID_CHARACTER` | `: * ? " < > \|` after the drive (includes data streams) |
| `PATH_RESERVED_NAME` | A segment is a reserved device name, with or without extension |
| `PATH_TRAILING_DOT_SPACE` | A segment ends with a dot or a space |
| `PATH_OUTSIDE_ROOT` | The resolved path is not the root or below it |

## Acceptance checks

- Relative paths, forward slashes and inner `..` that stay inside resolve
  against the root; the root itself resolves with an empty relative path.
- Absolute paths inside the root with different case are accepted and returned
  with the declared root.
- Escapes are rejected: `..` above the root, a sibling with a shared prefix,
  another drive, a UNC path for a drive root, another UNC share.
- UNC roots accept their own share regardless of case.
- Device namespaces, drive relative and root relative forms are rejected.
- Data streams, forbidden characters, reserved names and trailing dots or spaces
  are rejected.
- Invalid inputs and invalid roots are rejected; verdicts are frozen.

## Limits

- Case is compared case-insensitively. Windows directories can be made case
  sensitive individually; that is an executor check (p3c).
- Short 8.3 names, symlinks, junctions and mount points are not visible in the
  text; the executor must resolve the final path (p3c).
- `/mnt/c/...` style input and WSL rules belong to p3b.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `paths.mjs` existed, `paths.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/paths.test.mjs` — 7 tests, 7 pass.
- Extra manual probes (not committed as tests) behaved as specified: climbing
  out and into a sibling is rejected, climbing out and back into the root is
  accepted, `\\?\UNC\...` is a device namespace, a reserved name in the middle
  of a path is rejected and repeated separators collapse.
- Lab tests on this branch — 24 tests, 24 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
