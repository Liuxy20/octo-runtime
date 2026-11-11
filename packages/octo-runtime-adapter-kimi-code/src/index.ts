import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

export const kimiCodeMetadata: AdapterMetadata = {
  type: "kimi-code",
  mcp: true
};

/** 宿主交付所选命令或 client factory；本模块仅维护 ACP 协议要求。 */
export function createKimiCodeAdapter(
  options: NonNullable<Parameters<typeof createAcpAdapter>[1]> & { command: string }
) {
  return createAcpAdapter(
    {
      metadata: kimiCodeMetadata,
      type: "kimi-code",
      provider: "kimi-code",
      command: options.command,
      args: ["acp"]
    },
    options
  );
}
