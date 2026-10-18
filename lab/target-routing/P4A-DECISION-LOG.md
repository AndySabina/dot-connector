# p4a — Decision log schema

Child branch: `target-routing/p4a-decision-log` (PR targets
`target-routing/p4-decision-log`). Phase: [P4-DECISION-LOG.md](P4-DECISION-LOG.md).
Reference code only; not imported by the product and not distributed.

## What this is

Three pure functions in `lab/target-routing/log.mjs`:

- `createLogEntry(fields)` validates a log entry against the minimal schema and
  returns a frozen copy.
- `toLogEntry(sequence, kind, source)` picks only allowed fields from an output
  of phases 1 or 2 and builds an entry, dropping everything else.
- `serializeLogEntry(entry)` returns one JSON line with a stable key order.

## Why it exists

Decisions must be auditable without the log itself becoming a copy of what the
feature protects: commands, prompts, terminal output or private paths.

## The problem it solves

- Logging a whole decision object would copy the project root and result data.
- A free-text reason can carry any content, including injected text or paths.
- Multi-line or unordered entries are hard to audit and can be spoofed.

## How

**Entry schema 1** (exact keys; optional keys may be absent):

| Field | Rule |
|---|---|
| `schema` | `1` |
| `sequence` | Non-negative safe integer supplied by the caller |
| `kind` | `resolution`, `result`, `switch` or `path` |
| `decision` | `allow`, `deny`, `accepted`, `rejected`, `cancelled` or `uncertain` |
| `reason` | Fixed code matching `^[A-Z][A-Z0-9_]{1,63}$` |
| `operation` | `observe`, `write`, `execute` or `null` |
| `machineId`, `tunnelId`, `projectId`, `sessionId` | Optional labels `^[A-Za-z0-9_-]{1,64}$` |
| `incarnation` | Optional lowercase UUID |
| `operationId` | Optional label `^[A-Za-z0-9_-]{1,80}$` |

- Any other field, such as `command`, `prompt`, `output`, `data`, `path` or
  `root`, → `LOG_FIELD_FORBIDDEN`. Invalid values → `LOG_INVALID`.
- `toLogEntry` reads `decision`/`reason`/`operation` from a phase 1 decision,
  or `accepted`/`reason`/`operationId` from a phase 2 verdict, plus identifiers
  from `target` or `binding`. It never copies `root`, `pathSpace` or `data`.
- Inputs are read once. `fields`, `source` and a present `target` or `binding`
  are copied into a shallow snapshot before validation, and the entry is built
  only from that snapshot. Only plain objects (prototype `Object.prototype` or
  `null`, not arrays) with own enumerable string-keyed data properties qualify.
  Getters and setters, symbol keys, non-enumerable properties and proxies whose
  traps throw (including revoked proxies) → `LOG_INVALID`. Getters are never
  called, and trap errors never escape. A `target` or `binding` that is absent
  or `null` adds no identifiers.
- Serialization sorts keys and produces a single line; validated values cannot
  contain line breaks.
- No timestamps: ordering comes from `sequence`. Time, storage and retention
  belong to the integration.

## Acceptance checks

- An allow decision becomes an entry with identifiers, decision, reason and
  operation, without root or path space.
- A deny decision without target becomes an entry without identifiers.
- An accepted result verdict becomes an entry without its data, even when the
  data contains instruction-like text and a private-looking path.
- Forbidden fields and unknown fields are rejected; free-text reasons and
  identifiers with spaces or separators are rejected.
- Entries are frozen; inputs are not modified; serialization is one stable line
  that parses back to the same entry.
- A `reason` getter that returns a valid code while being validated and then
  command text with injected JSON produces no entry (`LOG_INVALID`), and the
  getter is never called.
- Getters on other fields, symbol keys, non-enumerable fields, a proxy with a
  throwing `ownKeys` trap and a revoked proxy → `LOG_INVALID`.
- `toLogEntry` with a getter on `source.decision` or on `target.projectId`, or
  with a proxy `binding` whose trap throws → `LOG_INVALID`; no getter is called.

## Limits

- Identifiers are labels chosen by the configuration owner; if they contain
  private names, the log will too. Examples here are fictional.
- A log entry records a decision; it does not prove enforcement.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `log.mjs` existed, `log.test.mjs` failed with
  `ERR_MODULE_NOT_FOUND`.
- GREEN: `node --test lab/target-routing/log.test.mjs` — 6 tests, 6 pass.
- Lab tests on this branch — 23 tests, 23 pass.
- `npm run build` exit 0; `npm run check:release` exit 0.
- Not distributed: `dist/build-manifest.json` has no `target-routing` entry and
  `npm pack --dry-run` lists no `lab/` file.
- No file under `src/`, `scripts/`, `test/` or `docs/` changed.

Review round 2 (Judgment Day): JD-B-008 (`createLogEntry` validated
`fields[k]` and then read it again to build the entry, so a changing getter
could register command text and injected JSON). The fix adds a single-read
snapshot (`plain`) and builds entries only from it. RED: with the previous
`log.mjs`, the three new tests failed (`not ok 7 - a reason getter that changes
after validation produces no entry`, `not ok 8 - getters, symbol keys, hidden
fields and proxy traps are rejected as LOG_INVALID`, `not ok 9 - toLogEntry
rejects getters and throwing proxies in sources as LOG_INVALID`, each with
`Missing expected exception`): 9 tests, 6 pass, 3 fail. GREEN:
`node --test lab/target-routing/log.test.mjs` — 9 tests, 9 pass;
`node --test lab/target-routing/*.test.mjs` — 9 tests, 9 pass. `npm run build`
exit 0; `npm run check:release` exit 0.
