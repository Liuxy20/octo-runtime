import {
  defaultRuntimeHome,
  runtimePaths,
  readJsonFile,
  type ProfileConfiguration
} from "./state.js";
import { loadCliManifest } from "./module-manifest.js";
import { readCliAdapterConfigurations } from "./adapter-configurations.js";
import { resolveAdapterModules } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import {
  createKernelService,
  type KernelService
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { fileURLToPath } from "node:url";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type InvokeInput,
  identifyInvokeInput,
  isHostTerminal,
  isTerminal
} from "@mininglamp-oss/octo-runtime-protocol";

import { INVOKE_REQUEST_MAX_BYTES } from "@mininglamp-oss/octo-runtime-protocol";

export interface PlayboardOptions {
  input: NodeJS.ReadableStream;
  output?: (line: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
  manifest?: string;
  home?: string;
  profile?: string;
}

/**
 * CLI 单次执行入口：读取一个 InvokeInput，原生构造并拥有本次临时 Kernel，消费源帧后关闭。
 * 返回执行退出码；关闭失败仍拒绝，并保留已发生的执行错误或非零结果，不能假报清理成功。
 * Home/profile 属于调用者，仅删除本次创建的临时目录，不改变公共 SDK 调用合同。
 */
export async function runPlayboard(options: PlayboardOptions): Promise<number> {
  if ((options.input as NodeJS.ReadStream).isTTY) {
    throw new Error(
      "playboard requires a JSON request on stdin; use <<< '...JSON...' or < request.json"
    );
  }
  let body = Buffer.alloc(0);
  let size = 0;
  for await (const chunk of options.input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const nextSize = size + bytes.length;
    if (nextSize > INVOKE_REQUEST_MAX_BYTES) throw new TypeError("INVOKE_REQUEST_TOO_LARGE");
    if (nextSize > body.length) {
      const expanded = Buffer.allocUnsafe(
        Math.min(INVOKE_REQUEST_MAX_BYTES, Math.max(65536, body.length * 2, nextSize))
      );
      body.copy(expanded, 0, 0, size);
      body = expanded;
    }
    bytes.copy(body, size);
    size = nextSize;
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8", 0, size));
    body = Buffer.alloc(0);
  } catch {
    throw new TypeError("playboard stdin must contain one complete JSON object");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("playboard stdin must contain one JSON input object");
  const input = identifyInvokeInput(value as InvokeInput);
  const profile = options.profile ?? "default";
  const home = options.home ?? defaultRuntimeHome(options.env);
  runtimePaths(home, profile); // Validate the selected profile before starting resources.
  if (input.runMetadata?.profile !== undefined && input.runMetadata.profile !== profile)
    throw new Error("RUNTIME_CONFIGURATION_NOT_FOUND: request profile differs from --profile");
  input.runMetadata = { ...input.runMetadata, profile };
  const output = options.output ?? writeLine;
  // Unix socket 的路径预算小于普通文件路径；固定短根，避免 TMPDIR 嵌套或中文路径超限。
  // mkdtemp 创建本次独占的 0700 目录；常驻服务仍使用 Runtime Home，Windows 保留命名管道。
  const temporary = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "op-"));
  const controller = new AbortController();
  let interrupted = 0;
  const onInterrupt = (): void => {
    interrupted = 130;
    controller.abort();
  };
  const onTerminate = (): void => {
    interrupted = 143;
    controller.abort();
  };
  const onOutputError = (error: Error): void => {
    controller.abort(error);
  };
  if (!options.output) process.stdout.on("error", onOutputError);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  let kernel: KernelService | undefined;
  let outcome: number | undefined;
  let primaryFailure: { error: unknown } | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  try {
    const paths = runtimePaths(home, profile);
    const manifest = await loadCliManifest(home, options.manifest);
    const configuration = await readJsonFile<ProfileConfiguration>(paths.profileConfig);
    kernel = createKernelService({
      endpoint:
        process.platform === "win32" ? componentEndpoint(temporary) : join(temporary, "k.sock"),
      workerEntrypoint: fileURLToPath(new URL("./worker.js", import.meta.url)),
      adapterModules: resolveAdapterModules(manifest),
      env: {
        ...(options.env ?? process.env),
        OCTO_RUNTIME_CLI_PROFILE_ROOT: paths.profileRoot,
        OCTO_RUNTIME_CLI_SYNC_OPENCLAW_TOOLS: "0"
      },
      adapterConfigurations: await readCliAdapterConfigurations(
        paths.profileRoot,
        configuration?.adapters,
        manifest,
        options.env ?? process.env
      )
    });
    await kernel.initialize({ signal: controller.signal });
    let exitCode = 1;
    for await (const frame of kernel.client.invoke(input, { signal: controller.signal })) {
      await output(JSON.stringify(frame));
      if (
        ("kind" in frame &&
          frame.kind === "control" &&
          frame.control.type === "interaction" &&
          frame.control.status === "pending") ||
        (!("kind" in frame) && frame.type === "interaction.requested")
      ) {
        throw new Error(
          "PLAYBOARD_INTERACTION_REQUIRED: one-shot stdin cannot answer provider interactions"
        );
      }
      if (
        "kind" in frame &&
        isHostTerminal(frame) &&
        frame.kind === "control" &&
        frame.control.type === "state"
      ) {
        exitCode =
          frame.control.state === "completed" ? 0 : frame.control.state === "cancelled" ? 130 : 1;
      }
      if (!("kind" in frame) && isTerminal(frame))
        exitCode = frame.type === "run.completed" ? 0 : frame.type === "run.cancelled" ? 130 : 1;
    }
    outcome = interrupted || exitCode;
  } catch (error) {
    if (interrupted) outcome = interrupted;
    else primaryFailure = { error };
  }
  try {
    await closeKernel(kernel);
    await rm(temporary, { recursive: true, force: true });
  } catch (error) {
    cleanupFailure = { error };
  } finally {
    if (!options.output) process.stdout.removeListener("error", onOutputError);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
  // 清理之后统一选择结果，避免 finally 的拒绝覆盖主结果。保留两个原始异常对象；
  // 取消/失败已有帧不改写，清理失败仍非零退出，不返回原来的成功码。
  if (cleanupFailure) {
    const cleanupError = cleanupFailure.error;
    const cleanupMessage =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    if (primaryFailure) {
      const primary = primaryFailure.error;
      throw new AggregateError(
        [primary, cleanupError],
        `${primary instanceof Error ? primary.message : String(primary)}; cleanup: ${cleanupMessage}`,
        { cause: cleanupError }
      );
    }
    if (outcome !== undefined && outcome !== 0)
      throw new AggregateError(
        [cleanupError],
        `Playboard exited with code ${outcome}; cleanup: ${cleanupMessage}`,
        { cause: cleanupError }
      );
    throw cleanupError;
  }
  if (primaryFailure) throw primaryFailure.error;
  return outcome ?? 1;
}

function writeLine(line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
  });
}
async function closeKernel(kernel: KernelService | undefined): Promise<void> {
  const result = await kernel?.close();
  if (result && !result.complete) throw new Error("COMPONENT_CLEANUP_INCOMPLETE");
}
