import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const scope = new AsyncLocalStorage<number>();
const deadlines = new WeakMap<AbortSignal, number>();
const parents = new WeakMap<AbortSignal, readonly AbortSignal[]>();

/** 私有关闭预算；不增加 ExtraContext 的公开字段或插件 ABI。 */
export function shutdownDeadline(signal?: AbortSignal): number {
  const inherited = signal && parents.get(signal);
  return Math.min(
    scope.getStore() ?? Infinity,
    (signal && deadlines.get(signal)) ?? Infinity,
    ...(inherited?.map((parent) => shutdownDeadline(parent)) ?? []),
    performance.now() + 4000
  );
}

export function withShutdownDeadline<T>(until: number, operation: () => T): T {
  return scope.run(Math.min(scope.getStore() ?? Infinity, until), operation);
}

export function abortForShutdown(controller: AbortController): void {
  if (!deadlines.has(controller.signal)) deadlines.set(controller.signal, shutdownDeadline());
  controller.abort();
}

export function shutdownSignal(signals: AbortSignal[]): AbortSignal {
  // AbortSignal.any 不携带私有预算；保留父信号关系，让稍后开始的 dispose 仍继承最早期限。
  const signal = AbortSignal.any(signals);
  parents.set(signal, signals);
  return signal;
}

/** 只限制等待时间，不强停 operation；owner 须在到期后撤销迟到操作的写入和投递权限。 */
export async function withinShutdown<T>(
  operation: Promise<T>,
  until: number,
  code: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), Math.max(0, until - performance.now()));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
