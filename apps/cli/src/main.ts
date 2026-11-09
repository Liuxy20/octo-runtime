import { loadCliAdapters } from "./adapters.js";
import { createCliKernelService } from "./kernel.js";
import { once } from "node:events";
import { join, resolve } from "node:path";
import {
  attachKernel,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  safeStartupValue,
  type KernelService
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  componentEndpoint,
  validateRuntimeHome,
  RuntimeHomeError
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { cliVersionInfo, lifecycleCommands } from "./help.js";
import { parseCliCommand } from "./command-tree.js";
import { runForegroundService } from "./foreground.js";
import { showKernelLogs } from "./logs.js";
import {
  selectRuntimeHome,
  prepareRuntimeHome,
  runtimePaths,
  withSetupLock,
  readJsonFile,
  type RuntimeHomeConfiguration,
  type ProfileConfiguration
} from "./state.js";
import { resolveServiceControl, type ServiceControlOptions } from "./service-control.js";
import { loadCliManifest } from "./module-manifest.js";
import { readCliAdapterConfigurations } from "./adapter-configurations.js";
import {
  describeError,
  formatErrorDetails,
  formatStatus,
  residentProcesses,
  formatResidentProcesses,
  recordStartupFailure,
  readStartupFailure,
  type ComponentSnapshot
} from "./output.js";

export interface CliDependencies extends ServiceControlOptions {
  /** 参数确认后通知可执行入口接管 Playboard 信号；可导入调用方默认保留协作取消。 */
  onPlayboardRun?: () => void;
  env?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream;
  output?: (line: string) => void;
  errorOutput?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** CLI 入口选择前台组件的退出策略；仅确认命令类型，不表示服务 ready。 */
  onComponentRun?: () => void;
  logsSignal?: AbortSignal;
  /** 自有命令的取消；不启动或停止任何服务。 */
  commandSignal?: AbortSignal;
}
const components = ["executor-kernel"] as const;
export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  // 参数解析失败也按宿主布尔标记输出 JSON；-- 后的字面位置参数不选择输出格式。
  const literalIndex = args.indexOf("--");
  let json = (literalIndex < 0 ? args : args.slice(0, literalIndex)).some(
    (arg) => arg === "--json" || arg.startsWith("--json=")
  );
  let context: { component?: string; action?: string; logs?: string } = {};
  // 实际日志 IO 仍使用原路径；失败输出的附带元信息与 diagnostic 使用同一净化。
  const failureContext = (): typeof context => ({
    component:
      context.component === undefined ? undefined : safeStartupValue(context.component, 128),
    action: context.action === undefined ? undefined : safeStartupValue(context.action, 128),
    logs: context.logs === undefined ? undefined : safeStartupValue(context.logs)
  });
  let runningComponent: string | undefined;
  try {
    const parsed = await parseCliCommand(args, dependencies);
    if (parsed.help !== undefined) {
      output(parsed.help);
      return 0;
    }
    const { flags, positional } = parsed;
    const action = positional[0];
    // 生命周期入口已平铺；内部服务身份仍用于锁、状态、日志与系统服务名称。
    context = lifecycleCommands.has(action)
      ? { component: "executor-kernel", action }
      : { component: positional[0], action: positional[1] };
    json = Boolean(flags.json);
    if (flags["acknowledge-orphan-cleanup"] !== undefined && action !== "recover")
      throw new Error("INVALID_ARGUMENTS");
    if ((flags.lines !== undefined || flags.follow !== undefined) && action !== "logs")
      throw new Error("INVALID_ARGUMENTS");
    if (flags.autostart !== undefined && action !== "install") throw new Error("INVALID_ARGUMENTS");
    if (flags.version || positional[0] === "version") {
      output(cliVersionInfo);
      return 0;
    }
    const home = selectRuntimeHome(flags.home, dependencies.env, dependencies.platform);
    // 先验证已存在的根，避免普通文件先退化成配置读取 ENOTDIR。
    // 缺失根只由后面已确认的宿主动作准备；未知/已移除命令不能因此创建 Home。
    if (["install", "start", "restart", "run"].includes(action)) {
      try {
        validateRuntimeHome(home);
      } catch (error) {
        if (!(error instanceof RuntimeHomeError && error.code === "HOME_NOT_FOUND")) throw error;
      }
    }
    // 模块清单不决定运行状态位置；前台 Kernel、doctor 和恢复确认共用 Home 下的同一路径。
    const kernelStateDirectory = join(home, "run");
    const kernelInvocationManifest = join(kernelStateDirectory, "kernel-invocations.json");
    // 恢复确认不加载 Provider 或访问服务管理器；原记录继续保留，下一次启动校验摘要后替换。
    if (action === "recover") {
      context = { component: "executor-kernel", action: "recover", logs: join(home, "logs") };
      if (
        positional.length !== 1 ||
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
          : `Orphan cleanup acknowledged. Evidence: ${recovery.archivePath}\nRun octo-runtime start again using the same --home.`
      );
      return 0;
    }
    // Route logs before config/module/manager access so offline failures remain diagnosable.
    if (action === "logs") {
      const component = "executor-kernel";
      context = {
        component: component,
        action: "logs",
        logs: join(home, "logs")
      };
      if (positional.length !== 1) throw new Error("INVALID_ARGUMENTS");
      if (flags.lines !== undefined && !/^[1-9][0-9]{0,4}$/.test(flags.lines))
        throw new Error("INVALID_ARGUMENTS");
      await showKernelLogs({
        home,
        component,
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
    const serviceArgs = [
      ...(flags.profile ? ["--profile", profile] : []),
      ...(flags.manifest ? ["--manifest", resolve(flags.manifest)] : [])
    ];
    const paths = runtimePaths(home, profile, dependencies.platform);
    // 配置/恢复和 Playboard 不使用常驻端点；只在实际连接或托管常驻服务时派生并校验。
    const kernelEndpoint = () => componentEndpoint(home, "executor-kernel", dependencies.platform);
    context = { ...context, logs: join(home, "logs") };
    // 部署、停止及配置修复命令不启动模块，也不因尚未可读的启动清单而无法操作。
    const needsManifest = action === "run";
    const manifest = needsManifest
      ? await loadCliManifest(
          home,
          flags.manifest,
          dependencies.errorOutput ?? ((message) => process.stderr.write(`${message}\n`))
        )
      : undefined;
    const componentNames = [...components];
    const service = resolveServiceControl(dependencies);
    const input = dependencies.input ?? process.stdin;
    const publish = (value: unknown, human?: string) =>
      output(
        typeof value === "string" ? value : !json && human ? human : JSON.stringify(value, null, 2)
      );
    const snapshot = async (component: string): Promise<ComponentSnapshot> => {
      const inspect = async () => {
        let spec = service.spec(home, component, false, serviceArgs);
        let native = await service.backend.inspect(spec);
        // 自启是已安装服务的事实，不能用 status 的默认 spec(false) 伪造配置漂移。
        if (native.enabled) {
          spec = { ...spec, enabled: true };
          native = await service.backend.inspect(spec);
        }
        return native;
      };
      // 原生管理器和 IPC 是两条独立事实；管理器失效不能跳过 Kernel 自身的 status。
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
    if (positional[0] === "playboard" && positional.length === 1) {
      dependencies.onPlayboardRun?.();
      const { runPlayboard } = await import("./playboard.js");
      return runPlayboard({
        home,
        profile,
        manifest: flags.manifest,
        input,
        output: dependencies.output,
        env: dependencies.env,
        handleSignals: !dependencies.onPlayboardRun
      });
    }
    if (positional[0] === "adapter" && positional[1] === "list" && positional.length === 2) {
      const client = attachKernel({ endpoint: kernelEndpoint() });
      try {
        publish(await client.list());
      } finally {
        client.close();
      }
      return 0;
    }
    if (positional[0] === "adapter" && positional[1] === "probe" && positional.length === 3) {
      const client = attachKernel({ endpoint: kernelEndpoint() });
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
      const processes = residentProcesses(status);
      publish(
        { manager, checks, recovery, processes },
        `Manager: ${manager.manager} (${manager.supported ? "available" : "unavailable"})\n\n${Object.entries(
          status
        )
          .map(([name, value]) => formatStatus(name, value))
          .join(
            "\n\n"
          )}\n\n${formatResidentProcesses(processes)}\n\nOrphan cleanup: ${recovery.state}\nManifest: ${recovery.manifestPath}${recovery.state === "cleanup_incomplete" ? "\nStop all orphan tools, then run octo-runtime recover --acknowledge-orphan-cleanup with the same --home." : ""}`
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
    const component = "executor-kernel";
    if (
      positional.length !== 1 ||
      !["uninstall", "install", "start", "restart", "stop", "run"].includes(action)
    )
      throw new Error("INVALID_ARGUMENTS");
    if (["install", "start", "restart", "run"].includes(action))
      componentEndpoint(home, component, dependencies.platform);
    if (action === "run") {
      if (!manifest) throw new Error("MANIFEST_INVALID");
      runningComponent = component;
      dependencies.onComponentRun?.();
      await prepareRuntimeHome(home);
      let handle: KernelService;
      {
        const config = await readJsonFile<ProfileConfiguration>(paths.profileConfig);
        handle = await createCliKernelService(
          {
            home,
            logging: { directory: join(home, "logs") },
            endpoint: kernelEndpoint(),
            stateDirectory: kernelStateDirectory,
            adapterConfigurations: await readCliAdapterConfigurations(
              paths.profileRoot,
              config?.adapters,
              manifest,
              dependencies.env ?? process.env
            )
          },
          await loadCliAdapters(manifest.adapters, {
            profileRoot: paths.profileRoot,
            syncOpenClawTools: true,
            env: dependencies.env ?? process.env
          })
        );
      }
      return await runForegroundService(
        handle,
        () => publish({ component, state: "ready" }, `${component}: ready`),
        async (error: unknown) => {
          try {
            await recordStartupFailure(join(home, "logs"), component, error);
          } finally {
            const failure = {
              ...describeError(error, "SERVICE_INITIALIZATION_FAILED", {
                component,
                phase: "initializing"
              }),
              ...failureContext()
            };
            if (json) publish({ error: failure });
            else
              (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
                `${component}: ${failure.code}${failure.cause_code ? ` (${failure.cause_code})` : ""}\n${formatErrorDetails(failure)}\nLogs: ${failure.logs}`
              );
          }
        }
      );
    }
    let spec = service.spec(home, component, false, serviceArgs);
    // 同组件所有部署修改及最终状态确认串行；不同组件仍可独立启动。
    return await withSetupLock(
      { ...paths, setupLock: join(home, "run", `${component}.setup.lock`) },
      async () => {
        if (action === "install") {
          spec = { ...spec, enabled: flags.autostart !== "false" };
          await prepareRuntimeHome(home);
          await service.backend.install(spec);
        } else {
          if (action === "start") {
            const before = await service.backend.inspect(spec);
            if (before.state === "not_installed") {
              const progress =
                dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`));
              progress(`${component}: service not installed; installing with autostart enabled...`);
              spec = { ...spec, enabled: true };
              await prepareRuntimeHome(home);
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
          `${component}: ${action} succeeded\nService: ${native.state}  Autostart: ${native.enabled ? "on" : "off"}\n${action === "install" ? `Next: octo-runtime start --home ${JSON.stringify(home)}\n` : ""}Logs: ${join(home, "logs")}`
        );
        return 0;
      }
    );
  } catch (error) {
    if (runningComponent && context.logs)
      await recordStartupFailure(context.logs, runningComponent, error);
    const failure = {
      ...describeError(
        error,
        "COMMAND_FAILED",
        ["run", "start", "restart", "install"].includes(context.action ?? "")
          ? {
              component: context.component ?? "cli",
              phase: runningComponent ? "initializing" : "created"
            }
          : undefined
      ),
      ...failureContext()
    };
    const code = failure.code;
    if (json)
      output(JSON.stringify({ error: failure }, null, context.action === "logs" ? undefined : 2));
    else
      (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `${[failure.component, failure.action].filter(Boolean).join(" ") || "octo-runtime"}: ${code}${failure.cause_code ? ` (${failure.cause_code})` : ""}\n${formatErrorDetails(failure)}${failure.logs ? `\nLogs: ${failure.logs}` : ""}`
      );
    return ["SERVICE_NOT_INSTALLED", "NOT_INSTALLED"].includes(code)
      ? 3
      : /INVALID|REQUIRED|COMMAND_NOT_FOUND/.test(code)
        ? 2
        : /INCOMPLETE/.test(code)
          ? 5
          : /UNAVAILABLE|SERVICE_PROCESS_EXITED/.test(code)
            ? 4
            : 1;
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
  throw new Error("INVALID_ARGUMENTS");
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
