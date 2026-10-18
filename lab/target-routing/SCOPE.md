# Target routing — scope

Status: **approved with adjustments** for sections A, B, D, E, F, H and the
reports of I. Section C is a future proposal. Section G is reduced. Grouped by
area, not by order of work.

## A. Baseline

1. Review what exists: private configuration (`src/private-config.mjs`), the
   session binding tuple (`machineId`, `projectId`, `incarnation`, `session`,
   `pane`) and the profile drafts of the configurator branch.
2. Document what is reused, what is missing and the base commit.
3. Document the boundary: this layer decides; the executor must validate and
   enforce the decision.

## B. Model — stable identities

4. **Machine**: one or many computers per user.
5. **Tunnel**: bound to exactly one machine. Several projects on that machine
   may share it; sharing is allowed, not required.
6. **Project**: machine, root and path space (Windows or WSL), plus an
   operation policy.
7. **Session context**: project, session and incarnation.
8. **Configuration versions** and invalidation of stale selections.

Display names, the current directory or matching paths never replace identity.

## D. Resolution and permissions

9. One request resolves to **exactly one target**; unknown or ambiguous targets
   are denied.
10. Deny when project, machine, tunnel or session do not match.
11. Generic per-project permissions: **observe**, **write**, **execute**. No
    requirement that dot only talks to agents from a catalog.
12. Requester identity comes from an existing trusted mechanism, never from
    fields inside the request.
13. Existing human pause and revocation stay unchanged and are not extended.
14. Catalog of named reason codes.

## E. Sessions and context

15. Bind requests, results and session state to project, session incarnation
    and configuration version. This is an identity and context check, not a
    cryptographic seal or trusted authorization.
16. **Project switch**: revalidate; no carried buffers or permissions.
17. Pending operations: cancelling is not undoing. A dispatched operation keeps
    an uncertain outcome and is never repeated automatically.
18. Reject late results from a previous context.
19. **Tunnel down** returns an error; never fall back to another project,
    machine or tunnel.

## F. Paths

20. Normalization per target path space: relative, absolute, `..`, drives, UNC,
    case and separators.
21. `C:\` and `/mnt/c/` are never treated as equivalent automatically.
22. Symlinks, junctions and mounts are documented as checks the executor must
    perform against the real filesystem; a pure resolver cannot prove them.

## G. Security — reduced

23. Terminal output is **untrusted data**, never instructions.
24. **Structured validation** of every input (exact keys, bounded values).
25. **Explicit limits**: what this layer can and cannot demonstrate.

## H. Reference code and tests — fictional data only

26. Pure functions: registry, resolution, per-project permissions, sessions and
    paths. No transports and no access to a real remote disk.
27. Minimum cases: two projects with different permissions on the same tunnel;
    two machines with matching names or paths; missing or denied permission;
    unknown or ambiguous target; inconsistent identity; project switch and late
    response; stale configuration; tunnel down without fallback; root escapes
    and Windows/WSL confusion.
28. Frozen results, documented as protection against accidental mutation only.

## I. Reports

29. Short diagnosis of what exists.
30. Decision log schema: fictional identifiers, decision and reason code. No
    commands, prompts, output content or private paths by default.
31. Results and limits, including what depends on real filesystem checks.
32. Integration proposal: the executor must validate and enforce the decision.

## Verifiable claims

With the supplied configuration and policy, the code is meant to demonstrate:

- detection of inconsistent targets;
- denial of operations the supplied policy does not authorize;
- rejection of results from a previous context.

It does not demonstrate containment of a compromised dot or agent; that needs
an independent execution boundary.

## C. Launch order — added by user decision (phases 6 and 7)

Launch profiles (with or without a multiplexer such as herdr), an agent catalog
and closed launch orders remain a proposal for a later stage. Nothing here
implements them or makes an agent catalog mandatory.

## Former pending user decisions — added by user decision (phase 8)

- Semantic filter of dot's messages.
- Output monitor for out-of-scope paths (it could only warn after an access).
- Mandatory approval for out-of-scope access with no pre-authorizations.

None of these may modify existing authorizations on this layer's initiative.

## Out of scope

- Executing anything, tunnels, transports, the direct shell and the current
  connection test.
- Mandatory isolation or any change to the user's environment.
- Secret or credential storage.
- Real terminals, machines, tunnel identifiers or private data.
- Merges or integration upstream; PR #13.

## Decisions

| Decision | Outcome |
|---|---|
| Permissions | Generic observe, write, execute per project |
| Tunnel sharing | Allowed, not required |
| Claims | Verifiable statements only; no containment claim |
| Frozen result | Accidental-mutation protection; executor must enforce |
| Context binding | Identity and context check, not authorization |
| Cancel vs undo | Dispatched operations stay uncertain and are not repeated |
| Section C | Future proposal |
| Documentation location | `lab/target-routing/`, outside the package |
