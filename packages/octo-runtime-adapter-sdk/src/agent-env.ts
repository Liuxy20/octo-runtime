import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  assertAgentEnv,
  assertApprovalMode,
  assertAgentSource,
  assertContextEnvs,
  assertContextMcp,
  assertRuntimeLimits,
  contextItem,
  CONTEXT_SCHEMA,
  DEFAULT_RUN_TIMEOUT_MS,
  type AgentEnv,
  type ContextItem,
  type AgentSource,
  type ApprovalMode,
  type InvokeRequest,
  type RuntimeLimits
} from "@mininglamp-oss/octo-runtime-protocol";

/**
 * 在 Adapter 消费本轮 AgentEnv 时，按 namespace/name 精确读取 bean 的 payload；不存在则返回 undefined。
 * 公共与私有 bean 都可读取。私有名称、字段和类型由宿主与对应 Adapter 约定，无须公共 schema 注册。
 * T 仅提供编译期类型提示，不做运行时校验；必填检查、默认值及 Provider 原生映射由消费方负责。
 * 返回原 payload 引用，不复制或修改信封；调用方应只读使用，不写回默认值或跨调用保存配置。
 *
 * @example
 * const options = agentEnvItem<{ agentId: string }>(req.agentEnv, "adapter.my-adapter", "options");
 * if (!options || typeof options.agentId !== "string" || !options.agentId.trim())
 *   throw new TypeError("MY_ADAPTER_AGENT_ID_REQUIRED");
 *
 * @see https://github.com/Mininglamp-OSS/octo-runtime/blob/main/docs/zh-CN/getting-started/sdk.md
 * @see https://github.com/Mininglamp-OSS/octo-runtime/blob/main/docs/en/getting-started/sdk.md
 */
export function agentEnvItem<T extends object = Record<string, unknown>>(
  env: AgentEnv,
  namespace: string,
  name: string
): T | undefined {
  return contextItem(env, namespace, name)?.payload as T | undefined;
}

/**
 * Adapter 读取公共 octo.execution/model bean 的 selection.id，取得本轮显式选择的 Provider 模型标识。
 * 条目或 id 缺失时返回 undefined；不补默认模型、不查询模型目录，也不读取私有 options 中的同名字段。
 * 本函数只读不改写 AgentEnv；字段类型、可用性检查及 Provider 原生参数映射仍由 Adapter 负责。
 * 私有配置使用 agentEnvItem<T>(request.agentEnv, namespace, name)，不扩展公共 model bean。
 *
 * @see https://github.com/Mininglamp-OSS/octo-runtime/blob/main/docs/zh-CN/getting-started/sdk.md
 * @see https://github.com/Mininglamp-OSS/octo-runtime/blob/main/docs/en/getting-started/sdk.md
 */
export function invocationModel(request: InvokeRequest): string | undefined {
  return agentEnvItem<{ selection?: { id?: string } }>(request.agentEnv, "octo.execution", "model")
    ?.selection?.id;
}

export function invocationEffort(request: InvokeRequest): string | undefined {
  return agentEnvItem<{ reasoning?: { effort?: string } }>(
    request.agentEnv,
    "octo.execution",
    "model"
  )?.reasoning?.effort;
}

export function invocationWorkdir(request: InvokeRequest): string {
  return (
    agentEnvItem<{ path: string }>(request.agentEnv, "octo.execution", "workspace")?.path ?? ""
  );
}

export function invocationApprovalMode(request: InvokeRequest): ApprovalMode {
  const mode =
    agentEnvItem<{ mode: ApprovalMode }>(request.agentEnv, "octo.security", "approval_policy")
      ?.mode ?? "ask";
  assertApprovalMode(mode);
  return mode;
}

export function invocationAgentSource(request: InvokeRequest): AgentSource {
  const source =
    agentEnvItem<{ source: AgentSource }>(request.agentEnv, "octo.execution", "agent")?.source ??
    "provisioned";
  assertAgentSource(source);
  return source;
}

/** Harness 私有选项仍是原始 payload；不生成公共配置副本。 */
export function invocationOptions(
  request: InvokeRequest,
  adapterType?: string
): Record<string, unknown> {
  const type =
    adapterType ??
    agentEnvItem<{ type: string }>(request.agentEnv, "octo.execution", "adapter")?.type;
  return agentEnvItem(request.agentEnv, `adapter.${type}`, "options") ?? {};
}

const connections = new WeakMap<InvokeRequest, Record<string, string>>();

/** 可信连接选项只绑定本次 Adapter 调用，不写回调用方信封。 */
export function bindInvocationConnection(
  request: InvokeRequest,
  options?: Record<string, string>
): void {
  if (options) connections.set(request, { ...options });
  else connections.delete(request);
}

export function invocationProviderOptions(
  request: InvokeRequest,
  adapterType?: string
): Record<string, unknown> {
  return { ...invocationOptions(request, adapterType), ...connections.get(request) };
}

export function invocationOption(
  request: InvokeRequest,
  key: string,
  adapterType?: string
): string | undefined {
  const value = invocationProviderOptions(request, adapterType)[key];
  if (value !== undefined && typeof value !== "string")
    throw new TypeError(`ADAPTER_OPTION_INVALID: ${key}`);
  return value;
}

export function invocationTimeoutSeconds(
  request: InvokeRequest,
  adapterType?: string
): number | undefined {
  const value = invocationOptions(request, adapterType).timeoutSeconds;
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0))
    throw new TypeError("ADAPTER_OPTION_INVALID: timeoutSeconds");
  return value;
}

const LIMIT_NAMES = {
  first_frame_timeout_ms: "firstFrameTimeoutMs",
  model_idle_timeout_ms: "modelIdleTimeoutMs",
  model_idle_warning_ms: "modelIdleWarningMs",
  model_idle_policy: "modelIdlePolicy",
  tool_timeout_ms: "toolTimeoutMs",
  tool_wall_timeout_ms: "toolWallTimeoutMs",
  run_timeout_ms: "runTimeoutMs",
  cancel_grace_ms: "cancelGraceMs",
  enforcement: "enforcement"
} as const;

/** Adapter 解释预算，Core 仅按本地回调执行计时，不解析配置条目。 */
export function invocationRuntimeLimits(request: InvokeRequest): RuntimeLimits | undefined {
  const payload = agentEnvItem(request.agentEnv, "octo.execution", "limits");
  if (!payload) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!Object.hasOwn(LIMIT_NAMES, key)) throw new TypeError("ADAPTER_LIMIT_UNSUPPORTED");
    result[LIMIT_NAMES[key as keyof typeof LIMIT_NAMES]] = value;
  }
  assertRuntimeLimits(result);
  return result;
}

/** 每个 Harness 拥有自己的默认信封；不包含隐式 cwd、模型或业务材料。 */
export function defaultAgentEnv(type: string, source: AgentSource = "provisioned"): AgentEnv {
  return {
    schema: CONTEXT_SCHEMA,
    items: [
      { namespace: "octo.execution", name: "adapter", payload: { type } },
      { namespace: "octo.execution", name: "agent", payload: { source } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } },
      {
        namespace: "octo.execution",
        name: "limits",
        payload: { run_timeout_ms: DEFAULT_RUN_TIMEOUT_MS }
      }
    ]
  };
}

/** 调用方显式补缺省条目，保留已提交条目的顺序和值，返回独立副本。 */
export function withAgentEnvDefaults(submitted: AgentEnv, defaults: AgentEnv): AgentEnv {
  assertAgentEnv(submitted);
  assertAgentEnv(defaults);
  const keys = new Set(submitted.items.map((item) => `${item.namespace}/${item.name}`));
  const result = structuredClone({
    schema: submitted.schema,
    items: [
      ...submitted.items,
      ...defaults.items.filter((item) => !keys.has(`${item.namespace}/${item.name}`))
    ]
  });
  assertAgentEnv(result);
  return result;
}

/** 调用方显式替换同名 bean；不解释 payload，不改变其他条目的相对顺序。 */
export function withAgentEnvItems(env: AgentEnv | undefined, items: ContextItem[]): AgentEnv {
  const base = env ?? { schema: CONTEXT_SCHEMA, items: [] };
  assertAgentEnv(base);
  // 先校验覆盖信封，避免 Map 将调用方重复键静默折叠。
  assertAgentEnv({ schema: CONTEXT_SCHEMA, items });
  const overrides = new Map(items.map((item) => [`${item.namespace}/${item.name}`, item]));
  const merged = base.items.map((item) => {
    const key = `${item.namespace}/${item.name}`;
    const next = overrides.get(key) ?? item;
    overrides.delete(key);
    return next;
  });
  const result = structuredClone({
    schema: CONTEXT_SCHEMA,
    items: [...merged, ...overrides.values()]
  });
  assertAgentEnv(result);
  return result;
}

/** 公共 bean 的消费校验；未消费的私有扩展不参与，也不需要中央注册。 */
export function assertAdapterAgentEnv(request: InvokeRequest): void {
  assertAgentEnv(request.agentEnv);
  invocationApprovalMode(request);
  invocationAgentSource(request);
  invocationRuntimeLimits(request);
  for (const item of request.agentEnv.items) {
    if (item.namespace === "octo.security" && item.name === "approval_policy") {
      assertFields(item.payload, ["mode"]);
      assertApprovalMode(item.payload.mode);
    }
    if (item.namespace !== "octo.execution") continue;
    const value: Record<string, unknown> = item.payload;
    if (item.name === "adapter") {
      assertFields(value, ["type"]);
      if (typeof value.type !== "string" || !value.type)
        throw new TypeError("ADAPTER_TYPE_INVALID");
    }
    if (item.name === "agent") {
      assertFields(value, ["source"]);
      assertAgentSource(value.source);
    }
    if (
      item.name === "workspace" &&
      (Object.keys(value).some((k) => k !== "path") || typeof value.path !== "string")
    )
      throw new TypeError("WORKDIR_INVALID");
    if (item.name === "actmode") {
      assertFields(value, ["mode"]);
      if (!["plan", "default"].includes(String(value.mode)))
        throw new TypeError("CONTEXT_SCHEMA_INVALID: actmode");
    }
    if (item.name === "model") {
      assertFields(value, ["selection", "reasoning"]);
      if (!Object.keys(value).length) throw new TypeError("CONTEXT_SCHEMA_INVALID: model");
      for (const [field, property] of [
        ["selection", "id"],
        ["reasoning", "effort"]
      ]) {
        const bean = value[field];
        if (bean === undefined) continue;
        if (!bean || typeof bean !== "object" || Array.isArray(bean))
          throw new TypeError("CONTEXT_SCHEMA_INVALID: model");
        const setting = bean as Record<string, unknown>;
        assertFields(setting, [property, "use_provider_default"]);
        if (setting.use_provider_default === true && setting[property] === undefined) continue;
        if (
          typeof setting[property] !== "string" ||
          !setting[property] ||
          setting.use_provider_default !== undefined
        )
          throw new TypeError("CONTEXT_SCHEMA_INVALID: model");
      }
    }
    if (item.name === "envs") assertContextEnvs(value);
    if (item.name === "mcp") assertContextMcp(value);
  }
}

function assertFields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new TypeError("CONTEXT_SCHEMA_INVALID");
}

/** 调用方准备目录；Adapter 在启动 Provider 前检查，不创建或替换路径。 */
export async function assertAdapterWorkdir(
  request: InvokeRequest,
  workspace = true
): Promise<void> {
  const path = invocationWorkdir(request);
  if (!workspace || (invocationAgentSource(request) === "preset" && !path)) return;
  const messages: Record<string, string> = {
    WORKDIR_REQUIRED:
      "A prepared working directory is required; create it and provide its absolute path.",
    WORKDIR_INVALID: "Working directory must be an absolute path without NUL characters.",
    WORKDIR_NOT_FOUND: "Working directory does not exist; create it before invoking Runtime.",
    WORKDIR_NOT_DIRECTORY: "Working directory must point to an existing directory.",
    WORKDIR_UNAVAILABLE: "Working directory is not accessible; check directory access permissions."
  };
  const fail = (code: string): never => {
    throw Object.assign(new TypeError(messages[code]), { code });
  };
  if (!path) fail("WORKDIR_REQUIRED");
  if (!isAbsolute(path) || path.includes("\0")) fail("WORKDIR_INVALID");
  try {
    if (!(await stat(path)).isDirectory()) fail("WORKDIR_NOT_DIRECTORY");
    await access(path, constants.X_OK);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code.startsWith("WORKDIR_")) throw error;
    fail(
      code === "ENOENT"
        ? "WORKDIR_NOT_FOUND"
        : code === "ENOTDIR"
          ? "WORKDIR_NOT_DIRECTORY"
          : "WORKDIR_UNAVAILABLE"
    );
  }
}
