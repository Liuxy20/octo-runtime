import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawnAcpClient } from "@mininglamp-oss/octo-runtime-acp-client";
import { createCodeBuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";

const model = (value) =>
  value?.configOptions?.find((v) => v.id === "model" || v.category === "model")?.currentValue ??
  value?.models?.currentModelId ??
  value?.model;

// 真实 ACP 透传；只记录模型、会话和调用顺序，不记录 prompt、环境或原始错误元数据。
export default createCodeBuddyAdapter({
  acpClientFactory(options) {
    const client = spawnAcpClient(options);
    const record = (value) =>
      appendFileSync(join(options.cwd, "native-evidence.ndjson"), JSON.stringify(value) + "\n", {
        mode: 0o600
      });
    let closing;
    return {
      initialize: client.initialize.bind(client),
      reserveRequestId: client.reserveRequestId.bind(client),
      async request(method, params, requestOptions) {
        const result = await client.request(method, params, requestOptions);
        record({
          method,
          sessionId: result?.sessionId ?? params.sessionId,
          requested: params.value ?? params.modelId,
          confirmed: model(result)
        });
        return result;
      },
      async *prompt(sessionId, text, promptOptions) {
        record({ method: "session/prompt", sessionId });
        yield* client.prompt(sessionId, text, promptOptions);
      },
      close() {
        return (closing ??= client.close().then(() => record({ method: "close" })));
      }
    };
  }
});
