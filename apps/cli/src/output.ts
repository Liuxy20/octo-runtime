import { ServiceError } from "@mininglamp-oss/octo-runtime-cross-service";
import type { ServiceStatus } from "@mininglamp-oss/octo-runtime-cross-service";
import { RuntimeLogging } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  describeStartupError,
  formatStartupDiagnostic,
  restoreStartupDiagnostic,
  safeStartupValue,
  startupPathDiagnostic,
  STARTUP_CATALOG,
  type StartupLocation
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { open, readdir, mkdir, rename, rm, lstat } from "node:fs/promises";
import { join } from "node:path";

export interface ComponentSnapshot {
  service: ServiceStatus;
  runtime: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  String(value)
    .replace(/\p{Cc}/gu, " ")
    .slice(0, 200);
const stableCode = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : undefined;

/** 展示公开状态的摘要，不为输出克隆完整 session/delivery 集合。JSON 模式保留原结果。 */
export function formatStatus(name: string, snapshot: ComponentSnapshot): string {
  const service = snapshot.service;
  const runtime = record(snapshot.runtime);
  const business = record(runtime.status);
  const ipc = runtime.available === false ? "unavailable" : "ready";
  // 查询失败的 enabled=false 只是兼容占位值，不代表已确认关闭自启。
  const managerQueryFailed =
    service.state === "unknown" && service.detail && /^[A-Z][A-Z0-9_]+$/.test(service.detail);
  const autostart = managerQueryFailed ? "unknown" : service.enabled ? "on" : "off";
  const lines = [
    `${name}  service: ${service.state}  autostart: ${autostart}  IPC: ${ipc}`,
    `  Manager: ${service.manager}${service.pid ? `  PID: ${service.pid}` : runtime.pid ? `  PID: ${text(runtime.pid)}` : ""}`
  ];
  if (runtime.execution_ready !== undefined)
    lines.push(`  Execution: ${runtime.execution_ready ? "ready" : "unavailable"}`);
  if (runtime.available === false)
    lines.push(`  Reason: ${text(record(runtime.error).code ?? "COMPONENT_UNAVAILABLE")}`);
  if (service.lastExitCode !== undefined && service.lastExitCode !== 0)
    lines.push(`  Last exit: ${service.lastExitCode}`);
  if (service.definitionPath) lines.push(`  Definition: ${service.definitionPath}`);
  if (managerQueryFailed) lines.push(`  Manager status: ${service.detail}`);
  const summarize = (value: unknown, depth = 0): string => {
    if (Array.isArray(value)) return `${value.length} entries`;
    if (value !== null && typeof value === "object") {
      if (depth >= 2) return "...";
      return Object.entries(value)
        .slice(0, 8)
        .map(([key, item]) => `${text(key)}=${summarize(item, depth + 1)}`)
        .join(", ");
    }
    return text(value);
  };
  const fields = (value: Record<string, unknown>) => {
    const parts = Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "bots",
            "pid",
            "name",
            "kernel_available",
            "connection_key",
            "botId",
            "bot_id",
            "bot_name"
          ].includes(key)
      )
      .slice(0, 24)
      .map(([key, value]) => `${text(key)}: ${summarize(value)}`);
    const rows: string[] = [];
    for (const part of parts) {
      const last = rows.length - 1;
      if (last >= 0 && rows[last].length + part.length < 90) rows[last] += `  ${part}`;
      else rows.push(part);
    }
    return rows;
  };
  if (business.kernel_available !== undefined)
    lines.push(
      `  Kernel: ${business.kernel_available ? "ready" : "unavailable (service stays running)"}`
    );
  const summary = fields(business);
  lines.push(...summary.map((row) => `  ${row}`));
  if (Array.isArray(business.bots)) {
    lines.push(`  Bots: ${business.bots.length}`);
    for (const bot of business.bots.slice(0, 20)) {
      const value = record(bot);
      lines.push(`    ${text(value.bot_name ?? value.name ?? value.type ?? "bot")}`);
      lines.push(...fields(value).map((row) => `      ${row}`));
    }
    if (business.bots.length > 20) lines.push("    ...");
  }
  if (service.drift.length) lines.push(`  Drift: ${service.drift.map(text).join(", ")}`);
  return lines.join("\n");
}

/** 只保留受控错误码和管理器元信息；异常正文及任意 stderr 可能含凭据，不能直出。 */
export function describeError(
  error: unknown,
  fallback = "COMMAND_FAILED",
  startup?: StartupLocation
) {
  const field = (value: unknown, key: string): unknown => {
    try {
      return value !== null && typeof value === "object"
        ? Object.getOwnPropertyDescriptor(value, key)?.value
        : undefined;
    } catch {
      return undefined;
    }
  };
  const code =
    stableCode(field(error, "code")) ??
    (error instanceof Error ? stableCode(field(error, "message")) : undefined) ??
    fallback;
  const cause = field(error, "cause");
  const causeCode = stableCode(field(cause, "code")) ?? stableCode(field(cause, "message"));
  const projection = describeStartupError(error, startup);
  const pathDiagnostic = startupPathDiagnostic(projection);
  const diagnostic =
    startup ||
    pathDiagnostic ||
    field(field(error, "diagnostic"), "domain") === "startup" ||
    projection.causes.some((cause) => cause.component && cause.phase)
      ? projection
      : undefined;
  const hints: Record<string, string> = {
    COMMAND_FAILED: "The command failed. Check the native manager, configuration and service logs.",
    KERNEL_UNAVAILABLE:
      "Kernel is unavailable. Check executor-kernel status; Extras can remain running.",
    INVALID_ARGUMENTS: "Use --help to see the available commands and flags.",
    ORPHAN_CLEANUP_OWNER_ALIVE:
      "The original Kernel or worker is still alive or its identity cannot be verified. Stop it safely before acknowledging cleanup.",
    ORPHAN_CLEANUP_NOT_PENDING:
      "There is no valid incomplete orphan cleanup to acknowledge. Run doctor with the same --home.",
    EXTRA_COMMAND_FAILED:
      "The Extra command failed. No private backend error is printed; check its input and configuration, then retry.",
    EXTRA_CONFIG_CONFLICT:
      "Configuration changed after this command read it. Read the latest configuration and retry.",
    EXTRA_COMMAND_LOAD_FAILED:
      "The selected Extra command module or one of its dependencies is broken. Check its package and commands export; lifecycle commands remain available.",
    EXTRA_COMMAND_API_UNSUPPORTED:
      "This CLI supports Extra command apiVersion 1. Install a compatible command extension.",
    EXTRA_COMMAND_DEFINITION_INVALID:
      "Command definitions must have unique names and valid options; lifecycle and host option names are reserved.",
    EXTRA_COMMAND_NAMESPACE_CONFLICT:
      "An Extra name conflicts with a Runtime command. Rename its manifest entry.",
    EXTRA_COMMAND_NOT_FOUND:
      "Unknown command. Use --help on the service command to see available subcommands.",
    EXTRA_COMMAND_CANCELLED:
      "The command was cancelled. Any save that already completed remains persisted.",
    EXTRA_COMMAND_STDIN_REQUIRED:
      "Pipe the required input through stdin; do not put credentials in command arguments.",
    EXTRA_MANIFEST_DECLARATION_REQUIRED:
      "Install this Extra alongside the global Runtime, or add its name and module to the selected Home manifest.json (extras array), then retry.",
    EXTRA_MODULE_MIGRATION_REQUIRED:
      "The saved module differs from manifest.json. Review both declarations, then save matching module text or omit module from the Extra configuration."
  };
  return {
    code,
    message:
      diagnostic?.explanation ??
      STARTUP_CATALOG[code]?.action ??
      hints[code] ??
      "Check --help, component status and service logs for this operation.",
    ...(causeCode ? { cause_code: causeCode } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(pathDiagnostic
      ? { startup: pathDiagnostic, ...(diagnostic?.cleanup ? { cleanup: diagnostic.cleanup } : {}) }
      : {}),
    ...(error instanceof ServiceError
      ? {
          backend: error.backend,
          command: typeof error.command === "string" ? safeStartupValue(error.command) : undefined,
          exit_code: error.exitCode
        }
      : {})
  };
}

/** 保留兼容 code/cause_code；共享启动结构决定动态解释与下一步。 */
export function formatErrorDetails(failure: ReturnType<typeof describeError>): string {
  return failure.diagnostic ? formatStartupDiagnostic(failure.diagnostic) : failure.message;
}

/** 前台启动失败沿既有白名单和小时轮转落盘；不捕获任意进程 stdout/stderr。 */
export async function recordStartupFailure(
  directory: string,
  component: string,
  error: unknown
): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(component)) return;
  // Home 校验失败不得由诊断日志递归补建根目录（#306）。
  if (startupPathDiagnostic(describeStartupError(error))) return;
  const logging = new RuntimeLogging({ directory });
  try {
    // 单份最近失败记录拥有独立有界文件；不放宽通用日志的配置/异常白名单。
    const diagnostic = describeStartupError(error, { component, phase: "initializing" });
    const failure = describeError(error, "SERVICE_INITIALIZATION_FAILED");
    const file = join(directory, `startup-${component}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const line = JSON.stringify({
        schema_version: 1,
        time: new Date().toISOString(),
        component,
        code: failure.code,
        ...(failure.cause_code ? { cause_code: failure.cause_code } : {}),
        diagnostic
      });
      if (Buffer.byteLength(line) <= 262144) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(line);
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      }
    } catch {
      // 诊断落盘失败不能覆盖原始启动/清理错误，调用方仍持有完整安全投影。
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    const log = component === "executor-kernel" ? logging.kernel : logging.extra(component);
    if (failure.cause_code) log("error", "cli.initialization_cause", { code: failure.cause_code });
    log("error", "cli.initialization_failed", { code: failure.code });
  } finally {
    await logging.close();
  }
}

/** 只读本次 start 后的白名单失败事件；每个轮转文件最多读取末尾 64 KiB。 */
export async function readStartupFailure(
  directory: string,
  component: string,
  since: number
): Promise<Error | undefined> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(component)) return undefined;
  try {
    const file = await open(
      join(directory, `startup-${component}.json`),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    );
    try {
      const stat = await file.stat();
      if (!constants.O_NOFOLLOW) {
        const entry = await lstat(join(directory, `startup-${component}.json`));
        if (!entry.isFile() || entry.dev !== stat.dev || entry.ino !== stat.ino) return undefined;
      }
      if (stat.isFile() && stat.size <= 262144) {
        const bytes = Buffer.alloc(262145);
        let length = 0;
        while (length < bytes.length) {
          const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > 262144) return undefined;
        const row = record(JSON.parse(bytes.subarray(0, length).toString("utf8")));
        if (
          row.schema_version === 1 &&
          row.component === component &&
          typeof row.time === "string" &&
          Date.parse(row.time) >= since
        ) {
          const diagnostic = restoreStartupDiagnostic(row.diagnostic);
          const code = stableCode(row.code),
            causeCode = stableCode(row.cause_code);
          if (diagnostic && code)
            return Object.assign(
              new Error(code, causeCode ? { cause: new Error(causeCode) } : undefined),
              { diagnostic }
            );
        }
      }
    } finally {
      await file.close();
    }
  } catch {
    // 缺失、损坏或旧版本记录继续走既有白名单日志，不影响真实就绪等待。
  }
  const root = component === "executor-kernel" ? directory : join(directory, "extras");
  const prefix = component === "executor-kernel" ? "kernel-" : `${component}-`;
  try {
    const names = (await readdir(root))
      .filter((name) => name.startsWith(prefix) && /^.+-\d{8}T\d{2}\.log$/.test(name))
      .sort()
      .reverse()
      .slice(0, 3);
    for (const name of names) {
      const file = await open(join(root, name), "r");
      let content: string;
      try {
        const size = (await file.stat()).size;
        const bytes = Buffer.alloc(Math.min(size, 65536));
        await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
        content = bytes.toString("utf8");
      } finally {
        await file.close();
      }
      let cause: string | undefined;
      for (const line of content.split("\n")) {
        let row: Record<string, unknown>;
        try {
          row = record(JSON.parse(line));
        } catch {
          continue;
        }
        if (
          typeof row.time !== "string" ||
          !Number.isFinite(Date.parse(row.time)) ||
          Date.parse(row.time) < since
        )
          continue;
        if (
          component === "executor-kernel"
            ? row.source !== "kernel"
            : row.source !== "extra" || row.extra_type !== component
        )
          continue;
        const code = record(row.data).code;
        if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,100}$/.test(code)) continue;
        if (row.event === "cli.initialization_cause") cause = code;
        if (row.event === "cli.initialization_failed")
          return new Error(code, cause ? { cause: new Error(cause) } : undefined);
      }
    }
  } catch {
    /* 日志是尽力诊断；缺失或损坏时仍按真实 IPC/管理器状态等待。 */
  }
  return undefined;
}
