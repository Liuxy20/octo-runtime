import type { AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

/**
 * MiniMax Code ACP adapter. Launches `mcode acp` and speaks the Agent Client
 * Protocol through the shared ACP adapter, which reconstructs model steps,
 * streams the prompt turn and normalizes `session/update` notifications into
 * canonical events.
 *
 * MiniMax Code owns model selection itself and advertises no per-session model
 * option, so no `session/set_model` is sent — the model configured on the
 * runtime governs. It also advertises `loadSession: false`; a resume whose
 * `session/load` returns an empty result is treated as a missing session and
 * falls back to a fresh session (`emptyLoadResultMeansMissing`).
 */
export const mcodeMetadata: AdapterMetadata = {
  type: "mcode",
  mcp: true
};

/** 宿主交付所选命令或 client factory；本模块仅维护 ACP 协议要求。 */
export function createMcodeAdapter(
  options: NonNullable<Parameters<typeof createAcpAdapter>[1]> & { command: string }
) {
  return createAcpAdapter(
    {
      metadata: mcodeMetadata,
      type: "mcode",
      provider: "mcode",
      command: options.command,
      args: ["acp"],
      emptyLoadResultMeansMissing: true
    },
    options
  );
}
