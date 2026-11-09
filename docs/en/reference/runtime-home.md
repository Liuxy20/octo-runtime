# Runtime Home ownership and migration

[简体中文](../../zh-CN/reference/runtime-home.md) | [SDK integration](../getting-started/sdk.md)

`createKernelService({ home, endpoint, adapters })` requires an explicit absolute Home directory already prepared by the host. Construction performs no I/O. Initialization validates Home before starting logs, ownership, identity, or listeners. SDK has no default Home, does not expand `~`, does not create the root, and never selects a replacement. Runtime-owned files and subdirectories may be created after validation.

Electron and other products choose their own directory, such as their deliberate userData/Application Support/AppData location or a user-selected directory. Host code prepares it before calling SDK:

```ts
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";

await app.whenReady();
const home = join(app.getPath("userData"), "runtime"); // 产品选择
await mkdir(home, { recursive: true }); // 宿主准备
const kernel = createKernelService({ home, endpoint: componentEndpoint(home), adapters: [] });
await kernel.initialize();
// 先停止应用接纳新调用，再 await kernel.close() 并检查 complete。
```

`componentEndpoint`, `normalizedHome`, `homeHash`, and `componentServiceId` perform path calculations. They reject invalid original input; endpoint derivation also checks path/address budgets. They do not prove directory existence. Service initialization independently validates required `home`. `hostHomePaths` checks the actual directory; `ensureHostHome` only creates internal resources under an existing root. Account/profile path objects carry `home`; `ensureAccount` and `ensureLocalRuntime` revalidate it before writing, so cached paths cannot recreate a missing root. `resolveHostHome(appId)` is removed.

Endpoint-only `attachKernel` owns a connection and never starts a service or infers Home. `acquireEndpoint` owns an endpoint lease and requires a prepared parent. Both validate IPC syntax and length. Internal `startKernelServer` validates addresses without creating endpoint parents; it is not a replacement public Home startup boundary. Explicit low-level Core does not use Home or provide Home service hosting.

## Budgets and diagnostics

Linux/macOS support absolute POSIX paths. Windows supports local drive-absolute paths and rejects UNC/device/extended prefixes, drive-relative/root-relative paths, ADS, reserved devices, and trailing spaces/dots. Filesystem roots are rejected. Spaces and non-ASCII names are preserved.

Filesystem checks include complete appended filenames, atomic-write suffixes, recovery archives, endpoint leases, and log locks. Unix paths use UTF-8 bytes and startup queries OS `/usr/bin/getconf PATH_MAX/NAME_MAX` for the selected filesystem, independently of Provider PATH overrides. Missing/indeterminate queries for required resources fail with `HOME_LIMIT_UNAVAILABLE`. Windows Node/libuv extended paths use UTF-16 units: 32767 minus NUL and the automatic `\\?\` prefix, with 255 units per component; the budget is not MAX_PATH=260. Actual I/O may fail sooner and retains its system code. Optional log I/O, including a failed filesystem-budget query, remains best-effort; an unavailable log path does not invalidate a usable Home. Log path syntax and static length budgets are still checked before that isolation boundary.

Pathname Unix sockets allow 107 UTF-8 bytes on Linux and 103 on macOS, leaving room for NUL. The documented CreateNamedPipe support contract allows 256 UTF-16 units for the complete name. They retain the existing Home hash naming. The POSIX Kernel uses `<home>/executor-kernel.sock`. Existing IPC and filesystem budget checks apply to the new address and its ordinary ownership/state paths.

Sources: [Node IPC](https://github.com/nodejs/node/blob/v24.19.0/doc/api/net.md#identifying-paths-for-ipc-connections), [Microsoft paths](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation), [named pipes](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea), [Linux limits](https://github.com/torvalds/linux/blob/master/include/uapi/linux/limits.h), [Darwin limits](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/syslimits.h).

Validation checks directory access and briefly creates/removes an exclusive probe to verify actual write access, including Windows ACLs. It preserves identity/configuration/credentials. This startup observation is not an OS sandbox against concurrent directory replacement by the same account.

`ServiceInitializationError.cause` retains `RuntimeHomeError`; `cleanup` retains rollback results. `RuntimeHomeError.diagnostic` exposes `domain: startup`, stable `code`, actual `path` when supplied, `resource`, `operation`, and actionable host `action`. Length failures include `measured/limit/unit`; IPC failures also include the derived `endpoint`. Necessary system errors use `systemCode`. CLI projects `startup` and `cleanup` without dumping raw errors, environment, or configuration. Invalid Home does not trigger recursive log-root creation. These are startup failures, not AgentRun outcomes.

Codes distinguish `HOME_INVALID`, `HOME_UNSUPPORTED`, `HOME_NOT_FOUND`, `HOME_NOT_DIRECTORY`, `HOME_PERMISSION_DENIED`, `HOME_PATH_TOO_LONG`, `HOME_LIMIT_UNAVAILABLE`, `HOME_UNUSABLE`, `IPC_ENDPOINT_INVALID`, `IPC_ENDPOINT_UNSUPPORTED`, and `IPC_ENDPOINT_TOO_LONG`.

## Migrate callers

1. Replace `resolveHostHome(appId)` with host-owned selection/preparation. Add required `home` to every Kernel service call; retain explicit endpoint selection. Never infer Home from an endpoint hash.
2. `HostAccountPaths` and `HostProfilePaths` now require `home`; prefer generating them with the path helpers. `hostHomePaths` now requires a real existing directory and no longer accepts a simulated platform. Calculation-only checks cannot establish native platform behavior.
3. CLI selects explicit `--home`, otherwise the user's `~/.octo-runtime` on every supported platform, and prepares the root. Relative CLI arguments become explicit absolute paths; blank input and literal `~` are rejected. `OCTO_RUNTIME_HOME`, LOCALAPPDATA, Application Support, and XDG no longer override selection.
4. Existing data is preserved in place. To keep using a former Windows `%LOCALAPPDATA%\OctoRuntime` directory or old override, pass `--home <existing absolute directory>`, including when reinstalling a service. Existing service definitions retain their explicit original location. No automatic movement or identity reset occurs.

Actual Windows results and unverified platforms are recorded in [Issue 306 validation](../../../.octospec/tasks/306-runtime-home/validation.md). Run the focused check explicitly with `node --test test/manual/runtime-home-306.test.mjs`; it is not added to default CI.
