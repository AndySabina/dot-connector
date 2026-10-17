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
