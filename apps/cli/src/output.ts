import { ServiceError } from "@mininglamp-oss/octo-runtime-cross-service";
import type { ServiceStatus } from "@mininglamp-oss/octo-runtime-cross-service";
import { RuntimeLogging } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { open, readdir } from "node:fs/promises";
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

/** 展示公开状态的摘要，不为输出克隆完整 session/delivery 集合。JSON 模式保留原结果。 */
export function formatStatus(name: string, snapshot: ComponentSnapshot): string {
  const service = snapshot.service;
  const runtime = record(snapshot.runtime);
  const business = record(runtime.status);
  const ipc = runtime.available === false ? "unavailable" : "ready";
  const lines = [
    `${name}  service: ${service.state}  autostart: ${service.enabled ? "on" : "off"}  IPC: ${ipc}`,
    `  Manager: ${service.manager}${service.pid ? `  PID: ${service.pid}` : runtime.pid ? `  PID: ${text(runtime.pid)}` : ""}`
  ];
  if (runtime.execution_ready !== undefined)
    lines.push(`  Worker: ${runtime.execution_ready ? "ready" : "unavailable"}`);
  const recovery = record(record(runtime.worker).recovery);
  if (recovery.code) {
    lines.push(
      `  Recovery: ${text(recovery.stage)} (${text(recovery.code)})${recovery.retry_at ? `  Next retry: ${text(recovery.retry_at)}` : ""}`
    );
    lines.push("  Diagnostics: octo-runtime executor-kernel logs --follow (use the same --home)");
  }
  if (runtime.available === false)
    lines.push(`  Reason: ${text(record(runtime.error).code ?? "COMPONENT_UNAVAILABLE")}`);
  if (service.lastExitCode !== undefined && service.lastExitCode !== 0)
    lines.push(`  Last exit: ${service.lastExitCode}`);
  if (service.definitionPath) lines.push(`  Definition: ${service.definitionPath}`);
  if (service.state === "unknown" && service.detail && /^[A-Z][A-Z0-9_]+$/.test(service.detail))
    lines.push(`  Manager status: ${service.detail}`);
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
export function describeError(error: unknown, fallback = "COMMAND_FAILED") {
  const stableCode = (value: unknown): string | undefined =>
    typeof value === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : undefined;
  const value = record(error);
  const code =
    stableCode(value.code) ??
    (error instanceof Error ? stableCode(error.message) : undefined) ??
    fallback;
  const cause = record(value.cause);
  const causeCode = stableCode(cause.code) ?? stableCode(cause.message);
  const hints: Record<string, string> = {
    COMMAND_FAILED: "The command failed. Check the native manager, configuration and service logs.",
    ENOENT:
      "The component endpoint or required file does not exist. Check installation and service status.",
    ECONNREFUSED: "The component is not accepting IPC connections. Check its process and logs.",
    KERNEL_UNAVAILABLE:
      "Kernel is unavailable. Check executor-kernel status; Extras can remain running.",
    INVALID_ARGUMENTS: "Use --help to see the available commands and flags.",
    SETUP_IN_PROGRESS:
      "Another component lifecycle operation is in progress. Wait for it to finish, then retry.",
    ORPHAN_CLEANUP_INCOMPLETE:
      "Run doctor with the same --home to inspect the manifest. After stopping all orphan tools, run executor-kernel recover --acknowledge-orphan-cleanup, then start again.",
    ORPHAN_CLEANUP_OWNER_ALIVE:
      "The original Kernel or worker is still alive or its identity cannot be verified. Stop it safely before acknowledging cleanup.",
    ORPHAN_CLEANUP_NOT_PENDING:
      "There is no valid incomplete orphan cleanup to acknowledge. Run doctor with the same --home.",
    SERVICE_NOT_INSTALLED: "Run this component's install command, then start it.",
    NOT_INSTALLED: "Run this component's install command, then start it.",
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
    EXTRA_NOT_REGISTERED:
      "Save the service configuration using its configure or extraset subcommand before starting it.",
    EXTRA_MANIFEST_DECLARATION_REQUIRED:
      "Install this Extra alongside the global Runtime, or add its name and module to the selected Home manifest.json (extras array), then retry.",
    EXTRA_NAME_MISMATCH:
      "The selected Extra must export the same name as its catalog entry. Check the reported package origin.",
    EXTRA_MODULE_LOAD_FAILED:
      "Check the selected catalog declaration, discovery diagnostics, installation and ESM exports; reinstall it or select a valid Home manifest entry, then retry.",
    EXTRA_MODULE_MIGRATION_REQUIRED:
      "The saved module differs from manifest.json. Review both declarations, then save matching module text or omit module from the Extra configuration.",
    MANIFEST_INVALID:
      "Check manifest.json: version must be 1 and adapters/extras must be valid arrays without duplicate keys.",
    MANAGER_UNAVAILABLE: "Run doctor and check the current user's native service manager.",
    COMPONENT_UNAVAILABLE:
      "Check component status and the service logs; the IPC or worker is not ready.",
    SERVICE_PROCESS_EXITED: "The service exited unexpectedly. Check its logs and configuration.",
    SERVICE_INITIALIZATION_FAILED: "Check the component configuration, manifest and service logs.",
    SERVICE_DISABLED: "Enable this component with install --autostart=true, then start it."
  };
  return {
    code,
    message: hints[code] ?? "Check --help, component status and service logs for this operation.",
    ...(causeCode ? { cause_code: causeCode } : {}),
    ...(error instanceof ServiceError
      ? { backend: error.backend, command: error.command, exit_code: error.exitCode }
      : {})
  };
}

/** 前台启动失败沿既有白名单和小时轮转落盘；不捕获任意进程 stdout/stderr。 */
export async function recordStartupFailure(
  directory: string,
  component: string,
  error: unknown
): Promise<void> {
  const logging = new RuntimeLogging({ directory });
  try {
    const log = component === "executor-kernel" ? logging.kernel : logging.extra(component);
    const failure = describeError(error, "SERVICE_INITIALIZATION_FAILED");
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
