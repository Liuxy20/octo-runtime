import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";

export default createOpenCodeAdapter({ command: process.env.OCTO_OPENCODE_COMMAND ?? "opencode" });
