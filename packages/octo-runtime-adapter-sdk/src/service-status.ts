import type { RuntimeLogLevel } from "./runtime-log.js";

export interface ExtraStatusRecord {
  time: string;
  level: RuntimeLogLevel;
  source: "extra";
  extra_type: string;
  event: string;
  data: Record<string, string | number>;
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
