# Phase 1 — Registry and resolution

Phase branch: `target-routing/p1-registry` (PR targets
`target-routing/tracker`). **Status: children complete; awaiting review.**
This document is a proposal; no code in this phase is implemented yet. See
[PLAN.md](PLAN.md) for the full chain.

## What this is

The first small block of pure functions:

- `validateRegistry(document)` checks a fictional configuration of machines,
  tunnels and projects and returns a frozen registry.
- `resolveTarget(registry, context, request)` resolves one request to exactly
  one target and checks the per-project permission for the requested
  operation, or denies with a reason code.

## Why it exists

It is the base the later blocks build on (sessions, project switch, paths,
decision log). Without a single, validated registry and a deterministic
resolver, every later check would have to guess which machine, tunnel or
project a request means.

## The problem it solves

- The same project name and root can exist on two machines; only machine
  identity can tell them apart.
- Several projects on one machine may share a tunnel but keep different
  permissions.
- A request could carry a tunnel or machine that does not belong to the project.
- A selection made with an older configuration must not keep its permissions.
- A down tunnel must fail, never fall back to another target.
- The request itself must not be able to claim who the requester is.

## How

**Registry document** (exact keys, labels `^[A-Za-z0-9_-]{1,64}$`, as in
`src/private-config.mjs`):

```json
{
  "schema": 1,
  "version": 3,
  "machines": [{"machineId": "m-alpha"}],
  "tunnels":  [{"tunnelId": "t-alpha", "machineId": "m-alpha"}],
  "projects": [{
    "machineId": "m-alpha", "projectId": "p-blog", "tunnelId": "t-alpha",
    "pathSpace": "wsl", "root": "/home/dev/blog",
    "grants": [{"principalId": "u-dot", "observe": true, "write": true, "execute": false}]
  }]
}
```

- A tunnel belongs to exactly one machine. A machine may have one or several
  tunnels; projects may share a tunnel but are not required to.
- A project is identified by `machineId` + `projectId`; the same `projectId` may
  exist on several machines.
- A project's tunnel must belong to the project's machine.
- `pathSpace` is `windows` or `wsl`; `root` must be absolute in that space. A
  `/mnt/c/...` root is not accepted as Windows, nor a `C:\...` root as WSL.
- Grants are per project and per principal, with generic `observe`, `write` and
  `execute`. A grant in one project never applies to another.
- Unknown fields (for example a command) are rejected.

**Trusted context** (supplied by the caller from an existing trusted mechanism,
never from the request): `principalId` and the observed status of each tunnel.

**Request**: `schema`, `configVersion`, `projectId`, `operation`
(`observe`, `write`, `execute`) and optionally `machineId` and `tunnelId`. A
request field such as `principalId` is rejected.

**Decision** (deeply frozen):

- allow: `{decision: "allow", reason: "ALLOWED", operation, target}` where
  `target` holds `machineId`, `tunnelId`, `projectId`, `pathSpace`, `root` and
  `configVersion`;
- deny: `{decision: "deny", reason, operation}`.

**Order of checks**: registry produced by `validateRegistry`, request
structure, trusted requester, target lookup among the projects visible to the
principal, identity consistency, configuration version, permission, tunnel
status. A project is visible to a principal when it has a grant for that
principal with at least one of `observe`, `write` or `execute` set to `true`.
A missing grant is reported as `TARGET_UNKNOWN`, so an unauthorized principal
cannot map projects, machines, tunnels or the configuration version.

The request and the context are read once into plain snapshots (own,
enumerable, string-keyed data properties of a plain object). Accessors, symbol
keys, other prototypes and throwing proxy traps are refused, and
`resolveTarget` never throws.

**Reason codes**

| Code | When |
|---|---|
| `REGISTRY_UNVERIFIED` | The registry did not come from `validateRegistry` |
| `REQUEST_INVALID` | Unknown or missing fields, unknown operation, a requester field in the request, or a request that is not a plain data object |
| `REQUESTER_UNVERIFIED` | No principal in the trusted context, or a context that is not a plain data object |
| `TARGET_UNKNOWN` | No visible project matches (this includes a missing grant and a machine where no visible project exists) |
| `TARGET_AMBIGUOUS` | More than one project in the registry has the name, no machine was given, and at least one is visible |
| `TARGET_INCONSISTENT` | Tunnel in the request does not belong to the resolved visible project |
| `CONFIG_STALE` | Request version differs from the registry version |
| `PERMISSION_DENIED` | The grant does not include the operation |
| `TUNNEL_UNAVAILABLE` | The project's tunnel is not reported as up |

Registry validation fails with `REGISTRY_INVALID`, `REGISTRY_DUPLICATE_ID`,
`REGISTRY_UNKNOWN_MACHINE`, `REGISTRY_UNKNOWN_TUNNEL`, `REGISTRY_TUNNEL_MACHINE_MISMATCH` or
`REGISTRY_INVALID_ROOT`.

## Child PRs

| Child | Branch | Targets | Content | Est. | Status |
|---|---|---|---|---|---|
| p1a | `target-routing/p1a-registry-model` | `p1-registry` | `validateRegistry`, registry reason codes, registry acceptance checks | ~280 | ✅ [P1A-REGISTRY-MODEL.md](P1A-REGISTRY-MODEL.md) |
| p1b | `target-routing/p1b-target-resolution` | `p1a-registry-model` | `resolveTarget`, decision shape, resolution reason codes and acceptance checks | ~330 | ✅ [P1B-TARGET-RESOLUTION.md](P1B-TARGET-RESOLUTION.md) |
| p1c | `target-routing/p1c-resolver-hardening` | `p1b-target-resolution` | Judgment Day round 2: overlapping and invalid registry roots, hostile request and context snapshots, no disclosure to ungranted principals (see the Review round 2 sections of P1A and P1B) | ~375 | ✅ |

Each child follows the workflow in [PLAN.md](PLAN.md): document, tests first
with fictional data (`lab/target-routing/*.test.mjs`), pure implementation with
no dependencies, filesystem, network or transport, QA with evidence, and
results recorded here.

## Acceptance checks

- Two projects on the same tunnel keep their own permissions.
- Matching project names and roots on two machines resolve only by machine
  identity; without it the request is ambiguous.
- A missing grant, or a grant with no allowed operation, is reported as
  `TARGET_UNKNOWN` for every probe (unique or ambiguous name, wrong machine,
  wrong tunnel, stale version); a denied operation is `PERMISSION_DENIED`.
- Unknown targets and operations are refused.
- A tunnel that does not belong to the resolved project is refused; a machine
  where no visible project exists is `TARGET_UNKNOWN`.
- A stale configuration version is refused, but only after the target is
  visible to the principal.
- Hostile requests or contexts (throwing getters, accessors, throwing proxy
  traps) return frozen deny decisions without throwing.
- A down or unreported tunnel returns `TUNNEL_UNAVAILABLE` with no fallback.
- A requester claimed inside the request is refused; a missing trusted
  principal is refused.
- Decisions are deeply frozen; a copied registry is refused.
- Registry rejects orphan tunnels, tunnels on the wrong machine, duplicates,
  unknown fields and roots outside their path space.
- Tunnel sharing works but is not required.

## Limits

- `Object.freeze` only prevents accidental mutation; the executor must still
  validate and enforce the decision.
- The trusted context is only as trustworthy as the mechanism that supplies it.
- Root checks are syntactic. Whether a root exists, its real case behavior and
  any symlink or junction are executor checks against the real filesystem.
- Sessions, project switch, late results and full path normalization belong to
  later blocks.

## Results

Not implemented yet.
