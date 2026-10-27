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

const componentDescriptions: Record<string, string> = {
  "executor-kernel": `Local Agent execution service. Runs requests through Provider adapters and
supervises the execution worker used by Gateway, WeCom, WebUI and SDK clients.
Install and authenticate your chosen Provider before running Agent tasks.

Get started: octo-runtime executor-kernel start
Check readiness: octo-runtime executor-kernel status`,
  "channel-gateway": `Connects Octo IM Bots to local Agent execution. Receives messages, invokes
the Executor Kernel and sends Agent replies back to Octo IM.

Configure Bots: octo-runtime channel-gateway configure --help
Advanced JSON: octo-runtime channel-gateway config set < gateway.json
Start: octo-runtime channel-gateway start
Agent tasks also need: octo-runtime executor-kernel start`,
  "channel-wecom": `Connects WeCom Bots to local Agent execution. Receives WeCom messages,
invokes the Executor Kernel and sends Agent replies back to WeCom.

Configure Bots: octo-runtime channel-wecom configure --help
Advanced JSON: octo-runtime channel-wecom config set < wecom.json
Start: octo-runtime channel-wecom start
Agent tasks also need: octo-runtime executor-kernel start`,
  webui: `Local browser workspace for Agent conversations and projects.
Uses the Executor Kernel for Agent execution; default URL: http://127.0.0.1:13888/.

Configure port and session storage: octo-runtime webui configure --help
Start: octo-runtime webui start
Agent tasks also need: octo-runtime executor-kernel start`
};

export function helpText(component?: string): string {
  if (component)
    return `Octo Runtime: ${component}

${componentDescriptions[component] ?? `Configured Extra service "${component}". Runs its registered module independently.\nConfiguration: octo-runtime extraget ${component}`}

Usage: octo-runtime ${component} <command> [flags]

Commands:
  install       Register and enable this service (autostart on by default)
  uninstall     Remove this service, preserving configuration and data
  start         Install if needed, then start this service and wait for readiness
  restart       Restart this service and wait for local readiness
  stop          Stop this service, preserving its autostart setting
  status        Show native service, IPC and component status
  run           Run this component in the foreground
${component === "executor-kernel" ? "  recover       Acknowledge a blocked orphan cleanup after stopping all orphan tools\n" : "  logs          Tail service status logs (no conversation content)\n"}

Flags: --home <path> --profile <name> --manifest <path> --json --help
--manifest selects Provider/Extra modules; invocation state stays in --home/run.
Install: --autostart=true|false
${component === "executor-kernel" ? "Recover: --acknowledge-orphan-cleanup (retains evidence; refuses a live owner)\n" : ""}
${component === "executor-kernel" ? "" : "Logs: --lines <1..10000> (default 200) --follow --json (NDJSON)\n"}
Kernel and Extras have independent services and autostart settings.
An Extra may start before Kernel and connect when Kernel becomes available.`;
  return `Octo Runtime CLI (${cliVersion})
${cliVersionInfo.split("\n").slice(1).join("\n")}
Manage the local Agent runtime and independent services.

Usage:
octo-runtime executor-kernel uninstall|install|start|restart|stop|status|run
octo-runtime executor-kernel recover --acknowledge-orphan-cleanup
octo-runtime <extra-name> uninstall|install|start|restart|stop|status|run
octo-runtime <extra-name> logs [--lines 200] [--follow] [--json]
octo-runtime [--home <path>] <extra-name> configure [options]
octo-runtime [--home <path>] <extra-name> config set|get
octo-runtime status [--json]
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime doctor
octo-runtime extraset <name> < config.json
octo-runtime extraget <name>
octo-runtime playboard < request.json

Flags: --home <path> --profile <name> --manifest <path> --json
--manifest selects Provider/Extra modules; invocation state stays in --home/run.
Install: --autostart=true|false (defaults to true)
Extras: channel-gateway, channel-wecom, webui, or a selected manifest entry.
Extra-owned commands: global --home/--manifest/--json and -h/--help work before or after the command.
Saving configuration requires an Extra restart to apply; config get/extraget include credentials.
Components:
  executor-kernel  Local Agent execution and worker supervision
  channel-gateway Octo IM Bot messaging and Agent replies
  channel-wecom   WeCom Bot messaging and Agent replies
  webui           Local browser workspace for Agent conversations
Use octo-runtime <component> --help for component commands.`;
}
