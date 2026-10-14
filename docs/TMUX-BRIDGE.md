# Experimental MCP snapshot bridge (disabled by default)

This implements a bounded request/response bridge and a local human text view
over one owned synthetic tmux session. It does not establish a cloud connection,
a network tunnel, a VT byte stream or an interactive project shell. The installed
plugin entrypoint and manifests remain diagnostic-only and unchanged.

## Transport decision

The existing private plugin uses MCP stdio, not a network listener. The separate
`scripts/tmux-bridge.mjs` entrypoint reuses that supported protocol and installed
SDK. It adds no destination URL, shell execution tool, arbitrary socket attach,
credential, service or network permission. A host must explicitly launch it with
`--experimental-synthetic MACHINE_LABEL SYNTHETIC_PROJECT_LABEL`. Without that
flag it exits before creating any terminal. Labels are scope checks, not proof
of a physical machine or access to a project directory.

The host's MCP connection must legitimately permit launching this local server
and exchanging its tool calls. Existing cloud coordination/local execution is not
proof that the cloud desktop can consume this protocol or render a shared view.
No tunnel through an unrelated API, file service, messaging channel or blocked
network path is implemented. Do not register or expose this experimental server
without reviewing the target host's supported connection and permissions.

## Authority and binding

There are two endpoints with fixed roles. The host-owned MCP stdio endpoint is
the agent/observer. It has five tools: `bridge_status`, `bridge_read`,
`bridge_input`, `bridge_operation`, `bridge_cancel`. There is no grant, role
change, attach, arbitrary command or stop tool. Agent input needs an explicit
local human grant, current generation, latest agent snapshot and unique operation
ID. The local human Unix socket is created inside the private session directory,
mode 0600, allows one connected human and supports grant/pause/input/stop.
Its path is printed on stderr for the operator, never mixed into MCP stdout.

Authentication is inherited from the trusted host-owned stdio pipe and OS user
permissions of the local socket. This does NOT authenticate a remote cloud user
or resist another process of the same UID. A same-UID process can use the human
socket or modify the broker. No secrets are generated. Do not claim this is an
authenticated remote service or expose the human socket to an untrusted agent.
The host must authorize who owns the stdio pipe; this code cannot identify the
human behind an arbitrary remote MCP client.

Every read/control/write carries machine label, project label, session
incarnation and tmux session/pane IDs. A mismatch fails closed. Underlying
mutations retain the reviewed PID/start-time, socket inode/device and unique
session-name checks, plus the recipient-side tmux guard. These checks do not
make labels credentials or prevent a same-UID attacker.

## Data, sequence and uncertainty

`bridge_read` returns a complete current escaped text snapshot, a monotonic
sequence, generation and fresh snapshot ID. Maximum screen text is 8192 UTF-8
bytes. Controls, OSC/escape and bidi formatting are escaped before display.
When that budget truncates history, it keeps the newest suffix so the latest
prompt remains visible. Cuts preserve whole Unicode code points and escaped
control tokens, but may start within a line or grapheme cluster. The human CLI
always displays `truncated=true/false`; a change in that flag redraws the view
even when its text is unchanged. Backend truncation is also propagated.
No received output is executed or interpreted as instructions or terminal codes.
The text is still untrusted application data. The sequence numbers order bridge
snapshots, NOT PTY bytes. A stale cursor yields `resync:true` and the number of
intervening snapshots, not fabricated missing output. Future/invalid cursors fail.
Intermediate application output can be lost even without a sequence gap.

Only the latest agent read authorizes that agent's input; human views use a
different backend observation slot. Human input/disconnect and cancellation
revoke the agent's authority. Paste and Enter remain separate; no queue or replay.
Backend operation IDs remain capped at 256 for a session. If input outcome is
uncertain, query `bridge_operation`; never resend with the same or a new ID to
simulate a retry. Backend uncertainty blocks subsequent input until closure.

MCP stdin frames are capped at 16 KiB before parsing; stdout frames at 32 KiB,
pending output at 64 KiB, outstanding requests at four, writes at eight, ingress
at 64 messages/second. Failed framing/limits close the transport. Writes time out
after three seconds and close rather than accumulating retries. Local human IPC
has 4 KiB request and 32 KiB response limits, four in-flight requests, one client.

`bridge_cancel` revokes future/pending writes and reports an operation phase. It
cannot revoke a pending human input: while the human owns that gate, an agent
cancellation reports human priority without changing its generation. The local
human may still explicitly pause. Human arrival already revoked agent authority.
Cancellation
does not retract dispatched bytes, send Ctrl-C or stop the application. Human
stop and MCP transport EOF/SIGTERM initiate verified owned-session shutdown.
Directories are retained for inspection; tests remove only fixtures after
verified stop. Startup/identity/exit uncertainty retains evidence rather than
claiming cleanup. An MCP timeout is not proof that a tool's side effect was undone.

A human reconnect receives no grant automatically. Recreating the MCP process
creates a NEW tmux session/incarnation; previous bindings fail. This is no-replay
recovery by starting fresh, not session adoption. There is no network resumption
token or reconnect to an orphaned server.

## Shared text view and validation

For an explicitly authorized local synthetic experiment, a real MCP client may
launch the opt-in server. Using the human socket reported on stderr:

```sh
node scripts/tmux-bridge-view.mjs SOCKET
```

The human view polls snapshots every 500 ms and prints changed text. Commands:
`/read`, `/grant` (five-second lease), `/pause`, `/paste TEXT`, `/submit`, `/stop`,
`/quit`. Pasting never sends Enter. `/quit` disconnects the human and revokes the
grant; server shutdown remains with the owning MCP host. `--once` reads one view
then disconnects. It is a textual snapshot console, not a VT emulator: no cursor
motion reproduction, resize, raw keyboard forwarding or lossless stream.
The MCP view and human view address the same underlying pane. A future cloud
renderer must use this explicit snapshot schema and show its limits; it must not
claim to be the existing Xfce terminal or another PTY.

```sh
DOT_TMUX_LAB_TEST=1 node --test --test-concurrency=1 --test-timeout=30000 test/tmux-bridge.test.mjs test/tmux-bridge-native.test.mjs
```

Pure tests use transport/session doubles. Native tests use real MCP stdio and
local human IPC, grants/revocation, Unicode snapshots, replay rejection, human
reconnect, new-process incarnation mismatch and verified shutdown. Full-suite
backend replacement/race regressions remain applicable. None proves cloud
reachability. Current run results belong in the accompanying execution evidence.

## Remaining connection work

Built: experimental tool protocol, bounded stdio transport, local human view and
binding to the reviewed synthetic backend. Pending: independent review, explicit
host registration of this entrypoint, proof of legitimate cloud-to-local tool
delivery, and a cloud-side view/client. No current tool in this local task grants
access to the cloud Xfce terminal or supplies a private endpoint. If that requires
new credentials, persistent access, software installation, service publication,
network/firewall/policy changes, obtain specific authorization first. The default
plugin stays paused and cannot start this bridge merely by being installed.
