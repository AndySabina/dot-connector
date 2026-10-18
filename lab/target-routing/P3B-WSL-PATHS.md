# p3b — WSL paths and path-space dispatch

Child branch: `target-routing/p3b-wsl-paths` (PR targets
`target-routing/p3a-windows-paths`). Phase: [P3-PATHS.md](P3-PATHS.md).
Reference code only; not imported by the product and not distributed.

## What this is

Two pure functions added to `lab/target-routing/paths.mjs`:

- `resolveWslPath(root, input)` interprets `input` with POSIX rules inside WSL
  relative to a project `root`.
- `resolvePath(project, input)` reads `pathSpace` and `root` from a project
  (the phase 1 target shape) and applies Windows or WSL rules accordingly.

Both return `{ok: true, path, relative}` or `{ok: false, reason}`, never throw
and never touch the filesystem.

## Why it exists

The same files are often reachable as `C:\work\shop` from Windows and as
`/mnt/c/work/shop` from WSL. Treating both spellings as equivalent would let a
request written for one path space reach a project declared in the other, and
the mapping depends on the mount configuration the resolver cannot see.

## The problem it solves

- Windows paths (`C:\...`, `C:/...`, backslashes) sent to a WSL project.
- `/mnt/c/...` paths sent to a Windows project.
- `..` and sibling prefixes in WSL, such as `/home/dev/blog2` next to
  `/home/dev/blog`.
- Case differences in WSL, where names are case sensitive.

## How

- **WSL root**: absolute, already normalized POSIX path, no trailing `/` (except
  `/`), no backslash, no control characters, at most 512 characters.
- **WSL input**: a non-empty string of at most 1024 characters without control
  characters. A drive prefix (`C:`) or any backslash means the input was written
  for Windows → `PATH_SPACE_MISMATCH`. Relative input is joined to the root;
  `..` is resolved textually; the comparison is case sensitive.
- **Dispatcher**: `pathSpace` `windows` uses p3a rules, except that a
  `/mnt/<letter>` path is reported as `PATH_SPACE_MISMATCH`; `wsl` uses the WSL
  rules. Any other project shape → `PATH_SPACE_INVALID`.

| Reason | When |
|---|---|
| `PATH_SPACE_INVALID` | The project has no `windows` or `wsl` path space |
| `PATH_SPACE_MISMATCH` | The input is written for the other path space |
| `ROOT_INVALID`, `PATH_INVALID`, `PATH_OUTSIDE_ROOT` | As in p3a, with WSL rules |
| p3a reasons | Windows projects keep every p3a reason |

## Acceptance checks

- WSL relative paths, inner `..` and absolute paths inside the root resolve; the
  root itself has an empty relative path.
- WSL escapes are rejected: `..` above the root, sibling prefix, different case,
  and `/mnt/C/...` for a `/mnt/c/...` root.
- Windows spellings sent to a WSL project are rejected as a path-space mismatch,
  including a root under `/mnt/c` and the matching `C:\` path.
- `/mnt/c/...` sent to a Windows project is rejected as a path-space mismatch.
- The dispatcher applies p3a rules to Windows projects and rejects unknown path
  spaces; invalid WSL roots and inputs are rejected.

## Limits

- `/mnt/c` is a DrvFs mount whose case behavior and mount point depend on the
  WSL configuration; the case-sensitive text comparison is the conservative
  choice. The executor must confirm the real mount (p3c).
- A backslash is a legal character in Linux names; it is rejected here because
  it far more often signals a Windows path.
- Symlinks and bind mounts can still lead outside the root; see p3c.

## Results

Node 22.23.3, local, fictional data only.

- RED: before the new exports existed, `paths-wsl.test.mjs` failed with
  `does not provide an export named 'resolvePath'`.
- GREEN: `paths-wsl.test.mjs` 5 tests and `paths.test.mjs` 7 tests — 12 pass.
- Extra manual probes behaved as specified: `//etc/passwd` and
  `/home/dev/blog/../blog2` are outside, repeated `/` collapse, and a UNC path
  sent to a Windows project with a drive root is outside.
- Lab tests on this branch — 29 tests, 29 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
