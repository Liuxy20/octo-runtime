import type { ExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import type { KernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** CLI 持有前台服务；所有终止路径只清理、诊断及完成一次，不退出调用进程。 */
export function runForegroundService(
  handle: ExtraService | KernelService,
  ready: () => void,
  failed: (error: unknown) => Promise<void>
): Promise<number> {
  return new Promise<number>((resolve) => {
    const initialization = new AbortController();
    let terminal = false;
    const detach = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    const finish = async (
      reason: "signal" | "initialization" | "closed",
      error?: unknown,
      closed?: Awaited<ExtraService["closed"]>
    ) => {
      if (terminal) return;
      terminal = true;
      detach();
      initialization.abort();
      let complete = false;
      let failure = error;
      try {
        try {
          complete = (closed ?? (await handle.close())).complete;
        } catch (cause) {
          failure ??= new Error("SERVICE_CLEANUP_INCOMPLETE", { cause });
        }
        if (reason === "closed") failure = new Error("SERVICE_PROCESS_EXITED", { cause: error });
        if (failure !== undefined) await failed(failure);
      } finally {
        resolve(complete ? (reason === "signal" && failure === undefined ? 0 : 1) : 5);
      }
    };
    // 两个 signal、initialize 与 closed 可以同时完成，finish 在首个 await 前取得终态。
    const stop = () => void finish("signal").catch(() => {});
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const initialized = Promise.resolve().then(() =>
      handle.initialize({ signal: initialization.signal })
    );
    void initialized
      .then(
        () => {
          if (!terminal) {
            try {
              ready();
            } catch (error) {
              return finish("initialization", error);
            }
          }
        },
        (error: unknown) => finish("initialization", error)
      )
      .catch(() => {});
    void handle.closed
      .then(
        // 初始化失败由其原始错误诊断；成功初始化后即使立即 closed 也必须报告失败。
        (result) =>
          initialized.then(
            () => finish("closed", undefined, result),
            () => {}
          ),
        (error: unknown) => finish("closed", error)
      )
      .catch(() => {});
  });
}
