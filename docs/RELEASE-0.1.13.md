# 0.1.13 experimental

Adds operator-only discovery for owned synthetic bridge instances started with
private configuration. List without connecting, select an explicit incarnation,
validate the human-view handshake, and remove only the owned descriptor after
verified shutdown. No automatic lease, arbitrary terminal adoption, or cloud
transport is introduced. The default plugin remains diagnostic-only.

Shutdown joins pending publication before disposing resources; a signal during
publication cannot subsequently connect MCP or announce ready. Descriptor fields
use strict types, including process start ticks and all binding fields.

Validation: 174 tests, 173 passed, one Windows-only helper test skipped under
Linux. Includes native isolated configuration/publication/view/EOF/SIGTERM,
publication failure, late acquisition and coercible-field regressions. The
two-instance test checks the surviving instance ID, not byte-for-byte descriptor
preservation. Build and release package checks passed.

See [operator discovery](HUMAN-DISCOVERY.md) and [configuration](PRIVATE-CONFIG.md).
Use a separate experimental installation for review. A host MCP command pinned
to an older release does not change when another install root updates; switch it
only through a coordinated host configuration change without interrupting an
active session. Existing instances do not gain discovery retroactively.
