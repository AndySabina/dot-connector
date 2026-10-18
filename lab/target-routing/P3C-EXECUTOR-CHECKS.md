# p3c — Executor filesystem checks

Child branch: `target-routing/p3c-executor-checks` (PR targets
`target-routing/p3b-wsl-paths`). Phase: [P3-PATHS.md](P3-PATHS.md).
Documentation only; no code. It describes requirements for the executor owned
by the main stage, not something implemented here.

## What this is

The list of checks that only the executor can make, because they depend on the
real filesystem of the target machine. The pure resolvers of p3a and p3b decide
from text alone; their `ok` verdict is a **precondition, not proof** that a
path stays inside the project root.

## Why it exists

A path can look inside the root and still lead elsewhere. The text does not
show links, junctions, mounts, short names, hard links or per-directory case
rules. Without these checks, a project root can be escaped with a single link
created inside it.

## The problem it solves

- `C:\work\shop\docs` may be a junction to another folder.
- `/home/dev/blog/data` may be a symlink to `/etc` or a bind mount.
- The root itself may be a link that moved after configuration.
- A check made on a path string can be invalidated before the file is opened.

## Checks the executor must make

1. **Resolve the real root once per session.** Open the root and read its final
   path (Windows: `GetFinalPathNameByHandleW`; Linux: `realpath` or
   `/proc/self/fd`). Refuse if the root is itself a symlink, junction or other
   reparse point, or if it no longer matches the configured root.
2. **Resolve beneath the root, on handles.** Open the target relative to the
   root handle without following links: Linux `openat2` with
   `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS`, or
   component-by-component `openat` with `O_NOFOLLOW`; Windows component by
   component with `FILE_FLAG_OPEN_REPARSE_POINT`, refusing any component with
   `FILE_ATTRIBUTE_REPARSE_POINT`.
3. **Verify the final path of the opened handle** starts with the real root
   followed by a separator, using the comparison rule of that filesystem.
4. **Act on the verified handle**, never on the path string again. A check
   followed by a second open by name is a time-of-check to time-of-use gap.
5. **Case rules.** On Windows, a directory can be case sensitive
   (`fsutil file queryCaseSensitiveInfo`); on WSL, DrvFs mounts accept a
   `case=` option. Compare final paths with the rule of the real directory.
6. **Short names.** 8.3 names (`SHOP~1`) are resolved by reading the final long
   path of the handle; never compare short and long forms as text.
7. **Mounts and volumes.** Compare the device of the target with the device of
   the root (Linux `st_dev`; Windows volume serial) and refuse crossings unless
   the policy allows them. Network shares and bind mounts count as crossings.
8. **`/mnt/c` mapping.** Read the real DrvFs mount point and options from
   `/proc/mounts` when needed; never infer that `/mnt/c` is `C:\`.
9. **Hard links.** A file inside the root can share content with a file outside
   it. Paths cannot show this; for writes, check the link count
   (`st_nlink` or `nNumberOfLinks`) when the policy requires it.
10. **New files.** Verify the parent directory as above, then create with
    exclusive creation (`O_CREAT | O_EXCL | O_NOFOLLOW`, Windows `CREATE_NEW`)
    so an existing link is not followed.
11. **Fail closed.** Any check that cannot be completed denies the operation; no
    retry against another path, project, machine or tunnel.

## Limits

- These checks run with the operating system user's permissions. They do not
  replace operating system isolation, account separation or transport
  authentication.
- They describe the executor's duties; nothing in this feature enforces them.
  The integration proposal (phase 5) lists them as integration requirements.

## Results

Documentation only. QA: build, release check and package contents unchanged;
see the PR body for the evidence of this branch.
