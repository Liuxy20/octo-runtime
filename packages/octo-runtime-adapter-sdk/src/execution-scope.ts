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

/**
 * Core 每次注册独占本地调用作用域；构造不得启动进程，关闭后不再接纳。
 * close 回收本 scope 的调用/订阅/租约，不隐含获得宿主注入 Engine 或共享连接的销毁权。
 * Adapter 构造方法和参数由实现者决定；统一的是注册后的执行合同。
 */
export interface AdapterExecutionScope {
  invoke(request: InvokeRequest, context?: AdapterInvocationContext): AsyncIterable<AdapterOutput>;
  respondInteraction?(invocationId: string, response: InteractionResponse): Promise<void>;
  respondNative?(invocationId: string, response: NativeInteractionResponse): Promise<void>;
  processes?(): readonly ServiceProcessSnapshot[];
  beginShutdown(reason: string): void;
  close(options: { deadline: number }): Promise<AdapterScopeCleanup>;
}

export type CreateAdapterExecutionScope = (options: { log: RuntimeLog }) => AdapterExecutionScope;
