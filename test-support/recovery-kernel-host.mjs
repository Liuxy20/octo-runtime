import { resolve } from "node:path";
import { createKernelService } from "@mininglamp-oss/octo-runtime/host";

// 此入口属于外层测试环境；Gateway 不加载它，也不取得服务对象。
const kernel = createKernelService({
  endpoint: process.argv[2],
  workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
  manifest: resolve("test/fixtures/recovery-adapters.json"),
  env: process.env
});
let closing;
const close = () =>
  (closing ??= kernel.close().then((result) => {
    console.log(JSON.stringify({ event: "fixture.cleanup", result }));
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
  await kernel.initialize();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await close();
}
