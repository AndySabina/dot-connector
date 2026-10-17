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

- **Root**: a normalized drive path (`C:\work\shop`) without a trailing
  separator, forbidden characters, reserved names or trailing dots or spaces.
  UNC roots are not supported: a network share lives on another machine than
  the one the project declares, and the registry (p1a) rejects them too.
  Anything else → `ROOT_INVALID`.
- **Input**: a non-empty string of at most 1024 characters without control
  characters. `/` is accepted as a separator and normalized to `\`.
- Relative input is joined to the root, never to a current directory.
- `..` and `.` are resolved textually. The result is then compared with the
  root segment by segment (split on `\`, the drive segment included); it is
  inside only when every root segment matches in order. Offsets are never
  computed on a case-folded string.
- Two segments match when they are exactly equal, or when both are pure ASCII
  and equal ignoring ASCII case (the Windows default). A segment with any
  non-ASCII character must match exactly.
- `relative` is the remaining segments joined with `\`. The returned `path` is
  the root exactly as declared, followed by `\` and `relative`, or the root
  alone when `relative` is empty.
- Every segment of the input is checked before normalization, because Windows
  would silently strip or reinterpret it.
- A segment is a reserved name when its part before the first `.` (or the
  whole segment without a dot), with trailing spaces removed, is a reserved
  device name in any case: `nul .txt` and `CON .log` are reserved because
  Win32 trims those spaces. Roots use the same segment check.

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
  another drive, a UNC path for a drive root.
- UNC roots are rejected as `ROOT_INVALID` (review fix, PR #9).
- Device namespaces, drive relative and root relative forms are rejected.
- Data streams, forbidden characters, reserved names and trailing dots or spaces
  are rejected.
- Invalid inputs and invalid roots are rejected; verdicts are frozen.

## Limits

- Case is compared case-insensitively for ASCII only. Non-ASCII names must
  match exactly, so a path that Windows would treat as the same folder may be
  refused; real Unicode case rules (and the per-volume upcase table) are an
  executor check (p3c). Windows directories can also be made case sensitive
  individually; that is an executor check (p3c) as well.
- Short 8.3 names, symlinks, junctions and mount points are not visible in the
  text; the executor must resolve the final path (p3c).
- `/mnt/c/...` style input and WSL rules belong to p3b.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `paths.mjs` existed, `paths.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/paths.test.mjs` — 7 tests, 7 pass.
- Review fix (dot, PR #9): the first version accepted UNC roots, which the
  registry never accepts. The UNC test was rewritten to require `ROOT_INVALID`,
  failed against the first version (RED) and passes after restricting roots to
  drive paths. Still 7 tests, 7 pass.
- Extra manual probes (not committed as tests) behaved as specified: climbing
  out and into a sibling is rejected, climbing out and back into the root is
  accepted, `\\?\UNC\...` is a device namespace, a reserved name in the middle
  of a path is rejected and repeated separators collapse.
- Lab tests on this branch — 24 tests, 24 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
- Review round 2 (Judgment Day): JD-B-002 showed that slicing the original
  path at an offset computed on `toLowerCase()` drifts when Unicode folding
  changes length (`U+0130` becomes `i` + `U+0307`), so a root
  `C:\Users\İsmail\proj` accepted `C:\Users\i̇smail\proj\Windows\x.txt`
  with relative `\Windows\x.txt`. JD-B-009 showed that `nul .txt`, `CON .log`
  and `src\aux .x` were accepted. Two tests were added first and failed (RED):
  `node --test lab/target-routing/paths.test.mjs` — 9 tests, 7 pass, 2 fail;
  the escape probe returned `ok: true` with relative `\Windows\x.txt` and
  `nul .txt` was not refused. After the segment comparison and the reserved
  name rule (GREEN): `node --test lab/target-routing/*.test.mjs` — 9 tests,
  9 pass. `npm run build` exit 0; `npm run check:release` exit 0.
