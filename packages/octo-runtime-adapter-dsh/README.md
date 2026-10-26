# DeepSeek Harness Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through DeepSeek Harness's official Client SDK over its stdio service: start or resume an explicit native session, send this turn, map the trajectory into `CanonicalEvent`. This is the only Adapter with a public entry, `@mininglamp-oss/octo-runtime/adapters/dsh`. It wraps the unmodified upstream SDK, so treat the integration as experimental rather than a stability guarantee.

## When to use it

- DeepSeek Harness is installed and logged in, as Desktop or CLI.
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
| Executable   | PATH `dsh` first, then the macOS Desktop build; `dshBin` and `desktopPath` override |
| Output       | canonical events only                                                               |
| Approval     | `full_access` only                                                                  |
| Defaults     | profile `sdk`, provider `deepseek-account`, model `deepseek-flash`                  |

## Compatibility

The Client and Provider are pinned to `0.2.1-rc.3`, wire protocol `deepseek-harness-sdk-runtime/0.0.1`. The recorded macOS Desktop build is commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`; unknown versions fail verification. Desktop launch depends on the experimental `process.execve` to keep the official Client's PID and stdio ownership. Real Desktop evidence comes from Node 24; Windows and Linux native distributions have not passed real integration.

## Sessions and limits

- An explicit session is resumed **before** the working directory is updated and the turn is sent. A failed resume does not silently start a new session.
- New-session control instructions are separate user text blocks, not a native system prompt. No application history is reconstructed.
- Upstream pre-parse input, stderr, and session maps have no Runtime-added memory bounds, and upstream close confirms the direct child only — not every tool descendant. Kernel worker isolation does not remove these limits.
- Using a host-owned API key means selecting `deepseek-official` explicitly. Missing environment variables never decide native login state.
- SDK `args` is a string array, unlike CLI string-valued options.

## Verification

`node scripts/verify-dsh-live.mjs` calls the configured real Provider and writes verification files; it is opt-in, not a CI check. The release bundles the imported official Client and Protocol JavaScript, not the Provider installation or native binaries, and applies no downstream SDK patches.

## Further reading

- [Implementation](src/index.ts), [Adapter SDK](../octo-runtime-adapter-sdk/README.md), [Runtime Protocol](../octo-runtime-protocol/README.md).
- [SDK quickstart](../../docs/en/getting-started/sdk.md), [upstream limitations](https://github.com/deepseek-ai/deepseek-harness/discussions/11031).
