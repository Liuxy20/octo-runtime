import {
  createKernelService,
  ServiceInitializationError,
  type KernelService,
  type KernelServiceOptions,
  type ServiceCleanupResult
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { cliCleanupResult, type CliAdapters } from "./adapters.js";

/** CLI 显式拥有装配资源；Kernel 只关闭自身调用，最后由此宿主关闭 Engine owner。 */
export async function createCliKernelService(
  options: Omit<KernelServiceOptions, "adapters">,
  assembly: CliAdapters
): Promise<KernelService> {
  let kernel: KernelService;
  try {
    kernel = createKernelService({
      ...options,
      adapters: assembly.adapters,
      serviceProcesses: () => assembly.processes(),
      async finalizeHostResources(deadline) {
        const cleanup = await assembly.close(deadline);
        if (!cleanup.complete) throw new Error("ENGINE_CLEANUP_INCOMPLETE", { cause: cleanup });
      }
    });
  } catch (error) {
    const result = await assembly.close(performance.now() + 2500);
    if (!result.complete)
      throw new ServiceInitializationError(error, cliCleanupResult(result), {
        component: "cli",
        phase: "created"
      });
    throw error;
  }
  let closing: Promise<ServiceCleanupResult> | undefined;
  let finish!: (result: ServiceCleanupResult) => void;
  const closed = new Promise<ServiceCleanupResult>((resolve) => {
    finish = resolve;
  });
  const close = (): Promise<ServiceCleanupResult> =>
    (closing ??= (async () => {
      const deadline = performance.now() + 5000;
      const errors: { resource: string; code: string }[] = [];
      const pendingResources: string[] = [];
      let cleanupError: unknown;
      try {
        assembly.beginShutdown();
      } catch {
        errors.push({ resource: "engines", code: "ENGINE_SHUTDOWN_FAILED" });
      }
      try {
        const result = await kernel.close();
        errors.push(...result.errors);
        pendingResources.push(...result.pendingResources);
        if (!result.complete && !result.errors.length)
          errors.push({ resource: "kernel", code: "KERNEL_CLEANUP_INCOMPLETE" });
      } catch (error) {
        cleanupError = error;
        errors.push({ resource: "kernel", code: "KERNEL_CLEANUP_INCOMPLETE" });
      }
      const engines = await assembly.close(deadline);
      const engineCleanup = cliCleanupResult(engines);
      errors.push(...engineCleanup.errors);
      pendingResources.push(...engineCleanup.pendingResources);
      const result = { complete: !errors.length, errors, pendingResources };
      finish(result);
      if (cleanupError)
        throw cleanupError instanceof Error
          ? cleanupError
          : new Error("KERNEL_CLEANUP_INCOMPLETE", { cause: cleanupError });
      return result;
    })());
  void kernel.closed.then(() => close()).catch(() => {});
  // initialize 自身失败也走统一 disposer；保留主原因和所有独立清理事实。
  return {
    get client() {
      return kernel.client;
    },
    async initialize(options) {
      try {
        await kernel.initialize(options);
      } catch (error) {
        throw new ServiceInitializationError(error, await close().catch(() => closed));
      }
    },
    status: () => kernel.status(),
    close,
    closed
  };
}
