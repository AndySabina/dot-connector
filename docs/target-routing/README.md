# Target routing — Stage 2 tracker

> **Status: DRAFT — reference only, not deployed.**
> Nothing in this feature connects to real machines, tunnels or terminals,
> installs tools, or changes real credentials or policies. Any real integration
> will be reviewed separately later.

## Purpose

Today the connector works with one implicit target: one machine, one project,
one owned pane. This feature designs the layer that lets the plugin select a
project and resolve it to exactly one authorized target — machine, tunnel,
project root and session — before anything reaches a transport.

It is a **decision layer**, not a transport. Terminal-to-terminal connection
and shell execution are owned by a separate stage and are out of scope here.

## Goals

1. **Reuse before creating.** Build on the existing private configuration,
   binding tuple and profile drafts; no parallel registry.
2. **Minimal model.** Stable identities for machine, tunnel, project and
   session context. Display names, cwd or matching paths never replace identity.
3. **Resolution and permissions.** Every request resolves to a single
   authorized target or is denied. Deny by default on missing permission,
   ambiguity or any project/machine/tunnel/session mismatch. Observe, write and
   execute are separate permissions, scoped per project.
4. **No context mixing.** Requests, results and session state are bound to the
   project and its session incarnation. Explicit project switch, stale-response
   rejection, no carried buffers or permissions, no automatic fallback when a
   tunnel is down.
5. **Paths.** Normalization per target machine (Windows or WSL). `C:\` and
   `/mnt/c/` are never treated as equivalent automatically. Filesystem checks
   that a pure resolver cannot prove are documented as executor duties.
6. **Reference code and tests.** Pure registry/resolution/policy functions with
   fictional data only.

## Non-goals

- Transports, tunnels, terminal connection or shell execution.
- Secret storage or credential handling.
- Changes to the current connection test, human pause or revocation controls.
- Real tunnel identifiers, private paths or private terminals in examples or logs.

## Branch model

This branch (`target-routing/tracker`) is the parent of the feature. It holds
only this tracker and the shared design documents. Each specific piece of work
gets its own child branch created from this one:

```
main
└── target-routing/tracker          (this branch)
    ├── target-routing/<NN>-<topic> (one per work unit)
    └── ...
```

Rules for child branches:

- Created from the current tip of `target-routing/tracker`.
- Each child adds its own section under `docs/target-routing/` describing its
  purpose, tasks, acceptance checks and results.
- Code, tests and documentation of the same behavior stay in the same branch.
- Each child is reviewed and merged back into the tracker; the tracker is
  proposed to `main` only when the feature is complete.

## Work units

| # | Branch | Purpose | Status |
|---|--------|---------|--------|
| — | `target-routing/tracker` | Feature tracker and branch model | 🚧 Draft |

Child branches will be listed here as they are created.

## Base

- Upstream: `osmelpv/dot-connector`, branch `main`, commit `407f942`.
