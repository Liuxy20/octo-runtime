import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentExecutor,
  HostedAdapterMetadata
} from "@mininglamp-oss/octo-runtime-executor-core";
import {
  HostRunService,
  KernelError,
  admissionClosedError,
  type KernelClient
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  createInputInvoke,
  identifyInvokeInput,
  assertInvokeRequestSize,
  isHostTerminal,
  type InputInvoke,
  type InvokeInput,
  type InvokeEnvironment,
  type HostFrame,
  type HostRunReceipt,
  type InteractionResponse,
  type NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";

/** 宿主显式选择执行位置；direct 始终借用同一 Core，ipc 只连接已有服务。 */
export type ExtraExecution =
  | { kind: "direct"; executor: AgentExecutor; endpoint?: never }
  | { kind: "ipc"; endpoint: string; executor?: never };

/** Extra 只控制本 scope 的调用；不暴露执行器 shutdown 或 Kernel 的低层恢复原语。 */
export interface ExtraExecutionContext {
  readonly kind: "direct" | "ipc";
  readonly invoke: InputInvoke;
  cancelInvocation(id: string, reason?: string): Promise<{ accepted: boolean }>;
  respondInteraction(id: string, response: InteractionResponse): Promise<void>;
  respondNativeInteraction(id: string, response: NativeInteractionResponse): Promise<void>;
  list(): Promise<HostedAdapterMetadata[]>;
}

export interface ExtraExecutionScope {
  context: ExtraExecutionContext;
  available(): Promise<boolean>;
  stopAdmission(): void;
  drain(options: { deadline: number; reason: string }): Promise<{ complete: boolean }>;
  release(): Promise<void>;
}

/** 复用同一 IPC client 的登记、取消重试及恢复逻辑，不复制协议实现。 */
export function ipcExecutionContext(client: KernelClient): ExtraExecutionContext {
  return Object.freeze({
    kind: "ipc" as const,
    invoke: client.invoke,
    cancelInvocation: (id: string, reason?: string) => client.cancelInvocation(id, reason),
    respondInteraction: (id: string, response: InteractionResponse) =>
      client.respondInteraction(id, response),
    respondNativeInteraction: (id: string, response: NativeInteractionResponse) =>
      client.respondNativeInteraction(id, response),
    list: () => client.list()
  });
}

export function createIpcExecutionScope(client: KernelClient): ExtraExecutionScope {
  return {
    context: ipcExecutionContext(client),
    available: () =>
      client.status().then(
        (status) => status.execution_ready,
        () => false
      ),
    stopAdmission: () => client.invocations.stopAdmission(),
    drain: (options) => client.invocations.drain(options),
    release() {
      client.close();
      return Promise.resolve();
    }
  };
}

interface Coordinator {
  source: HostRunService;
  users: number;
}
// 只协调显式共享同一对象的 scope；缓冲总额不随 Extra 数量倍增，不创建全局执行器。
const coordinators = new WeakMap<AgentExecutor, Coordinator>();
interface OwnedInvocation {
  controller: AbortController;
  admitted: Promise<HostRunReceipt>;
  receipt?: HostRunReceipt;
  settled: Promise<void>;
  failed: boolean;
}

/**
 * 将 Core 的执行 iterator 留在共享有界源中独立驱动；插件只有观察视图。
 * 完整接纳凭据到达前只操作自己的 signal，绝不凭调用方传入的 id 取消共享 Core。
 */
export function createDirectExecutionScope(executor: AgentExecutor): ExtraExecutionScope {
  let coordinator = coordinators.get(executor);
  if (!coordinator) {
    coordinator = {
      users: 0,
      source: new HostRunService({
        invoke: executor.invoke,
        invokeFrames: (input, environment) => executor.invokeFrames(input, environment),
        list: (configurations) => executor.describe(configurations),
        probe: (type, options) => Promise.resolve(executor.probe(type, options)),
        cancel: (id, reason) => Promise.resolve({ cancelled: executor.cancel(id, reason) }),
        respondInteraction: (id, response) => executor.respondInteraction(id, response),
        respondNative: (id, response) => executor.respondNative(id, response)
      })
    };
    coordinators.set(executor, coordinator);
  }
  const shared = coordinator;
  shared.users++;
  const records = new Map<string, OwnedInvocation>();
  const queries = new Set<Promise<unknown>>();
  let stopped = false;
  let released = false;
  let draining: Promise<{ complete: boolean }> | undefined;
  const assertOpen = () => {
    if (stopped) throw admissionClosedError();
    if (!executor.status().available) throw new Error("EXECUTOR_CLOSED");
  };
  const owned = (id: string) => {
    const record = records.get(id);
    if (!record) throw new KernelError("INVOCATION_NOT_TRACKED");
    return record;
  };
  const accepted = (id: string) => {
    const record = owned(id);
    if (!record.receipt) throw new KernelError("INVOCATION_NOT_ACCEPTED");
    if (record.failed) throw new KernelError("RUN_OUTCOME_UNKNOWN");
    return record.receipt;
  };
  const trackQuery = (pending: Promise<unknown>) => {
    queries.add(pending);
    void pending.then(
      () => queries.delete(pending),
      () => queries.delete(pending)
    );
  };
  const cancel = async (id: string, reason = "caller_cancelled") => {
    const record = owned(id);
    if (!record.receipt) {
      record.controller.abort(reason);
      // 明确拒绝接纳不会取得他人的控制权；已接纳则由此 signal 定向通知同一次调用。
      await record.admitted;
      return { accepted: true };
    }
    const receipt = accepted(id);
    if (shared.source.get(receipt.run_id).terminal) return { accepted: false };
    return { accepted: executor.cancel(receipt.invocation_id, reason) };
  };
  async function* observe(
    input: InvokeInput,
    environment: InvokeEnvironment = {}
  ): AsyncGenerator<HostFrame> {
    assertOpen();
    environment.signal?.throwIfAborted();
    assertInvokeRequestSize(input, environment);
    const identified = identifyInvokeInput(structuredClone(input));
    if (records.has(identified.invocationId)) throw new KernelError("EXECUTION_IDENTITY_CONFLICT");
    if (records.size >= 128) throw new KernelError("CLIENT_INVOCATION_CAPACITY_EXHAUSTED");
    const controller = new AbortController();
    const abort = () => controller.abort(environment.signal?.reason);
    environment.signal?.addEventListener("abort", abort, { once: true });
    const admitted = shared.source.submit(identified, {
      ...environment,
      ...(environment.executionEnvOverrides
        ? { executionEnvOverrides: structuredClone(environment.executionEnvOverrides) }
        : {}),
      signal: controller.signal
    });
    const record: OwnedInvocation = {
      controller,
      admitted,
      settled: Promise.resolve(),
      failed: false
    };
    records.set(identified.invocationId, record);
    record.settled = admitted
      .then(async (receipt) => {
        record.receipt = receipt;
        await shared.source.settled(receipt);
        const cleanup = await executor.waitForInvocationCleanup(receipt);
        if (cleanup !== "complete") throw new Error("EXTRA_RUN_CLEANUP_INCOMPLETE");
        records.delete(identified.invocationId);
      })
      .catch(() => {
        // submit 明确拒绝时未创建 Core owner；已接纳的失败必须保留容量和关闭失败事实。
        if (!record.receipt) records.delete(identified.invocationId);
        else record.failed = true;
      })
      .finally(() => environment.signal?.removeEventListener("abort", abort));
    const receipt = await admitted;
    let after = 0;
    while (true) {
      const window = shared.source.read(receipt.run_id, receipt.stream_id, after);
      for (const item of window.events) {
        after = item.seq;
        yield item.event;
        if (isHostTerminal(item.event)) {
          if (
            item.event.kind === "control" &&
            item.event.control.type === "state" &&
            item.event.control.state === "lost"
          )
            throw new KernelError("RUN_OUTCOME_UNKNOWN");
          return;
        }
      }
      // 每次只读取中央窗口的一小批；观察退出不关闭 source，也不撤销已接纳调用。
      await delay(10);
    }
  }
  const context: ExtraExecutionContext = Object.freeze({
    kind: "direct",
    invoke: createInputInvoke(observe),
    cancelInvocation: cancel,
    respondInteraction: async (id: string, response: InteractionResponse) => {
      const receipt = accepted(id);
      await shared.source.respond(receipt.run_id, response);
    },
    respondNativeInteraction: async (id: string, response: NativeInteractionResponse) => {
      const receipt = accepted(id);
      await shared.source.respondNativeRun(receipt.run_id, response);
    },
    list: async () => {
      assertOpen();
      if (queries.size >= 128) throw new Error("EXTRA_QUERY_CAPACITY_EXHAUSTED");
      const query = executor.describe({}, { onProbe: trackQuery });
      trackQuery(query);
      return query;
    }
  });
  return {
    context,
    available: () => Promise.resolve(!stopped && executor.status().available),
    stopAdmission() {
      stopped = true;
    },
    drain({ deadline, reason }) {
      stopped = true;
      return (draining ??= (async () => {
        for (const [id] of records) void cancel(id, reason).catch(() => undefined);
        while ([...records.values()].some((record) => !record.failed) || queries.size) {
          if (Date.now() >= deadline) return { complete: false };
          await delay(Math.min(10, Math.max(1, deadline - Date.now())));
        }
        return { complete: records.size === 0 };
      })());
    },
    async release() {
      stopped = true;
      if (released || records.size || queries.size) return;
      released = true;
      if (--shared.users === 0) {
        coordinators.delete(executor);
        await shared.source.close();
      }
    }
  };
}
