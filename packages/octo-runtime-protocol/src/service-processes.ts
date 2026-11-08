import type { KernelStatus, ServiceProcessSnapshot } from "./generated/protocol-types.js";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("INVALID_KERNEL_STATUS");
  return value as Record<string, unknown>;
};
const positive = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** status 的安全进程白名单与共享 Schema 对齐，拒绝任意 argv/env 扩展字段。 */
export function assertServiceProcessSnapshot(
  value: unknown
): asserts value is ServiceProcessSnapshot {
  const item = record(value);
  if (
    Object.keys(item).some(
      (key) =>
        ![
          "scope_id",
          "service_id",
          "incarnation",
          "provider",
          "owner_pid",
          "pid",
          "state",
          "observation",
          "ownership"
        ].includes(key)
    ) ||
    ["scope_id", "service_id", "provider"].some(
      (key) => typeof item[key] !== "string" || !item[key].length
    ) ||
    typeof item.incarnation !== "number" ||
    !Number.isSafeInteger(item.incarnation) ||
    item.incarnation < 0 ||
    !positive(item.owner_pid) ||
    (item.pid !== undefined && !positive(item.pid)) ||
    typeof item.state !== "string" ||
    ![
      "not_started",
      "starting",
      "ready",
      "recovering",
      "degraded",
      "closing",
      "closed",
      "cleanup_incomplete"
    ].includes(item.state) ||
    typeof item.observation !== "string" ||
    !["alive", "exited", "unknown"].includes(item.observation) ||
    item.ownership !== "owned"
  )
    throw new TypeError("INVALID_KERNEL_STATUS");
}

/** 兼容没有服务快照的旧 status；有快照时完整校验后才能交给 doctor。 */
export function assertKernelStatus(value: unknown): asserts value is KernelStatus {
  const item = record(value);
  if (
    Object.keys(item).some(
      (key) =>
        ![
          "ipc_version",
          "kernel_instance_id",
          "pid",
          "execution_ready",
          "service_processes"
        ].includes(key)
    ) ||
    item.ipc_version !== 2 ||
    typeof item.kernel_instance_id !== "string" ||
    !item.kernel_instance_id ||
    !positive(item.pid) ||
    typeof item.execution_ready !== "boolean"
  )
    throw new TypeError("INVALID_KERNEL_STATUS");
  if (item.service_processes !== undefined) {
    if (!Array.isArray(item.service_processes) || item.service_processes.length > 256)
      throw new TypeError("INVALID_KERNEL_STATUS");
    for (const process of item.service_processes) assertServiceProcessSnapshot(process);
  }
}
