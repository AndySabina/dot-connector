# Harness handoff and work split

> **Work in progress.** This was published to synchronize work and ideas, not
> for merge or approval. Code, tests and docs may still change, and some tasks
> are unfinished on purpose so they can be shared out.

Reference code only, fictional data, nothing integrated or deployed. Nothing
here touches upstream `osmelpv/dot-connector`.

## What each piece is for

| Piece | Purpose |
|---|---|
| Phases 1–5 (done) | Choose the exact machine, tunnel and project; per-project permissions; bind each result to its session; keep paths inside the root; safe decision log and untrusted output |
| `harness-config.mjs` (p6a) | Checks the user's configuration: launch profiles (with herdr or a plain terminal), the agent catalog and the agents allowed per project; refuses shells as programs |
| `launch-order.mjs` (p6b) | Turns that configuration plus a resolved target into the exact command that opens the agent: argv array, root as working directory, safe-mode arguments; dot only picks an allowed agent id |
| p7a gate (planned) | In harness projects dot can only launch, prompt the bound agent session and read its output |
| p8 approvals and guards (planned) | Human approvals for anything outside the project; advisory checks on prompts and output |
| p9 evidence and guide (planned) | Compromised-dot and concurrent-session tests; end-to-end how-it-works guide |

## Validated decisions (product owner, one by one)

1. **Agent-only, no shell mode.** In every harness project dot can launch an
   allowed agent in the exact root, send prompts to it and read its output.
   ⚠️ This **differs from dot's earlier request** that the layer should not
   impose an agent catalog. It is the product owner's decision; please raise
   any concern on PR #1.
2. **Closed launch order.** Built only from the user's configuration; dot only
   picks an agent id from the project's allowed list. Argv arrays, no shell
   string, no interpolation; a shell as the launched program is refused.
3. **Approvals always.** dot requests, only a human grants. Single-use, bound
   to project, session and request digest, expiring, revocable, never change
   grants. The approval channel belongs to the integration.
4. **Advisory guards.** Prompt guard (before) and output watch (after) flag
   and escalate; they are never presented as protection.
5. **Concurrent sessions.** Several projects at once, each with its own agent
   session, context and ledger; every prompt and result is bound to exactly one
   session. This layer cannot stop dot itself from addressing the wrong one.
6. **Adversarial evidence and a guide.** Compromised-dot scenarios as tests,
   and an end-to-end how-it-works guide.

Details and branch layout: [PLAN.md](PLAN.md), section "Harness phases".

## Status

| Task | Branch | State | Owner |
|---|---|---|---|
| Phase 6 doc | `target-routing/p6-launch` | ✅ Done | Andy |
| p6a harness configuration | `target-routing/p6a-harness-config` | ✅ Done: 9 tests, build, release check | Andy |
| p6b launch order | `target-routing/p6b-launch-order` | 🚧 Code and 7 tests green; `P6B-LAUNCH-ORDER.md` and review pending | open |
| p7a agent-only operation gate (with concurrent sessions) | `target-routing/p7a-operation-gate` | ⏳ Not started | open |
| p8a approval ledger | `target-routing/p8a-approval-ledger` | ⏳ Not started | open |
| p8b prompt guard | `target-routing/p8b-prompt-guard` | ⏳ Not started | open |
| p8c output watch | `target-routing/p8c-output-watch` | ⏳ Not started | open |
| p9a adversarial and concurrent tests | `target-routing/p9a-adversarial` | ⏳ Not started; needs 6–8 | open |
| p9b how-it-works guide | `target-routing/p9b-how-it-works` | ⏳ Not started; needs 6–9a | open |

**How to claim a task:** comment on PR #1 with the task name, then set the
Owner column in your first commit. Phase 7 depends on p6b; phase 8 children
are chained (p8a → p8b → p8c); phase 9 builds on `integration-preview`.

## Rules for every child

- At most 400 added plus deleted lines, including docs and tests.
- Doc first, then a failing test (record RED), then code, then GREEN.
- Pure functions in `lab/target-routing/`, no filesystem, network or process.
- Fictional data only; real CLI flags are user data, never invented.
- Hostile input read once through descriptor snapshots; frozen results
  recognized through a WeakSet, as in the existing modules.
- Each child doc: What, Why, Problem, How, Acceptance checks, Limits, Results.
- Draft PRs only, chained to their parent; no force-push, no upstream merge.

## Reproduce

```
git fetch https://github.com/AndySabina/dot-connector.git target-routing/p6b-launch-order
git switch --detach FETCH_HEAD
node --test lab/claim-lifecycle.test.mjs lab/console-lab.test.mjs lab/target-routing/*.test.mjs
npm run build && npm run check:release
```

Last result on p6b (Node 22.23.3): 33 tests, 33 pass; build and release
check exit 0; no `lab/` file in `npm pack --dry-run`.
