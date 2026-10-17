# Phase 3 — Paths

Phase branch: `target-routing/p3-paths` (PR targets `target-routing/tracker`).
**Status: in progress.** Proposal and reference code only; see
[PLAN.md](PLAN.md) for the full chain.

## What this is

Pure functions that interpret a path requested for a project according to the
project's path space (Windows or WSL) and decide, from the text alone, whether
it stays inside the project root.

## Why it exists

Phases 1 and 2 decide which project and session a request belongs to. A path
inside that request can still point elsewhere: `..`, another drive, a network
share, a device namespace or a path written for the other path space.

## The problem it solves

- Relative paths must be resolved against the project root, never against an
  unknown current directory.
- `..` can climb out of the root; a sibling such as `C:\work\shop2` shares a
  text prefix with `C:\work\shop` but is outside it.
- Windows accepts both separators, ignores case by default and has drive
  relative forms (`C:file`), root relative forms (`\file`), UNC shares, device
  namespaces (`\\?\`, `\\.\`), reserved names (`NUL`, `CON`), alternate data
  streams (`file:stream`) and trailing dots or spaces that it strips silently.
- `C:\` and `/mnt/c/` often reach the same files but are never treated as
  equivalent automatically.

## How

`resolveWindowsPath(root, input)` (p3a) and `resolveWslPath(root, input)` plus
the dispatcher `resolvePath(project, input)` (p3b) return a frozen verdict:
`{ok: true, path, relative}` or `{ok: false, reason}`. They never throw and
never touch the filesystem. Ambiguous forms are rejected rather than guessed.

Phase 3 does not import other phases. It receives a root and a path space, the
same fields as the phase 1 target.

## Child PRs

| Child | Branch | Targets | Content | Est. | Status |
|---|---|---|---|---|---|
| p3a | `target-routing/p3a-windows-paths` | `p3-paths` | Windows rules: separators, case, drives, UNC, device namespaces, reserved names, `..` | ~350 | 🚧 In progress |
| p3b | `target-routing/p3b-wsl-paths` | `p3a-windows-paths` | WSL rules, path-space dispatcher, `C:\` ↔ `/mnt/c/` rejection | ~280 | ⏳ Planned |
| p3c | `target-routing/p3c-executor-checks` | `p3b-wsl-paths` | Documentation of checks only the executor can make on the real filesystem | ~120 | ⏳ Planned |

## Limits

A text check cannot prove where a path really leads. Symlinks, junctions,
mount points, per-directory case sensitivity, short (8.3) names and hard links
depend on the real filesystem. p3c documents what the executor must verify
before acting. Plugin checks never replace operating system permissions.
