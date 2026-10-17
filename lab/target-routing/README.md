# Target routing — Stage 2 tracker

> **Status: PROPOSAL — reference only, not deployed.**
> This folder lives under `lab/`, which is excluded from the distributed
> package. Documentation here is a proposal: it is not implemented code and not
> a real connection test. Nothing here connects to real machines, tunnels or
> terminals, installs tools, or changes the user's environment, credentials or
> policies.

## What this is

The design and pure reference code for a **target resolver and policy check**:
given a request and a supplied configuration, it decides whether the request
resolves to exactly one known target (machine, tunnel, project, session) and
whether the supplied policy allows the requested operation there.

## The problem

dot can reach a user's computer through a tunnel and drive a terminal there.
Without a decision layer:

- **Wrong target.** A user may have several computers and projects with the
  same name or the same path on each. Names, the current directory or a
  matching path can send work to the wrong place.
- **Mixed context.** A late result from one project or session can be taken as
  the result of another after a project switch.
- **Unauthorized operations.** Permission granted in one project must not be
  applied to another.
- **Untrusted content.** Terminal output can contain text that looks like
  instructions.

## How it is approached

- Stable identities for machine, tunnel, project and session context. Display
  names, cwd or matching paths never replace identity.
- A tunnel is bound to exactly one machine. Several projects on that machine
  may share it; sharing is allowed, not required.
- Generic per-project permissions: **observe**, **write**, **execute**. A
  permission in one project never grants anything in another.
- Every request resolves to exactly one target or is denied with a reason code.
  Missing permission, ambiguity, unknown targets or a mismatch between project,
  machine, tunnel or session deny by default.
- Results and session state are checked against project, session incarnation
  and configuration version. Results from a previous context are rejected.
- A project switch never treats "cancel" as "undo": an operation already
  dispatched keeps an uncertain outcome and is not repeated.
- Terminal output is treated as untrusted data, never as instructions.

## What it can claim — verifiable statements only

With the supplied configuration and policy, the reference code is meant to
demonstrate that it can:

1. detect inconsistent targets (project, machine, tunnel or session mismatch);
2. deny operations that the supplied policy does not authorize;
3. reject results that belong to a previous context.

It does **not** demonstrate containment of a compromised dot or agent. That
requires an independent execution boundary, which this layer is not.

## Limits

- **Frozen results** prevent accidental mutation of the returned object. They do
  not stop a compromised executor from ignoring the decision. Validating and
  enforcing the decision in the executor is an integration requirement, not a
  guarantee provided by `Object.freeze`.
- **The project/session/incarnation/version binding** is an identity and context
  check. It is not a cryptographic seal, and it is not trusted authorization
  when the values come from the requester.
- **Requester identity** must come from an existing trusted mechanism, never
  from fields the request itself supplies.
- **Paths**: a pure resolver cannot prove symlink, junction, mount or case
  behavior. Those checks belong to the executor against the real filesystem.
- **Output scanning** can only warn after an access; it does not prove
  prevention, and the absence of a path in text does not prove safety.
- Plugin permissions do not replace transport authentication or operating
  system isolation.

## Boundaries

- This feature decides and checks; it is pure code tested with fictional data.
- The executor, the tunnel and the direct shell are owned by the main stage and
  are not modified here. Existing human pause and revocation stay unchanged.

Full task list, deferred items and decisions: [SCOPE.md](SCOPE.md).

## Branch model and plan

Two-level feature branch chain: this tracker (draft PR, never merged upstream),
one parent branch per phase targeting the tracker, and chained child PRs of at
most 400 changed lines each. Full plan, phases and workflow:
[PLAN.md](PLAN.md).

## Work units

| Phase | Branch | Purpose | Status |
|---|---|---|---|
| — | `target-routing/tracker` | Feature tracker, scope and plan | 🚧 Proposal, scope approved with adjustments |
| 0 | (in tracker) | Foundation and short diagnosis: [01-DIAGNOSIS.md](01-DIAGNOSIS.md) | ✅ Done |
| 1 | `target-routing/p1-registry` | Registry and resolution (p1a, p1b): `P1-REGISTRY.md` | 🚧 Children complete; awaiting review |
| 2 | `target-routing/p2-sessions` | Sessions and context (p2a, p2b): `P2-SESSIONS.md` | 🚧 Children complete; awaiting review |
| 3 | `target-routing/p3-paths` | Paths (p3a, p3b, p3c): `P3-PATHS.md` | 🚧 Children complete; awaiting review |
| 4 | `target-routing/p4-decision-log` | Decision log and untrusted output (p4a, p4b): `P4-DECISION-LOG.md` | 🚧 Children complete; awaiting review |
| 5 | `target-routing/p5-reports` | Results, limits and integration proposal (p5a, p5b, p5c): `P5-REPORTS.md` | 🚧 Children complete; awaiting review |

## Base

- Upstream: `osmelpv/dot-connector`, branch `main`, commit `407f942`.
