import {
  resolveModuleSpecifier,
  type AdapterModuleEntry
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import type { HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  withStartupContext,
  ServiceInitializationError,
  type ServiceCleanupResult
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import type {
  AdapterScopeCleanup,
  ServiceProcessSnapshot
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** CLI 工厂可以返回显式自有资源；此约定不限制 SDK Adapter 的构造形式。 */
export interface CliAdapterResource {
  adapter: HostedAdapter;
  processes?(): readonly ServiceProcessSnapshot[];
  beginShutdown?(): void;
  close(deadline: number): Promise<AdapterScopeCleanup>;
}
export interface CliAdapters {
  adapters: HostedAdapter[];
  processes(): readonly ServiceProcessSnapshot[];
  beginShutdown(): void;
  close(deadline: number): Promise<AdapterScopeCleanup>;
}

/** CLI 只加载所选模块并构造实例；Kernel 不接触清单、模块路径或产品准备。 */
export async function loadCliAdapters(
  entries: readonly AdapterModuleEntry[],
  options?: {
    profileRoot: string;
    syncOpenClawTools: boolean;
    env?: NodeJS.ProcessEnv;
  }
): Promise<CliAdapters> {
  const adapters: HostedAdapter[] = [];
  const resources: CliAdapterResource[] = [];
  const pending = new Map<CliAdapterResource, Promise<void>>();
  const completed = new Map<CliAdapterResource, AdapterScopeCleanup>();
  const assembly: CliAdapters = {
    adapters,
    processes: () => resources.flatMap((r) => [...(r.processes?.() ?? [])]),
    beginShutdown() {
      const errors: unknown[] = [];
      for (const resource of resources) {
        try {
          resource.beginShutdown?.();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "CLI_ENGINE_SHUTDOWN_FAILED");
    },
    async close(deadline) {
      if (!Number.isFinite(deadline)) throw new TypeError("CLEANUP_DEADLINE_INVALID");
      // 按构造逆序释放依赖；每个 disposer 只启动一次，到期仍尝试其余独立资源。
      for (const [index, resource] of [...resources.entries()].reverse()) {
        if (!pending.has(resource)) {
          pending.set(
            resource,
            Promise.resolve()
              .then(() => resource.close(deadline))
              .then((result) => {
                // JS 工厂可能违反类型合同；坏结果也必须成为清理失败，不能打断其他 disposer。
                if (!isScopeCleanup(result)) throw new TypeError("CLI_RESOURCE_CLEANUP_INVALID");
                completed.set(
                  resource,
                  !result.complete && !result.unresolvedServiceIds.length
                    ? { ...result, unresolvedServiceIds: [`cli-adapter-${index}`] }
                    : result
                );
              })
              .catch(() => {
                completed.set(resource, {
                  complete: false,
                  unresolvedServiceIds: [`cli-adapter-${index}`],
                  failedCleanupServiceIds: [`cli-adapter-${index}`]
                });
              })
          );
        }
        let timer: NodeJS.Timeout | undefined;
        if (performance.now() >= deadline) {
          await Promise.resolve();
          continue;
        }
        try {
          await Promise.race([
            pending.get(resource),
            new Promise<void>((done) => {
              timer = setTimeout(done, Math.max(0, deadline - performance.now()));
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      const results = resources.map(
        (resource, index) =>
          completed.get(resource) ?? {
            complete: false,
            unresolvedServiceIds: [`cli-adapter-${index}`],
            failedCleanupServiceIds: []
          }
      );
      return {
        complete: results.every(
          (r) => r.complete && !r.unresolvedServiceIds.length && !r.failedCleanupServiceIds.length
        ),
        unresolvedServiceIds: results.flatMap((r) => [...r.unresolvedServiceIds]),
        failedCleanupServiceIds: results.flatMap((r) => [...r.failedCleanupServiceIds])
      };
    }
  };
  // 解析也在诊断边界内；仍先解析整个所选集合，再导入/构造，保持 CLI 原顺序。
  const selected = entries.map((entry) => {
    try {
      return { entry, specifier: resolveModuleSpecifier(entry.module, entry.sourceManifest) };
    } catch (error) {
      throw adapterStartupFailure(error, entry);
    }
  });
  try {
    for (const { entry, specifier } of selected) {
      try {
        const loaded: unknown = await import(specifier);
        const exports = asRecord(loaded, `adapter module ${entry.module}`);
        const exported = exports[entry.export];
        if (exported === undefined)
          throw new Error(`missing export ${entry.export} from ${entry.module}`);

        // 动态模块先校验工厂与 Adapter 形状，再交给唯一 Core 注册；不提前探测未选模块。
        const constructed: unknown = entry.factory
          ? await callFactory(exported, entry, options?.env ?? process.env)
          : exported;
        const resource =
          isRecord(constructed) &&
          typeof constructed.close === "function" &&
          "adapter" in constructed
            ? (constructed as unknown as CliAdapterResource)
            : undefined;
        if (resource) resources.push(resource);
        const instance = resource ? resource.adapter : constructed;
        if (!isHostedAdapter(instance))
          throw new TypeError(`${entry.module}#${entry.export} is not an Octo Runtime adapter`);
        if (entry.type && instance.metadata.type !== entry.type)
          throw new Error(
            `manifest type ${entry.type} does not match adapter ${instance.metadata.type}`
          );
        adapters.push(instance);
      } catch (error) {
        throw adapterStartupFailure(error, entry);
      }
    }
    if (options && adapters.some((adapter) => adapter.metadata.type === "openclaw")) {
      const { initializeCliOpenClaw } = await import("./openclaw.js");
      await initializeCliOpenClaw(options.profileRoot);
    }
    return assembly;
  } catch (error) {
    const cleanup = await assembly.close(performance.now() + 2500);
    if (!cleanup.complete)
      throw new ServiceInitializationError(error, cliCleanupResult(cleanup), {
        component: "cli",
        phase: "created"
      });
    throw error;
  }
}

/** 将宿主资源清理事实投影到既有启动诊断；主失败与 pending/failed 资源分别保留。 */
export function cliCleanupResult(cleanup: AdapterScopeCleanup): ServiceCleanupResult {
  const complete =
    cleanup.complete &&
    !cleanup.unresolvedServiceIds.length &&
    !cleanup.failedCleanupServiceIds.length;
  return {
    complete,
    errors: complete
      ? []
      : [
          { resource: "engines", code: "ENGINE_CLEANUP_INCOMPLETE" },
          ...cleanup.failedCleanupServiceIds.map((resource) => ({
            resource,
            code: "ENGINE_CLEANUP_FAILED"
          }))
        ],
    pendingResources: [
      ...new Set([...cleanup.unresolvedServiceIds, ...cleanup.failedCleanupServiceIds])
    ]
  };
}

function adapterStartupFailure(error: unknown, entry: AdapterModuleEntry): unknown {
  return withStartupContext(error, {
    component: "cli",
    phase: "created",
    context: {
      module: entry.module,
      resource: "adapter-module",
      operation: "assemble-adapter",
      configKey: "adapters"
    }
  });
}

function callFactory(value: unknown, entry: AdapterModuleEntry, env: NodeJS.ProcessEnv): unknown {
  if (typeof value !== "function")
    throw new TypeError(
      `${entry.module}#${entry.export} is marked as a factory but is not callable`
    );
  return (
    value as (options: Record<string, unknown>, context: { env: NodeJS.ProcessEnv }) => unknown
  )(entry.options, { env });
}

function isHostedAdapter(value: unknown): value is HostedAdapter {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  return (
    typeof value.metadata.type === "string" &&
    Array.isArray(value.metadata.agentSources) &&
    value.metadata.agentSources.length > 0 &&
    value.metadata.agentSources.every(
      (source) => source === "preset" || source === "provisioned"
    ) &&
    typeof value.invoke === "function"
  );
}
function isScopeCleanup(value: unknown): value is AdapterScopeCleanup {
  if (!isRecord(value) || typeof value.complete !== "boolean") return false;
  return [value.unresolvedServiceIds, value.failedCleanupServiceIds].every(
    (ids) => Array.isArray(ids) && ids.every((id: unknown) => typeof id === "string")
  );
}
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
