import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve as resolveEsm } from "import-meta-resolve";

export interface AdapterModuleEntry {
  type?: string;
  module: string;
  export: string;
  factory: boolean;
  options: Record<string, unknown>;
  sourceManifest: string;
}
export interface ExtraModuleEntry {
  /** 可选独立命令入口；与服务模块使用同一个清单来源解析。 */
  commands?: string;
  name: string;
  module: string;
  sourceManifest: string;
}
export interface ModuleManifest {
  version: 1;
  adapters: AdapterModuleEntry[];
  extras: ExtraModuleEntry[];
}

/** CLI 清单边界：只校验声明、不导入模块；来源路径始终随条目保留，不能用合并位置替换。 */
export function parseModuleManifest(
  value: unknown,
  source: string,
  { legacy = false } = {}
): ModuleManifest {
  const manifest = record(value, "manifest");
  if (manifest.version !== 1) throw new TypeError("manifest.version must be 1");
  if (!Array.isArray(manifest.adapters)) throw new TypeError("manifest.adapters must be an array");
  const extras = manifest.extras === undefined && legacy ? [] : manifest.extras;
  if (!Array.isArray(extras)) throw new TypeError("manifest.extras must be an array");
  const sourceManifest = resolve(source);
  const adapters = manifest.adapters.map((value, index): AdapterModuleEntry => {
    const entry = record(value, `adapters[${index}]`);
    const type = entry.type === undefined && legacy ? undefined : text(entry.type, "adapter.type");
    if (entry.factory !== undefined && typeof entry.factory !== "boolean")
      throw new TypeError("adapter.factory must be a boolean");
    return {
      ...(type === undefined ? {} : { type }),
      module: text(entry.module, "adapter.module"),
      export: entry.export === undefined ? "default" : text(entry.export, "adapter.export"),
      factory: entry.factory === true,
      options: entry.options === undefined ? {} : record(entry.options, "adapter.options"),
      sourceManifest
    };
  });
  const extraEntries = extras.map((value, index): ExtraModuleEntry => {
    const entry = record(value, `extras[${index}]`);
    const name = text(entry.name, "extra.name");
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new TypeError("extra.name is invalid");
    return {
      name,
      module: text(entry.module, "extra.module"),
      sourceManifest,
      ...(entry.commands === undefined ? {} : { commands: text(entry.commands, "extra.commands") })
    };
  });
  unique(adapters, (entry) => entry.type, "adapter.type");
  unique(extraEntries, (entry) => entry.name, "extra.name");
  return { version: 1, adapters, extras: extraEntries };
}

/** 只有可选用户文件的 ENOENT 表示无扩展；权限、JSON 或格式错误必须保留失败。 */
export async function readModuleManifest(
  file: string,
  { optional = false, legacy = false } = {}
): Promise<ModuleManifest> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, adapters: [], extras: [] };
    throw error;
  }
  try {
    return parseModuleManifest(JSON.parse(content), file, { legacy });
  } catch (error) {
    throw Object.assign(
      new TypeError(
        `Invalid manifest ${file}: ${error instanceof Error ? error.message : "invalid JSON"}`,
        { cause: error }
      ),
      { code: "MANIFEST_INVALID" }
    );
  }
}

/** 内置优先、用户追加；冲突项在解析/import 前剔除，诊断不得包含 options 或业务配置。 */
export function mergeModuleManifests(
  builtin: ModuleManifest,
  extension: ModuleManifest,
  report: (message: string) => void = () => {}
): ModuleManifest {
  function merge<T extends { module: string; sourceManifest: string }>(
    first: T[],
    second: T[],
    key: (entry: T) => string | undefined
  ): T[] {
    const seen = new Map(first.map((entry) => [key(entry), entry]));
    return [
      ...first,
      ...second.filter((entry) => {
        const name = key(entry);
        if (name !== undefined && seen.has(name)) {
          const selected = seen.get(name)!;
          report(
            `Ignoring extension module "${name}": built-in declaration takes precedence; selected ${JSON.stringify({ module: selected.module, source: selected.sourceManifest })}; ignored ${JSON.stringify({ module: entry.module, source: entry.sourceManifest })}`
          );
          return false;
        }
        if (name !== undefined) seen.set(name, entry);
        return true;
      })
    ];
  }
  return {
    version: 1,
    adapters: merge(builtin.adapters, extension.adapters, (entry) => entry.type),
    extras: merge(builtin.extras, extension.extras, (entry) => entry.name)
  };
}

/** 按原始清单解析裸包的 ESM import/exports；本机路径先转 URL，避免 Windows 盘符误判。 */
export function resolveModuleSpecifier(module: string, sourceManifest: string): string {
  if (module.startsWith(".") || isAbsolute(module))
    return pathToFileURL(resolve(dirname(sourceManifest), module)).href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(module)) return module;
  return resolveEsm(module, pathToFileURL(resolve(sourceManifest)).href);
}

/** 仅解析选中 Adapter，生成可跨进程的启动快照；不提前解析或加载 Extra。 */
export function resolveAdapterModules(manifest: ModuleManifest): AdapterModuleEntry[] {
  return manifest.adapters.map((entry) => ({
    ...entry,
    module: resolveModuleSpecifier(entry.module, entry.sourceManifest)
  }));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}
function unique<T>(entries: T[], key: (entry: T) => string | undefined, label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = key(entry);
    if (value === undefined) continue;
    if (seen.has(value)) throw new TypeError(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
