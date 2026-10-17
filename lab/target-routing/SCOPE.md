# Target routing — scope

Status: **proposed, pending approval.** Grouped by area, not by order of work.

## A. Baseline

1. Review what exists: private configuration (`src/private-config.mjs`), the
   session binding tuple (`machineId`, `projectId`, `incarnation`, `session`,
   `pane`) and the profile drafts of the configurator branch.
2. Document what is reused, what is missing and the base commit.
3. Document the boundary: the gatekeeper decides; the executor executes and
   cannot change the decision.

## B. Model — stable identities

4. **Machine**: one or many computers per user (work, personal, ...).
5. **Tunnel**: bound to exactly one machine. Projects on the same machine share it.
6. **Project**: machine, root folder and path space (Windows, WSL or Linux).
7. **Agent session**: each open agent CLI, with a unique incarnation.
8. **Configuration versions** and invalidation of stale selections.

Display names, the current directory or matching paths never replace identity.

## C. Launch order — decide, never execute

9. **Launch profiles**: with a terminal multiplexer (for example herdr) and
   without one (plain terminal).
10. **Allowed agent catalog** (for example pi, Gentle Shell, OpenCode,
    Claude Code, Codex), configured by the user.
11. The gatekeeper returns a **closed launch order** (agent, exact root, mode)
    built from the user's configuration, never from dot's text.
12. The order requests the **agent's own safe or sandbox mode** when available.

## D. Resolution and permissions

13. One request resolves to **exactly one target**; unknown or ambiguous targets
    are denied.
14. Deny when machine, tunnel, project and session do not match.
15. Separate per-project permissions: **launch**, **write to agent**, **read from
    agent**. A permission in one project never grants anything in another.
16. Requester identity comes from an existing **trusted mechanism**, never from
    fields inside the request.
17. Existing human **pause and revocation** stay unchanged.
18. Catalog of **named error codes**.

## E. Sessions and context

19. Distinguish **several agent sessions** without mixing their context.
20. **Seal** every request and result with project and session incarnation.
21. **Project switch**: revalidate, cancel or mark pending operations as
    unknown, new session, no carried buffers or permissions.
22. Reject **late responses** from a previous context.
23. **Tunnel down** returns an error; never fall back to another project,
    machine or tunnel.

## F. Paths

24. Normalization per target path space: relative, absolute, `..`, drives, UNC,
    case and separators.
25. `C:\` and `/mnt/c/` are never treated as equivalent automatically.
26. Symlinks and junctions are documented as checks the executor must perform
    against the real filesystem; a pure resolver cannot prove them.

## G. Security — both directions, assuming dot may be compromised

27. **No direct access for dot**: named actions only; no file reads, no free
    commands.
28. **Prompt injection**: terminal output is data, never instructions.
29. **Request filter** for dot's messages that reference anything outside the
    project.
30. **Output watch**: alert or pause when the agent output shows out-of-scope
    paths.
31. **User approval, always**, for anything outside the project. No pre-approved
    lists.
32. **Command injection**: dot's text never becomes part of a command.
33. **Leaks**: no user data in logs, errors or examples.
34. **Decision log** of what dot requested and what was decided.
35. **Honest limits**: what the gatekeeper covers and what depends on the agent
    sandbox, the tunnel and the operating system.

## H. Reference code and tests — fictional data only

36. Pure functions: registry, resolution, permissions, sessions, paths, filters
    and approvals.
37. Minimum cases requested: two projects with different permissions on the same
    tunnel; two machines with matching names or paths; missing or denied
    permission; unknown or ambiguous target; inconsistent identity; project
    switch and late response; stale configuration; tunnel down without fallback;
    root escapes and Windows/WSL confusion.
38. Additional cases: with and without a multiplexer, agent outside the catalog,
    concurrent sessions, injection attempts, and a compromised dot attacking
    directly and through the agent.
39. **Frozen result**: consumers cannot alter the authorized target.

## I. Quality and delivery

40. **QA with evidence** when each child branch closes.
41. Results and limits document.
42. Integration proposal for the plugin and the executor.
43. Every branch documents what it is, why it exists, the problem, the how and
    the purpose.
44. Developer guide stays outside the distributed package (`lab/`).

## Out of scope

- Executing anything: opening the multiplexer or terminal, launching agents,
  tunnels, message transport.
- Mandatory isolation or any change to the user's environment.
- Secret or credential storage.
- Real terminals, machines, tunnel identifiers or private data.

## Decisions

| Decision | Outcome |
|---|---|
| Out-of-scope access | Always requires user approval |
| Security promise | "Very hard, visible and stoppable", not "impossible" |
| OS isolation | Used when present, never required |
| Executor and tunnel | Not part of this feature |
| Multiplexer | Supported with and without (for example herdr) |
| Documentation location | `lab/target-routing/`, outside the package |

## Pending

- Approval of this scope, in particular sections C and G, which extend the
  original stage 2 request.
