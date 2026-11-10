import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

export const hermesMetadata: AdapterMetadata = {
  type: "hermes",
  mcp: true,
  agentSources: ["provisioned"]
};

/** 宿主交付所选命令或 client factory；本模块仅维护 ACP 协议要求。 */
export function createHermesAdapter(
  options: NonNullable<Parameters<typeof createAcpAdapter>[1]> & { command: string }
) {
  return createAcpAdapter(
    {
      metadata: hermesMetadata,
      type: "hermes",
      provider: "hermes",
      command: options.command,
      args: ["acp"],
      emptyLoadResultMeansMissing: true
    },
    options
  );
}
