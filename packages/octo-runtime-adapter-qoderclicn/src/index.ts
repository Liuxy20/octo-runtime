import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { invocationApprovalMode } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

/**
 * Qoder CN CLI ACP adapter. Launches `qoderclicn --acp` and speaks the
 * Agent Client Protocol through the shared ACP adapter, which reconstructs
 * model steps, streams the prompt turn and normalizes `session/update`
 * notifications into canonical events.
 *
 * This is the China (CN) distribution of Qoder; it behaves like Qoder CLI —
 * full access adds `--yolo` to select the ACP "bypass permissions" mode and a stored provider
 * session resumes through `session/load` — but ships as a distinct `qoderclicn`
 * binary and is registered as its own adapter type so a runtime can pick the CN
 * build explicitly.
 */
export const qoderCliCnMetadata: AdapterMetadata = {
  type: "qoderclicn",
  mcp: true,
  agentSources: ["provisioned"]
};

/** 宿主交付所选命令或 client factory；本模块仅维护 ACP 协议要求。 */
export function createQoderCliCnAdapter(
  options: NonNullable<Parameters<typeof createAcpAdapter>[1]> & { command: string }
) {
  return createAcpAdapter(
    {
      metadata: qoderCliCnMetadata,
      type: "qoderclicn",
      provider: "qoderclicn",
      command: options.command,
      args: (request) =>
        invocationApprovalMode(request) === "full_access" ? ["--yolo", "--acp"] : ["--acp"]
    },
    options
  );
}
