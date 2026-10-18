# p2b — Project switch

Child branch: `target-routing/p2b-project-switch` (PR targets
`target-routing/p2a-context-binding`). Phase: [P2-SESSIONS.md](P2-SESSIONS.md).
Reference code only; not imported by the product and not distributed.

## What this is

A pure operation ledger of frozen states with a single current state per ledger
(p2c) in `lab/target-routing/switch.mjs`, built on
the session context of p2a:

- `openWorkspace(context)` starts a ledger for one session context.
- `queueOperation(state, operationId)` and `markDispatched(state, operationId)`
  record an operation before and after it is handed to the executor.
- `completeOperation(state, result)` accepts a result only for a dispatched
  operation of the current context.
- `switchProject(state, nextContext)` moves to a new context and reports what
  happened to pending operations.

Every function returns new frozen state; the previous state is never changed.

## Why it exists

A project switch is the moment where context mixing is most likely: results
from the old project are still arriving, some operations were sent and some
were not, and the next project must start clean.

## The problem it solves

- Treating "cancel" as "undo" for an operation that was already sent.
- Repeating an operation whose outcome is unknown.
- Accepting a late result from the previous project after the switch.
- Carrying operations, buffers or permissions into the next project.
- Reusing the same incarnation for a "new" context, which would let old results
  match.

## How

- Operation states: `queued` (recorded, not sent), `dispatched` (handed to the
  executor), `completed` (a matching result was accepted).
- On `switchProject`:
  - `queued` operations become `cancelled`: they were never sent;
  - `dispatched` operations become `uncertain`: they may have run, are not
    undone and must not be repeated;
  - `completed` operations are not reported as pending.
- The next context must be a verified p2a context with an incarnation never
  used before by this ledger; reusing an earlier one would let its late results
  match again. Revalidation means the caller resolves the next target again
  (phase 1) and creates a new context; this ledger never reuses the old one.
- The new state has no operations and holds no buffers or permissions. It
  remembers retired operation ids so that a cancelled or uncertain operation id
  cannot be queued again.
- Late results are checked with p2a `checkResult` against the current context
  and are rejected; the state does not change.

Errors are thrown as `Error(code)` for invalid transitions; result handling
returns a verdict and never throws.

| Code | When |
|---|---|
| `LEDGER_INVALID` | Thrown: state not produced by this module |
| `CONTEXT_UNVERIFIED` | Thrown: context not produced by p2a |
| `REQUEST_INVALID` | Thrown: invalid operation id |
| `OPERATION_ID_REUSED` | Thrown: id already used in this context or retired by a switch |
| `OPERATION_NOT_QUEUED` | Thrown: dispatch of an operation that is not queued |
| `SWITCH_INCARNATION_REUSED` | Thrown: next context reuses the current or an earlier incarnation of this ledger |
| `RESULT_UNKNOWN_OPERATION` | Verdict: result for an operation that is not dispatched here |
| `RESULT_ALREADY_COMPLETED` | Verdict: a second result for a completed operation |
| p2a codes | Verdict: target, session or configuration mismatch, invalid result |

## Acceptance checks

- A ledger needs a verified context; forged states are rejected.
- Queue → dispatch → matching result completes the operation; the earlier state
  is unchanged.
- Results for unknown, queued-only or already completed operations are refused.
- A switch cancels queued operations, marks dispatched ones uncertain, starts
  empty and keeps the previous state unchanged.
- A late result from the previous project is rejected after the switch.
- Cancelled and uncertain ids cannot be queued again after the switch.
- A switch with the current or an earlier incarnation, or with an unverified
  context, is refused.
- Restarting the same project with a new incarnation is a switch; old results
  are rejected as a session mismatch.

## Limits

- `uncertain` means this layer does not know the real effect. Only the executor
  or the user can establish it; this layer never retries.
- The ledger is in memory and per caller. Persisting it, and coordinating
  several callers, belongs to the integration.
- Revalidation depends on the caller resolving the next target again with
  phase 1; this module cannot force it.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `switch.mjs` existed, `switch.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- While implementing, a gap in the first design was found: switching back with
  an earlier incarnation would let its late results match again. The ledger
  now remembers every incarnation it used, and a test covers the case.
- GREEN: `switch.test.mjs` 8 tests and `context.test.mjs` 9 tests — 17 pass.
  `context.mjs` only gained the `isSessionContext` export.
- Lab tests on this branch — 34 tests, 34 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.
