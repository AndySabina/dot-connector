# p2a — Context binding

Child branch: `target-routing/p2a-context-binding` (PR targets
`target-routing/p2-sessions`). Phase: [P2-SESSIONS.md](P2-SESSIONS.md).
Reference code only; not imported by the product and not distributed.

## What this is

Three pure functions in `lab/target-routing/context.mjs`:

- `createSessionContext(target, session)` builds a frozen session context from
  an allowed target and the caller's `sessionId` and `incarnation`.
- `bindRequest(context, operationId)` returns a frozen request envelope that
  carries a binding copied from the context.
- `checkResult(context, result)` accepts a result only when its binding matches
  the current context exactly, and otherwise rejects it with a reason code.

## Why it exists

Results arrive later than requests. By then the user may have switched project,
the session may have restarted or the configuration may have changed. Each
result must prove that it claims the context that is current now.

## The problem it solves

- A late result from another project on the same tunnel.
- A result from a project with the same name and root on another machine.
- A result from an earlier session or incarnation of the same project.
- A result produced under an older configuration version.
- Result fields that do not belong to the envelope.

## How

- **Target**: exactly `machineId`, `tunnelId`, `projectId`, `pathSpace`, `root`
  and `configVersion`, the shape of the phase 1 allow decision.
- **Session**: exactly `sessionId` (label) and `incarnation` (lowercase UUID),
  supplied by the caller. This module never generates them.
- **Binding**: `machineId`, `tunnelId`, `projectId`, `sessionId`, `incarnation`
  and `configVersion`.
- **Request envelope**: `{operationId, binding}`; `operationId` matches
  `^[A-Za-z0-9_-]{1,80}$`, the rule of `src/connector.mjs`.
- **Result envelope**: exactly `{operationId, binding, data}`. `data` is
  returned untouched and stays untrusted data.
- Contexts are recognized only when produced by `createSessionContext`.

Invalid inputs to `createSessionContext` and `bindRequest` throw `Error(code)`.
`checkResult` never throws; it returns a frozen verdict
`{accepted, reason, operationId}`, plus `data` when accepted. Checks run in
this order and the first failure wins:

| Code | When |
|---|---|
| `CONTEXT_INVALID` | Thrown: target or session with a wrong shape or value |
| `CONTEXT_UNVERIFIED` | The context was not produced by `createSessionContext` |
| `REQUEST_INVALID` | Thrown: invalid `operationId` |
| `RESULT_INVALID` | Wrong result shape, binding keys or `operationId` |
| `RESULT_TARGET_MISMATCH` | Machine, tunnel or project differ |
| `RESULT_SESSION_MISMATCH` | Session or incarnation differ |
| `RESULT_CONFIG_STALE` | Configuration version differs |
| `ACCEPTED` | Every binding field matches |

## Acceptance checks

- A valid target and session produce a frozen context; inputs are not modified;
  wrong shapes, values or incarnations are rejected.
- A request envelope carries the binding of its context and is frozen; invalid
  operation ids and unverified contexts are rejected.
- A matching result is accepted and its data is returned untouched, even when
  the data contains text that looks like an instruction.
- A late result from another project on the same tunnel is rejected.
- A result from the same project name and root on another machine is rejected.
- A result from an earlier session or incarnation is rejected.
- A result from an older configuration version is rejected.
- A result with extra or missing fields is rejected.

## Limits

- A matching binding shows what a result claims, not where it came from;
  transport authentication must establish the origin.
- This child does not track which operations were issued or pending; that is
  part of p2b.
- Accepting a result never turns its data into instructions.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `context.mjs` existed, `context.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/context.test.mjs` — 9 tests, 9 pass.
- Lab tests on this branch (`lab/claim-lifecycle.test.mjs`,
  `lab/console-lab.test.mjs`, `context.test.mjs`) — 26 tests, 26 pass. Phase 1
  files are not on this branch by design.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
