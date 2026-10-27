import type { RuntimeLogLevel } from "./runtime-log.js";

export interface ExtraStatusRecord {
  time: string;
  level: RuntimeLogLevel;
  source: "extra";
  extra_type: string;
  event: string;
  data: Record<string, string | number>;
}

export interface KernelStatusRecord {
  time: string;
  level: RuntimeLogLevel;
  source: "kernel";
  event: string;
  data: Record<string, string | number>;
}

/** Kernel 父进程的监督诊断白名单；读盘时也重建，绝不包含执行正文或原始异常。 */
export function kernelStatusRecord(
  level: RuntimeLogLevel,
  event: string,
  data?: Readonly<Record<string, unknown>>,
  time = new Date().toISOString()
): KernelStatusRecord | undefined {
  if (
    !["info", "warn", "error"].includes(level) ||
    ![
      "worker.ready",
      "worker.lost",
      "worker.recovery_blocked",
      "worker.retry_scheduled",
      "worker.start_failed"
    ].includes(event) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) ||
    !Number.isFinite(Date.parse(time))
  )
    return;
  const safe: Record<string, string | number> = {};
  for (const key of ["code", "signal", "trigger", "stage", "occurred_at", "retry_at"]) {
    const value = data?.[key];
    if (typeof value !== "string") continue;
    const valid =
      key === "code"
        ? /^[A-Z][A-Z0-9_]{0,95}$/.test(value)
        : key === "signal"
          ? /^SIG[A-Z0-9]+$/.test(value)
          : key === "trigger"
            ? ["exit", "error", "heartbeat", "ipc"].includes(value)
            : key === "stage"
              ? ["cleanup", "manifest", "starting", "backoff"].includes(value)
              : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
                Number.isFinite(Date.parse(value));
    if (valid) safe[key] = value;
  }
  for (const key of ["pid", "generation", "attempt", "delay_ms", "exit_code"]) {
    const value = data?.[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      (key === "exit_code" || value >= 0)
    )
      safe[key] = value;
  }
  return Object.freeze({ time, level, source: "kernel", event, data: Object.freeze(safe) });
}
const events = new Set([
  "service.initializing",
  "service.ready",
  "service.closing",
  "service.closed",
  "service.failed",
  "service.cleanup_incomplete",
  "service.output_dropped",
  "kernel.available",
  "kernel.unavailable",
  "channel.connecting",
  "channel.connected",
  "channel.disconnected",
  "channel.connection_failed",
  "channel.retry_started",
  "channel.retry_scheduled",
  "channel.stopped",
  "channel.diagnostic"
]);
const states = new Set([
  "created",
  "initializing",
  "ready",
  "closing",
  "closed",
  "failed",
  "connecting",
  "online",
  "retrying",
  "stopped",
  "available",
  "unavailable"
]);

/** Rebuild status records from a separate allowlist, including when reading persisted files. */
export function extraStatusRecord(
  extra: string,
  level: RuntimeLogLevel,
  event: string,
  data?: Readonly<Record<string, unknown>>,
  time = new Date().toISOString()
): ExtraStatusRecord | undefined {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(extra) ||
    !["info", "warn", "error"].includes(level) ||
    !events.has(event)
  )
    return;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) ||
    !Number.isFinite(Date.parse(time))
  )
    return;
  if (event === "channel.diagnostic" && data?.code !== "IM_DISPOSE_FAILED") return;
  const safe: Record<string, string | number> = {};
  for (const key of ["state", "code", "endpoint_id"] as const) {
    const value = data?.[key];
    if (typeof value !== "string") continue;
    if (
      key === "state"
        ? states.has(value)
        : key === "endpoint_id"
          ? /^[a-f0-9]{64}$/.test(value)
          : /^[A-Z][A-Z0-9_]{0,95}$/.test(value)
    )
      safe[key] = value;
  }
  for (const key of ["attempt", "delay_ms", "dropped_count"]) {
    const value = data?.[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  return Object.freeze({
    time,
    level,
    source: "extra",
    extra_type: extra,
    event,
    data: Object.freeze(safe)
  });
}
