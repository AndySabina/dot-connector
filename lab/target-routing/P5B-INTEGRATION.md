# p5b — Integration proposal

Child branch: `target-routing/p5b-integration` (PR targets
`target-routing/p5a-results-limits`). Phase: [P5-REPORTS.md](P5-REPORTS.md).
Documentation only. This is a proposal for a later, separately reviewed stage;
nothing here is integrated, deployed or connected.

## What this is

How the plugin and the executor of the main stage could consume the reference
contract of phases 1 to 4, what each side must do, and what stays open.

## Proposed flow

```
plugin request ──► trusted context ──► resolveTarget ──► deny: reason code to dot
 (no identity)     (transport-authenticated         │
                    principal, observed tunnels)    └─► allow: frozen decision
                                                          │
executor (main stage) ◄───────────────────────────────────┘
  1. re-validates the decision against its own registry and version
  2. creates the session context (existing incarnation) and ledger
  3. resolvePath + filesystem checks (p3c) for every path
  4. existing human pause and input epoch checks, unchanged
  5. dispatches; results go through checkResult / completeOperation
  6. result data through wrapUntrusted; decisions through toLogEntry
```

## Requirements for the executor

1. **Validate and enforce every decision itself.** A frozen object is not a
   guarantee; the executor must recompute or verify the target against its own
   registry before acting.
2. **Use only the decided tunnel, machine, project and root.** Never fall back
   to another target when anything is down or ambiguous.
3. **Check the configuration version at dispatch time**, not only at
   resolution time.
4. **Apply the filesystem checks of p3c** on handles beneath the real root.
5. **Keep existing controls unchanged**: human pause, `INPUT_ENABLED` epochs,
   fresh-snapshot rules and revocation in `src/connector.mjs` still apply, after
   these checks and never replaced by them.
6. **Never retry uncertain operations.** Report them to the user.
7. **Authenticate the transport** so result origin is established by the
   transport, not by the binding text.

## Requirements for the plugin

1. Send only the request: `projectId`, `operation` and, when known,
   `machineId` and `tunnelId`. Never a requester identity.
2. Have no path to change a decision: resolution runs where the plugin cannot
   modify inputs or outputs, and the executor re-validates anyway.
3. Present output only inside the untrusted envelope.

## Mapping to existing code

| This feature | Existing code | Proposed change for the integration stage |
|---|---|---|
| Registry (p1a) | `src/private-config.mjs` schema 1 (`machineId`, `projectId`, `revision`) | A new schema version with machines, tunnels, projects and grants; `revision` becomes the configuration version. No secrets or tunnel identifiers that are private. |
| Grants | Configurator profile permissions (unmerged branch) | `read_files`/`read_output` → observe, `modify_files` → write, `execute` → execute |
| Session context (p2a) | Binding tuple in `src/tmux-bridge.mjs` (`machineId`, `projectId`, `incarnation`, `session`, `pane`) | Add `tunnelId` and `configVersion`; keep `BINDING_MISMATCH` |
| Incarnation | `randomUUID()` in `src/tmux-session.mjs` | Reuse as the session incarnation |
| Untrusted output (p4b) | Snapshot warning in `src/connector.mjs` | Same warning, plus the structural envelope |

## Integration tests to add later

- A committed end-to-end test once the phases are merged into the tracker,
  replacing the throwaway combined run of p5a.
- Executor tests on a real temporary directory for links, junctions and case
  rules, run only in an isolated environment.

## Open decisions

| Topic | Owner |
|---|---|
| Trusted requester identity mechanism | Main stage (transport) |
| Semantic filter of dot's messages | User decision |
| Output monitor for out-of-scope paths | User decision |
| Mandatory approval without pre-authorization | User decision |
| Launch profiles and agent catalog (former section C) | Future proposal |
| Log storage, retention and requested identifiers on denials | Integration stage |

## Delivery of this chain

Children merge into their phase, phases merge into `target-routing/tracker`.
The tracker PR stays a draft and is never merged upstream; any upstream
integration is a separate, later review.
