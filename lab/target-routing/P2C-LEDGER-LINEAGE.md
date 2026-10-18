# p2c — Ledger lineage

Child branch: `target-routing/p2c-ledger-lineage` (PR targets
`target-routing/p2b-project-switch`). Phase: [P2-SESSIONS.md](P2-SESSIONS.md).
Reference code only; not imported by the product and not distributed.

## What this is

A fix for Judgment Day finding JD-B-001 (HIGH) in
`lab/target-routing/switch.mjs`. Ledger states stay frozen and every
transition still returns a new state, but each ledger now has a single
**lineage**: only the latest state of a lineage is current.

## Why it exists

In p2b a state was valid as long as this module had produced it. States were
never retired, so a handler that kept a reference to a state from before a
switch could keep using it as if the switch had never happened.

## The problem it solves

With the p2b ledger, after `switchProject(s1, next)`:

- `completeOperation(s1, lateResultFromA)` returned `ACCEPTED` for a late
  result from the previous project;
- `markDispatched(s1, 'op-2')` dispatched an operation the switch had reported
  as `cancelled`;
- queuing and dispatching `op-9` twice from the same base state produced two
  dispatched copies of the same operation.

Cancelled or uncertain work could be dispatched again, and late results could
be accepted.

## How

- A private `WeakMap` maps each state to a lineage record `{current}`.
- `openWorkspace` creates a new lineage.
- `queueOperation`, `markDispatched`, an accepted `completeOperation` and
  `switchProject` require `lineage.current === state` and set
  `lineage.current` to the new state.
- `switchProject` keeps the same lineage, so the pre-switch state becomes
  stale.
- A refused `completeOperation` (any reason) does not advance the lineage.

| Code | When |
|---|---|
| `LEDGER_STALE` | Thrown by `queueOperation`, `markDispatched` and `switchProject` on a state that is no longer the current state of its lineage |
| `LEDGER_STALE` | Verdict from `completeOperation` on a stale state: `{accepted: false, reason: 'LEDGER_STALE', operationId}` (operationId from the p2a verdict, or `null`), with the unchanged state |
| `LEDGER_INVALID` | Thrown: state not produced by this module (unchanged) |

`completeOperation` still never throws for a result.

## Acceptance checks

- After `switchProject(s1, next)`, a late result on `s1` is refused with
  `LEDGER_STALE`, not accepted.
- `markDispatched(s1, …)`, `queueOperation(s1, …)` and `switchProject(s1, …)`
  throw `LEDGER_STALE`.
- Queuing `op-9` twice from the same base state: the second call throws
  `LEDGER_STALE`, so no two dispatched copies exist.
- A refused result does not advance the lineage; an accepted one does, and the
  state it started from becomes stale.
- Forged states still throw `LEDGER_INVALID`.
- Every p2b test passes unchanged.

## Limits

- The lineage is in memory and per process. Persisting it, and coordinating
  several processes or callers, belongs to the integration.
- A stale state can still be read; only transitions on it are refused.

## Results

Node 22.23.3, local, fictional data only.

- RED: four JD-B-001 tests added to `switch.test.mjs` before changing
  `switch.mjs`; 12 tests, 9 pass, 3 fail:
  - `the pre-switch state is stale and refuses late results and new work` —
    the late result on `s1` returned `reason: 'ACCEPTED'` instead of
    `LEDGER_STALE`;
  - `the same base state cannot be advanced twice, so work is never dispatched
    twice` — `Missing expected exception` (`LEDGER_STALE`);
  - `a refused result does not advance the lineage and an accepted one does` —
    a second result on the pre-completion state was accepted.
  - The forged-state test passed already, as expected.
- GREEN: `switch.test.mjs` 12 tests, 12 pass. No existing test was changed.
- Lab tests on this branch (`node --test lab/target-routing/*.test.mjs`) —
  24 tests, 24 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Only `lab/target-routing/` files changed.
