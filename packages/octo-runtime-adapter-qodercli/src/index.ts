import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { invocationApprovalMode } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

/**
 * Qoder CLI ACP adapter. Launches `qodercli --acp` and speaks the Agent
 * Client Protocol through the shared ACP adapter, which reconstructs model
 * steps, streams the prompt turn and normalizes `session/update` notifications
 * into canonical events.
 *
 * Full access adds `--yolo`, selecting Qoder's ACP "bypass permissions" mode so headless tool runs
 * do not block on interactive approval. Qoder advertises session loading, so a
 * stored provider session resumes through `session/load` without a fresh
 * fallback. Per-session model selection follows the standard ACP path when the
 * runtime configures a model that Qoder advertises.
 */
export const qoderCliMetadata: AdapterMetadata = {
  type: "qodercli",
  mcp: true,
  agentSources: ["provisioned"]
};

/** 宿主交付所选命令或 client factory；本模块仅维护 ACP 协议要求。 */
export function createQoderCliAdapter(
  options: NonNullable<Parameters<typeof createAcpAdapter>[1]> & { command: string }
) {
  return createAcpAdapter(
    {
      metadata: qoderCliMetadata,
      type: "qodercli",
      provider: "qodercli",
      command: options.command,
      args: (request) =>
        invocationApprovalMode(request) === "full_access" ? ["--yolo", "--acp"] : ["--acp"]
    },
    options
  );
}
