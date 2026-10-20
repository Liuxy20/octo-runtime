import { AgentExecutor, type HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-core";
import { WorkerRpcServer } from "./rpc.js";
import {
  RuntimeLogging,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

/**
 * 在当前独立 worker 子进程中提供 Core 执行服务。调用方已经决定加载集合：
 * CLI 可从自己的 JSON 动态加载，SDK 可直接 import；这里不扫描或补齐任何 Adapter。
 * 该函数只在 worker 入口调用；宿主 App 和 Kernel 监督进程通过客户端接入，不直接调用。
 */
export function serveWorker(
  adapters: readonly HostedAdapter[],
  options: { logging?: RuntimeLoggingOptions } = {}
): void {
  const logging = new RuntimeLogging(
    options.logging ??
      (process.env.OCTO_RUNTIME_LOGS_DIRECTORY
        ? { directory: process.env.OCTO_RUNTIME_LOGS_DIRECTORY }
        : undefined)
  );
  process.on("uncaughtExceptionMonitor", () =>
    logging.kernel("error", "host.uncaught", { code: "HOST_UNCAUGHT_EXCEPTION" })
  );
  const host = new AgentExecutor({ log: logging.kernel });
  for (const adapter of adapters) {
    // 注册阶段保留协议校验和重复类型检查，失败时不建立就绪的 RPC 服务。
    host.register(adapter);
    logging.kernel("info", "adapter.registered", { adapter_type: adapter.metadata.type });
  }

  // 仅服务已注册集合；Kernel 监督器通过首次 list 握手确认 worker 就绪。
  // 注册不代表 Provider 已安装或认证，实际可用性由 probe 和调用结果说明。
  new WorkerRpcServer({
    host,
    output: process.stdout,
    log: logging.kernel
  }).listen(process.stdin);
  logging.kernel("info", "host.ready");

  // 父 Kernel 断开或停止时等待 Core 取消和清理；需要替换时由 Kernel 监督器重启相同入口。
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void host.shutdown().then(
      async (result) => {
        if (result.cleanup === "incomplete") {
          logging.kernel("error", "host.cleanup_incomplete", {
            code: "EXECUTOR_CLEANUP_INCOMPLETE",
            unresolved_count: result.unresolvedInvocationIds.length
          });
        }
        await logging.close();
        process.exit(result.cleanup === "complete" ? 0 : 1);
      },
      async () => {
        await logging.close();
        process.exit(1);
      }
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  process.stdin.once("end", stop);
  process.stdin.once("close", stop);
  // 心跳必须由执行进程主事件循环处理；独立线程应答会掩盖执行线程阻塞。
  process.on("message", (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "kernel.ping" &&
      process.connected
    ) {
      process.send?.({ type: "worker.pong" });
    }
  });
  process.once("disconnect", stop);
}
