import { createKernelService, type KernelServiceOptions } from "@mininglamp-oss/octo-runtime/host";

/** Construct services through public factories; never launch the CLI or load the user's Home. */
export async function recoveryNativeHost(kernelOptions: KernelServiceOptions) {
  const kernel = createKernelService(kernelOptions);
  try {
    await kernel.initialize();
    return {
      kernel,
      pid: process.pid,
      initializeCount: 1,
      async close() {
        const kernelCleanup = await kernel.close();
        return { kernelCleanup };
      }
    };
  } catch (error) {
    await kernel.close();
    throw error;
  }
}
