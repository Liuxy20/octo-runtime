import type { AdapterProbeOptions } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { HostedAdapterMetadata } from "@mininglamp-oss/octo-runtime-executor-core";
import {
  resolveStreamLimitPolicy,
  type InputInvoke,
  type InputFrames,
  type InteractionResponse,
  type NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";

/** Kernel 内部的原生执行源；不是另一条传输协议，公共调用始终经过 KernelClient RPC。 */
export interface ExecutionSource {
  list(configurations?: Record<string, AdapterProbeOptions>): Promise<HostedAdapterMetadata[]>;
  probe(adapterType: string, options?: AdapterProbeOptions): Promise<unknown>;
  cancel(invocationId: string, reason?: string): Promise<{ cancelled: boolean }>;
  respondInteraction(invocationId: string, response: InteractionResponse): Promise<void>;
  respondNative(invocationId: string, response: NativeInteractionResponse): Promise<void>;
  invoke: InputInvoke;
  invokeFrames: InputFrames;
}

/** 校验宿主提供的配置值，不读取文件或修改原对象。 */
export function probeOptions(value: unknown): AdapterProbeOptions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid probe options");
  const options = value as AdapterProbeOptions;
  if (
    options.providerOptions !== undefined &&
    (!options.providerOptions ||
      typeof options.providerOptions !== "object" ||
      Array.isArray(options.providerOptions) ||
      Object.values(options.providerOptions).some((v) => typeof v !== "string"))
  )
    throw new TypeError("invalid probe provider options");
  return {
    ...options,
    ...(options.streamLimits === undefined
      ? {}
      : { streamLimits: resolveStreamLimitPolicy(options.streamLimits) })
  };
}
