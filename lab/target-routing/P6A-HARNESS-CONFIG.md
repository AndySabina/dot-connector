# p6a — Harness configuration

Child branch: `target-routing/p6a-harness-config` (PR targets
`target-routing/p6-launch`). Phase: [P6-LAUNCH.md](P6-LAUNCH.md).
Reference code only; not imported by the product and not distributed.

## What this is

`lab/target-routing/harness-config.mjs` exports `validateHarnessConfig(document)`,
which returns a deeply frozen copy of a valid harness configuration or throws
`Error(code)`, and `isHarnessConfig(value)`, which recognizes only those copies.

## Why it exists

The launch order (p6b) must be built from the user's configuration alone. That
configuration has to be closed and checked first: known profiles and agents,
plain argv arrays and no shell as the launched program.

## The problem it solves

- Unknown keys, such as a per-project `mode`: every harness project is
  agent-only, so a mode does not exist and is rejected.
- Programs or arguments with control or bidi characters, empty or oversized.
- Projects that name a missing launch profile or agent, or duplicate ids.
- A shell configured as the program of a profile or agent.
- Hostile inputs whose values could change after validation.

## How

Exact keys everywhere. `schema` is 1 and `version` a non-negative safe integer.
`launchProfiles` (1..16) are `{profileId, kind, argv}` with `kind` `multiplexer`
or `terminal`; `agents` (1..32) are `{agentId, argv, safeModeArgv}`; `projects`
(1..64) are `{machineId, projectId, launchProfileId, agentIds}` with 1..16
unique agent ids. Ids match `^[A-Za-z0-9_-]{1,64}$`. `argv` has 1..16 strings,
`safeModeArgv` 0..16; each string has 1..256 characters and no C0/C1 control,
U+2028/2029 or bidi override (U+202A..202E, U+2066..2069).

Every object and array is read once into a snapshot: own enumerable string-keyed
data properties only, plain prototype, arrays with only index keys plus `length`
and no holes. Getters never run; accessors, symbol keys and any thrown proxy
trap make the input invalid. Fictional example (`herdr run --` is not the real
herdr syntax, and the agent programs are invented):

```js
{schema: 1, version: 4,
  launchProfiles: [{profileId: 'lp-herdr', kind: 'multiplexer', argv: ['herdr', 'run', '--']},
    {profileId: 'lp-term', kind: 'terminal', argv: ['example-term', '--new-window']}],
  agents: [{agentId: 'a-codex', argv: ['codex-example'], safeModeArgv: ['--example-safe']}],
  projects: [{machineId: 'm-alpha', projectId: 'p-shop', launchProfileId: 'lp-herdr', agentIds: ['a-codex']}]}
```

Checks run in this order and the first failure wins:

| Code | When |
|---|---|
| `HARNESS_INVALID` | Wrong shape, key, count, id or argv string; hostile input |
| `HARNESS_DUPLICATE_ID` | Repeated `profileId`, `agentId` or `machineId`+`projectId` |
| `HARNESS_UNKNOWN_PROFILE` | A project's `launchProfileId` is not configured |
| `HARNESS_UNKNOWN_AGENT` | A project's agent id is not in the catalog |
| `HARNESS_SHELL_PROGRAM` | First argv element of a profile or agent is a shell |

Shell basenames are compared case-insensitively after the last `/` or `\`,
ignoring trailing dots and spaces (Windows ignores them) and an optional `.exe`
or `.com`: sh, bash, zsh, fish, dash, ksh, csh, tcsh, cmd, powershell, pwsh,
wsl. So `cmd.`, `CMD.EXE ` and `cmd.com` are refused. Names that only contain
them (`bashful`, `fisher`, `cmdx.exe`) are accepted.

`env` runs its first argument that is not a `NAME=value` assignment, so that
argument is checked as well: `env bash` and `env A=1 /bin/zsh` are refused,
`env NODE_ENV=dev agent-example` is accepted. `env` options (for example `-S`,
which splits one string into a command) cannot be checked and are refused, as
is `env` with no program.

## Acceptance checks

- A valid document with a multiplexer and a terminal profile, two agents (one
  with empty `safeModeArgv`) and three projects yields a deeply frozen copy;
  the input is unchanged and later edits to it do not reach the copy.
- A clone of a result is not recognized; a project `mode` key is invalid.
- Each error code is produced by its case.
- Argv with a control character, bidi override, empty string, 257 characters
  or 17 elements is invalid.
- `bash`, `/bin/sh`, `C:\Windows\System32\cmd.exe`, `PowerShell.EXE`, `pwsh`
  and `wsl` are refused for profiles and agents; `bashful`, `fisher` and
  `cmdline-tool` are accepted.
- Disguised shells are refused: `cmd.`, `CMD.EXE `, `cmd.com`, `env bash`,
  `env A=1 B=2 /bin/zsh`, `env -S 'bash -c x'`, `env --split-string=...`, bare
  `env`, `ENV.EXE pwsh`; `env NODE_ENV=dev agent-example` is accepted.
- A getter (never run), a throwing or revoked proxy, a symbol key, a sparse
  array or an array with an extra property give `HARNESS_INVALID` only.

## Limits

- The shell check is a guard, not a guarantee: a configured program could still
  start a shell itself; other interpreters (python, node, perl), other
  wrappers (busybox, sudo, nohup) and Windows short names are not listed.
- Real CLI flags are user data; nothing here checks that a program exists or
  that it honours its safe-mode arguments.
- The launch order and its execution are p6b and the executor.

## Results

Node 22.23.3, local, fictional data only.

- RED: before `harness-config.mjs` existed, the test file failed with
  `ERR_MODULE_NOT_FOUND` (1 test, 0 pass, 1 fail).
- GREEN: `node --test lab/target-routing/harness-config.test.mjs` — 8 tests, 8 pass.
- Tech-lead review found disguised shells (Windows trailing dots and spaces,
  `.com`, `env` wrappers). RED: the new test failed (8 pass, 1 fail); GREEN
  after the fix: 9 tests, 9 pass.
- `node --test lab/claim-lifecycle.test.mjs lab/console-lab.test.mjs
  lab/target-routing/*.test.mjs` — 26 tests, 26 pass. Other phases' files are
  not on this branch by design.
- `npm run build` exit 0; `npm run check:release` exit 0;
  `npm pack --dry-run` lists no `lab/` file (count 0).
