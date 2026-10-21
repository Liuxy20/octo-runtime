import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { randomUUID } from "node:crypto";
import { invokeOnce } from "./invoke.mts";

const [endpoint, adapterType = "codex"] = process.argv.slice(2);
if (!endpoint) throw new Error("Usage: node attach.mts <endpoint> [adapter-type]");
const input = InvokeInput.check({
  invocationId: randomUUID(),
  inputs: [{ type: "text", text: "Reply with a short greeting." }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "adapter",
        payload: {
          type: adapterType,
          ...(adapterType === "openclaw" ? { provider_agent_id: "main" } : {})
        }
      }
    ]
  }
});
const client = attachKernel({ endpoint });
try {
  // 示例拒绝交互，生产应用应交给用户界面；不因关闭连接而假定执行已取消。
  await invokeOnce(client, input, async (event) => {
    if (event.type === "interaction.requested") {
      await client.respondInteraction(input.invocationId!, {
        interactionId: event.payload.interactionId,
        outcome: "cancelled"
      });
    }
    if (event.type === "message.delta" && event.payload.channel === "final")
      process.stdout.write(event.payload.text ?? "");
    if (event.type === "run.failed") console.error(event.payload);
  });
} finally {
  client.close();
}
