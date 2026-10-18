# Phase 6 — Harness configuration and launch order

Phase branch: `target-routing/p6-launch` (PR targets `target-routing/tracker`).
**Status: in progress.** Reference code only; see [PLAN.md](PLAN.md).

## What this is

Pure functions that describe how a project is opened in harness mode: which
launch profile (inside a terminal multiplexer such as herdr, or in a plain
terminal), which agent CLI from the user's catalog, and the exact project root.
The result is a closed, frozen launch order that the executor can run as is.

## Why it exists

In the harness every project is `agent-only`: the only thing dot may start on
the user's machine is a configured agent. If dot could choose the program, its arguments or the
folder, it could start anything. The launch order must therefore be fully
determined by the user's configuration.

## The problem it solves

- dot choosing an arbitrary program, arguments or working directory.
- Text from dot ending up inside a command line (command injection).
- An agent that is not allowed for that project.
- Users with and without a terminal multiplexer.

## How

- Configuration (p6a): launch profiles, an agent catalog and, per project, a
  launch profile and the allowed agents. There is no shell mode. Programs and arguments are arrays of plain strings; real CLI flags
  are user data.
- Launch order (p6b): profile argv + agent argv + optional safe-mode argv from
  the catalog, with the project root as working directory. No string is built,
  joined or interpolated, and nothing comes from dot except the agent id, which
  must be in the project's allowed list.

Phase 6 does not import other phases. It reads the phase 1 target shape.

## Child PRs

| Child | Branch | Targets | Content | Est. | Status |
|---|---|---|---|---|---|
| p6a | `target-routing/p6a-harness-config` | `p6-launch` | Harness configuration validation | ~300 | ✅ [P6A-HARNESS-CONFIG.md](P6A-HARNESS-CONFIG.md) |
| p6b | `target-routing/p6b-launch-order` | `p6a-harness-config` | Closed launch order builder | ~280 | 🚧 Code and tests done (7/7); doc P6B and full QA pending |

## Limits

- The executor still has to start the process without a shell, in the given
  working directory, and verify that the started process is the declared one.
- Safe-mode arguments only help if the agent honours them; they are not an
  isolation boundary.
