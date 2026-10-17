# Target routing — Stage 2 tracker

> **Status: DRAFT — scope pending approval. Reference only, not deployed.**
> This folder lives under `lab/`, which is excluded from the distributed
> package. Nothing here connects to real machines, tunnels or terminals,
> installs tools, or changes the user's environment, credentials or policies.

## What this is

The design and pure reference code for a **gatekeeper**: the layer that
decides, for every request from dot, whether it is allowed, exactly where it
goes, and in which agent session — before anything reaches the executor.

## The problem

dot can reach a user's computer through a tunnel and drive a terminal there.
Without a decision layer, that access is effectively unlimited:

- **Wrong target.** A user may have several computers (work, personal) and
  projects with the same name or the same path on each. Names, the current
  directory or a matching path can send work to the wrong place.
- **Mixed context.** Several agent sessions can be open at once. A late
  response from one project can be taken as the result of another.
- **Out of scope.** dot could act outside the requested project, directly or
  by asking the agent CLI to do it for it. This matters most if dot itself is
  compromised: it must not be able to reach private files unrelated to the task.
- **Untrusted content.** Terminal output can carry prompt injection aimed at dot.

## How it is solved

- dot never receives a free shell. It can only use **named actions**: launch an
  allowed agent CLI in the exact project root, write to that agent, and read
  from it. The agent does the work; dot only orchestrates it.
- Every request resolves to **exactly one authorized target** (machine, tunnel,
  project, session) or is denied. Ambiguity, missing permission or any identity
  mismatch denies by default.
- The launch order is built from the **user's own configuration** (agent
  catalog, launch profile with or without a terminal multiplexer such as herdr),
  never from text sent by dot.
- Requests and results carry a **seal** (project + session incarnation). Project
  switches revalidate everything and late responses are rejected.
- Anything outside the project **always requires user approval**.
- The decision is returned **frozen**: the executor consumes it but cannot
  change the target.

## Why — and the honest promise

The goal is to keep dot's work **truthful and inside the requested scope**
without changing the user's environment.

Without operating-system isolation, no plugin can make out-of-scope access
strictly impossible: the agent CLI runs with the user's permissions. The promise
of this feature is therefore **"very hard, visible and stoppable"**:

- use the agent's own safe or sandbox mode when the agent offers one;
- filter dot's requests and watch the agent's output for out-of-scope paths;
- require user approval, keep the existing human pause and revocation;
- record every decision, and document the limits plainly.

Users who need a hard guarantee must add isolation themselves; this layer uses
it when present and never requires it.

## Boundaries

- **This feature decides and authorizes.** It is pure code tested with
  fictional data.
- **The executor and the tunnel are owned by another stage.** Opening the
  multiplexer or terminal, launching the agent and transporting messages are
  out of scope here.

Full task list, out-of-scope items and decisions: [SCOPE.md](SCOPE.md).

## Branch model

This branch (`target-routing/tracker`) is the parent of the feature. Each work
unit gets a child branch created from it:

```
main
└── target-routing/tracker          (this branch)
    ├── target-routing/<NN>-<topic> (one per work unit)
    └── ...
```

- Children start from the current tip of the tracker.
- Each child documents its purpose, tasks, acceptance checks and results in
  this folder.
- Code, tests and documentation of the same behavior stay in the same branch.
- Each child closes with QA and evidence, then merges back into the tracker.
  The tracker is proposed upstream only when the feature is complete.

## Work units

| # | Branch | Purpose | Status |
|---|--------|---------|--------|
| — | `target-routing/tracker` | Feature tracker, scope and branch model | 🚧 Draft, scope pending approval |

Child branches are defined after the scope is approved.

## Base

- Upstream: `osmelpv/dot-connector`, branch `main`, commit `407f942`.
