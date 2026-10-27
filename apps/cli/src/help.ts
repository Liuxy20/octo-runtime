import { readFileSync } from "node:fs";

// Read the public release package, rather than the private CLI workspace version.
const releasePackage = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as { version: string };
export const cliVersion = releasePackage.version;
let buildInfo: { commit?: unknown; dirty?: unknown; buildTime?: unknown } = {};
try {
  const metadata: unknown = JSON.parse(
    readFileSync(new URL("./build-info.json", import.meta.url), "utf8")
  );
  if (metadata !== null && typeof metadata === "object") buildInfo = metadata;
} catch (error) {
  if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT")
    throw error;
}
const cliCommitInfo = `commit:${typeof buildInfo.commit === "string" ? buildInfo.commit.slice(0, 12) : "unknown"}${buildInfo.dirty === true ? " (dirty)" : ""}`;
const buildTime = buildInfo.buildTime;
const validBuildTime =
  typeof buildTime === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(buildTime) &&
  Number.isFinite(Date.parse(buildTime)) &&
  new Date(buildTime).toISOString() ===
    (buildTime.includes(".") ? buildTime : buildTime.replace("Z", ".000Z"));
const cliBuildInfo = `build:${validBuildTime ? buildTime : "unknown"}`;
export const cliVersionInfo = `${cliVersion}\n${cliCommitInfo}\n${cliBuildInfo}`;
export const cliHelpHeader = `Octo Runtime CLI (${cliVersion})\n${cliCommitInfo}\n${cliBuildInfo}`;

// 产品指定的首页顺序只影响展示；缺席的 Extra 不补进有效命令目录。
export const preferredRootCommands = [
  "executor-kernel",
  "channel-gateway",
  "channel-wecom",
  "webui"
];

export const lifecycleCommands = new Map([
  ["install", "Register and enable this service (autostart on by default)"],
  ["uninstall", "Remove this service, preserving configuration and data"],
  ["start", "Install if needed, then start this service and wait for readiness"],
  ["stop", "Stop this service, preserving its autostart setting"],
  ["restart", "Restart this service and wait for readiness"],
  ["run", "Run this service in the foreground"],
  ["status", "Show service and runtime status"],
  ["logs", "Read service status logs (no conversation content)"],
  ["extraset", "Replace this service configuration from stdin JSON"],
  ["extraget", "Read this service configuration, including credentials"]
]);
export const rootCommands = new Map([
  ["adapter", "List and probe execution adapters"],
  ["doctor", "Diagnose the local runtime"],
  ["executor-kernel", "Manage local Agent execution and worker supervision"],
  ["extraget", "Read a complete service configuration (advanced)"],
  ["extraset", "Replace a complete service configuration from JSON (advanced)"],
  ["help", "Help about any command"],
  ["playboard", "Run an Agent request from stdin JSON"],
  ["status", "Show runtime and service status"],
  ["version", "Print version and build information"]
]);
