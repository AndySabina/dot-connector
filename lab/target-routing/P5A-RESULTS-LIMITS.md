# p5a — Results and limits

Child branch: `target-routing/p5a-results-limits` (PR targets
`target-routing/p5-reports`). Phase: [P5-REPORTS.md](P5-REPORTS.md).
Documentation only. Node 22.23.3, local runs, fictional data only.

## Results per child PR

Changed lines are additions + deletions against the parent branch. Native
review assessment was run per child against its parent with committed-only
scope; none required an outside review.

| Child | Head | Lines | Module | Tests | Assessment |
|---|---|---|---|---|---|
| p1a registry model | `a5a2f37` | 298 | `registry.mjs` | 7 | medium, not due |
| p1b target resolution | `2612f56` | 288 | `resolver.mjs` | 11 | medium, not due |
| p2a context binding | `7800755` | 247 | `context.mjs` | 9 | medium, not due |
| p2b project switch | `2bbe000` | 298 | `switch.mjs` | 8 | medium, not due |
| p3a Windows paths | `2bd6c9a` | 227 | `paths.mjs` | 7 | medium, not due |
| p3b WSL paths | `5d322e9` | 171 | `paths.mjs` | 5 | medium, not due |
| p3c executor checks | `8fe2387` | 79 | documentation | — | passive, readback |
| p4a decision log | `9043fe6` | 214 | `log.mjs` | 6 | medium, not due |
| p4b untrusted output | `2a95632` | 313 | `untrusted.mjs` | 11 | medium, not due |
| p5c composition | `314a1f5` | 173 | `composition.test.mjs` | 7 | see p5c |

Every code child observed its tests failing before the module existed (RED),
then passing (GREEN). On every branch, `npm run build` and
`npm run check:release` exited 0, the build manifest had no `target-routing`
entry and `npm pack --dry-run` listed no `lab/` file. No file under `src/`,
`scripts/`, `test/` or `docs/` changed.

Two design gaps were found and fixed inside their own child before commit:
incarnation reuse on a switch back (p2b) and an off-by-two size boundary in a
test (p4b).

## Combined run

Committed in p5c (`composition.test.mjs`) on `target-routing/integration-preview`,
a branch that only merges the phase tips: 71 tests, 71 pass. The composition
tests cover registry → resolver → paths, resolver → context → switch,
validation → output envelope and decisions → log. With the pre-review modules
they fail on both review findings; with the fixed modules they pass.

## Review round 1 (dot)

| Finding | Fix | Evidence |
|---|---|---|
| `untrusted.mjs` let array extra properties and accessors through; size and copy used different views | One canonical snapshot from own data descriptors is validated, measured and frozen; extras, accessors, hidden and symbol keys and throwing proxies are rejected | 5 regressions failed first (RED), then passed |
| Same module (found while fixing) | Work bounded before measuring; no quadratic index lookup | A test counting element reads failed with 70001 reads; 40000 elements went from 5945 ms to 47 ms |
| Registry rejected UNC roots while `paths.mjs` accepted them | UNC roots are unsupported in both: a share is not on the declared machine | The `paths.mjs` UNC test failed first (RED); the registry test pins the shared contract |
| Composition only shown by a throwaway script | Committed composition tests (p5c) | 7 tests; they fail against the pre-review modules |

Fixes reached child branches by merge, without rewriting published history.

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
| Root escapes and Windows/WSL confusion | `paths.test.mjs`: escapes; `paths-wsl.test.mjs`: WSL escapes and both path-space mismatches; `registry.test.mjs`: roots per path space; `composition.test.mjs`: paths resolved only inside the decided root |

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
- Phases do not import each other by design; composition is tested on the
  preview branch (p5c) rather than inside each phase.
