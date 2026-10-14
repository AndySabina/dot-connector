# Local human discovery (0.1.13 experimental)

The experimental bridge started with `--config /absolute/private/config.json`
publishes a local descriptor in `instances/<incarnation>.json` beside that config.
Existing running versions do not gain descriptors retroactively. No adoption,
process attachment, host task identity, or automatic restart is attempted.
Label-only startup keeps its previous explicit socket workflow.

Run these commands locally in WSL using the same Unix account and source/release:

```sh
node scripts/tmux-instances.mjs list --config /absolute/private/config.json
node scripts/tmux-bridge-view.mjs --config /absolute/private/config.json --instance UUID --once
node scripts/tmux-bridge-view.mjs --config /absolute/private/config.json --instance UUID
node scripts/tmux-instances.mjs prune --config /absolute/private/config.json --instance UUID
```

List returns instance IDs, binding labels and availability, never socket paths.
Selection is mandatory even with one instance; no newest-instance heuristic.
Listing does not connect to a socket, revoke a lease or grant one. Opening the
human view does take human priority (revoking agent authority); only the explicit
`/grant` command grants five seconds. The viewer checks the complete handshake
binding against the selected descriptor before requesting output or control.
The existing direct `SOCKET [--once]` syntax remains for explicit legacy use.

The registry is operator-only and is never included in MCP tool responses.
No new transport, secrets, config fields, network listeners or host task mapping
are introduced. Stderr readiness remains diagnostic, not the discovery channel.
Descriptors contain socket identity, broker PID and Linux process start ticks;
they are private local state, not suitable for sharing or committing to Git.

New directories/files use 0700/0600. Existing permissions are validated, never
changed. Config and registry must be canonical private directories outside Git.
Descriptors reject symlinks, nonregular files, multiple links, foreign ownership,
broad permissions, invalid schemas and files over 4096 bytes. Socket parent,
ownership, permissions, type and inode/device are checked without connecting.
The registry refuses directories with more than 64 entries; keep the small local
registry clean. Concurrent starts may reach this limit together; later discovery
fails closed if it is exceeded. This is a cooperative same-UID trust model, not
protection from malicious code running as the operator. Path checks and removal
are not atomic against malicious same-UID directory replacement.

`available` means the recorded broker process incarnation and socket metadata
match; it does not prove socket responsiveness or a functioning terminal.
`stale` means the broker process incarnation is gone. `unavailable` means its
process exists but socket validation failed. `invalid` records require local
operator inspection; the CLI will not follow or delete unsafe entries.

Verified normal shutdown removes only the descriptor that the bridge published.
Shutdown joins pending socket/publication acquisition before disposal. A signal
during publication prevents MCP connection/ready and removes the late descriptor
after verified stop. Process-start ticks and every binding field must be strings;
coercible values are invalid and cannot be pruned as stale.
Failed or unverified shutdown retains evidence. Explicit prune only deletes a
validated descriptor whose broker is provably gone; it does **not** stop a tmux
server or prove that a pane exited. Never use prune as terminal cleanup.
Do not retry input after an uncertain result. Registry failures stop new bridge
startup through its existing owned-session cleanup path; no active host session
is touched. Publication may briefly appear invalid while its bounded file is
being written; rerun list, never infer authority from it.

Validation includes isolated filesystem fixtures, synthetic Unix listeners and
opt-in native cat/tmux sessions with EOF/SIGTERM and failed-publication cleanup.
The installed v0.1.12 host session must remain untouched until a separately
authorized upgrade/restart. Windows native ConPTY and direct cloud access are
outside this WSL operator-discovery change.
