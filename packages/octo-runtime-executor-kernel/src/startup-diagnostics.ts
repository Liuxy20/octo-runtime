import type { ServiceCleanupResult, ServicePhase } from "./lifecycle.js";
import { STARTUP_CATALOG } from "./startup-catalog.js";
export { STARTUP_CATALOG, type StartupCatalogEntry } from "./startup-catalog.js";

/** 只接受启动调用方已确认的资源事实；不接受原始配置、环境、stderr 或异常正文。 */
export interface StartupContext {
  path?: string;
  resource?: string;
  operation?: string;
  configKey?: string;
  endpoint?: string;
  executable?: string;
  module?: string;
  systemCode?: string;
  measured?: number;
  limit?: number;
  unit?: "utf8-bytes" | "utf16-units";
}
/** #306 路径诊断兼容投影；所有字段均从共享诊断白名单生成。 */
export interface StartupPathDiagnostic extends Pick<
  StartupContext,
  "path" | "systemCode" | "endpoint" | "measured" | "limit" | "unit"
> {
  domain: "startup";
  code: string;
  resource: string;
  operation: string;
  action: string;
}

/** CLI 继续提供 #306 的 startup 字段；恢复建议始终来自同一 catalog。 */
export function startupPathDiagnostic(
  diagnostic: StartupDiagnostic
): StartupPathDiagnostic | undefined {
  if (!/^(HOME_|IPC_ENDPOINT_)/.test(diagnostic.rootCode)) return undefined;
  const { path, resource, operation, systemCode, endpoint, measured, limit, unit } =
    diagnostic.context;
  return {
    domain: "startup",
    code: diagnostic.rootCode,
    resource: resource ?? "home",
    operation: operation ?? "validate-input",
    action: diagnostic.actions.join(" "),
    ...(path !== undefined ? { path } : {}),
    ...(systemCode !== undefined ? { systemCode } : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
    ...(measured !== undefined ? { measured } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(unit !== undefined ? { unit } : {})
  };
}
export interface StartupCause {
  code: string;
  context: Readonly<StartupContext>;
  component?: string;
  phase?: ServicePhase;
  cleanup?: ServiceCleanupResult;
}
export interface StartupDiagnostic {
  domain: "startup";
  code: string;
  rootCode: string;
  component: string;
  phase: ServicePhase;
  summary: string;
  explanation: string;
  actions: readonly string[];
  retryable: boolean;
  userActionRequired: boolean;
  context: Readonly<StartupContext>;
  causes: readonly StartupCause[];
  cleanup?: ServiceCleanupResult;
  truncated: boolean;
}
export interface StartupLocation {
  component: string;
  phase: ServicePhase;
  context?: StartupContext;
}

/** 保持原类型/message/code/cause，仅在可扩展错误上增加安全诊断；冻结错误可由调用边界直接投影。 */
export function withStartupContext<T>(
  error: T,
  location: StartupLocation,
  classification?: string
): T {
  try {
    if (error instanceof Error && Object.isExtensible(error) && !Object.hasOwn(error, "diagnostic"))
      Object.defineProperty(error, "diagnostic", {
        value: describeStartupError(
          classification ? { code: classification, cause: error } : error,
          location
        )
      });
  } catch {
    // 不可信代理/不可写对象不能让诊断遮盖原错误。
  }
  return error;
}
const phases = new Set<ServicePhase>([
  "created",
  "initializing",
  "ready",
  "closing",
  "closed",
  "failed"
]);
const wrappers = new Set([
  "SERVICE_INITIALIZATION_FAILED",
  "KERNEL_START_CLEANUP_INCOMPLETE",
  "COMMAND_FAILED"
]);
const object = (value: unknown): object | undefined =>
  value !== null && (typeof value === "object" || typeof value === "function") ? value : undefined;
// 不执行 getter/toJSON；代理或损坏对象按未知处理，错误投影本身不能覆盖启动失败。
function own(value: unknown, key: string): unknown {
  try {
    return object(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  } catch {
    return undefined;
  }
}
function arrayItems(value: unknown, maximum: number): unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = own(value, "length");
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return undefined;
    return Array.from({ length: Math.min(length, maximum) }, (_, index) =>
      own(value, String(index))
    );
  } catch {
    return undefined;
  }
}
const codeOf = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : undefined;
const errorCode = (value: unknown): string | undefined =>
  codeOf(own(value, "code")) ?? codeOf(own(value, "message"));

/** 文本与 JSON 同用确定性规范化：去控制字符，去 URL 认证/query/hash 和显式敏感赋值。 */
export function safeStartupValue(value: string, maximum = 32768): string {
  return (
    value
      .slice(0, maximum)
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      // 前缀锚点避免在长而不完整的 scheme 每个连字符后重复回溯。
      .replace(
        /(^|[^a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s"<>]+)/gi,
        (match: string, prefix: string) => {
          try {
            const url = new URL(match.slice(prefix.length));
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            return prefix + url.toString();
          } catch {
            return prefix + "[redacted-url]";
          }
        }
      )
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
      .replace(/\b(?:sk-|bf_)[A-Za-z0-9_-]{8,}/g, "[redacted]")
      .replace(
        /\b(?:token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
        "[redacted]"
      )
  );
}
function safeContext(value: unknown): StartupContext {
  const result: StartupContext = {};
  for (const key of [
    "path",
    "resource",
    "operation",
    "configKey",
    "endpoint",
    "executable",
    "module",
    "systemCode"
  ] as const) {
    const field = own(value, key);
    if (typeof field === "string")
      result[key] = safeStartupValue(
        field,
        ["path", "endpoint", "executable", "module"].includes(key) ? 32768 : 256
      );
  }
  for (const key of ["measured", "limit"] as const) {
    const field = own(value, key);
    if (typeof field === "number" && Number.isSafeInteger(field) && field >= 0) result[key] = field;
  }
  const unit = own(value, "unit");
  if (unit === "utf8-bytes" || unit === "utf16-units") result.unit = unit;
  return result;
}
function safeCleanup(value: unknown): ServiceCleanupResult | undefined {
  const complete = own(value, "complete"),
    errors = arrayItems(own(value, "errors"), 32),
    pending = arrayItems(own(value, "pendingResources"), 32);
  if (typeof complete !== "boolean" || !errors || !pending) return undefined;
  return {
    complete,
    errors: errors.map((item: unknown) => ({
      resource: safeStartupValue(
        typeof own(item, "resource") === "string" ? (own(item, "resource") as string) : "unknown",
        256
      ),
      code: codeOf(own(item, "code")) ?? "STARTUP_UNKNOWN"
    })),
    pendingResources: pending.map((item: unknown) =>
      typeof item === "string" ? safeStartupValue(item, 256) : "unknown"
    )
  };
}

function safeCause(value: unknown): StartupCause {
  const component = own(value, "component"),
    phase = own(value, "phase");
  const cleanup = safeCleanup(own(value, "cleanup"));
  return {
    code: codeOf(own(value, "code")) ?? "STARTUP_UNKNOWN",
    context: safeContext(own(value, "context")),
    ...(typeof component === "string" ? { component: safeStartupValue(component, 128) } : {}),
    ...(typeof phase === "string" && phases.has(phase as ServicePhase)
      ? { phase: phase as ServicePhase }
      : {}),
    ...(cleanup ? { cleanup } : {})
  };
}

/**
 * 在失败调用边界投影启动事实；不依赖 IPC/Run，不改变原错误、退出码或清理行为。
 * cause/aggregate 按主失败优先有界遍历（16 节点/6 层）；循环和原始异常正文均不输出。
 */
export function describeStartupError(
  error: unknown,
  location: StartupLocation = { component: "host", phase: "created" }
): StartupDiagnostic {
  const existing = restoreStartupDiagnostic(own(error, "diagnostic"));
  if (existing) return existing;
  const seen = new Set<object>();
  const causes: StartupCause[] = [];
  let truncated = false;
  let cleanup: ServiceCleanupResult | undefined;
  let visited = 0;
  const visit = (
    value: unknown,
    depth: number,
    inherited: StartupContext = {}
  ): StartupCause | undefined => {
    if (depth > 6 || visited >= 16) {
      truncated = true;
      return undefined;
    }
    const reference = object(value);
    if (!reference) return undefined;
    if (seen.has(reference)) {
      truncated = true;
      return undefined;
    }
    seen.add(reference);
    visited++;
    const diagnostic = own(value, "diagnostic");
    const embedded = own(diagnostic, "domain") === "startup" ? diagnostic : undefined;
    const nodeCleanup = safeCleanup(own(value, "cleanup")) ?? safeCleanup(own(embedded, "cleanup"));
    cleanup ??= nodeCleanup;
    const code = errorCode(value) ?? codeOf(own(embedded, "code"));
    const context = {
      ...inherited,
      ...safeContext(own(value, "startupContext")),
      ...safeContext(embedded),
      ...safeContext(own(embedded, "context"))
    };
    // Node 系统错误字段是实际 IO 事实；spawn 的 path 是可执行文件，不能误建议 mkdir。
    const syscall = own(value, "syscall"),
      path = own(value, "path"),
      address = own(value, "address");
    if (typeof syscall === "string") context.operation ??= safeStartupValue(syscall, 256);
    if (typeof path === "string") {
      if (typeof syscall === "string" && syscall.startsWith("spawn")) {
        context.executable ??= safeStartupValue(path);
        context.resource ??= "executable";
      } else context.path ??= safeStartupValue(path);
    }
    if (typeof address === "string") context.endpoint ??= safeStartupValue(address);
    if (code && /^(E[A-Z0-9]+|UV_[A-Z0-9_]+)$/.test(code)) context.systemCode ??= code;
    const current = code
      ? safeCause({
          code,
          context,
          component: own(embedded, "component"),
          phase: own(embedded, "phase"),
          cleanup: nodeCleanup
        })
      : undefined;
    if (current) causes.push(current);
    let child: StartupCause | undefined;
    const rawErrors = own(value, "errors");
    const errors = arrayItems(rawErrors, 16);
    if (errors) {
      for (let i = 0; i < errors.length; i++) {
        const found = visit(errors[i], depth + 1, context);
        if (i === 0) child = found ?? { code: "STARTUP_UNKNOWN", context };
      }
      // 所有分支都必须遍历以保留清理失败；不能被 ??= 短路。
      if (Number(own(rawErrors, "length")) > 16) truncated = true;
    }
    const cause = own(value, "cause");
    const nested = cause === undefined ? undefined : visit(cause, depth + 1, context);
    const savedRoot = codeOf(own(embedded, "rootCode"));
    // 后台回读只有白名单诊断而没有原始 cause；保留已确认根因及清理事实，不反序列化异常。
    if (!errors && cause === undefined && savedRoot) {
      const savedCauses = arrayItems(own(embedded, "causes"), 15);
      if (savedCauses) {
        for (const item of savedCauses) {
          visit(
            {
              code: codeOf(own(item, "code")),
              startupContext: safeContext(own(item, "context")),
              cleanup: safeCleanup(own(item, "cleanup")),
              diagnostic: {
                domain: "startup",
                component: own(item, "component"),
                phase: own(item, "phase")
              }
            },
            depth + 1
          );
        }
      }
      return { code: savedRoot, context };
    }
    const primary = child ?? nested;
    // Home/端点所有者已验证的资源分类比系统 errno 更精确；errno 仍保留在 context/causes。
    // 初始化/加载包装不能采用此规则，否则会再次遮盖真正根因。
    if (
      current &&
      STARTUP_CATALOG[current.code] &&
      /^(HOME_|IPC_ENDPOINT_|ENDPOINT_|ORPHAN_)/.test(current.code)
    )
      return { code: current.code, context: { ...context, ...primary?.context } };
    return primary ?? (current && !wrappers.has(current.code) ? current : undefined);
  };
  const root = visit(error, 0);
  const embedded = own(error, "diagnostic");
  const component =
    typeof own(embedded, "component") === "string"
      ? (own(embedded, "component") as string)
      : location.component;
  const phase = own(embedded, "phase");
  const context = {
    ...safeContext(location.context),
    ...safeContext(own(embedded, "context")),
    ...(root?.context ?? {})
  };
  const code = errorCode(error) ?? codeOf(own(embedded, "code")) ?? "STARTUP_UNKNOWN";
  const rootCode = root?.code ?? (wrappers.has(code) ? "STARTUP_UNKNOWN" : code);
  return buildDiagnostic({
    code,
    rootCode,
    component: safeStartupValue(component, 128),
    phase:
      typeof phase === "string" && phases.has(phase as ServicePhase)
        ? (phase as ServicePhase)
        : location.phase,
    context,
    causes,
    ...(cleanup ? { cleanup } : {}),
    truncated
  });
}

type StartupFacts = Pick<
  StartupDiagnostic,
  "code" | "rootCode" | "component" | "phase" | "context" | "causes" | "cleanup" | "truncated"
>;
function buildDiagnostic(facts: StartupFacts): StartupDiagnostic {
  const { rootCode } = facts;
  const catalog = STARTUP_CATALOG[rootCode] ?? STARTUP_CATALOG.STARTUP_UNKNOWN;
  const context = safeContext({
    ...(catalog.configKey ? { configKey: catalog.configKey } : {}),
    ...facts.context
  });
  const details = Object.entries(context)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(", ");
  let action = catalog.action;
  if (rootCode === "ENOENT" && context.executable)
    action = `Check that executable ${JSON.stringify(context.executable)} is installed and the host's selected working directory exists. Correct the executable or working directory configuration, then retry. Creating a directory does not provide an executable.`;
  else if (rootCode === "ENOENT" && context.resource === "directory")
    action = `Correct the configured directory ${JSON.stringify(context.path ?? "unknown")}, or create it if this is the intended location, then retry.`;
  else if (
    ["HOME_NOT_FOUND", "HOME_NOT_DIRECTORY"].includes(rootCode) &&
    context.resource &&
    context.resource !== "home" &&
    context.resource !== "home-probe"
  )
    action = `Inspect the reported ${JSON.stringify(context.resource)} path and its parent directory. Correct the host's resource selection or prepare its required parent directory, then retry. Do not create a replacement Runtime Home or delete an unrelated resource.`;
  if (context.configKey) action += ` Check configuration key ${JSON.stringify(context.configKey)}.`;
  return {
    ...facts,
    domain: "startup",
    context,
    summary: catalog.summary,
    explanation: `${catalog.summary}${details ? ` Observed: ${details}.` : " No further safe resource facts were recorded."}`,
    actions: [action],
    retryable: catalog.retryable,
    userActionRequired: !catalog.retryable
  };
}

/** 可读投影只消费已净化的共享结构；SDK 可直接按 rootCode/context 分支。 */
export function formatStartupDiagnostic(diagnostic: StartupDiagnostic): string {
  const nested = diagnostic.causes
    .filter((cause) => cause.cleanup && !cause.cleanup.complete)
    .map(
      (cause) =>
        `\nCause cleanup [${cause.code}]${cause.component ? ` (${cause.component})` : ""}: incomplete; pending: ${cause.cleanup?.pendingResources.join(", ") || "none"}`
    )
    .join("");
  return `[${diagnostic.code}] ${diagnostic.explanation}\nComponent: ${diagnostic.component}; phase: ${diagnostic.phase}; root: ${diagnostic.rootCode}\n${diagnostic.actions.map((action) => `Action: ${action}`).join("\n")}${diagnostic.cleanup ? `\nCleanup: ${diagnostic.cleanup.complete ? "complete" : "incomplete"}; pending: ${diagnostic.cleanup.pendingResources.join(", ") || "none"}` : ""}${nested}${diagnostic.truncated ? "\nDetails: additional causes were omitted by diagnostic limits." : ""}`;
}

/** 持久化/JSON 是不可信边界：仅重建码、位置、资源和清理，文案始终重新来自当前 catalog。 */
export function restoreStartupDiagnostic(value: unknown): StartupDiagnostic | undefined {
  const code = codeOf(own(value, "code")),
    rootCode = codeOf(own(value, "rootCode"));
  const component = own(value, "component"),
    phase = own(value, "phase"),
    causes = arrayItems(own(value, "causes"), 16);
  if (
    own(value, "domain") !== "startup" ||
    !code ||
    !rootCode ||
    typeof component !== "string" ||
    typeof phase !== "string" ||
    !phases.has(phase as ServicePhase) ||
    !causes
  )
    return undefined;
  const context = safeContext(own(value, "context"));
  const cleanup = safeCleanup(own(value, "cleanup"));
  return buildDiagnostic({
    code,
    rootCode,
    component: safeStartupValue(component, 128),
    phase: phase as ServicePhase,
    context,
    causes: causes.map(safeCause),
    ...(cleanup ? { cleanup } : {}),
    truncated: own(value, "truncated") === true || Number(own(own(value, "causes"), "length")) > 16
  });
}

/** 仅供启动边界补充已确认的位置事实；cause 保留给本地深度排障，公开输出用 diagnostic。 */
export class StartupError extends Error {
  readonly code: string;
  readonly diagnostic: StartupDiagnostic;
  constructor(code: string, location: StartupLocation, cause?: unknown) {
    super(code, { cause });
    this.name = "StartupError";
    this.code = code;
    Object.defineProperty(this, "startupContext", { value: location.context });
    this.diagnostic = describeStartupError(this, location);
  }
}
