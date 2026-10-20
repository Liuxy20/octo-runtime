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

export function helpText(): string {
  return `Octo Runtime CLI (${cliVersion})
${cliVersionInfo.split("\n").slice(1).join("\n")}
Manage the local Agent runtime and independent services.

Usage:
octo-runtime executor-kernel uninstall|install|start|restart|stop|run
octo-runtime channel-gateway uninstall|install|start|restart|stop|run
octo-runtime status [--json]
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime doctor
octo-runtime extraset <name> < config.json
octo-runtime extraget <name>
octo-runtime playboard < request.json

Flags: --home <path> --profile <name> --manifest <path> --json
Install: --autostart=true|false (first install defaults to false)`;
}
