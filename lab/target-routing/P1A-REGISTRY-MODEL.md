# p1a — Registry model

Child branch: `target-routing/p1a-registry-model` (PR targets
`target-routing/p1-registry`). Phase: [P1-REGISTRY.md](P1-REGISTRY.md).
Reference code only; not imported by the product and not distributed.

## What this is

`validateRegistry(document)` in `lab/target-routing/registry.mjs`: a pure
function that checks a fictional configuration of machines, tunnels and
projects and returns a deeply frozen copy. `isRegistry(value)` tells whether a
value was produced by `validateRegistry`.

## Why it exists

Every later block (resolution, sessions, paths) relies on one validated source
of machines, tunnels and projects. If the registry itself can be inconsistent,
no resolver built on it can be trusted to pick the right target.

## The problem it solves

- A tunnel declared for a machine that does not exist.
- A project whose tunnel belongs to a different machine.
- Two entries with the same identity.
- Fields that do not belong to the model, such as a command.
- A project root that is not absolute in its declared path space, for example
  a `/mnt/c/...` root declared as Windows or a `C:\...` root declared as WSL.

## How

The document shape is described in [P1-REGISTRY.md](P1-REGISTRY.md). Rules:

- Exact keys at every level; labels match `^[A-Za-z0-9_-]{1,64}$`, the rule of
  `src/private-config.mjs`.
- `schema` is `1`; `version` is a non-negative safe integer.
- At least one machine; at most 64 machines, tunnels and projects each, and at
  most 64 grants per project.
- Identities are unique: `machineId`; `tunnelId`; the pair `machineId` +
  `projectId`; `principalId` inside one project.
- A tunnel names an existing machine. A machine may have one or several
  tunnels; projects may share a tunnel but are not required to.
- A project names an existing machine and an existing tunnel of that same
  machine.
- `pathSpace` is `windows` or `wsl`. A Windows root is a drive-absolute,
  already normalized path with backslashes (`C:\work\shop`). A WSL root is an
  absolute, already normalized POSIX path. Roots are at most 512 characters
  and contain no control characters. UNC roots (`\\server\share\...`) are
  not supported: a network share lives on another machine than the one the
  project declares. Full path normalization belongs to phase 3.
- Windows root segments follow the rule of `lab/target-routing/paths.mjs`
  (mirrored, not imported): a segment is invalid when it ends with a dot or a
  space, or when its part before the first `.`, with trailing spaces removed,
  is a reserved device name (`con`, `prn`, `aux`, `nul`, `com0-9`, `lpt0-9`,
  and `com`/`lpt` with `¹`, `²`, `³`, any case). After the drive, none of
  `: * ? " < > |` is allowed.
- Two projects on the same machine may not have equal or nested roots.
  Windows segments are compared ignoring case (a match under either
  `toUpperCase()` or `toLowerCase()`); WSL segments are compared exactly. The
  root `/` and drive roots such as `C:\` overlap everything in their space.
  Only for this check, a WSL root `/mnt/<letter>/rest` is also seen as
  `<LETTER>:\rest`, and a Windows root as `/mnt/<letter>/rest`, so WSL `/`
  and `/mnt` contain every drive. This mapping is used only to refuse a
  registry, never to grant access. Projects on different machines never
  overlap. Root validity is checked for every project before overlap.
- Grants hold `principalId` and boolean `observe`, `write` and `execute`.
- The input is never modified; the result is a frozen copy.

Errors are thrown as `Error(code)`:

| Code | When |
|---|---|
| `REGISTRY_INVALID` | Wrong shape, unknown or missing keys, bad labels, counts or values |
| `REGISTRY_DUPLICATE_ID` | A repeated identity |
| `REGISTRY_UNKNOWN_MACHINE` | A tunnel or project names a machine that does not exist |
| `REGISTRY_UNKNOWN_TUNNEL` | A project names a tunnel that does not exist |
| `REGISTRY_TUNNEL_MACHINE_MISMATCH` | A project's tunnel belongs to another machine |
| `REGISTRY_INVALID_ROOT` | A root that is not absolute and normalized in its path space, or a Windows root with a reserved name, a trailing dot or space, or a forbidden character |
| `REGISTRY_ROOT_OVERLAP` | Two projects on the same machine have equal or nested roots |

## Acceptance checks

- A valid document returns a deeply frozen copy recognized by `isRegistry`; a
  structured clone of it is not recognized.
- The input document is not modified, and later changes to it do not affect
  the returned registry.
- Each error code above is produced by its case: orphan tunnel, project on an
  unknown machine or tunnel, crossed tunnel, duplicate machine, tunnel, project
  and principal, unknown field, invalid schema, version and grant values.
- Root checks: relative Windows root, forward slashes in a Windows root, a WSL
  path declared as Windows, a Windows path declared as WSL, and a WSL root with
  `..` are rejected; a WSL root under `/mnt/c` is accepted as WSL only.
- A machine with two tunnels and projects on each is valid.
- A UNC root is rejected (review fix, PR #3: the contract now matches
  `paths.mjs`, which rejects UNC roots too). The registry already rejected it;
  the test pins the shared contract.
- Windows roots `C:\work\nul`, `C:\work\shop.`, `C:\work\shop ` and
  `C:\com1\x` are rejected with `REGISTRY_INVALID_ROOT`, as are `Aux .txt`,
  `lpt¹` and each of `: * ? " < > |` after the drive; `console.d\nul-x` is
  accepted (review round 2, JD-B-004).
- On one machine, `C:\work` next to `C:\work\shop` (nested),
  `C:\WORK\shop` (case variant) and a second `C:\work\shop` (equal) are
  rejected with `REGISTRY_ROOT_OVERLAP`, as are `C:\`, `/`, a parent WSL root,
  WSL `/mnt/c/work`, `/mnt/c/WORK/shop/x`, `/mnt/c` and `/mnt` next to
  `C:\work\shop`. Siblings `C:\work\shop2`, `/home/dev/blog2`,
  `/mnt/d/work/shop` and `D:\work\blog` are valid; identical or nested roots
  on different machines are valid (review round 2, JD-B-003).
- An invalid root is reported as `REGISTRY_INVALID_ROOT` even when it would
  also overlap. The input document is unchanged after every rejection.

## Limits

- Checks are syntactic. Whether a root exists, its case behavior and any
  symlink or junction are executor checks on the real filesystem.
- `Object.freeze` prevents accidental mutation only.
- Grants are data supplied by the configuration owner; this layer does not
  decide who may edit them.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `registry.mjs` existed, `registry.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/registry.test.mjs` — 7 tests, 7 pass.
- Existing lab tests unchanged: `lab/claim-lifecycle.test.mjs`,
  `lab/console-lab.test.mjs` and this file together — 24 tests, 24 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.

Review round 2 (Judgment Day): JD-B-003 (overlapping roots on one machine)
and JD-B-004 (reserved names, trailing dots and spaces). RED: with the new
tests and the previous `registry.mjs`, `node --test
lab/target-routing/registry.test.mjs` ran 10 tests, 7 pass, 3 fail, each with
`Missing expected exception.`: `Windows roots follow the segment rules of
paths.mjs` (expected `REGISTRY_INVALID_ROOT`), `projects on one machine cannot
have equal or nested roots` (expected `REGISTRY_ROOT_OVERLAP`) and `root
validity is checked before overlap` (expected `REGISTRY_INVALID_ROOT`). GREEN:
after the fix, `node --test lab/target-routing/registry.test.mjs` and `node
--test lab/target-routing/*.test.mjs` — 10 tests, 10 pass. `npm run build`
exit 0; `npm run check:release` exit 0. The overlap check also maps Windows
roots to `/mnt/<letter>` so WSL `/` and `/mnt` are refused next to a Windows
root; this only refuses more registries.
