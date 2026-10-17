# Phase 1 — Registry and resolution

Phase branch: `target-routing/p1-registry` (PR targets
`target-routing/tracker`). **Status: planned, implementation on hold.**
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
structure, trusted requester, configuration version, target lookup, identity
consistency, permission, tunnel status.

**Reason codes**

| Code | When |
|---|---|
| `REGISTRY_UNVERIFIED` | The registry did not come from `validateRegistry` |
| `REQUEST_INVALID` | Unknown or missing fields, unknown operation, or a requester field in the request |
| `REQUESTER_UNVERIFIED` | No principal in the trusted context |
| `CONFIG_STALE` | Request version differs from the registry version |
| `TARGET_UNKNOWN` | No project matches |
| `TARGET_AMBIGUOUS` | More than one project matches |
| `TARGET_INCONSISTENT` | Machine or tunnel in the request does not belong to the project |
| `PERMISSION_MISSING` | No grant for this principal in this project |
| `PERMISSION_DENIED` | The grant does not include the operation |
| `TUNNEL_UNAVAILABLE` | The project's tunnel is not reported as up |

Registry validation fails with `REGISTRY_INVALID`, `REGISTRY_DUPLICATE_ID`,
`REGISTRY_UNKNOWN_MACHINE`, `REGISTRY_TUNNEL_MACHINE_MISMATCH` or
`REGISTRY_INVALID_ROOT`.

## Child PRs

| Child | Branch | Targets | Content | Est. |
|---|---|---|---|---|
| p1a | `target-routing/p1a-registry-model` | `p1-registry` | `validateRegistry`, registry reason codes, registry acceptance checks | ~280 |
| p1b | `target-routing/p1b-target-resolution` | `p1a-registry-model` | `resolveTarget`, decision shape, resolution reason codes and acceptance checks | ~330 |

Each child follows the workflow in [PLAN.md](PLAN.md): document, tests first
with fictional data (`lab/target-routing/*.test.mjs`), pure implementation with
no dependencies, filesystem, network or transport, QA with evidence, and
results recorded here.

## Acceptance checks

- Two projects on the same tunnel keep their own permissions.
- Matching project names and roots on two machines resolve only by machine
  identity; without it the request is ambiguous.
- Missing and denied permissions are refused.
- Unknown targets and operations are refused.
- Inconsistent machine or tunnel identity is refused.
- A stale configuration version is refused.
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
