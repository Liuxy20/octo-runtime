import type {
  ApprovalMode,
  ContextEnvsPayload,
  ContextEnvelope,
  ContextItem,
  McpServers
} from "./generated/protocol-types.js";

export const CONTEXT_SCHEMA = "octo.context-envelope/v3" as const;
export const RUNTIME_RUN_CONTRACT = Object.freeze({
  schema_version: 7,
  context_schema: CONTEXT_SCHEMA,
  approval_schema: "octo.approval-request/v1"
} as const);
export const CONTEXT_MAX_BYTES = 65_536;
export const CONTEXT_MAX_ITEMS = 32;
// 整轮预算与首帧/空闲检测独立；七天仍在 Node 单次定时器的安全范围内。
export const DEFAULT_RUN_TIMEOUT_MS = 86_400_000;
export const MAX_RUN_TIMEOUT_MS = 604_800_000;
export const APPROVAL_MODES: readonly ApprovalMode[] = ["ask", "assisted", "full_access"];

export function assertApprovalMode(value: unknown): asserts value is ApprovalMode {
  if (!APPROVAL_MODES.includes(value as ApprovalMode))
    throw new TypeError("APPROVAL_MODE_UNSUPPORTED");
}

export function assertContextEnvelope(value: unknown): asserts value is ContextEnvelope {
  object(value, "CONTEXT_REQUIRED");
  fields(value, ["schema", "items"]);
  if (value.schema !== CONTEXT_SCHEMA || !Array.isArray(value.items))
    throw new TypeError("CONTEXT_SCHEMA_INVALID");
  if (value.items.length > CONTEXT_MAX_ITEMS) throw new TypeError("CONTEXT_BUDGET_EXCEEDED");
  assertJsonValue(value);
  const keys = new Set<string>();
  for (const item of value.items) {
    object(item, "CONTEXT_SCHEMA_INVALID");
    if (item.namespace === "octo.control" && item.name === "instructions")
      throw new TypeError(
        "CONTROL_INSTRUCTIONS_REMOVED: controlInstructions was removed; provide application prompts in inputs.parts"
      );
    fields(item, ["namespace", "name", "payload"]);
    for (const property of ["namespace", "name"]) {
      const text = item[property];
      if (typeof text !== "string" || text.length > 96 || !/^[a-z0-9][a-z0-9._-]*$/.test(text))
        throw new TypeError("CONTEXT_SCHEMA_INVALID");
    }
    const key = JSON.stringify([item.namespace, item.name]);
    if (keys.has(key)) throw new TypeError("CONTEXT_KEY_DUPLICATED");
    keys.add(key);
    object(item.payload, "CONTEXT_SCHEMA_INVALID");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > CONTEXT_MAX_BYTES)
    throw new TypeError("CONTEXT_BUDGET_EXCEEDED");
}

export function contextItem(
  context: ContextEnvelope,
  namespace: string,
  name: string
): ContextItem | undefined {
  return context.items.find((item) => item.namespace === namespace && item.name === name);
}

export function canonicalContext(context: ContextEnvelope): string {
  assertContextEnvelope(context);
  return JSON.stringify(
    sorted({
      schema: context.schema,
      items: context.items
    })
  );
}

export function mergeContext(
  defaults: ContextEnvelope,
  overrides: ContextEnvelope
): ContextEnvelope {
  assertContextEnvelope(defaults);
  assertContextEnvelope(overrides);
  const items = new Map<string, ContextItem>();
  for (const item of [...defaults.items, ...overrides.items]) {
    const key = JSON.stringify([item.namespace, item.name]);
    const previous = items.get(key);
    const next = structuredClone(item);
    if (
      previous &&
      item.namespace === "octo.execution" &&
      ["model", "limits"].includes(item.name)
    ) {
      next.payload = { ...previous.payload, ...next.payload };
    }
    if (previous && item.namespace === "octo.execution" && item.name === "envs")
      next.payload = { ...mergeContextEnvs(previous.payload, next.payload) };
    if (previous && item.namespace === "octo.execution" && item.name === "mcp")
      next.payload = {
        mcpServers: {
          ...(previous.payload.mcpServers as McpServers),
          ...(next.payload.mcpServers as McpServers)
        }
      };
    items.set(key, next);
  }
  const result: ContextEnvelope = { schema: CONTEXT_SCHEMA, items: [...items.values()] };
  assertContextEnvelope(result);
  return JSON.parse(canonicalContext(result)) as ContextEnvelope;
}

export function assertContextMcp(value: unknown): asserts value is { mcpServers: McpServers } {
  object(value, "CONTEXT_SCHEMA_INVALID");
  fields(value, ["mcpServers"]);
  try {
    assertMcpServers(value.mcpServers, true);
  } catch {
    throw new TypeError("CONTEXT_SCHEMA_INVALID");
  }
}

export function assertMcpServers(value: unknown, templates = false): asserts value is McpServers {
  if (!isObject(value)) throw new TypeError("mcpServers must be an object");
  const entries = Object.entries(value);
  if (entries.length > 32) throw new TypeError("mcpServers must not contain more than 32 servers");
  for (const [name, server] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new TypeError("mcpServers contains an invalid server name");
    }
    if (!isObject(server)) throw new TypeError(`mcpServers.${name} must be an object`);
    const allowed =
      server.type === "stdio"
        ? new Set([
            "type",
            "command",
            "args",
            "env",
            "cwd",
            "required",
            "startupTimeoutMs",
            "toolTimeoutMs"
          ])
        : server.type === "streamable_http"
          ? new Set(["type", "url", "headers", "required", "startupTimeoutMs", "toolTimeoutMs"])
          : undefined;
    if (!allowed) throw new TypeError(`mcpServers.${name}.type is unsupported`);
    for (const key of Object.keys(server)) {
      if (!allowed.has(key)) throw new TypeError(`mcpServers.${name}.${key} is unsupported`);
    }
    if (server.type === "stdio") {
      requireNonEmptyString(server, "command", `mcpServers.${name}`);
      assertStringArray(server.args, `mcpServers.${name}.args`, 128);
      assertStringRecord(server.env, `mcpServers.${name}.env`, 128);
      for (const [key, value] of Object.entries(server.env ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /\0/.test(String(value)))
          throw new TypeError(`MCP_ENV_INVALID: ${name}.${key}`);
      }
      if (server.cwd !== undefined && (typeof server.cwd !== "string" || server.cwd.length === 0)) {
        throw new TypeError(`mcpServers.${name}.cwd must be a non-empty string when present`);
      }
    } else {
      requireNonEmptyString(server, "url", `mcpServers.${name}`);
      const templated = templates && /\$\$?\{[A-Za-z_][A-Za-z0-9_]*\}/.test(server.url as string);
      let parsed: URL;
      try {
        parsed = new URL(templated ? "https://template.invalid" : (server.url as string));
      } catch {
        throw new TypeError(`mcpServers.${name}.url must be an absolute HTTP URL`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError(`mcpServers.${name}.url must be an absolute HTTP URL`);
      }
      if (Array.from(server.url as string).length > 4096) {
        throw new TypeError(`mcpServers.${name}.url must not exceed 4096 characters`);
      }
      assertStringRecord(server.headers, `mcpServers.${name}.headers`, 64);
      const seen = new Set<string>();
      for (const [key, value] of Object.entries(server.headers ?? {})) {
        if (
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
          /[\r\n\0]/.test(String(value)) ||
          seen.has(key.toLowerCase())
        )
          throw new TypeError(`MCP_HEADER_INVALID: ${name}.${key}`);
        seen.add(key.toLowerCase());
      }
    }
    if (server.required !== undefined && typeof server.required !== "boolean") {
      throw new TypeError(`mcpServers.${name}.required must be boolean when present`);
    }
    assertMcpTimeout(server.startupTimeoutMs, `mcpServers.${name}.startupTimeoutMs`, 300_000);
    assertMcpTimeout(server.toolTimeoutMs, `mcpServers.${name}.toolTimeoutMs`, 3_600_000);
  }
}

function requireNonEmptyString(value: Record<string, unknown>, key: string, path: string): void {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    throw new TypeError(`${path}.${key} must be a non-empty string`);
  }
}

function assertStringArray(value: unknown, path: string, limit: number): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new TypeError(`${path} must be an array of strings`);
  }
}

function assertStringRecord(value: unknown, path: string, limit: number): void {
  if (value === undefined) return;
  if (
    !isObject(value) ||
    Object.keys(value).length > limit ||
    Object.values(value).some((item) => typeof item !== "string")
  ) {
    throw new TypeError(`${path} must be a string map`);
  }
}

function assertMcpTimeout(value: unknown, path: string, maximum: number): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || Number(value) < 100 || Number(value) > maximum) {
    throw new TypeError(`${path} is out of range`);
  }
}

export function assertJsonValue(value: unknown): void {
  json(value, 0);
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new TypeError("CONTEXT_SCHEMA_INVALID");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new TypeError(code);
}

function json(value: unknown, depth: number): void {
  if (depth > 32) throw new TypeError("CONTEXT_SCHEMA_INVALID");
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError("CONTEXT_SCHEMA_INVALID");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) json(item, depth + 1);
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      json(key, depth + 1);
      json(item, depth + 1);
    }
    return;
  }
  throw new TypeError("CONTEXT_SCHEMA_INVALID");
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (isObject(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])])
    );
  return value;
}

/** Environment names are values in a list, never dynamic protocol object keys. */
export function assertContextEnvs(value: unknown): asserts value is ContextEnvsPayload {
  object(value, "CONTEXT_SCHEMA_INVALID");
  fields(value, ["env_variables"]);
  if (!Array.isArray(value.env_variables) || value.env_variables.length > 128)
    throw new TypeError("CONTEXT_SCHEMA_INVALID");
  const keys = new Set<string>();
  for (const entry of value.env_variables) {
    object(entry, "CONTEXT_SCHEMA_INVALID");
    fields(entry, ["key", "value"]);
    if (
      typeof entry.key !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key) ||
      typeof entry.value !== "string" ||
      entry.value.includes("\0") ||
      keys.has(entry.key)
    )
      throw new TypeError("CONTEXT_SCHEMA_INVALID");
    keys.add(entry.key);
  }
}

export function mergeContextEnvs(base: unknown, overrides: unknown): ContextEnvsPayload {
  assertContextEnvs(base);
  assertContextEnvs(overrides);
  const entries = new Map(
    [...base.env_variables, ...overrides.env_variables].map((entry) => [entry.key, entry.value])
  );
  return {
    env_variables: [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value }))
  };
}
