# Target routing — development plan

Status: **proposal.** Planning only; phases are implemented one child PR at a
time. Nothing is merged or integrated upstream, and PR #13 is not touched.

## Delivery strategy

Feature branch chain with two levels, on the fork:

- `target-routing/tracker` is the feature branch. Its PR is a **draft that is
  never merged upstream**.
- Each **phase** is a parent branch whose PR targets the tracker.
- Each **subphase** is a child PR. The first child targets its phase branch;
  later children target the previous child.
- Every PR stays within **400 changed lines** (additions + deletions), tests and
  documentation included.
- Merge order: child → phase → tracker.

Base: `osmelpv/dot-connector` default branch `main`, commit `407f942`. Branch
names use hyphens (`p1a-...`) because Git cannot hold both `x` and `x/y` refs.

```
main (407f942)
└── target-routing/tracker                    draft, never merged upstream
    ├── target-routing/p1-registry            → tracker
    │   ├── target-routing/p1a-registry-model     → p1-registry
    │   ├── target-routing/p1b-target-resolution  → p1a-registry-model
    │   └── target-routing/p1c-resolver-hardening → p1b-target-resolution
    ├── target-routing/p2-sessions            → tracker
    │   ├── target-routing/p2a-context-binding    → p2-sessions
    │   ├── target-routing/p2b-project-switch     → p2a-context-binding
    │   └── target-routing/p2c-ledger-lineage     → p2b-project-switch
    ├── target-routing/p3-paths               → tracker
    │   ├── target-routing/p3a-windows-paths      → p3-paths
    │   ├── target-routing/p3b-wsl-paths          → p3a-windows-paths
    │   └── target-routing/p3c-executor-checks    → p3b-wsl-paths
    ├── target-routing/p4-decision-log        → tracker
    │   ├── target-routing/p4a-decision-log       → p4-decision-log
    │   └── target-routing/p4b-untrusted-output   → p4a-decision-log
    ├── target-routing/p5-reports             → tracker
    │   ├── target-routing/p5a-results-limits     → p5-reports
    │   └── target-routing/p5b-integration        → p5a-results-limits
    └── target-routing/integration-preview    merges the phase tips only; no PR
        └── target-routing/p5c-composition        → integration-preview
```

## Phases

Line counts are estimates of additions + deletions per child PR.

### Phase 0 — Foundation ✅

Tracker, scope and short diagnosis ([01-DIAGNOSIS.md](01-DIAGNOSIS.md)). Part of
the tracker PR; no separate phase branch.

### Phase 1 — Registry and resolution (`p1-registry`)

| Child | Content | Est. |
|---|---|---|
| `p1a-registry-model` | `validateRegistry`: machines, tunnels, projects, per-project grants, configuration version; tests and doc | ~280 |
| `p1b-target-resolution` | `resolveTarget`: single target, ambiguity, inconsistent identity, permissions, stale version, tunnel down without fallback, trusted requester; tests and doc | ~330 |

### Phase 2 — Sessions and context (`p2-sessions`)

| Child | Content | Est. |
|---|---|---|
| `p2a-context-binding` | Bind results to project, session incarnation and configuration version; reject late results | ~260 |
| `p2b-project-switch` | Explicit switch: revalidate, pending operations stay uncertain and are never repeated, no carried buffers or permissions | ~320 |

### Phase 3 — Paths (`p3-paths`)

| Child | Content | Est. |
|---|---|---|
| `p3a-windows-paths` | Drives, UNC, case, separators, relative paths and `..` for Windows targets | ~350 |
| `p3b-wsl-paths` | WSL paths, no automatic `C:\` ↔ `/mnt/c/` equivalence, root escapes | ~280 |
| `p3c-executor-checks` | Documentation: symlink, junction and mount checks the executor must perform on the real filesystem | ~120 |

### Phase 4 — Decision log and untrusted output (`p4-decision-log`)

| Child | Content | Est. |
|---|---|---|
| `p4a-decision-log` | Minimal schema: fictional identifiers, decision, reason code; no commands, prompts, output content or private paths by default | ~250 |
| `p4b-untrusted-output` | Output handled as untrusted data: structured validation and explicit limits | ~220 |

### Phase 5 — Reports (`p5-reports`)

| Child | Content | Est. |
|---|---|---|
| `p5a-results-limits` | Results of all tests and what cannot be demonstrated | ~200 |
| `p5b-integration` | Integration proposal: the executor must validate and enforce every decision | ~200 |

Totals: 5 implementation phases, 13 planned child PRs.

### Added during review

| Child | Why | PR |
|---|---|---|
| `p5c-composition` | Review round 1 (dot): committed composition tests across phases, on `integration-preview` | #18 |
| `p1c-resolver-hardening` | Review round 2 (own Judgment Day): registry roots and resolver fixes, kept apart so p1a and p1b stay within 400 lines | #19 |
| `p2c-ledger-lineage` | Review round 2: only the current ledger state can advance | #20 |

Final total: 16 child PRs, all within 400 changed lines.

## Harness phases (added by the user's product decision)

The approved scope covered target selection, permissions, context and paths.
The user then decided to also build the **harness**: in projects that choose
it, dot can only launch the configured agent CLI in the exact project root and
then talk to that agent. These phases implement former section C and the full
section G of SCOPE.md, with the same rules: pure reference code, fictional data,
no execution, nothing integrated.

Design decisions (1 to 4 and 6 validated by the user one by one; 5 added by the tech lead after the user's question about concurrent work):

1. **Agent-only.** Every harness project is `agent-only`: dot can launch an
   allowed agent in the exact root, send prompts to that agent and read its
   output. There is no shell mode. This is the user's product decision and
   differs from dot's earlier request not to impose an agent catalog; the final
   report must state it.
2. **Closed launch order.** Built only from the user's configuration: launch
   profile (with a terminal multiplexer such as herdr, or a plain terminal),
   agent catalog entry and the project root. dot only picks an agent id from the
   project's allowed list. Program and arguments are arrays; no shell string,
   no interpolation, never text sent by dot. A shell as the launched program is
   refused. Real CLI flags are user data, not invented here.
3. **Approvals always.** Anything outside the project needs a human decision.
   dot can request but never grant. Approvals are single-use, bound to
   project, session and request digest, expire, are revocable and never change
   grants. The approval channel belongs to the integration.
4. **Advisory guards.** The prompt guard (before a prompt reaches the agent)
   holds prompts with out-of-scope references for approval; the output watch
   (after the agent answers) recommends a pause. They do not prevent anything
   and are never presented as protection.
5. **Concurrent sessions.** Several projects can be worked on at the same time;
   each has its own agent session, context and ledger, and nothing is shared
   between them. This layer cannot stop dot itself from sending a prompt meant
   for one project to another; it guarantees that every prompt and result is
   bound to exactly one session.
6. **Adversarial evidence and a guide.** Compromised-dot scenarios run across
   all phases as tests, and an end-to-end guide explains how every piece works
   and what each one does not protect.

```
target-routing/tracker
├── target-routing/p6-launch               → tracker
│   ├── target-routing/p6a-harness-config      → p6-launch
│   └── target-routing/p6b-launch-order        → p6a-harness-config
├── target-routing/p7-agent-gate           → tracker
│   └── target-routing/p7a-operation-gate      → p7-agent-gate
├── target-routing/p8-approvals            → tracker
│   ├── target-routing/p8a-approval-ledger     → p8-approvals
│   ├── target-routing/p8b-prompt-guard        → p8a-approval-ledger
│   └── target-routing/p8c-output-watch        → p8b-prompt-guard
└── target-routing/integration-preview     merges phase tips only
    ├── target-routing/p9a-adversarial         → integration-preview
    └── target-routing/p9b-how-it-works        → p9a-adversarial
```

| Child | Content | Est. |
|---|---|---|
| `p6a-harness-config` | Validate launch profiles (multiplexer or plain terminal), agent catalog and each project's launch profile and allowed agents | ~300 |
| `p6b-launch-order` | Build the closed, frozen launch order: argv arrays, exact root as working directory, agent safe-mode arguments from the catalog | ~280 |
| `p7a-operation-gate` | In every harness project allow only launch, send prompt to the bound agent session and read its output; reject raw execution and terminal control sequences; a prompt after the agent session ended is refused ; several agent sessions can be open at once, each prompt is bound to exactly one session and its results can only complete that session | ~320 |
| `p8a-approval-ledger` | Request, decide (human only), consume once; bound, expiring, revocable; never changes grants | ~300 |
| `p8b-prompt-guard` | Flag references outside the project in dot's prompts (absolute paths, other drives, UNC, `..`, home and environment shortcuts) so they require approval; advisory | ~280 |
| `p8c-output-watch` | Flag out-of-scope paths in agent output and recommend a pause; after the fact, advisory | ~220 |
| `p9a-adversarial` | Compromised-dot scenarios across all phases: direct access, via the agent, injection, replay, stale approvals, and several concurrent sessions receiving each other's results | ~300 |
| `p9b-how-it-works` | End-to-end guide of how every piece works and fits together, with diagrams and worked examples | ~300 |

## Workflow for every child PR

1. **Document first** in this folder: what it is, why, the problem, how, tasks
   and acceptance checks.
2. **Tests first** with fictional data; observe them fail.
3. **Implement** pure code with no dependencies, filesystem, network or
   transport until the tests pass.
4. **QA with evidence**: `node --test lab/target-routing/`, plus
   `npm run build` and `npm run check:release` unchanged, and no file of this
   folder in the distributed package.
5. **Record results** in the child's document.
6. **PR body**: start, end, prior dependencies, follow-up work, out-of-scope
   items and a dependency diagram marking the current PR with 📍.

If a child grows beyond 400 lines, it is split once more along a cohesive
boundary before review; tests, comments and docs are never trimmed to fit.

## Out of scope for every phase

Executing anything, tunnels, transports, the direct shell, the current
connection test, launch profiles and agent catalogs (future proposal), secret
storage, real terminals or private data, and merges or integration upstream.
