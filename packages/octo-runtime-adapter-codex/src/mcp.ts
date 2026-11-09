import { invocationMcpServers, type InvokeRequest } from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** 本轮 MCP 经私有 thread RPC 传递；不依赖共享进程环境，不写 argv 或配置文件。 */
export function codexMcpConfig(request: InvokeRequest, env: NodeJS.ProcessEnv) {
  const servers = invocationMcpServers(request, env);
  const native = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const entry: Record<string, unknown> = {};
      if (server.type === "stdio") {
        entry.command = server.command;
        if (server.args) entry.args = server.args;
        if (server.cwd) entry.cwd = server.cwd;
        if (server.env) entry.env = server.env;
      } else {
        entry.url = server.url;
        entry.http_headers = server.headers ?? {};
      }
      if (server.required !== undefined) entry.required = server.required;
      if (server.startupTimeoutMs !== undefined)
        entry.startup_timeout_sec = server.startupTimeoutMs / 1000;
      if (server.toolTimeoutMs !== undefined) entry.tool_timeout_sec = server.toolTimeoutMs / 1000;
      return [name, entry];
    })
  );
  return { servers: native, env: {} };
}
