# CodeBuddy Adapter

[简体中文](README.zh.md) | [Packages](../README.md)

Runs one invocation through CodeBuddy ACP: starts `codebuddy --acp`, creates or loads an explicit native session, sends the turn, and maps text, public thought, tools, usage, and session updates into `CanonicalEvent`. It exists separately from the generic ACP Adapter because CodeBuddy's permission-mode flag and its ACP mappings differ.

## When to use it

- CodeBuddy is installed and logged in, and you want its own ACP permission handling.
- You need public reasoning surfaced as `public_reasoning`.
- You do not need image input or MCP from this Adapter.

## Register the Adapter and prepare input

This excerpt registers the Adapter and prepares its input. Execute with `executor.invoke(input)`; see [Executor Core](../octo-runtime-executor-core/README.md) for consumption, terminal checks, and `shutdown()`.

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { codebuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";

const executor = new AgentExecutor();
executor.register(codebuddyAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codebuddy" } }]
  }
});
```

## What it binds

| Item         | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Adapter type | `codebuddy`                                                               |
| Exports      | `codebuddyAdapter`, `createCodeBuddyAdapter`                              |
| Command      | `codebuddy --acp --permission-mode <mode>`                                |
| Output       | canonical events only                                                     |
| Session      | new session, or an explicit one loaded by id                              |
| Model        | sent with `session/new`; loading an existing session does not reselect it |

## Limits

- `assisted` is rejected; the Runtime permission bridge answers instead.
- Image input is rejected outright, and the implementation does not declare MCP support.
- Prompt and control text travel through the ACP text carrier, not a separate native system role.
- The correlated `session/prompt` response decides completion; silence in updates does not.
- Session receipts include a model only when the provider confirms it. An omitted model uses the provider default; a requested model on resume is not reported as applied.
- Provider refusal or explicit failed-request metadata produces `run.failed` with `ACP_MODEL_REQUEST_FAILED` (public code `OH-PRV-4010`). The message is the catalog message followed by a newline and `JSON.stringify` of the original `_meta`, without parsing, redaction or field selection. Details do not change the error classification; successful responses may still carry metadata.
- A turn without final assistant text fails with `ACP_NO_FINAL_OUTPUT`. Supported ACP result-body text supplies an answer only when there is no streamed final text or provider failure; reasoning and tool activity alone do not count as an answer.
- Probe checks that the executable exists, not that the account or model is usable.

## Import and distribution

Private workspace package, included in the CLI distribution. It has no individual npm package or public SDK subpath.

## Further reading

- [Implementation](src/index.ts), [ACP transport](../octo-runtime-acp-client/README.md), [Adapter SDK](../octo-runtime-adapter-sdk/README.md).
- [Input reference](../../docs/en/reference/invoke-input.md).
