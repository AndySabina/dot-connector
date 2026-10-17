# p5c — Composition tests

Child branch: `target-routing/p5c-composition` (PR targets
`target-routing/integration-preview`). Phase: [P5-REPORTS.md](P5-REPORTS.md).
Reference code only; not imported by the product and not distributed.

## What this is

`lab/target-routing/composition.test.mjs`: committed, reproducible tests that
run the phases together with fictional data, replacing the throwaway script
used for the first report.

## Why it exists

Review of the chain (dot) asked for composition evidence saved in a branch,
especially registry → resolver → paths and validation → output envelope. The
phases do not import each other by design, so the tests need a branch where all
of them exist.

## The base branch

`target-routing/integration-preview` starts from `target-routing/tracker` and
only merges the tips of the five phases. Its only own change is the README
work-unit table, resolved to the real status of each phase. Every module and
test file in it is byte-identical to its phase branch. It is a preview for
these tests, not a merge of the PRs: nothing is merged upstream.

## What is covered

| Composition | Test |
|---|---|
| registry → resolver → paths | Paths resolve only inside the decided root; escapes and both path-space confusions are rejected |
| registry → resolver → paths | The resolved path is identical on two machines while machine and tunnel differ: the path never identifies the machine |
| registry → resolver → paths | Denied and down-tunnel requests carry no target to resolve against |
| registry ↔ paths | One root contract: a UNC share is rejected by both; every registry root is accepted by `resolvePath` |
| resolver → context → switch | The decided target opens a session as is; after a switch the late result is rejected |
| validation → output envelope | Accepted data is wrapped untrusted; hostile data accepted by `checkResult` is refused by `wrapUntrusted` |
| decisions → log | Entries carry identifiers and reasons, never roots or data |

## Reproduce

From any clone of `dot-connector`, with Node 22:

```sh
git fetch https://github.com/AndySabina/dot-connector.git target-routing/p5c-composition
git switch --detach FETCH_HEAD
node --test lab/target-routing/*.test.mjs
npm run build && npm run check:release
npm pack --dry-run --json | grep -c '"lab/'   # expected: 0
```

No dependency is installed and nothing connects to a network, terminal or
remote disk.

## Results

Node 22.23.3, local.

- `composition.test.mjs`: 7 tests, 7 pass.
- Mutation check: with the pre-review modules (`untrusted.mjs` at `9a7574d`,
  `paths.mjs` at `1b6a19e`) copied into a temporary directory, the UNC contract
  and hostile-output tests fail (5 pass, 2 fail); with the fixed modules all 7
  pass. The composition tests catch both review findings.
- All lab tests on this branch: 71 tests, 71 pass. `npm run build` and
  `npm run check:release` exit 0; `npm pack --dry-run` lists no `lab/` file.

## Limits

- The preview branch shows the phases together for testing; reviewing each
  phase still happens in its own PRs.
- These tests compose pure functions. They are not a connection test and do not
  exercise an executor, a tunnel or a real filesystem.
