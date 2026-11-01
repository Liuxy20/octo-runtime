import { createInterface } from "node:readline";
// 临时只读 stdio MCP；无外部连接、文件读取或凭据，唯一工具回显有界整数。
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const result =
    request.method === "initialize"
      ? {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "approval-fixture", version: "1.0.0" }
        }
      : request.method === "tools/list"
        ? {
            tools: [
              {
                name: "read_only_echo",
                description: "Return an integer without side effects",
                inputSchema: {
                  type: "object",
                  properties: { value: { type: "integer", minimum: 1, maximum: 32 } },
                  required: ["value"],
                  additionalProperties: false
                },
                annotations: { readOnlyHint: true, destructiveHint: false }
              }
            ]
          }
        : request.method === "tools/call" && request.params.name === "read_only_echo"
          ? { content: [{ type: "text", text: String(request.params.arguments.value) }] }
          : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
}
