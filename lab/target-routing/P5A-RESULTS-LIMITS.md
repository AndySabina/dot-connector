# p5a — Results and limits

Child branch: `target-routing/p5a-results-limits` (PR targets
`target-routing/p5-reports`). Phase: [P5-REPORTS.md](P5-REPORTS.md).
Documentation only. Node 22.23.3, local runs, fictional data only.

## Results per child PR

Changed lines are additions + deletions against the parent branch. Native
review assessment was run per child against its parent with committed-only
scope; none required an outside review.

| Child | Commit | Lines | Module | Tests | Assessment |
|---|---|---|---|---|---|
| p1a registry model | `83858ce` | 292 | `registry.mjs` | 7 | medium, not due |
| p1b target resolution | `841e23c`, `2b5bd3f` | 288 | `resolver.mjs` | 11 | medium, not due |
| p2a context binding | `7800755` | 247 | `context.mjs` | 9 | medium, not due |
| p2b project switch | `2bbe000` | 298 | `switch.mjs` | 8 | medium, not due |
| p3a Windows paths | `a3008a6` | 220 | `paths.mjs` | 7 | medium, not due |
| p3b WSL paths | `1b6a19e` | 171 | `paths.mjs` | 5 | medium, not due |
| p3c executor checks | `b3c85bc` | 79 | documentation | — | passive, readback |
| p4a decision log | `9043fe6` | 214 | `log.mjs` | 6 | medium, not due |
| p4b untrusted output | `9a7574d` | 194 | `untrusted.mjs` | 5 | medium, not due |

Every code child observed its tests failing before the module existed (RED),
then passing (GREEN). On every branch, `npm run build` and
`npm run check:release` exited 0, the build manifest had no `target-routing`
entry and `npm pack --dry-run` listed no `lab/` file. No file under `src/`,
`scripts/`, `test/` or `docs/` changed.

Two design gaps were found and fixed inside their own child before commit:
incarnation reuse on a switch back (p2b) and an off-by-two size boundary in a
test (p4b).

## Combined run

The `lab/target-routing/` files of the four phase tips (p1b, p2b, p3c, p4b)
were extracted with `git archive` into a temporary directory outside the
repository: 58 tests, 58 pass, no file conflicts. A throwaway script (not
committed) composed every module with fictional data: ambiguous target denied,
down tunnel denied without fallback, allowed target resolved, path inside
accepted, escape and `/mnt/c` input rejected, switch left the dispatched
operation uncertain, the late result of the previous project was rejected, a
write without permission was denied and output was wrapped as untrusted.

## Original minimum cases → tests

| Case | Evidence |
|---|---|
| Two projects with different permissions on the same tunnel | `resolver.test.mjs`: two projects on the same tunnel keep their own permissions |
| Two machines with matching names or paths | `resolver.test.mjs`: matching names and roots resolve only by machine identity; `context.test.mjs`: same name and root on another machine |
| Missing or denied permission | `resolver.test.mjs`: missing grant and denied operation |
| Unknown or ambiguous target | `resolver.test.mjs`: unknown project, operation or field; ambiguity case |
| Inconsistent identity | `resolver.test.mjs`: inconsistent machine or tunnel; `registry.test.mjs`: tunnels and projects bound to existing machines |
| Project switch and late response | `switch.test.mjs`: late result rejected after the switch; `context.test.mjs`: late result from another project |
| Stale configuration | `resolver.test.mjs`: stale version; `context.test.mjs`: older configuration version |
| Tunnel down without fallback | `resolver.test.mjs`: down tunnel without falling back to another machine |
| Root escapes and Windows/WSL confusion | `paths.test.mjs`: escapes; `paths-wsl.test.mjs`: WSL escapes and both path-space mismatches; `registry.test.mjs`: roots per path space |

## What the code demonstrates

With the supplied configuration and policy:

1. inconsistent targets are detected (machine, tunnel, project, session,
   incarnation and configuration version);
2. operations the supplied policy does not authorize are denied;
3. results that belong to a previous context are rejected.

## What it does not demonstrate

- **Containment of a compromised dot or agent.** That needs an independent
  execution boundary; this layer is not one.
- **Requester identity.** The trusted context is supplied by the caller.
- **Enforcement.** Frozen decisions prevent accidental mutation only; a
  compromised executor can ignore them.
- **Real filesystem behavior.** Links, junctions, mounts, case rules, short names
  and hard links are executor checks (p3c).
- **Injection detection.** Output is labelled untrusted and bounded; text that
  contains instructions is not detected, and the absence of a path in text does
  not prove safety.
- **Tunnel truth.** Tunnel status is a snapshot supplied by the caller.

## Follow-ups found

- Deny entries in the decision log carry no project identifiers, because deny
  decisions have no target. The integration should log the requested,
  validated identifiers separately, marked as requested rather than resolved.
- Phases do not import each other by design; a committed end-to-end test can be
  added once the phases are merged into the tracker.
