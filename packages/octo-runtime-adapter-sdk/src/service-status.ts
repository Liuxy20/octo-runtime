import type { RuntimeLogLevel } from "./runtime-log.js";

export interface KernelStatusRecord {
  time: string;
  level: RuntimeLogLevel;
  source: "kernel";
  event: string;
  data: Record<string, string | number>;
}

/** Kernel 原生生命周期诊断白名单；读盘时也重建，绝不包含执行正文或原始异常。 */
export function kernelStatusRecord(
  level: RuntimeLogLevel,
  event: string,
  data?: Readonly<Record<string, unknown>>,
  time = new Date().toISOString()
): KernelStatusRecord | undefined {
  if (
    !["info", "warn", "error"].includes(level) ||
    ![
      "kernel.ready",
      "kernel.closing",
      "kernel.execution_drained",
      "kernel.cleanup_incomplete",
      "kernel.start_failed"
    ].includes(event) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) ||
    !Number.isFinite(Date.parse(time))
  )
    return;
  const safe: Record<string, string | number> = {};
  const code = data?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(code)) safe.code = code;
  const pid = data?.pid;
  if (typeof pid === "number" && Number.isSafeInteger(pid) && pid >= 0) safe.pid = pid;
  return Object.freeze({ time, level, source: "kernel", event, data: Object.freeze(safe) });
}
