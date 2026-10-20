import net from "node:net";
import { readFile, mkdir, chmod, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RuntimeLogging,
  readBoundedLines,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { extraRegistration, type ExtraDescriptor } from "./extra-config.js";
import { ExtraPlugins, type ExtraPluginModule } from "./extras.js";
import type { ChannelDependencies } from "./context-loader.js";
import { createExtraPort } from "./extra-port.js";
import { attachKernel, acquireEndpoint } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createDependencyProxy } from "./dependencies.js";
import { processChannel } from "./process-channel.js";
import { deadline } from "./launch.js";

interface ExtraConfiguration {
  logging?: RuntimeLoggingOptions;
  declaration: ExtraDescriptor;
  endpoint: string;
  controlEndpoint?: string;
  instance: string;
  epoch: string;
  proxy?: boolean;
  dependencyModule?: { entrypoint: string; exportName: string };
}
const index = process.argv.indexOf("--config");
const channel = processChannel(process);
const owner = new AbortController();
let options: ExtraConfiguration;
let execution: ReturnType<typeof createExtraPort> | undefined;
let logs: RuntimeLogging | undefined;
let plugins: ExtraPlugins | undefined;
let kernel: ReturnType<typeof attachKernel> | undefined;
let proxy: ReturnType<typeof createDependencyProxy> | undefined;
const inspect = async () => {
  if (!plugins || !kernel) throw new Error("EXTRA_NOT_LOADED");
  const status =
    options.declaration.enabled === false
      ? { phase: "disabled" }
      : await plugins.inspect(options.declaration.name);
  const available = await kernel.status().then(
    (status) => status.execution_ready,
    () => false
  );
  return { ...status, kernel_available: available };
};
let server: net.Server | undefined;
let listening: Promise<void> | undefined;
let serverClosing: Promise<void> | undefined;
let releaseEndpoint: (() => Promise<void>) | undefined;
let endpointReleasing: Promise<void> | undefined;
const connections = new Set<net.Socket>();
let closing: Promise<void> | undefined;
let forceExit: NodeJS.Timeout | undefined;
let disconnecting = false;
let initializationFinished!: () => void;
const initialized = new Promise<void>((resolve) => {
  initializationFinished = resolve;
});
const closeServer = async () => {
  if (!server || !listening) return;
  await listening.catch(() => undefined);
  if (!server.listening && !serverClosing) return;
  await (serverClosing ??= new Promise<void>((resolve, reject) =>
    server!.close((error) => (error ? reject(error) : resolve()))
  ));
};
const releaseControlEndpoint = async () => {
  if (!releaseEndpoint) return;
  await (endpointReleasing ??= (async () => {
    if (options.controlEndpoint && process.platform !== "win32")
      await rm(options.controlEndpoint, { force: true });
    await releaseEndpoint();
  })());
};
const stop = (requestId?: string): Promise<void> =>
  (closing ??= (async () => {
    // owner 退出后没有父进程兜底；为 4 秒清理和 IPC 排空留出最终退出宽限。
    forceExit = setTimeout(() => {
      if (process.platform !== "win32") {
        try {
          // SDK 创建独立进程组，同时回收不响应 dispose 的插件子进程。
          process.kill(-process.pid, "SIGKILL");
        } catch {
          // 直接运行的 runner 可能不是组长，仍须退出自身。
        }
      }
      process.exit(process.exitCode ?? 1);
    }, 4500).unref();
    owner.abort();
    plugins?.stopAdmission();
    proxy?.close();
    for (const socket of connections) socket.destroy();
    const until = Date.now() + 4000;
    const errors: unknown[] = [];
    const attempt = async (operation: () => void | Promise<void>) => {
      try {
        await deadline(
          Promise.resolve().then(operation),
          Math.max(0, until - Date.now()),
          "EXTRA_RUN_CLEANUP_INCOMPLETE"
        );
      } catch (error) {
        errors.push(error);
      }
    };
    // 初始化仍可能取得资源；必须等它结束后才能确认资源已回收。
    await attempt(() => initialized);
    await Promise.all([
      attempt(async () => {
        try {
          await execution?.cancelOwned();
        } finally {
          try {
            await plugins?.close();
          } finally {
            execution?.disconnect();
          }
        }
      }),
      attempt(closeServer)
    ]);
    await attempt(() => kernel?.close());
    await attempt(() => logs?.close());
    if (!errors.length) await attempt(releaseControlEndpoint);
    const complete = !errors.length;
    // 清理失败时即使只剩未引用的后代，也要保留最终进程组回收机会。
    if (!complete) forceExit.ref();
    if (process.connected)
      channel.send({ type: "component.stopped", request_id: requestId, complete });
    process.exitCode = complete ? 0 : 1;
    if (process.connected) {
      disconnecting = true;
      process.disconnect();
    }
  })());
process.on("message", (message: unknown) => {
  const value = message as { type?: string; request_id?: string };
  if (value.type === "component.stop") void stop(value.request_id);
  if (value.type === "component.status")
    void inspect().then(
      (status) => channel.send({ type: "component.status", request_id: value.request_id, status }),
      () =>
        channel.send({
          type: "component.status",
          request_id: value.request_id,
          status: { phase: "unavailable" }
        })
    );
});
process.once("disconnect", () => {
  proxy?.close();
  void stop();
  // 真正失去 owner 后，即使插件后代已 unref，也不能在组回收前自然退出。
  if (!disconnecting) forceExit?.ref();
});
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
if (!process.connected) owner.abort();
try {
  try {
    if (index < 0 || !process.argv[index + 1]) throw new Error("CONFIG_REQUIRED");
    options = JSON.parse(await readFile(process.argv[index + 1], "utf8")) as ExtraConfiguration;
    owner.signal.throwIfAborted();
    execution = createExtraPort(options.endpoint, owner.signal);
    logs = new RuntimeLogging(options.logging);
    plugins = new ExtraPlugins([extraRegistration(options.declaration)], execution.port, (name) =>
      logs!.extra(name)
    );
    kernel = attachKernel({ endpoint: options.endpoint });
    const settings = options.declaration.config.context_loading;
    const timeout =
      settings &&
      typeof settings === "object" &&
      !Array.isArray(settings) &&
      typeof settings.timeout_ms === "number"
        ? settings.timeout_ms
        : 5000;
    proxy = options.proxy
      ? createDependencyProxy(channel, options.instance, options.epoch, timeout)
      : undefined;
    let dependencies: ChannelDependencies = proxy ?? {};
    if (options.dependencyModule) {
      if (!isAbsolute(options.dependencyModule.entrypoint) || options.proxy)
        throw new Error("EXTRA_DEPENDENCY_MODULE_INVALID");
      const loaded = (await import(
        pathToFileURL(options.dependencyModule.entrypoint).href
      )) as Record<string, unknown>;
      owner.signal.throwIfAborted();
      dependencies = loaded[options.dependencyModule.exportName] as ChannelDependencies;
      if (!dependencies || typeof dependencies !== "object")
        throw new Error("EXTRA_DEPENDENCY_MODULE_INVALID");
    }
    const registration = extraRegistration(options.declaration);
    if (options.declaration.enabled !== false) {
      const module = await registration.load();
      owner.signal.throwIfAborted();
      await plugins.load(
        module as ExtraPluginModule<ChannelDependencies>,
        registration.config,
        dependencies
      );
      owner.signal.throwIfAborted();
    }
    if (options.controlEndpoint) {
      if (process.platform !== "win32")
        await mkdir(dirname(options.controlEndpoint), { recursive: true, mode: 0o700 });
      owner.signal.throwIfAborted();
      releaseEndpoint = await acquireEndpoint(options.controlEndpoint);
      owner.signal.throwIfAborted();
      server = net.createServer((socket) => {
        if (owner.signal.aborted) {
          socket.destroy();
          return;
        }
        connections.add(socket);
        socket.once("close", () => connections.delete(socket));
        socket.on("error", () => socket.destroy());
        socket.setTimeout(5000, () => socket.destroy());
        const off = readBoundedLines(socket, 4096, {
          onError: () => socket.destroy(),
          onTooLarge: () => socket.destroy(),
          onClose: () => {},
          onLine(line) {
            off();
            try {
              const request = JSON.parse(line) as { id?: string; method?: string };
              if (request.method !== "status") throw new Error("METHOD_NOT_FOUND");
              void inspect().then(
                (status) =>
                  socket.end(
                    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { name: options.declaration.name, pid: process.pid, status } })}\n`
                  ),
                () => socket.destroy()
              );
            } catch {
              socket.destroy();
            }
          }
        });
      });
      listening = new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(options.controlEndpoint, resolve);
      });
      await listening;
      if (owner.signal.aborted) {
        await closeServer();
        owner.signal.throwIfAborted();
      }
      if (process.platform !== "win32") await chmod(options.controlEndpoint, 0o600);
      owner.signal.throwIfAborted();
    }
    owner.signal.throwIfAborted();
    if (process.connected) channel.send({ type: "component.ready" });
  } finally {
    initializationFinished();
  }
} catch {
  if (process.connected) channel.send({ type: "component.failed", error: "EXTRA_START_FAILED" });
  await stop();
}
