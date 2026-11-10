import { resolveHostProviderLaunch } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-launch";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";

const launch = resolveHostProviderLaunch(process.env.OCTO_OPENCODE_COMMAND ?? "opencode", {
  env: process.env,
  cwd: process.cwd()
});
export default createOpenCodeAdapter({
  command: launch.command,
  commandArgsPrefix: launch.args,
  env: launch.env
});
