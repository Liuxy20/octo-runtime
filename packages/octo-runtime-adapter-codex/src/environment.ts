import {
  invocationEnvs,
  mergeProcessEnvironment,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** Per-thread overrides; the provider's effective configuration stays on disk unchanged. */
export function codexEnvironmentConfig(
  request: InvokeRequest,
  config: Record<string, unknown>
): Record<string, unknown> {
  const envs = invocationEnvs(request);
  const keys = Object.keys(envs);
  if (!keys.length) return {};
  const shell = record(config.shell_environment_policy);
  const overrides: Record<string, unknown> = {
    "shell_environment_policy.set": mergeProcessEnvironment(
      record(shell.set) as NodeJS.ProcessEnv,
      envs
    )
  };
  if (Array.isArray(shell.include_only) && shell.include_only.length) {
    overrides["shell_environment_policy.include_only"] = [
      ...new Set([...(shell.include_only as unknown[]), ...keys])
    ];
  }
  const servers: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record(config.mcp_servers))) {
    const server = record(value);
    if (
      typeof server.command !== "string" ||
      server.enabled === false ||
      server.experimental_environment === "remote"
    )
      continue;
    // 共享 app-server 环境固定；逐线程传实际值，MCP 自有 env 继续具有原生优先级。
    Object.defineProperty(servers, name, {
      enumerable: true,
      value: {
        env: mergeProcessEnvironment(envs, record(server.env) as NodeJS.ProcessEnv)
      }
    });
  }
  if (Object.keys(servers).length) overrides.mcp_servers = servers;
  return overrides;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
