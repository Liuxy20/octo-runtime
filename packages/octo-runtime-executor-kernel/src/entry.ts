import { readFile } from "node:fs/promises";
import { startKernelServer, type KernelServerOptions } from "./server.js";

const owner = new AbortController();
let server: Awaited<ReturnType<typeof startKernelServer>> | undefined;
let stopping: Promise<void> | undefined;
let stopRequestId: string | undefined;
const finish = (complete: boolean) => {
  if (process.connected) {
    process.send?.({ type: "component.stopped", request_id: stopRequestId, complete });
    process.disconnect();
  }
  process.exitCode = complete ? 0 : 1;
};
// 初始化也属于 owner 的生命周期，断连或停止不能等 worker 就绪后才观察。
const stop = (requestId?: string) => {
  stopRequestId ??= requestId;
  owner.abort();
  if (server)
    stopping ??= server.close().then(
      () => finish(true),
      () => finish(false)
    );
};
process.on("message", (message: unknown) => {
  const value = message as { type?: string; request_id?: string };
  if (value?.type === "component.stop") stop(value.request_id);
});
process.once("disconnect", () => stop());
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
if (!process.connected) stop();
try {
  owner.signal.throwIfAborted();
  const index = process.argv.indexOf("--config");
  if (index < 0 || !process.argv[index + 1]) throw new Error("CONFIG_REQUIRED");
  const options = JSON.parse(
    await readFile(process.argv[index + 1], "utf8")
  ) as KernelServerOptions;
  owner.signal.throwIfAborted();
  server = await startKernelServer(options, owner.signal);
  owner.signal.throwIfAborted();
  if (process.connected) process.send?.({ type: "component.ready" });
} catch (error) {
  if (process.connected) process.send?.({ type: "component.failed", error: "KERNEL_START_FAILED" });
  finish(!(error instanceof AggregateError));
  if (!owner.signal.aborted) process.exitCode = 1;
}
