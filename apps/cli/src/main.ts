import net from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachKernel,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  createKernelService,
  type KernelService,
  readAdapterConfigurations
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  componentEndpoint,
  createExtraService,
  type ExtraService
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { getExtra, readExtra, setExtra } from "./extras.js";
import { cliVersionInfo, helpText } from "./help.js";
import { runForegroundService } from "./foreground.js";
import { showExtraLogs } from "./logs.js";
import { StatusOutput } from "./status-output.js";
import {
  defaultRuntimeHome,
  runtimePaths,
  withSetupLock,
  readJsonFile,
  type RuntimeHomeConfiguration,
  type ProfileConfiguration
} from "./state.js";
import { resolveServiceControl, type ServiceControlOptions } from "./service-control.js";
import { loadCliManifest } from "./module-manifest.js";
import { resolveAdapterModules } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { readExtraDirectory } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  describeError,
  formatStatus,
  recordStartupFailure,
  readStartupFailure,
  type ComponentSnapshot
} from "./output.js";

export interface CliDependencies extends ServiceControlOptions {
  env?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream;
  output?: (line: string) => void;
  errorOutput?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** CLI 入口选择前台组件的退出策略；仅确认命令类型，不表示服务 ready。 */
  onComponentRun?: () => void;
  logsSignal?: AbortSignal;
}
const components = ["executor-kernel", "channel-gateway"] as const;
const builtinComponents: readonly string[] = [...components, "channel-wecom", "webui"];
export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  let json = args.includes("--json");
  let context: { component?: string; action?: string; logs?: string } = {};
  let runningComponent: string | undefined;
  let statusOutput: StatusOutput | undefined;
  try {
    const { flags, positional } = parse(args);
    if (
      flags["acknowledge-orphan-cleanup"] !== undefined &&
      !(positional[0] === "executor-kernel" && positional[1] === "recover")
    )
      throw new Error("INVALID_ARGUMENTS");
    if ((flags.lines !== undefined || flags.follow !== undefined) && positional[1] !== "logs")
      throw new Error("INVALID_ARGUMENTS");
    json = Boolean(flags.json);
    if (flags.version || positional[0] === "version") {
      output(cliVersionInfo);
      return 0;
    }
    if (flags.help || !positional.length || positional[0] === "help") {
      output(helpText(builtinComponents.includes(positional[0]) ? positional[0] : undefined));
      return 0;
    }
    // 裸组件帮助仅做词法校验，不读取配置或创建服务管理器。
    if (positional.length === 1 && builtinComponents.includes(positional[0])) {
      output(helpText(positional[0]));
      return 0;
    }
    const home = resolve(flags.home ?? defaultRuntimeHome(dependencies.env, dependencies.platform));
    // 模块清单不决定运行状态位置；前台 Kernel、doctor 和恢复确认共用 Home 下的同一路径。
    const kernelStateDirectory = join(home, "run");
    const kernelInvocationManifest = join(kernelStateDirectory, "kernel-invocations.json");
    // 恢复确认不加载 Provider 或访问服务管理器；原记录继续保留，下一次启动校验摘要后替换。
    if (positional[0] === "executor-kernel" && positional[1] === "recover") {
      context = { component: "executor-kernel", action: "recover", logs: join(home, "logs") };
      if (
        positional.length !== 2 ||
        flags["acknowledge-orphan-cleanup"] !== "true" ||
        flags.autostart !== undefined
      )
        throw new Error("INVALID_ARGUMENTS");
      const recovery = await withSetupLock(
        {
          ...runtimePaths(home, "default", dependencies.platform),
          setupLock: join(kernelStateDirectory, "executor-kernel.setup.lock")
        },
        () => acknowledgeOrphanCleanup(kernelInvocationManifest)
      );
      output(
        json
          ? JSON.stringify(recovery)
          : `Orphan cleanup acknowledged. Evidence: ${recovery.archivePath}\nStart executor-kernel again using the same --home.`
      );
      return 0;
    }
    // Route logs before config/module/manager access so offline failures remain diagnosable.
    if (positional[1] === "logs") {
      const extra = positional[0];
      context = { component: extra, action: "logs", logs: join(home, "logs", "extras") };
      if (
        positional.length !== 2 ||
        extra === "executor-kernel" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(extra) ||
        flags.autostart !== undefined
      )
        throw new Error("INVALID_ARGUMENTS");
      if (!builtinComponents.includes(extra)) {
        const registration = await lstat(join(home, "extras", extra, "config.json")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }
        );
        if (!registration?.isFile() || registration.isSymbolicLink())
          throw new Error("EXTRA_NOT_FOUND");
      }
      if (flags.lines !== undefined && !/^[1-9][0-9]{0,4}$/.test(flags.lines))
        throw new Error("INVALID_ARGUMENTS");
      await showExtraLogs({
        home,
        extra,
        lines: Number(flags.lines ?? 200),
        follow: Boolean(flags.follow),
        json,
        output:
          dependencies.output ??
          (async (line, signal) => {
            if (!process.stdout.write(`${line}\n`)) await once(process.stdout, "drain", { signal });
          }),
        errorOutput:
          dependencies.errorOutput ??
          ((line) => {
            process.stderr.write(`${line}\n`);
          }),
        signal: dependencies.logsSignal
      });
      return 0;
    }
    const root = await readJsonFile<RuntimeHomeConfiguration>(
      runtimePaths(home, "default").rootConfig
    );
    const profile = flags.profile ?? root?.default_profile ?? "default";
    const paths = runtimePaths(home, profile, dependencies.platform);
    const endpoint = componentEndpoint(home, "executor-kernel", dependencies.platform);
    context = { component: positional[0], action: positional[1], logs: join(home, "logs") };
    const registrations = await readExtraDirectory(join(home, "extras"));
    // 部署、停止及配置修复命令不启动模块，也不因尚未可读的启动清单而无法操作。
    const needsManifest =
      positional[1] === "run" ||
      (!builtinComponents.includes(positional[0]) &&
        !registrations.some((entry) => entry.name === positional[0]) &&
        ["install", "start", "restart", "stop", "uninstall", "status"].includes(positional[1]));
    const manifest = needsManifest
      ? await loadCliManifest(
          home,
          flags.manifest,
          dependencies.errorOutput ?? ((message) => process.stderr.write(`${message}\n`))
        )
      : undefined;
    const componentNames = [
      ...new Set([...components, ...registrations.map((entry) => entry.name)])
    ];
    const isComponent = (name: string) =>
      builtinComponents.includes(name) ||
      registrations.some((entry) => entry.name === name) ||
      manifest?.extras.some((entry) => entry.name === name) === true;
    if (positional.length === 1 && isComponent(positional[0])) {
      output(helpText(positional[0]));
      return 0;
    }
    const service = resolveServiceControl(dependencies);
    const input = dependencies.input ?? process.stdin;
    const publish = (value: unknown, human?: string) =>
      output(
        typeof value === "string" ? value : !json && human ? human : JSON.stringify(value, null, 2)
      );
    const snapshot = async (component: string): Promise<ComponentSnapshot> => {
      const inspect = async () => {
        let spec = service.spec(home, component);
        let native = await service.backend.inspect(spec);
        // 自启是已安装服务的事实，不能用 status 的默认 spec(false) 伪造配置漂移。
        if (native.enabled) {
          spec = { ...spec, enabled: true };
          native = await service.backend.inspect(spec);
        }
        return native;
      };
      // 原生管理器和 IPC 是两条独立事实；管理器失效不能跳过 Extra 自身的 status。
      const [native, runtime] = await Promise.all([
        inspect().catch((error: unknown) => ({
          manager: service.backend.kind,
          state: "unknown" as const,
          enabled: false,
          drift: [],
          detail: describeError(error).code
        })),
        componentStatus(home, component, dependencies.platform).catch((error: unknown) => ({
          available: false,
          error: describeError(error, "COMPONENT_UNAVAILABLE")
        }))
      ]);
      return { service: native, runtime };
    };
    const snapshots = async (names: string[]) =>
      Object.fromEntries(
        await Promise.all(
          names.map(async (name): Promise<[string, ComponentSnapshot]> => [
            name,
            await snapshot(name)
          ])
        )
      );
    if (["extraset", "extraget"].includes(positional[0]) && flags.profile)
      throw new Error("INVALID_ARGUMENTS");
    if (positional[0] === "extraset" && positional.length === 2) {
      publish(await setExtra(paths, positional[1], input));
      return 0;
    }
    if (positional[0] === "extraget" && positional.length === 2) {
      // 配置命令是数据接口，保持紧凑 JSON 与慢管道完整输出合同。
      output(JSON.stringify(await getExtra(paths, positional[1])));
      (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `Config file: ${join(home, "extras", positional[1], "config.json")}`
      );
      return 0;
    }
    if (positional[0] === "playboard" && positional.length === 1) {
      const { runPlayboard } = await import("./playboard.js");
      return runPlayboard({
        home,
        profile,
        manifest: flags.manifest,
        input,
        output: dependencies.output
      });
    }
    if (positional[0] === "adapter" && positional[1] === "list" && positional.length === 2) {
      const client = attachKernel({ endpoint });
      try {
        publish(await client.list());
      } finally {
        client.close();
      }
      return 0;
    }
    if (positional[0] === "adapter" && positional[1] === "probe" && positional.length === 3) {
      const client = attachKernel({ endpoint });
      try {
        const adapter = (await client.list()).find((value) => value.type === positional[2]);
        if (!adapter) throw new Error("ADAPTER_NOT_FOUND");
        publish(adapter);
      } finally {
        client.close();
      }
      return 0;
    }
    if (positional[0] === "doctor" && positional.length === 1) {
      const manager = await service.backend.probe();
      const status = await snapshots(componentNames);
      const checks = Object.entries(status).map(([component, value]) => ({ component, ...value }));
      const recovery = await inspectOrphanCleanup(kernelInvocationManifest);
      publish(
        { manager, checks, recovery },
        `Manager: ${manager.manager} (${manager.supported ? "available" : "unavailable"})\n\n${Object.entries(
          status
        )
          .map(([name, value]) => formatStatus(name, value))
          .join(
            "\n\n"
          )}\n\nOrphan cleanup: ${recovery.state}\nManifest: ${recovery.manifestPath}${recovery.state === "cleanup_incomplete" ? "\nStop all orphan tools, then run executor-kernel recover --acknowledge-orphan-cleanup with the same --home." : ""}`
      );
      return 0;
    }
    if (positional[0] === "status" && positional.length === 1) {
      const status = await snapshots(componentNames);
      publish(
        status,
        Object.entries(status)
          .map(([name, value]) => formatStatus(name, value))
          .join("\n\n")
      );
      return 0;
    }
    const component = positional[0],
      action = positional[1];
    if (
      !isComponent(component) ||
      positional.length !== 2 ||
      !["uninstall", "install", "start", "restart", "stop", "run", "status"].includes(action)
    )
      throw new Error("INVALID_ARGUMENTS");
    if (flags.autostart !== undefined && action !== "install") throw new Error("INVALID_ARGUMENTS");
    if (action === "status") {
      const status = await snapshots([component]);
      publish(status[component], formatStatus(component, status[component]));
      return 0;
    }
    if (action === "run") {
      if (!manifest) throw new Error("MANIFEST_INVALID");
      runningComponent = component;
      dependencies.onComponentRun?.();
      await mkdir(home, { recursive: true, mode: 0o700 });
      let handle: KernelService | ExtraService;
      if (component === "executor-kernel") {
        const config = await readJsonFile<ProfileConfiguration>(paths.profileConfig);
        handle = createKernelService({
          endpoint,
          stateDirectory: kernelStateDirectory,
          workerEntrypoint: fileURLToPath(new URL("./worker.js", import.meta.url)),
          adapterModules: resolveAdapterModules(manifest),
          adapterConfigurations: readAdapterConfigurations(paths.profileRoot, config?.adapters),
          env: {
            ...(dependencies.env ?? process.env),
            OCTO_RUNTIME_HOME: home,
            OCTO_RUNTIME_CLI_PROFILE_ROOT: paths.profileRoot,
            OCTO_RUNTIME_CLI_SYNC_OPENCLAW_TOOLS: "1",
            OCTO_RUNTIME_LOGS_DIRECTORY: join(home, "logs")
          }
        });
      } else {
        const registration = await readExtra(paths, component, manifest);
        const module =
          registration.enabled === false
            ? { name: registration.name, default: () => () => {} }
            : await registration.load();
        if (module.name !== registration.name) throw new Error("EXTRA_NAME_MISMATCH");
        if (!dependencies.output) statusOutput = new StatusOutput(process.stdout);
        handle = createExtraService({
          logging: {
            directory: join(home, "logs"),
            statusOutput: dependencies.output
              ? (record) => output(JSON.stringify(record))
              : statusOutput!.write
          },
          module,
          config: registration.config,
          dependencies: {},
          enabled: registration.enabled,
          endpoint,
          controlEndpoint: componentEndpoint(home, component, dependencies.platform)
        });
      }
      return await runForegroundService(
        handle,
        () => publish({ component, state: "ready" }, `${component}: ready`),
        async (error: unknown) => {
          try {
            await recordStartupFailure(join(home, "logs"), component, error);
          } finally {
            const failure = {
              ...describeError(error, "SERVICE_INITIALIZATION_FAILED"),
              ...context
            };
            if (json) publish({ error: failure });
            else
              (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
                `${component}: ${failure.code}${failure.cause_code ? ` (${failure.cause_code})` : ""}\n${failure.message}\nLogs: ${context.logs}`
              );
          }
        }
      );
    }
    const serviceArgs = [
      ...(flags.profile ? ["--profile", profile] : []),
      ...(flags.manifest ? ["--manifest", resolve(flags.manifest)] : [])
    ];
    let spec = service.spec(home, component, false, serviceArgs);
    // 同组件所有部署修改及最终状态确认串行；不同组件仍可独立启动。
    return await withSetupLock(
      { ...paths, setupLock: join(home, "run", `${component}.setup.lock`) },
      async () => {
        if (action === "install") {
          spec = { ...spec, enabled: flags.autostart !== "false" };
          await mkdir(home, { recursive: true, mode: 0o700 });
          await service.backend.install(spec);
        } else {
          if (action === "start") {
            const before = await service.backend.inspect(spec);
            if (before.state === "not_installed") {
              const progress =
                dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
              progress(`${component}: service not installed; installing with autostart enabled...`);
              spec = { ...spec, enabled: true };
              await mkdir(home, { recursive: true, mode: 0o700 });
              await service.backend.install(spec);
              progress(`${component}: installation complete; starting service...`);
            }
          } else if (action === "restart") {
            const before = await service.backend.inspect(spec);
            if (before.state === "not_installed") throw new Error("SERVICE_NOT_INSTALLED");
          }
          if (action === "uninstall") await service.backend.uninstall(spec);
          if (action === "stop") await service.backend.stop(spec);
          const startedAt = Date.now();
          if (action === "start") await service.backend.start(spec);
          if (action === "restart") await service.backend.restart(spec);
          if (action === "start" || action === "restart") {
            const end = Date.now() + 30_000;
            while (true) {
              try {
                await componentStatus(home, component, dependencies.platform, true);
                break;
              } catch (error) {
                const failure = await readStartupFailure(join(home, "logs"), component, startedAt);
                if (failure) throw failure;
                // LastTaskResult/ExecMainStatus 可能仍属于旧进程；无本次失败证据就保留就绪预算。
                if (Date.now() >= end) throw new Error("COMPONENT_UNAVAILABLE", { cause: error });
                await (dependencies.sleep ?? sleep)(100);
              }
            }
          }
        }
        if (action === "start" || action === "restart") {
          const status = await snapshot(component);
          publish(
            { component, action, ...status },
            `${component}: ${action} succeeded\n${formatStatus(component, status)}\nLogs: ${join(home, "logs")}`
          );
          return 0;
        }
        // 后续操作不把默认的 false 当作修改已安装服务自启的意图。
        const native = await service.backend.inspect(spec);
        publish(
          { component, action, service: native },
          `${component}: ${action} succeeded\nService: ${native.state}  Autostart: ${native.enabled ? "on" : "off"}\n${action === "install" ? `Next: octo-runtime ${component} start --home ${JSON.stringify(home)}\n` : ""}Logs: ${join(home, "logs")}`
        );
        return 0;
      }
    );
  } catch (error) {
    if (runningComponent && context.logs)
      await recordStartupFailure(context.logs, runningComponent, error);
    const failure = { ...describeError(error), ...context };
    const code = failure.code;
    if (json)
      output(JSON.stringify({ error: failure }, null, context.action === "logs" ? undefined : 2));
    else
      (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `${[context.component, context.action].filter(Boolean).join(" ") || "octo-runtime"}: ${code}${failure.cause_code ? ` (${failure.cause_code})` : ""}\n${failure.message}${context.logs ? `\nLogs: ${context.logs}` : ""}`
      );
    return ["SERVICE_NOT_INSTALLED", "NOT_INSTALLED"].includes(code)
      ? 3
      : /INVALID|REQUIRED/.test(code)
        ? 2
        : /INCOMPLETE/.test(code)
          ? 5
          : /UNAVAILABLE|SERVICE_PROCESS_EXITED/.test(code)
            ? 4
            : 1;
  } finally {
    statusOutput?.close();
  }
}
async function componentStatus(
  home: string,
  component: string,
  platform?: NodeJS.Platform,
  requireReady = false
): Promise<unknown> {
  const endpoint = componentEndpoint(home, component, platform);
  if (component === "executor-kernel") {
    const client = attachKernel({ endpoint });
    try {
      const status = await client.status();
      if (requireReady && !status.execution_ready) throw new Error("COMPONENT_UNAVAILABLE");
      return status;
    } finally {
      client.close();
    }
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const id = randomUUID();
    let bytes = "";
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("COMPONENT_UNAVAILABLE"));
    });
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "status" })}\n`)
    );
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.toString("utf8");
      if (bytes.length > 65536) {
        socket.destroy();
        reject(new Error("INVALID_RESPONSE"));
        return;
      }
      if (bytes.includes("\n")) {
        try {
          const response = JSON.parse(bytes.slice(0, bytes.indexOf("\n"))) as {
            jsonrpc?: unknown;
            id?: unknown;
            result?: { name?: unknown; pid?: unknown; status?: unknown };
          };
          if (
            response.jsonrpc !== "2.0" ||
            response.id !== id ||
            response.result?.name !== component ||
            typeof response.result.pid !== "number" ||
            !response.result.status ||
            typeof response.result.status !== "object"
          )
            throw new Error("INVALID_RESPONSE");
          resolve(response.result);
        } catch {
          reject(new Error("INVALID_RESPONSE"));
        }
        socket.destroy();
      }
    });
    socket.once("end", () => {
      if (!bytes.includes("\n")) reject(new Error("COMPONENT_UNAVAILABLE"));
    });
  });
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function parse(args: string[]) {
  const flags: Record<string, string> = {},
    positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] === "-h" ? "--help" : args[i] === "-v" ? "--version" : args[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (
      !match ||
      ![
        "home",
        "profile",
        "manifest",
        "json",
        "help",
        "version",
        "autostart",
        "lines",
        "follow",
        "acknowledge-orphan-cleanup"
      ].includes(match[1]) ||
      Object.hasOwn(flags, match[1])
    )
      throw new Error("INVALID_ARGUMENTS");
    const key = match[1];
    flags[key] = ["json", "help", "version", "follow", "acknowledge-orphan-cleanup"].includes(key)
      ? "true"
      : (match[2] ?? args[++i]);
    if (key === "acknowledge-orphan-cleanup" && match[2] !== undefined)
      throw new Error("INVALID_ARGUMENTS");
    if (
      !flags[key] ||
      flags[key].startsWith("--") ||
      (key === "autostart" && !["true", "false"].includes(flags[key]))
    )
      throw new Error("INVALID_ARGUMENTS");
  }
  return { flags, positional };
}
