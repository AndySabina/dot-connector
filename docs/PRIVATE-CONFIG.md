# Per-user local configuration

CLI and JavaScript API share schema 1 and `src/private-config.mjs`. This is a
local API, not HTTP. The synthetic MCP stdio feature needs NO plugin credentials.
The host manages ChatGPT sign-in and authorizes the local process. Never supply
ChatGPT passwords, cookies, session tokens or API keys to this plugin.

## Setup and manual editing

Inside Linux/WSL with Node 22, from the installed release directory:

```sh
node scripts/private-config.mjs init --file "$HOME/dot-connector-private/config.json" --machine local --project synthetic
node scripts/private-config.mjs check --file "$HOME/dot-connector-private/config.json"
node scripts/private-config.mjs show --file "$HOME/dot-connector-private/config.json"
node scripts/private-config.mjs doctor --file "$HOME/dot-connector-private/config.json" --feature synthetic
```

The parent must exist; init creates a NEW directory 0700 and file 0600 outside
Git and the release tree. It refuses existing destinations; it never changes
existing permissions. `show`, `check`, and `doctor` redact labels, report readiness,
and never start a terminal. Complete manual example without credentials:

```json
{
  "schema": 1,
  "revision": 0,
  "transport": "mcp-stdio",
  "workload": "synthetic-cat",
  "machineId": "local",
  "projectId": "synthetic"
}
```

Edit locally with a trusted editor, stop concurrent config writers, increment
revision and run check. Keep editor backups outside Git. Automated replacement:

```sh
node scripts/private-config.mjs write --file "$HOME/dot-connector-private/config.json" --revision 0 < /absolute/private-draft.json
```

The draft contains the full schema and revision 0; a successful write commits
revision 1. Use the revision reported by show. The shared writer uses exclusive
locking and atomic rename. Interrupted writes may retain lock/pending evidence;
inspect redacted state before recovery; do not automatically retry uncertain writes.
Manual editors and same-UID processes can bypass this cooperative locking.

JavaScript imports: `readConfig`, `writeConfig`, `validateConfig`, `configReadiness`,
`redactedConfig`, `configProblem` from `src/private-config.mjs`.
`readConfig(file)` returns the complete local document; do not log it.
`writeConfig(file, document, expectedRevision)` returns only a redacted summary.
CLI and API use identical validation and format, not separate schemas.

## Errors and authentication

Missing file returns CONFIG_NOT_FOUND, field config.json, init instructions and
this guide. Missing fields and empty/invalid labels fail with actionable fixed
codes. Unknown fields including secrets, apiKey, password and endpoint are
rejected. Inputs are capped at 32768 bytes. Values never appear in errors.
Noninteractive commands do not prompt and fail nonzero. MCP startup validation
errors go only to stderr before session creation; protocol stdout stays empty.

`doctor --feature dot-remote` returns CONNECTION_NOT_IMPLEMENTED and an empty
required-secrets list. No key can fix a missing transport. Future adapters must
specify the real authentication contract and secure setup before being enabled.
Do not paste credentials in chat, command arguments, logs or repository files.

An authorized MCP host may start a NEW paused synthetic session with:

```sh
node scripts/tmux-bridge.mjs --experimental-synthetic --config "$HOME/dot-connector-private/config.json"
```

This is not a diagnostic command or arbitrary shell. Human input grants remain
separate. See [TMUX-BRIDGE.md](TMUX-BRIDGE.md). Trust is in host-owned stdio and
OS user permissions; same-UID processes are trusted. Views are text snapshots,
not lossless VT output. Local computer authorization is not proof of tool delivery.

[Official local plugin packaging](https://developers.openai.com/plugins/build/plugins)
describes catalogs and desktop restart. For remote ChatGPT MCP,
[official connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt)
describes public HTTPS or Secure MCP Tunnel, including private stdio servers.
Neither is configured here; tunnel availability, account policy and authorization
must be established before setup. No speculative tunnel identifier or endpoint
belongs in this config. Existing ChatGPT sign-in remains with the host.

## Source control and removal

Use the external per-user directory. `.private/`, `*.private.json` and existing
.env patterns are ignored as defense in depth; already tracked or forced files
are not protected by ignore rules. Release allowlists exclude private formats.
Never commit local settings or credential material. Upgrades leave external
config untouched. Disable only the separate experimental plugin in its host
before removing its own runtime. Preserve config unless deletion is desired.
Do not remove shared plugin directories or the original connector. Coordinate
any desktop restart first.
