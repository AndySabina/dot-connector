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
  and contain no control characters. UNC and full normalization belong to
  phase 3.
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
| `REGISTRY_INVALID_ROOT` | A root that is not absolute and normalized in its path space |

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
