import { createKernelService, type KernelServiceOptions } from "@mininglamp-oss/octo-runtime/host";
import type { CanonicalEvent, InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { invokeOnce } from "./invoke.mts";

/** 装配入口拥有服务；完整消费本轮后关闭。清理失败与原执行错误共同保留。 */
export async function runOwnedInvocation(
  options: KernelServiceOptions,
  input: InvokeInput,
  consume: (event: CanonicalEvent) => void | Promise<void>
): Promise<void> {
  const kernel = createKernelService(options);
  const errors: unknown[] = [];
  try {
    await kernel.initialize();
    await invokeOnce(kernel.client, input, consume);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      const cleanup = await kernel.close();
      if (!cleanup.complete)
        errors.push(new Error("KERNEL_CLEANUP_INCOMPLETE", { cause: cleanup }));
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "OWNED_INVOCATION_FAILED");
}
