# DeepSeek Harness Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through DeepSeek Harness's official Client SDK over its stdio service: start or resume an explicit native session, send this turn, map the trajectory into `CanonicalEvent`. This is the only Adapter with a public entry, `@mininglamp-oss/octo-runtime/adapters/dsh`. It wraps the unmodified upstream SDK, so treat the integration as experimental rather than a stability guarantee.

## When to use it

- Install the Node distribution at version **`0.2.1-rc.4` or higher**, for example `npm install -g @deepseek-ai/dsh@0.2.1-rc.4`. Check `dsh --version`: npm's `latest` tag may point to an older release. The host supplies the installed package's JavaScript CLI entry as an absolute `providerOptions.dshBin` path and prepares DSH authentication.
- You are on Node.js `^24` or `^26` — not an arbitrary higher major.
- You accept the upstream limits listed below.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter);

const input = InvokeInput.check({
  agentConfig: { providerOptions: { dshBin: hostSelectedDshEntry } },
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});
```

## What it binds

| Item         | Value                                                                               |
| ------------ | ----------------------------------------------------------------------------------- |
| Adapter type | `dsh`                                                                               |
| Exports      | `dshAdapter`, `createDshAdapter`                                                    |
| Public entry | `@mininglamp-oss/octo-runtime/adapters/dsh`                                         |
| Executable   | Required host-selected absolute `dshBin` JavaScript entry, launched with `process.execPath` |
| Output       | canonical events only                                                               |
| Approval     | `full_access` only                                                                  |
| Defaults     | profile `sdk`, provider `deepseek-account`, model `deepseek-flash`                  |

## Compatibility

The unmodified official Client is pinned to `0.2.1-rc.3`; the selected DSH Provider must be **`>=0.2.1-rc.4`**, with no upper bound. SemVer precedence applies, including later prereleases; build metadata does not affect acceptance. Older or unparseable versions return `DSH_VERSION_UNSUPPORTED` (`OH-ADP-3005`) with the detected version (or `unknown`), minimum version, and an instruction to upgrade. `probe()` reports the actual installed version. `DSH_MIN_VERSION` is the minimum; the existing `DSH_VERSION` export remains an alias for it.

Initialization validates the `deepseek-harness-sdk-runtime` service identity and response shape without pinning `serverInfo.version` to `0.0.1`. Passing the version check does not guarantee execution: actual SDK, protocol, and final-message conversion errors still fail explicitly. This policy accepts possible future incompatibilities rather than rejecting newer releases in advance.

The adapter does not discover npm installations, search PATH, or use Desktop/ASAR code. `command`, `args`, and `desktopPath` are rejected. Missing or invalid configuration returns `DSH_CONFIG_INVALID`; a missing selected file returns `DSH_EXECUTABLE_NOT_FOUND`.

The adapter resolves the configured module's real path, validates that target, and uses that canonical path for both version probing and the official SDK client. Replacing the original selection symlink after validation cannot redirect either launch.

`hostSelectedDshEntry` above is maintained by your host, for example the absolute `lib/bin.js` path in its selected global `@deepseek-ai/dsh` installation. Do not pass `dsh.cmd`, `npx.cmd`, a Desktop executable, or a relative path. For a Kernel service, set `adapterConfigurations: { dsh: { providerOptions: { dshBin: hostSelectedDshEntry } } }` in `createKernelService` so `kernel.client.list()` and invocation share the same entry.

The Runtime CLI is a host: before starting either its persistent Kernel or `playboard`, it automatically selects the first existing `dsh` candidate on its PATH and resolves the npm package's JavaScript entry from `@deepseek-ai/dsh` package metadata. Only absent candidate paths are skipped; a broken symlink, inaccessible or non-executable command, non-file candidate, or invalid npm metadata stops discovery without selecting another installation. This handles npm symlinks and adjacent npm shims, including Windows `dsh.cmd`, without executing the wrapper. Both discovery and invocation receive the resolved `dshBin` through Kernel configuration. Set `adapters.dsh.execution.provider_options.dshBin` in `<home>/<profile>/config.json` to override selection; a missing or incompatible explicit entry never falls back to PATH. SDK applications own their own selection policy; the Adapter and shared Kernel do not inherit CLI auto-detection.

Electron hosts use their own runtime executable, without a separate Node installation. The adapter adds `ELECTRON_RUN_AS_NODE=1` only to its child environment when running in Electron; the host must also enable Node mode for its Kernel worker and use an Electron build that supports it. Windows uses the same JavaScript entry contract, without a shell wrapper. The SDK profile is `sdk`; no Desktop window or existing Desktop process is required.

DSH also has native runtime compatibility requirements. A previous local macOS arm64 check found that DSH `0.2.1-rc.3` rejects Electron `39.8.10` during SDK initialization with `unsupported Electron runtime fingerprint`, even though `--version` succeeds. This upstream rejection is distinct from installation discovery; enabling Node mode alone does not make that Electron build compatible. The same historical check passed with Electron `44.7.0` (Node `24.21.0`); it does not establish compatibility for later DSH releases.

## Sessions and limits

- An explicit session is resumed **before** the working directory is updated and the turn is sent. A failed resume does not silently start a new session.
- New-session control instructions are separate user text blocks, not a native system prompt. No application history is reconstructed.
- Upstream pre-parse input, stderr, and session maps have no Runtime-added memory bounds, and upstream close confirms the direct child only — not every tool descendant. Kernel worker isolation does not remove these limits.
- Using a host-owned API key means selecting `deepseek-official` explicitly. Missing environment variables never decide native login state.

## Verification

`OCTO_DSH_NATIVE_BIN=/absolute/path/to/lib/bin.js node --test test/dsh-native.test.js` explicitly verifies a real npm installation's version and SDK initialization without a model request. This is an opt-in, non-gating check; fixture tests alone do not establish native-platform support.

`OCTO_DSH_NATIVE_BIN=/absolute/path/to/lib/bin.js node scripts/verify-dsh-live.mjs` calls the configured real Provider and writes verification files; it is opt-in, not a CI check. The release bundles the imported official Client and Protocol JavaScript, not the Provider installation or native binaries, and applies no downstream SDK patches.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [SDK quickstart](../../docs/en/getting-started/sdk.md), [upstream limitations](https://github.com/deepseek-ai/deepseek-harness/discussions/11031).
