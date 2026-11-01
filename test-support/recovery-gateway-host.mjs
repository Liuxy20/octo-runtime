import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { extraStatusRecord } from "../packages/octo-runtime-adapter-sdk/dist/index.js";

// SDK 原生宿主只收到 RPC endpoint 与 Gateway 配置，不拥有 Kernel。
process.once("message", async ({ endpoint, controlEndpoint, config }) => {
  const extra = createExtraService({
    endpoint,
    controlEndpoint,
    module: {
      ...gateway,
      default(context, config) {
        return gateway.default(
          {
            ...context,
            log(level, event, data) {
              context.log(level, event, data);
              const row = extraStatusRecord(gateway.name, level, event, data);
              if (row) console.log(JSON.stringify(row));
            }
          },
          config
        );
      }
    },
    config,
    dependencies: {}
  });
  let closing;
  const close = () =>
    (closing ??= extra.close().then((result) => {
      console.log(JSON.stringify({ event: "fixture.cleanup", result }));
      // 宿主记录实际结果；预期的 lost 与实际资源错误由外层分别验收。
      if (!result.complete) process.exitCode = 1;
      if (process.connected) process.disconnect();
    }));
  process.on("message", (message) => {
    if (message.command === "close") void close();
  });
  process.once("disconnect", () => void close());
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  try {
    await extra.initialize();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    await close();
  }
});
