# Inputs and agentEnv

[简体中文](../../zh-CN/concepts/inputs-and-contexts.md) | [文档目录](../README.md)

`KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)` takes four flat arguments. `inputs` contains application-prepared startup prompts, business material and current text/images in caller-selected order. `agentEnv` is reusable execution configuration, copied per invocation: cwd, Adapter, model/effort, environment variables, MCP, approval and execution limits.

Runtime does not build history, interpret `extra.im`, or render business Context. Gateway/applications prepare their own history, rules, materials and images as inputs. Plain text, Markdown and `<namespace ...>` are optional application conventions, unrelated to execution requirements.

```ts
const agentEnv = {
  schema: "octo.context-envelope/v3" as const,
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
    { namespace: "octo.execution", name: "workspace", payload: { path: "/absolute/prepared/project" } },
    { namespace: "octo.execution", name: "model", payload: { reasoning: { effort: "high" } } }
  ]
};
const run = client.invoke(
  [
    { type: "text", text: "Answer concisely." },
    { type: "text", text: "Summarize this application-prepared history: ..." }
  ],
  "conversation-42",
  undefined,
  agentEnv
);
// A Stop button can call: await client.interrupt(run.invocationId);
for await (const frame of run) {
  // Consume the original stream through its terminal event.
}
```

The envelope stays `schema: "octo.context-envelope/v3"` with namespace/name/payload items. Run event versions stay unchanged. Execution settings are not appended to model text. The first text part above is ordinary user input, with no special system/developer/trusted role. Runtime does not prepend prompts, parse application namespaces or inject them on fresh/resumed sessions. Callers decide which prompts to include in each complete primary or recovery input. Removed `octo.control/instructions` and `controlInstructions` are rejected. Tools may read environment variables, so keep credentials out of business inputs and logs.

Ordinary inputs are `ModelInputPart[]`. For canonical output or explicit recovery material, `InvocationContent` accepts `{ parts, protocol_mode: "canonical", freshFallbackModelInputParts, ... }` with content, tracing identity and generation fields. It does not carry environment or session arguments and is not the old outer invocation object.

See [fields](../reference/invoke-input.md), [identifiers](identifiers.md), and [sessions](../guides/context-and-sessions.md).
