import type {
  ProtocolMode,
  RuntimeLimits,
  StreamLimitPolicy
} from "@mininglamp-oss/octo-runtime-protocol";
import type { RuntimeLog } from "./runtime-log.js";

/** Provider progress used by the host watchdog to enforce execution deadlines. */
export interface ProviderActivity {
  kind: "turn_started" | "turn_progress" | "transport_response" | "retry_notice";
  method:
    | "turn_start"
    | "text_delta"
    | "tool_delta"
    | "item_lifecycle"
    | "usage"
    | "rpc_response"
    | "retry";
  toolCallId?: string;
  toolState?: "started" | "completed";
}

export interface AdapterInvocationContext {
  /** 宿主可信连接设置不改写调用方 AgentEnv。 */
  providerOptions?: Record<string, string>;
  /** Adapter 解释预算后配置本次 Core 看门狗；不传 Provider 配置副本。 */
  configureRuntimeLimits?(limits: RuntimeLimits | undefined): void;
  protocolMode?: ProtocolMode;
  streamLimits?: Readonly<StreamLimitPolicy>;
  /** Existing host metadata sink; never serialize or log provider bodies. */
  log?: RuntimeLog;
  reportConversion?(): void;
  reportActivity?(activity: ProviderActivity): void;
  /** 本地资格确认：成功结果已确定，后续 cleanup 失败独立报告；不是 wire 事件。 */
  reportExecutionResult?(result: {
    status: "completed";
    basis: "final_answer_cleanup_fallback";
  }): void;
}
