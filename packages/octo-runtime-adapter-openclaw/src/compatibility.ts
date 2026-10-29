import type { ApprovalMode } from "@mininglamp-oss/octo-runtime-protocol";

type JsonRecord = Record<string, unknown>;
export type GatewayTerminal = "completed" | "failed" | "cancelled";

const SESSION_PERMISSIONS_RELEASE = 20260801;
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
  methods: readonly string[];
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

/** 每次握手校验协议和实际能力；版本仅选择已知的权限字段代际，不逐版限制升级。 */
export function resolveGatewayContract(value: unknown): GatewayContract {
  const hello = record(value);
  const rawVersion = record(hello?.server)?.version;
  const version =
    typeof rawVersion === "string" && /^[A-Za-z0-9.+_-]{1,80}$/.test(rawVersion)
      ? rawVersion.replace(/^v/, "")
      : "unknown";
  const release = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:$|[-+])/.exec(version);
  const fail = (reason: string): never => {
    const displayVersion =
      typeof rawVersion === "string" && /^[A-Za-z0-9.+_-]{1,80}$/.test(rawVersion)
        ? rawVersion
        : version;
    throw new Error(`OPENCLAW_COMPATIBILITY_UNSUPPORTED: OpenClaw ${displayVersion}: ${reason}`);
  };
  if (hello?.protocol !== 4) fail("unsupported Gateway protocol");
  // hello 未广告参数 schema；上游日期版本只辅助选择旧字段，独立版本号的 fork 按当前 stage 尝试。
  const releaseNumber =
    release && Number(release[2]) >= 1 && Number(release[2]) <= 12
      ? Number(release[1]) * 10000 + Number(release[2]) * 100 + Number(release[3])
      : undefined;
  const family =
    releaseNumber !== undefined && releaseNumber < SESSION_PERMISSIONS_RELEASE
      ? "legacy"
      : "session-permissions";
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
    methods,
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
