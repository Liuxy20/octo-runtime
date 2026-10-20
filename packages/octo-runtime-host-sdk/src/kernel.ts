import { fileURLToPath } from "node:url";
import {
  attachKernel,
  type KernelClient,
  type KernelStatus,
  type KernelServerOptions
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { ComponentStartError, launchNode, type CleanupResult } from "./launch.js";

/** 宿主独占的 Kernel 进程句柄；client 仅是 attached 连接，stop/restart 才管理进程。 */
export interface OwnedKernel {
  readonly topology: "kernel-ipc";
  readonly ownership: "owned";
  readonly client: KernelClient;
  readonly exited: Promise<void>;
  stop(): Promise<CleanupResult>;
  restart(): Promise<KernelStatus>;
}
export type OwnedKernelOptions = Omit<KernelServerOptions, "configurations"> & {
  entrypoint?: string;
  signal?: AbortSignal;
};
/**
 * 启动独立 Node Kernel 并返回所有权；worker 入口和 Adapter 集合由宿主显式选择。
 * 宿主退出前先等待相关 Extra/业务收尾，再 stop 并检查 complete；失败的旧进程不能直接替换。
 */
export async function startOwnedKernel(options: OwnedKernelOptions): Promise<OwnedKernel> {
  const entrypoint =
    options.entrypoint ??
    fileURLToPath(new URL("../../octo-runtime-executor-kernel/dist/entry.js", import.meta.url));
  const configuration = {
    endpoint: options.endpoint,
    workerEntrypoint: options.workerEntrypoint,
    manifest: options.manifest,
    env: options.env,
    adapterConfigurations: options.adapterConfigurations,
    stateDirectory: options.stateDirectory
  };
  let process = await launchNode(entrypoint, configuration, undefined, options.signal);
  let client = attachKernel({ endpoint: options.endpoint });
  let failedStartup: ComponentStartError | undefined;
  let operation: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = operation.catch(() => undefined).then(action);
    operation = next;
    return next;
  };
  return {
    topology: "kernel-ipc",
    ownership: "owned",
    get client() {
      return client;
    },
    get exited() {
      return process.exited;
    },
    stop: () =>
      serial(async () => {
        client.close();
        if (failedStartup) return failedStartup.cleanup;
        return process.stop();
      }),
    restart: () =>
      serial(async () => {
        client.close();
        if (failedStartup && !failedStartup.cleanup.complete)
          throw new Error("COMPONENT_CLEANUP_INCOMPLETE");
        const cleanup = await process.stop();
        if (!cleanup.complete) throw new Error("COMPONENT_CLEANUP_INCOMPLETE");
        try {
          process = await launchNode(entrypoint, configuration);
          failedStartup = undefined;
        } catch (error) {
          if (error instanceof ComponentStartError) failedStartup = error;
          throw error;
        }
        client = attachKernel({ endpoint: options.endpoint });
        return client.status();
      })
  };
}
