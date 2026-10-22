import type { ApprovalMode } from "@mininglamp-oss/octo-runtime-protocol";

type JsonRecord = Record<string, unknown>;
export type GatewayTerminal = "completed" | "failed" | "cancelled";

const LEGACY_RELEASES = [
  "2026.6.11",
  "2026.7.1",
  "2026.7.1-1",
  "2026.7.1-2",
  "2026.7.33",
  "2026.7.34",
  "2026.7.35"
];
const SESSION_PERMISSION_RELEASES = [
  "2026.8.1",
  "2026.8.2",
  "2026.8.33",
  "2026.8.34",
  "2026.8.35",
  "2026.9.1",
  "2026.9.2",
  "2026.9.3",
  "2026.9.4",
  "2026.9.5",
  "2026.9.6",
  "2026.9.7",
  "2026.9.8",
  "2026.9.9",
  "2026.9.33",
  "2026.10.1",
  "2026.10.2",
  "2026.10.3",
  "2026.10.4",
  "2026.10.5"
];
const RELEASES = new Map([
  ...LEGACY_RELEASES.map((version) => [version, "legacy"] as const),
  ...SESSION_PERMISSION_RELEASES.map((version) => [version, "session-permissions"] as const)
]);
const EXECUTION_METHODS = [
  "agents.list",
  "sessions.create",
  "sessions.messages.subscribe",
  "agent",
  "agent.wait",
  "sessions.abort"
];
const APPROVAL_METHODS = ["exec.approval.list", "exec.approval.resolve"];
const APPROVAL_EVENTS = ["exec.approval.requested", "exec.approval.resolved"];

export interface GatewayContract {
  version: string;
  family: "legacy" | "session-permissions";
  approvalTransport: boolean;
  scopes?: readonly string[];
}

export interface GatewayPermissionPolicy {
  effective: "ask" | "full_access";
  fallbackReason?: string;
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 每条连接以真实 hello 选择固定源码核对过的合同；v4 不表示请求字段相同。 */
export function resolveGatewayContract(value: unknown): GatewayContract {
  const hello = record(value);
  const rawVersion = record(hello?.server)?.version;
  const version =
    typeof rawVersion === "string" && /^v?\d{4}\.\d{1,2}\.\d{1,2}(?:-\d{1,2})?$/.test(rawVersion)
      ? rawVersion.replace(/^v/, "")
      : "unknown";
  const fail = (reason: string): never => {
    const displayVersion =
      typeof rawVersion === "string" && /^[A-Za-z0-9.+_-]{1,80}$/.test(rawVersion)
        ? rawVersion
        : version;
    throw new Error(`OPENCLAW_COMPATIBILITY_UNSUPPORTED: OpenClaw ${displayVersion}: ${reason}`);
  };
  if (hello?.protocol !== 4) fail("unsupported Gateway protocol");
  const family = RELEASES.get(version);
  if (!family) return fail("server.version has no verified contract");
  const features = record(hello?.features);
  const methods = strings(features?.methods);
  const events = strings(features?.events);
  for (const method of EXECUTION_METHODS) {
    if (!methods.includes(method)) fail(`missing required method ${method}`);
  }
  if (family === "legacy" && !methods.includes("sessions.patch"))
    fail("missing required method sessions.patch");
  if (!events.includes("agent")) fail("missing required agent event stream");
  const auth = record(hello?.auth);
  return {
    version,
    family,
    approvalTransport:
      APPROVAL_METHODS.every((method) => methods.includes(method)) &&
      APPROVAL_EVENTS.every((event) => events.includes(event)),
    ...(Array.isArray(auth?.scopes) ? { scopes: strings(auth.scopes) } : {})
  };
}

/** 用户已授权 ask 不可用时向 full 回退；原始请求与 Context 不随 effective 改写。 */
export function resolveGatewayPermission(
  contract: GatewayContract,
  requested: ApprovalMode
): GatewayPermissionPolicy {
  if (requested === "assisted")
    throw new Error("APPROVAL_MODE_UNSUPPORTED: OpenClaw has no qualified assisted policy");
  const fallbackReason =
    requested !== "ask"
      ? undefined
      : contract.family === "legacy"
        ? "legacy_human_reviewer_unconfirmed"
        : !contract.approvalTransport
          ? "approval_transport_unavailable"
          : contract.scopes &&
              !contract.scopes.includes("operator.approvals") &&
              !contract.scopes.includes("operator.admin")
            ? "approval_scope_unavailable"
            : undefined;
  const effective = requested === "ask" && !fallbackReason ? "ask" : "full_access";
  if (
    effective === "full_access" &&
    contract.family === "session-permissions" &&
    contract.scopes &&
    !contract.scopes.includes("operator.admin")
  ) {
    throw new Error(
      `OPENCLAW_PERMISSION_UNAVAILABLE: OpenClaw ${contract.version}: full requires operator.admin`
    );
  }
  return { effective, ...(fallbackReason ? { fallbackReason } : {}) };
}

export function gatewayCreateParams(
  contract: GatewayContract,
  policy: GatewayPermissionPolicy,
  params: JsonRecord,
  requestId: string,
  thinking: unknown
): JsonRecord {
  if (contract.family === "legacy") return { ...params };
  return {
    ...params,
    permissionMode: policy.effective === "full_access" ? "full" : "guarded",
    idempotencyKey: `${requestId}-session`,
    ...(typeof thinking === "string" ? { thinkingLevel: thinking } : {})
  };
}

export function gatewayLegacyPermissionParams(key: string): JsonRecord {
  // 旧字段不能区分 ask 与 auto reviewer，使用已授权的免审批回退，不伪称人工 ask。
  return { key, execSecurity: "full", execAsk: "off" };
}

/** 同一执行的中间回执在 RPC 等待、终态归一化和对账中使用同一判定。 */
export function isGatewayRunPending(value: unknown): boolean {
  const response = record(value);
  return (
    response?.pendingError === true ||
    ["accepted", "in_flight", "queued", "pending", "running"].includes(String(response?.status))
  );
}

/** RPC 最终回执、lifecycle 与 agent.wait 共用归一化；超时归因优先于 abort 清理。 */
export function gatewayTerminal(
  value: unknown,
  source: "wait" | "final" | "lifecycle"
): GatewayTerminal | undefined {
  const response = record(value);
  const meta = record(record(response?.result)?.meta);
  const status =
    typeof response?.status === "string"
      ? response.status
      : source === "lifecycle"
        ? response?.phase === "end"
          ? "ok"
          : response?.phase === "error"
            ? "error"
            : undefined
        : undefined;
  if (!status || isGatewayRunPending(response)) return undefined;
  const reason = response?.stopReason ?? meta?.stopReason;
  const timeoutPhase = response?.timeoutPhase ?? meta?.timeoutPhase;
  const hardTimeout =
    ["preflight", "provider", "post_turn"].includes(String(timeoutPhase)) ||
    (status === "timeout" &&
      reason !== "restart" &&
      (response?.providerStarted ?? meta?.providerStarted) === true);
  if (hardTimeout) return "failed";
  const livenessValue = response?.livenessState ?? meta?.livenessState;
  const liveness = typeof livenessValue === "string" ? livenessValue.trim().toLowerCase() : "";
  const ended = typeof response?.endedAt === "number" && Number.isFinite(response.endedAt);
  if (source === "wait" && status === "timeout" && !ended) return undefined;
  if (liveness === "blocked" || reason === "timeout") return "failed";
  if (
    reason === "restart" ||
    reason === "aborted" ||
    (status !== "ok" && (reason === "rpc" || reason === "stop")) ||
    response?.aborted === true ||
    meta?.aborted === true
  )
    return "cancelled";
  if (liveness === "abandoned") return "failed";
  if (status === "ok") return "completed";
  if (status === "error" || status === "timeout") return "failed";
  return undefined;
}
