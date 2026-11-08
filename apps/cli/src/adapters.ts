import {
  resolveModuleSpecifier,
  type AdapterModuleEntry
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import type { HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { withStartupContext } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** CLI 只加载所选模块并构造实例；Kernel 不接触清单、模块路径或产品准备。 */
export async function loadCliAdapters(
  entries: readonly AdapterModuleEntry[],
  options?: {
    profileRoot: string;
    syncOpenClawTools: boolean;
  }
): Promise<HostedAdapter[]> {
  const adapters: HostedAdapter[] = [];
  // 解析也在诊断边界内；仍先解析整个所选集合，再导入/构造，保持 CLI 原顺序。
  const selected = entries.map((entry) => {
    try {
      return { entry, specifier: resolveModuleSpecifier(entry.module, entry.sourceManifest) };
    } catch (error) {
      throw adapterStartupFailure(error, entry);
    }
  });
  for (const { entry, specifier } of selected) {
    try {
      const loaded: unknown = await import(specifier);
      const exports = asRecord(loaded, `adapter module ${entry.module}`);
      const exported = exports[entry.export];
      if (exported === undefined)
        throw new Error(`missing export ${entry.export} from ${entry.module}`);

      // 动态模块先校验工厂与 Adapter 形状，再交给唯一 Core 注册；不提前探测未选模块。
      const instance: unknown = entry.factory ? callFactory(exported, entry) : exported;
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
  return adapters;
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

function callFactory(value: unknown, entry: AdapterModuleEntry): unknown {
  if (typeof value !== "function")
    throw new TypeError(
      `${entry.module}#${entry.export} is marked as a factory but is not callable`
    );
  return (value as (options: Record<string, unknown>) => unknown)(entry.options);
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
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
