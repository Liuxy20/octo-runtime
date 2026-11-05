import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
let call;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  if (request.id === "consent" && !request.method) {
    send({
      id: call,
      result: {
        content: [
          {
            type: "text",
            text: request.result?.action === "accept" ? "CONSENT_ACCEPTED" : "CONSENT_DECLINED"
          }
        ]
      }
    });
    continue;
  }
  const reply = (result) => send({ id: request.id, result });
  if (request.method === "initialize")
    reply({
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "octo-consent-probe", version: "1.0.0" }
    });
  else if (request.method === "tools/list")
    reply({
      tools: [
        {
          name: "consent_echo",
          description:
            "Ask for approval using MCP elicitation, then return its result. Read only and no external effects.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ]
    });
  else if (request.method === "tools/call") {
    call = request.id;
    send({
      id: "consent",
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Confirm this local read-only probe.",
        requestedSchema: {
          type: "object",
          properties: { approved: { type: "boolean", title: "Approve probe" } },
          required: ["approved"]
        }
      }
    });
  } else reply({});
}
