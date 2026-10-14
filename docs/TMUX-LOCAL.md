# Opt-in local tmux synthetic backend

**Current validation: 136 passed, 0 failed, 1 Windows-only test skipped.** The
corrected sources and expanded tests ran in a fresh isolated Linux copy on
2026-10-13, including six native tmux integrations. Build and distribution checks
exited 0. The outer runner exited 1 because it retained a Node compile cache;
subsequent inspection found no tmux fixtures or sockets. That runner result is
not a clean PASS. Nothing has been integrated, installed or activated; independent
review and a separate integration decision remain required.

This unit is an isolated development entrypoint, not an enabled terminal plugin.
The existing diagnostic MCP entrypoint, native adapters, profiles and installation
remain unchanged. No cloud GUI connection is implemented or proven.

## What is implemented

`src/tmux-session.mjs` owns a fresh tmux server on a unique Unix socket and exactly
one synthetic `/bin/cat` pane. It uses `/usr/bin/tmux`, an empty config file,
a minimal environment and a newly created private temporary working directory.
It never discovers or adopts an existing tmux server, pane or active application.
There is no TCP listener, SSH, remote connection, package install or service setup.

`src/tmux-local.mjs` exposes local Unix-domain JSONL IPC. `scripts/tmux-lab.mjs`
provides a standalone broker and local clients. Each connected client receives
the same machine/project labels, session incarnation, tmux session ID and pane ID.
The owned server and cat process are additionally bound to PID plus Linux process
start time, socket device/inode and a UUID-bearing tmux session name. Session and
pane numbers alone are never sufficient to authorize input or kill-server.
Labels identify the synthetic scope; they do not resolve a real project, prove a
machine identity, or establish multi-machine trust. The project bridge contract
is not duplicated here.

Clients begin as observers. A cooperative human client may grant an observer a
lease for 1–5000 milliseconds, revoke it, send its own input, or stop the owned
session. Each grant, revoke, expiry and relevant disconnect changes the generation.
Agent input requires the current lease and a fresh snapshot from that generation.
Snapshot expiry is 5 seconds. Input requires a unique operation ID. Paste is
literal UTF-8 text up to 256 bytes without controls; Enter is a separate `submit`.

There is no input queue. One operation may be pending validation/journaling or
dispatching; overlapping calls return `BUSY_NO_QUEUE`. Revoke discards pending
authority before dispatch, clears snapshots and returns immediately. A human
input arriving during pending agent input revokes that agent operation but gets
`BUSY_NO_QUEUE` itself; the UI must show that it was not accepted. No background
retry is performed. A write already dispatching can complete after revoke.
Revoking does not undo executed commands or recall terminal input already queued
by tmux/the kernel. A new human line can encounter partial agent text.

Results distinguish `dispatched` (tmux acknowledged), `unknown` (dispatch began
but no reliable acknowledgement), and `revoked` (not dispatched by this broker).
Dispatched does not prove application consumption or success. Unknown blocks all
further input and grants until stop; never resend the same operation or its suffix.
The client does not retry after transport loss. Use `operation` with the original
ID to inspect retained in-memory status when transport remains available.

Operation IDs are retained for the lifetime of the session, capped at 256; then
new input fails closed with `OPERATION_LIMIT`. Exclusive metadata-only markers
are also written before dispatch. They are not fsync-backed crash recovery and
do not claim exactly-once effects. Restart/adoption/recovery is unsupported: a
new broker creates a different session and never replays old input. An old broker
crash can leave its owned tmux server running; do not automatically adopt it,
remove its directory, or reuse its journal.

`snapshot` is bounded text from the same pane (at most 120 history rows plus the
24-row screen, 16,000 output characters). It is not a lossless event stream and
can miss transient output between polls. Treat text as untrusted. There is no
VT renderer, automatic prompt recognition, resize API or streaming resync in this
unit. tmux subprocess output is capped at 64 KiB; capture overflow fails explicitly.
There are at most eight clients, four concurrent snapshots, eight requests per
connection, 4 KiB incoming frames, 32 KiB outgoing frames and bounded socket backlog.
Frame limits apply to each complete record and the unfinished fragment, regardless
of transport chunk boundaries. Several valid frames in one chunk are accepted.
A framing/schema rejection or destroyed connection terminates parsing immediately;
later records in that chunk and subsequent chunks cannot dispatch commands.

## Cooperative priority and security limits

The human role is declared by the connecting local client. A private directory
(0700) and sockets (0600 for broker IPC) restrict access to this OS user, but do
not distinguish programs running as that user. The same user can impersonate a
human client, directly invoke tmux, edit files or kill processes. This is not an
OS security boundary or authenticated remote protocol. Do not register it as an
untrusted agent tool or expose its socket across user boundaries.

Human priority is checked only for requests passing through this broker.
Ordinary keyboard typing in another tmux client is not detected or fenced. No
global hook, physical keyboard monitoring, focus change or input injection is
implemented. Two cooperating clients share a pane; two arbitrarily attached
clients do not gain strict input exclusion. A product UI must send human input
through the broker and show explicit ownership/uncertainty before claiming more.

## Reproduce the disposable local test

Prerequisites used for validation: Linux/WSL2, Node 22.23.3 and tmux 3.4
at `/usr/bin/tmux`. This unit has no new dependency. From an isolated checkout:

```sh
DOT_TMUX_LAB_TEST=1 node --test --test-concurrency=1 --test-timeout=30000 --test-reporter=tap test/tmux-session.test.mjs test/tmux-review.test.mjs test/tmux-local.test.mjs
```

The real integration tests launch two separate CLI client processes against
one broker, compare snapshots of the same pane, paste a synthetic marker, submit
separately, reject replay and unauthorized operations, revoke, and verify stop.
They also reject oversized IPC frames and stale authority after reconnect.
Native regressions cover literal Unicode hexadecimal input, replacement before
input admission, and replacement after successful preflight but before launching
the actual recipient guard, separately for input and stop.
The fixture only runs `cat`, not a project shell or AI CLI. Tests clean only
their generated temporary directory, and only after verified owned-session stop.
Without `DOT_TMUX_LAB_TEST=1`, native tmux tests are explicitly skipped; pure
state-machine tests still run. This avoids opening sessions in ordinary test runs.

For an explicitly chosen manual lab session, start:

```sh
node scripts/tmux-lab.mjs serve lab-machine synthetic
```

Copy the emitted socket path into each of two local terminal windows:

```sh
node scripts/tmux-lab.mjs client SOCKET_PATH human
node scripts/tmux-lab.mjs client SOCKET_PATH observer
```

These clients present JSON responses; they are not full terminal GUI emulators.
Each prints its client ID. The observer can request `{"action":"status"}` or
`{"action":"snapshot"}`. On the human client send a grant using the observer ID:

```json
{"action":"grant","clientId":"OBSERVER_ID","ttlMs":5000}
```

Fetch a fresh observer snapshot and use its snapshot ID plus returned generation:

```json
{"action":"input","operationId":"example-paste-1","kind":"paste","text":"SYNTHETIC","generation":1,"snapshotId":"FRESH_ID"}
```

The generation is an example: copy the actual value. If the short lease expires,
grant again and obtain another snapshot; do not resend any uncertain operation.
Observe both clients, then issue `{"action":"revoke"}` from the human client.
After the final observation issue `{"action":"stop"}` there. Quit client stdin
with EOF and stop the broker process with Ctrl+C. The broker's own Ctrl+C is an
explicit lifecycle shutdown, not a terminal key sent to another application.

## Stop semantics and rollback

`stop` closes the dispatch gate, increments generation, invalidates pending input,
waits for the owned outstanding input operation, and kills only its private tmux
server after validating the original server/pane process identities and socket.
Both send and kill use a second recipient-side tmux `if-shell -F` guard: PID,
pane PID, unique session name and session/pane IDs must match on the server which
actually receives that command. The branch is evaluated as a tmux format without
executing a shell. Paste is encoded as fixed hexadecimal bytes (`send-keys -H`)
so text cannot become syntax in the guarded command string. This addresses a
socket replacement between the broker preflight and native command connection.

A changed or unavailable owner fails closed with `identity_lost`; the broker does
not send input or kill the new socket occupant and does not claim verified stop.
Before initial ownership is established, a startup failure never blindly invokes
kill-server for cleanup: retain the directory for explicit inspection. The UUID
name is a cooperative incarnation label, not a credential; a malicious same-UID
process can still modify/spoof this implementation and is outside its boundary.
The encoding and guard passed the native regressions recorded below. These
deterministic cases do not prove every race or protect against a malicious same UID.

After an authorized stop it checks previously captured `/proc` PID/start-time identities for
the server and synthetic cat process. An absent/replaced PID or zombie state
confirms that original process exited. The result is `stopped, verified:true`
only with that evidence; otherwise `stop_unverified, verified:false`. A response
from `kill-server` alone is insufficient. Repeat stop returns the same result.
No automatic force escalation or cleanup follows unverified stop.

This proof covers only the owned synthetic server and cat pane; it does not prove
all arbitrary descendants stopped or roll back command effects. The IPC broker
stays alive after the stop request so clients can read status. Its own SIGINT or
SIGTERM repeats the same stop and closes local IPC. Manual lab state is retained
for inspection, including on a verified shutdown. No automatic crash recovery.

Rollback does not involve configuration: close this lab's broker after verified
stop and leave the existing diagnostic plugin as it was. Remove only the exact
generated lab directory after verifying it belongs to this run and stop was
verified. If using a detached development worktree, keep/export the diff first;
remove that exact worktree only when its changes are no longer needed. Do not
reset/stash the main checkout or delete another tmux socket/claim. No project,
profile, service, firewall, SSH configuration or registry rollback is needed.

## Verification record before independent review (historical)

Validated on WSL2 Ubuntu with Node 22.23.3 and tmux 3.4. The isolated worktree ran
`DOT_TMUX_LAB_TEST=1 npm run verify` with npm offline: build/syntax checks, 121
tests (120 pass, 0 fail, 1 Windows-only probe skipped), and package checks passed.
The final test duration was 6471.305934 ms. Thirteen tests belong to this unit,
including two real tmux tests with separate local client processes.

The initial full run found two packaging failures caused by the development
worktree's dependency symlink, and a process-exit verification race. The worktree
now has a private dependency copy; `/proc` ENOENT/ESRCH during process exit are
handled as disappearance. Both initial failed-session socket leftovers were
subsequently checked: no listener remained. Their directories were retained,
not automatically deleted after the earlier unverified result. The final tests
verified stop and cleaned their own fixtures.

No claim of cloud connectivity follows from this local test. The previous
native/WezTerm adapters and installed plugin remain unchanged and paused; this
entrypoint is not imported by them.

## Current Linux verification record (2026-10-13)

After an explicitly authorized, approved WSL probe succeeded, the corrected
minimal suite passed 26/26 tests, including three native integrations. Three more
native tests were then added without changing production code. The previous
isolated checkout was verified at the expected base with no tracked changes;
its local dependency directory was verified before copying it into a fresh
isolated checkout. No network access or dependency installation was used.

The complete applicable suite used Node 22.23.3, tmux 3.4, MCP SDK 1.27.1 and
zod 3.25.76, with private HOME, TMPDIR and npm cache and npm offline:

- Build/syntax: exit 0; 59 files checked/hashed. C# was hashed, not compiled.
- Tests: 137 total, 136 passed, 0 failed, 1 skipped; test process exit 0;
  duration 17748.064955 ms. The skipped test was
  `real Windows identity helper binds to this live Node caller repeatedly`.
- Distribution check: exit 0, including offline npm pack dry-run and heuristic scan.
- All six native tmux tests passed. The expanded local unit has 29 tests.

Unicode coverage included accents, Chinese, emoji, a combining character and
literal tmux/shell-looking punctuation. The full string appeared unchanged
without replacement characters, and separate submit was acknowledged.
For each new race test, a test-only interception held the real command launch
after successful ownership preflight and the final fence. It replaced only the
owned synthetic server, reused session/pane IDs, then sent the original real
`if-shell` guard. Input was rejected without its marker appearing; stop was
rejected while the replacement remained alive. Independently bound replacement
cleanup verified process exit in both cases.

The outer runner returned **exit 1**, despite all three command phases returning
0: its strict empty-TMPDIR check found `node-compile-cache`. Follow-up inspection
found only that cache, zero tmux fixture directories and zero sockets. Native
cleanup assertions passed. The cache, checkout and logs were preserved. The
runner criterion was neither changed nor rerun; its exit 1 remains part of the
record and must not be described as an overall green runner result.

The review delivery preserves raw TAP/build/distribution logs, versions, source
hashes, cleanup inspection, the raw phase result and a separately interpreted
result. Those source hashes identify the code and tests actually run. A later
documentation-only update records this outcome; it does not imply another run.

This validates a cooperative local synthetic component. It does not establish
cloud transport, two cloud interfaces sharing a session, same-UID authentication,
physical keyboard priority outside the broker, lossless output streaming, session
adoption/recovery or cancellation of arbitrary descendants. The race tests force
specific interleavings, not every possible race. Review before any integration.

## Review regression commands

On Windows, without starting tmux or using WSL:

```text
node --test --test-timeout=10000 --test-reporter=tap test/tmux-session.test.mjs test/tmux-review.test.mjs test/tmux-local.test.mjs
```

On an explicitly permitted Linux execution, run the same tests with
`DOT_TMUX_LAB_TEST=1`. One real integration regression replaces only its own
disposable tmux server at the same socket, verifies that session/pane IDs recycle,
and asserts that the replacement receives neither input nor stop. This regression
and the three additional Unicode/post-preflight regressions passed in the current
Linux suite; the earlier Windows-only correction was an intermediate stage.

The replacement fixture records its creation attempt before starting tmux and
binds the replacement's process/socket identity before asserting recycled IDs.
Cleanup uses that replacement binding, never the original broker as a fallback
after a replacement attempt. If capture, ownership validation or exit verification
fails, it reports an explicit retained directory/identity and fails the test;
it does not silently delete the evidence or kill an unverified socket occupant.
Three Windows simulations cover either recycled-ID assertion failing, incomplete
identity capture and ownership changing before cleanup.

After local review and only from an authorized Linux checkout containing these
corrected files, the bounded test command is:

```sh
DOT_TMUX_LAB_TEST=1 node --test --test-concurrency=1 --test-timeout=30000 --test-reporter=tap test/tmux-session.test.mjs test/tmux-review.test.mjs test/tmux-local.test.mjs
```

This installs nothing and changes no security policy. It creates only the local
synthetic fixtures described above. Passing this command alone is not approval
to integrate. The complete applicable Linux suite and remaining limits are
recorded above; Windows simulation results are not substitutes for native tests.

Primary implementation references consulted for the native guard:
[tmux 3.4 conditional-format implementation](https://raw.githubusercontent.com/tmux/tmux/3.4/cmd-if-shell.c)
and [literal hexadecimal input implementation](https://raw.githubusercontent.com/tmux/tmux/3.4/cmd-send-keys.c).
