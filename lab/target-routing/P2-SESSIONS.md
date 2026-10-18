# Phase 2 — Sessions and context

Phase branch: `target-routing/p2-sessions` (PR targets
`target-routing/tracker`). **Status: in progress.** Proposal and reference code
only; see [PLAN.md](PLAN.md) for the full chain.

## What this is

Pure functions that keep each request, result and piece of session state bound
to one project and one session incarnation, and that define an explicit
project switch.

## Why it exists

Phase 1 decides where a request goes. Phase 2 makes sure that what comes back
belongs to the context that asked for it. Without it, a slow result from one
project can be taken as the result of another after a switch, and pending
operations can be lost, repeated or carried into the wrong project.

## The problem it solves

- A late result from a previous project, session or configuration version.
- An operation already dispatched before a switch: it cannot be undone, and
  repeating it could act twice.
- Buffers or permissions carried from one project to the next.

## How

A **session context** combines an allowed target from phase 1 (`machineId`,
`tunnelId`, `projectId`, `pathSpace`, `root`, `configVersion`) with a
`sessionId` and an `incarnation`. Both are supplied by the caller, for example
from the existing session creation, which uses a random UUID as incarnation
(`src/tmux-session.mjs:255`). This phase does not generate them.

- Requests carry a binding copied from the current context.
- Results are accepted only when their binding matches the current context
  exactly; otherwise they are rejected with a reason code.
- A project switch builds a new context from a newly resolved target; it never
  reuses the previous one.

The binding is an **identity and context check**. It is not a cryptographic
seal and not trusted authorization when its values come from the requester.

Phase 2 does not import phase 1 code. It accepts a target with the same shape
as the phase 1 decision and validates it itself, so both phases can be reviewed
independently. Joining them belongs to the integration proposal (phase 5).

## Child PRs

| Child | Branch | Targets | Content | Est. | Status |
|---|---|---|---|---|---|
| p2a | `target-routing/p2a-context-binding` | `p2-sessions` | Session context, request binding, late-result rejection | ~260 | ✅ [P2A-CONTEXT-BINDING.md](P2A-CONTEXT-BINDING.md) |
| p2b | `target-routing/p2b-project-switch` | `p2a-context-binding` | Explicit switch: revalidation, pending operations stay uncertain and are not repeated, nothing carried over | ~320 | ✅ [P2B-PROJECT-SWITCH.md](P2B-PROJECT-SWITCH.md) |

## Limits

- Matching bindings show that a result claims the current context; they do not
  prove where it really came from. Transport authentication does.
- Results are untrusted data; accepting a result never turns its content into
  instructions.
- Cancelling is not undoing: the real effect of a dispatched operation is
  unknown to this layer.
