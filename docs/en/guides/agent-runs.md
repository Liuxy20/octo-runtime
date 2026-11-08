# Invoke and Interrupt

[简体中文](../../zh-CN/guides/agent-runs.md) | [Documentation](../README.md)

Invoke through an attached client with application-prepared content. The service owner manages Kernel lifetime.

```ts
const run = client.invoke(
  { parts: [{ type: "text", text: "Summarize this project." }], protocol_mode: "canonical" },
  "project-chat",
  undefined,
  { schema: "octo.context-envelope/v3", items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }
  ] }
);
let terminal: string | undefined;
for await (const event of run) {
  if (event.type === "message.delta") console.log(event.payload.text);
  if (event.type === "interaction.requested")
    await client.interrupt(run.invocationId, "example interaction");
  if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) terminal = event.type;
}
if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
```

[Invoke API](../reference/invoke-input.md) · [Identifiers](../concepts/identifiers.md) · [Output and control](../reference/output-and-control.md)
