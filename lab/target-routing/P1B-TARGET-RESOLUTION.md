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
- **Snapshots**: the request, the context and `context.tunnelStatus` are read
  once into plain snapshots before any check: only own, enumerable,
  string-keyed data properties of an object whose prototype is
  `Object.prototype` or `null`. Accessors, symbol keys, other prototypes and
  any throwing proxy trap make a hostile request `REQUEST_INVALID` (operation
  `null`) and a hostile context `REQUESTER_UNVERIFIED`. Every later check uses
  the snapshots only, so `resolveTarget` never throws.
- **Visibility**: a project is visible to the principal when it has a grant
  for that principal with at least one of `observe`, `write` or `execute` set
  to `true`. A missing grant is reported as `TARGET_UNKNOWN`, so an
  unauthorized principal cannot map projects, machines, tunnels or the
  configuration version.
- Checks run in this order and the first failure wins: registry, request,
  requester, then lookup among visible projects only: no visible project with
  the `projectId` → `TARGET_UNKNOWN`; a `machineId` with no visible project of
  that name on it → `TARGET_UNKNOWN`; several projects with that name in the
  whole registry, no `machineId`, and at least one visible →
  `TARGET_AMBIGUOUS` (the only visible one is never picked silently); a
  `tunnelId` that does not match the resolved project → `TARGET_INCONSISTENT`;
  then configuration version, permission for the operation, tunnel status.
  Permission is checked before tunnel status, so a denied request does not
  learn whether the tunnel is up.
- The decision is a deeply frozen object. `operation` is `null` when the
  request did not name a valid operation.

## Acceptance checks

- Two projects on the same tunnel keep their own permissions; a grant in one
  project does not apply to the other.
- Matching names and roots on two machines: ambiguous without `machineId`,
  resolved to the right machine and tunnel with it.
- Missing grant → `TARGET_UNKNOWN`; grant without the operation →
  `PERMISSION_DENIED`.
- An ungranted principal, or one whose grant allows no operation, gets
  `TARGET_UNKNOWN` for an existing unique project, an ambiguous name without
  `machineId`, a project on the wrong machine, a wrong `tunnelId` and a stale
  `configVersion`.
- A principal that sees only one of two same-named projects still gets
  `TARGET_AMBIGUOUS` without `machineId`.
- Unknown project → `TARGET_UNKNOWN`; unknown operation or field →
  `REQUEST_INVALID`.
- Tunnel of another machine → `TARGET_INCONSISTENT`; a machine where no
  visible project of that name exists → `TARGET_UNKNOWN`.
- Older `configVersion` on a visible target → `CONFIG_STALE`.
- A throwing getter, an accessor, a non-enumerable or symbol key, a foreign
  prototype, or a throwing or revoked proxy in the request →
  `REQUEST_INVALID`; the same in the context or its `tunnelStatus` →
  `REQUESTER_UNVERIFIED`; never an exception.
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

**Review round 2 (Judgment Day).** Fixes JD-B-005 (a throwing getter or proxy
trap made `resolveTarget` throw) and JD-B-010 (lookup and `CONFIG_STALE` ran
before any permission check, so an ungranted principal could map projects,
machines, tunnels and the version). `PERMISSION_MISSING` is removed.

- RED: with the updated `resolver.test.mjs` and the previous `resolver.mjs`,
  15 tests, 9 pass, 6 fail: missing grant returned `PERMISSION_MISSING`
  instead of `TARGET_UNKNOWN`; a machine without the visible project returned
  `TARGET_INCONSISTENT`; ungranted probes returned `PERMISSION_MISSING`; a
  grant with no allowed operation returned `PERMISSION_DENIED`; a principal
  seeing one of two same-named projects got `PERMISSION_MISSING` on the other
  machine; a throwing `operation` getter made `resolveTarget` throw `boom`.
- GREEN: `node --test lab/target-routing/resolver.test.mjs` — 15 tests, 15
  pass; `node --test lab/target-routing/*.test.mjs` — 25 tests, 25 pass; all
  lab tests (`lab/*.test.mjs`, `lab/target-routing/*.test.mjs`) — 42 tests, 42
  pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
