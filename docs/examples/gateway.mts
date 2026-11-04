import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type {
  GatewayDependencies,
  LoadContexts
} from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { ContextItem } from "@mininglamp-oss/octo-runtime/protocol";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 宿主每轮读取当前材料，函数不进入 JSON；同步与异步实现二选一。 */
export function synchronousContexts(readInstructions: () => string): LoadContexts {
  return (_config, { signal }) => {
    signal.throwIfAborted();
    return instructionItems(readInstructions());
  };
}

export function asynchronousContexts(file: string): LoadContexts {
  return async (_config, { signal }) =>
    instructionItems(await readFile(file, { encoding: "utf8", signal }));
}

function instructionItems(text: string): ContextItem[] {
  return [{ namespace: "octo.control", name: "instructions", payload: { entries: [{ text }] } }];
}

/** 示例宿主准备配置和凭据；服务只借用已有 Kernel，不控制插件内部连接。 */
export function createGatewayExample(env: NodeJS.ProcessEnv, loadContexts: LoadContexts) {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const workdir = required("GATEWAY_WORKDIR");
  if (!isAbsolute(workdir)) throw new Error("GATEWAY_WORKDIR must be absolute");
  const dependencies: GatewayDependencies = { loadContexts };
  return createExtraService({
    home: required("RUNTIME_HOME"),
    endpoint: required("KERNEL_ENDPOINT"),
    module: gateway,
    config: {
      bots: [
        {
          api_url: required("GATEWAY_API_URL"),
          bot_id: required("GATEWAY_BOT_ID"),
          bf_token: required("GATEWAY_BOT_TOKEN"),
          adapter: { adapter_type: "codex", workdir }
        }
      ]
    },
    dependencies
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 凭据由宿主运行环境注入；仅 Ctrl+C 请求关闭，清理失败继续保留为错误。
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node gateway.mts <instructions.txt>");
  const extra = createGatewayExample(process.env, asynchronousContexts(file));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  const errors: unknown[] = [];
  try {
    await extra.initialize({ signal: controller.signal });
    const status = await extra.status();
    console.log(JSON.stringify({ phase: status.phase, kernel_available: status.kernel_available }));
    if (!controller.signal.aborted)
      await new Promise<void>((done) =>
        controller.signal.addEventListener("abort", () => done(), { once: true })
      );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      const cleanup = await extra.close();
      if (!cleanup.complete) errors.push(new Error("EXTRA_CLEANUP_INCOMPLETE", { cause: cleanup }));
    } catch (error) {
      errors.push(error);
    }
    process.removeListener("SIGINT", stop);
  }
  if (errors.length) throw new AggregateError(errors, "GATEWAY_EXAMPLE_FAILED");
}
