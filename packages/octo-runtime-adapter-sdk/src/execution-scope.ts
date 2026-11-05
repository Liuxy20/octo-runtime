import type { AdapterInvocationContext } from "./activity.js";
import type { AdapterOutput } from "./index.js";
import type { RuntimeLog } from "./runtime-log.js";
import type {
  InteractionResponse,
  NativeInteractionResponse,
  InvokeRequest,
  ServiceProcessSnapshot
} from "@mininglamp-oss/octo-runtime-protocol";

export type { ServiceProcessSnapshot } from "@mininglamp-oss/octo-runtime-protocol";

/** 服务资源独立于单轮清理；deadline 使用 performance.now() 的绝对毫秒值。 */
export interface AdapterScopeCleanup {
  complete: boolean;
  unresolvedServiceIds: readonly string[];
  failedCleanupServiceIds: readonly string[];
}

/** Core 每次注册独占一个作用域；构造不得启动进程，关闭后不可重新接纳或恢复。 */
export interface AdapterExecutionScope {
  invoke(request: InvokeRequest, context?: AdapterInvocationContext): AsyncIterable<AdapterOutput>;
  respondInteraction?(invocationId: string, response: InteractionResponse): Promise<void>;
  respondNative?(invocationId: string, response: NativeInteractionResponse): Promise<void>;
  processes?(): readonly ServiceProcessSnapshot[];
  beginShutdown(reason: string): void;
  close(options: { deadline: number }): Promise<AdapterScopeCleanup>;
}

export type CreateAdapterExecutionScope = (options: { log: RuntimeLog }) => AdapterExecutionScope;
