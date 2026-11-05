import type { AdapterProtocolSupport } from "./run-protocol.js";
import type { HostedAdapterMetadataWire } from "./generated/protocol-types.js";

/** 宿主注册及执行时使用的完整元数据；编写时的可选默认值须由 Adapter 工厂先补齐。 */
export type HostedAdapterMetadata = Pick<
  HostedAdapterMetadataWire,
  | "workspace"
  | "type"
  | "agentSources"
  | "processModel"
  | "transport"
  | "providerVersion"
  | "providerPath"
  | "available"
  | "unavailableReason"
> & {
  /** wire 可省略的编写输入不能放宽 Core 注册合同。 */
  protocolSupport: AdapterProtocolSupport;
};
