import {
  createKernelService,
  type KernelService
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  createCodexAdapter,
  createManagedCodexEngine,
  type CodexEngineProvider
} from "@mininglamp-oss/octo-runtime-adapter-codex";

/** 宿主已准备两种 Home；持有 owner 的宿主负责回滚和最终关闭。 */
export async function startOwnedCodex(home: string, codexHome: string, command: string) {
  const owner = createManagedCodexEngine({ command, env: process.env, codexHome });
  let kernel: KernelService | undefined;
  const close = async () => {
    const deadline = performance.now() + 5000;
    const errors: unknown[] = [];
    owner.beginShutdown();
    try {
      const result = await kernel?.close();
      if (result && !result.complete) errors.push(result);
    } catch (error) {
      errors.push(error);
    }
    // Kernel 失败仍关闭独占 owner；不删除 CODEX_HOME。
    try {
      const result = await owner.close({ deadline });
      if (!result.complete) errors.push(result);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "HOST_CLEANUP_INCOMPLETE");
  };
  try {
    kernel = createKernelService({
      home,
      endpoint: componentEndpoint(home),
      adapters: [createCodexAdapter({ engine: owner.provider })],
      serviceProcesses: () => owner.processes(),
      async finalizeHostResources(deadline) {
        const result = await owner.close({ deadline });
        if (!result.complete) throw new Error("ENGINE_CLEANUP_INCOMPLETE", { cause: result });
      }
    });
    await kernel.initialize();
    return { client: kernel.client, close };
  } catch (error) {
    const errors = [error];
    try {
      await close();
    } catch (cleanup) {
      errors.push(cleanup);
    }
    throw new AggregateError(errors, "HOST_INITIALIZATION_FAILED");
  }
}

/** 业务 owner 保留共享 Engine 的管理权；此宿主只关闭自己的 Kernel。 */
export function borrowingCodex(home: string, engine: CodexEngineProvider): KernelService {
  return createKernelService({
    home,
    endpoint: componentEndpoint(home),
    adapters: [createCodexAdapter({ engine })]
  });
}
