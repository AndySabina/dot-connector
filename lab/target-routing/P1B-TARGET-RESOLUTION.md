# p1b — Target resolution

Child branch: `target-routing/p1b-target-resolution` (PR targets
`target-routing/p1a-registry-model`). Phase: [P1-REGISTRY.md](P1-REGISTRY.md).
Reference code only; not imported by the product and not distributed.

## What this is

`resolveTarget(registry, context, request)` in
`lab/target-routing/resolver.mjs`: a pure function that resolves one request to
exactly one target of a registry built by `validateRegistry` (p1a) and checks
the per-project permission for the requested operation. It never throws for a
bad request; it returns a deny decision with a reason code.

## Why it exists

The registry says what exists. Resolution decides where one request goes and
whether the supplied policy allows it. Later blocks (sessions, project switch,
paths) start from an allow decision.

## The problem it solves

- The same project name and root on two machines: only machine identity can
  tell them apart; without it the request is ambiguous.
- Several projects on one tunnel keep their own permissions.
- A request naming a machine or tunnel that does not belong to the project.
- A request prepared with an older configuration version.
- A down tunnel must fail, never fall back to another target.
- A request that tries to name its own requester.

## How

Inputs and the decision shape are described in [P1-REGISTRY.md](P1-REGISTRY.md).

- **Registry**: must be the exact object returned by `validateRegistry`; a copy
  is refused.
- **Context**: exactly `principalId` and `tunnelStatus` (tunnel id → `up` or
  `down`), supplied by the caller from a trusted mechanism. A malformed context
  or missing principal is refused. A tunnel that is not reported as `up` is
  unavailable.
- **Request**: exactly `schema` (1), `configVersion`, `projectId`, `operation`
  (`observe`, `write`, `execute`), optionally `machineId` and `tunnelId`. Any
  other field, including a requester field, is refused.
- Checks run in this order and the first failure wins: registry, request,
  requester, configuration version, target lookup, identity consistency,
  permission, tunnel status. Permission is checked before tunnel status, so a
  denied request does not learn whether the tunnel is up.
- The decision is a deeply frozen object. `operation` is `null` when the
  request did not name a valid operation.

## Acceptance checks

- Two projects on the same tunnel keep their own permissions; a grant in one
  project does not apply to the other.
- Matching names and roots on two machines: ambiguous without `machineId`,
  resolved to the right machine and tunnel with it.
- Missing grant → `PERMISSION_MISSING`; grant without the operation →
  `PERMISSION_DENIED`.
- Unknown project → `TARGET_UNKNOWN`; unknown operation or field →
  `REQUEST_INVALID`.
- Tunnel of another machine, or a machine where the project does not exist
  while it exists elsewhere → `TARGET_INCONSISTENT`.
- Older `configVersion` → `CONFIG_STALE`.
- Down or unreported tunnel → `TUNNEL_UNAVAILABLE`, even when another machine
  has a project with the same name and an up tunnel.
- Requester named inside the request → `REQUEST_INVALID`; context without a
  principal → `REQUESTER_UNVERIFIED`.
- Decisions are deeply frozen; a copied registry → `REGISTRY_UNVERIFIED`.
- A project on its own tunnel resolves to that tunnel even when the shared
  tunnel of the same machine is down.

## Limits

- `Object.freeze` prevents accidental mutation only. The executor must validate
  and enforce the decision; a compromised executor can ignore it.
- The context is only as trustworthy as the mechanism that supplies it. This
  function cannot prove who the requester is.
- Tunnel status is a snapshot supplied by the caller; it can change right after
  the decision. Resolution does not open, test or retry any tunnel.
- Sessions, late results and path checks inside the root are later blocks.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `resolver.mjs` existed, `resolver.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/resolver.test.mjs` — 11 tests, 11 pass.
- All lab tests (`lab/claim-lifecycle.test.mjs`, `lab/console-lab.test.mjs`,
  `registry.test.mjs`, `resolver.test.mjs`) — 35 tests, 35 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
