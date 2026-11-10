import { agentEnvItem, type InvokeRequest } from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** 只读本轮私有 item；省略不补模式，非法显式值在原生映射前拒绝。 */
export function grokModeId(request: InvokeRequest): "default" | "plan" | undefined {
  const value = agentEnvItem(request.agentEnv, "adapter.grok-build", "options")?.modeId;
  if (value === undefined) return undefined;
  if (value !== "default" && value !== "plan")
    throw new TypeError("ADAPTER_OPTION_INVALID: grok-build.modeId");
  return value;
}
