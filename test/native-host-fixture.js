import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { createInputInvoke } from "@mininglamp-oss/octo-runtime-protocol";

// 测试宿主原生装配。测试用执行源接口的所有操作都通过真实 Kernel RPC。
export async function nativeHost(adapters, options = {}) {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "onh-"));
  const kernel = createKernelService({
    home: home,
    endpoint: componentEndpoint(home),
    adapters,
    ...options
  });
  try {
    await kernel.initialize();
  } catch (error) {
    await kernel.close();
    await rm(home, { recursive: true, force: true });
    throw error;
  }
  const refs = new Map();
  const client = {
    list: () => kernel.client.list(),
    async *invokeFrames(input, environment) {
      const { ref } = await kernel.client.submit(input, environment);
      refs.set(ref.invocation_id, ref);
      yield* kernel.client.subscribe(ref);
    },
    async cancel(id, reason) {
      return { cancelled: (await kernel.client.cancel(refs.get(id), reason)).accepted };
    },
    respondInteraction: (id, response) => kernel.client.respond(refs.get(id), response),
    respondNative: (id, response) => kernel.client.respondNative(refs.get(id), response),
    status: () => kernel.client.status()
  };
  client.invoke = createInputInvoke((input, environment) =>
    client.invokeFrames(input, environment)
  );
  return {
    kernel,
    client,
    adapters: await kernel.client.list(),
    async close() {
      const result = await kernel.close();
      if (!result.complete)
        throw Object.assign(new Error("EXECUTOR_CLEANUP_INCOMPLETE"), {
          code: "EXECUTOR_CLEANUP_INCOMPLETE"
        });
      await rm(home, { recursive: true, force: true });
    }
  };
}
