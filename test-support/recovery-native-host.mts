import {
  createKernelService,
  createExtraService,
  type KernelServiceOptions,
  type ExtraServiceOptions
} from "@mininglamp-oss/octo-runtime/host";

/** Construct services through public factories; never launch the CLI or load the user's Home. */
export async function recoveryNativeHost(
  kernelOptions: KernelServiceOptions,
  extraOptions: ExtraServiceOptions
) {
  const kernel = createKernelService(kernelOptions);
  const extra = createExtraService(extraOptions);
  try {
    await kernel.initialize();
    await extra.initialize();
    return {
      kernel,
      extra,
      pid: process.pid,
      initializeCount: 1,
      async close() {
        const extraCleanup = await extra.close();
        const kernelCleanup = await kernel.close();
        return { extraCleanup, kernelCleanup };
      }
    };
  } catch (error) {
    await extra.close();
    await kernel.close();
    throw error;
  }
}
