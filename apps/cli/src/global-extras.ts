import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { assertExtraName } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  resolveModuleSpecifier,
  type ExtraModuleEntry,
  type ModuleManifest
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";
import { cliEntrypoint } from "./cli-entrypoint.js";

const runtimePackage = "@mininglamp-oss/octo-runtime";
type Report = (message: string) => void;
interface Installation {
  kind: "npm" | "pnpm" | "pnpm-isolated";
  root: string;
  modules: string;
}
interface PackageRoot {
  directory: string;
  directPackages?: Set<string>;
}
interface DiscoveredExtra extends ExtraModuleEntry {
  installation: { directory: string; realDirectory: string };
}

/** 纯路径分类不证明安装身份；调用方还须核对包名、全局 bin 或有效安装组。 */
export function installationLayout(
  entry: string,
  platform = process.platform
): Installation | undefined {
  const p = platform === "win32" ? path.win32 : path.posix;
  const suffix = p.join(
    "node_modules",
    "@mininglamp-oss",
    "octo-runtime",
    "apps",
    "cli",
    "dist",
    "index.js"
  );
  if (!entry.endsWith(p.sep + suffix)) return;
  const modules = entry.slice(
    0,
    -p.join("@mininglamp-oss", "octo-runtime", "apps", "cli", "dist", "index.js").length - 1
  );
  const parent = p.dirname(modules);
  if (p.basename(p.dirname(parent)) === "v11")
    return { kind: "pnpm-isolated", root: p.dirname(parent), modules };
  if (p.basename(parent) === "5") return { kind: "pnpm", root: parent, modules };
  if (platform === "win32") return { kind: "npm", root: parent, modules };
  if (p.basename(parent) === "lib") return { kind: "npm", root: p.dirname(parent), modules };
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? "INVALID_METADATA";
}
async function metadata(file: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_METADATA");
  return value as Record<string, unknown>;
}
async function entries(directory: string, report: Report) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    report(
      `Global Extra discovery cannot read ${JSON.stringify(directory)} (${errorCode(error)}); manifests remain available.`
    );
    return [];
  }
}

async function installationRoots(entry: string, report: Report): Promise<PackageRoot[]> {
  let actual: string;
  try {
    actual = await realpath(entry);
  } catch (error) {
    report(
      `Global Extra discovery cannot locate CLI ${JSON.stringify(entry)} (${errorCode(error)}); use a Home manifest.`
    );
    return [];
  }
  // pnpm argv 保留组内链接，realpath 则可能已进入共享 store；不能从共享 store 反查其他环境。
  for (const candidate of new Set([path.resolve(entry), actual])) {
    const layout = installationLayout(candidate);
    if (!layout) continue;
    try {
      const runtime = path.join(layout.modules, runtimePackage);
      if ((await metadata(path.join(runtime, "package.json"))).name !== runtimePackage) continue;
      if ((await realpath(path.join(runtime, "apps/cli/dist/index.js"))) !== actual) continue;
      if (layout.kind === "pnpm-isolated") {
        const roots: PackageRoot[] = [];
        let ownsRuntime = false;
        const group = await realpath(path.dirname(layout.modules));
        for (const item of await entries(layout.root, report)) {
          // 只接受活动索引链接；pnpm 保留的旧 target 目录不是已安装包。
          if (!item.isSymbolicLink()) continue;
          const install = path.join(layout.root, item.name);
          try {
            const target = await realpath(install);
            const data = await metadata(path.join(install, "package.json"));
            if (!data.dependencies || typeof data.dependencies !== "object") continue;
            roots.push({
              directory: path.join(install, "node_modules"),
              directPackages: new Set(Object.keys(data.dependencies))
            });
            if (target === group && Object.hasOwn(data.dependencies, runtimePackage))
              ownsRuntime = true;
          } catch (error) {
            report(`Ignoring global install ${JSON.stringify(install)} (${errorCode(error)}).`);
          }
        }
        if (ownsRuntime) return roots.sort((a, b) => compare(a.directory, b.directory));
      } else if (layout.kind === "pnpm") {
        const data = await metadata(path.join(layout.root, "package.json"));
        await readFile(path.join(layout.modules, ".modules.yaml"));
        if (
          data.dependencies &&
          typeof data.dependencies === "object" &&
          Object.hasOwn(data.dependencies, runtimePackage)
        )
          return [
            { directory: layout.modules, directPackages: new Set(Object.keys(data.dependencies)) }
          ];
      } else if (process.platform === "win32") {
        const shim = await readFile(path.join(layout.root, "octo-runtime.cmd"), "utf8");
        if (
          shim
            .replaceAll("\\", "/")
            .includes("node_modules/@mininglamp-oss/octo-runtime/apps/cli/dist/index.js")
        )
          return [{ directory: layout.modules }];
      } else if ((await realpath(path.join(layout.root, "bin/octo-runtime"))) === actual) {
        return [{ directory: layout.modules }];
      }
    } catch (error) {
      report(
        `Global Extra discovery could not verify ${JSON.stringify(layout.root)} (${errorCode(error)}).`
      );
    }
  }
  report(
    "Global Extra discovery unavailable for this CLI installation; use <Home>/manifest.json or --manifest (no PATH-based fallback)."
  );
  return [];
}

/** 每次只读当前 CLI 对应环境的顶层包元数据；不可用的可选目录不阻止 Kernel/manifest 使用。 */
export async function discoverGlobalExtras(
  report: Report,
  entry = cliEntrypoint()
): Promise<ExtraModuleEntry[]> {
  const found: DiscoveredExtra[] = [];
  for (const root of await installationRoots(entry, report)) {
    const modules = root.directory;
    const packages: string[] = [];
    for (const item of await entries(modules, report)) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      if (item.name.startsWith("@")) {
        for (const child of await entries(path.join(modules, item.name), report))
          if (child.isDirectory() || child.isSymbolicLink())
            packages.push(`${item.name}/${child.name}`);
      } else if (!item.name.startsWith(".")) packages.push(item.name);
    }
    for (const module of packages.sort(compare)) {
      if (root.directPackages && !root.directPackages.has(module)) continue;
      const match = /^(?:@[^/]+\/)?octo-runtime-extra-(.+)$/.exec(module);
      if (!match) continue;
      const directory = path.join(modules, module);
      try {
        const name = match[1];
        assertExtraName(name);
        if ((await metadata(path.join(directory, "package.json"))).name !== module)
          throw new Error("PACKAGE_NAME_MISMATCH");
        found.push({
          name,
          module,
          sourceManifest: path.join(path.dirname(modules), "package.json"),
          installation: { directory, realDirectory: await realpath(directory) }
        });
      } catch (error) {
        report(
          `Ignoring global Extra ${JSON.stringify(directory)} (${errorCode(error)}; check package.json name and Extra suffix).`
        );
      }
    }
  }
  return found.sort(
    (a, b) =>
      compare(a.module, b.module) || compare(a.installation.directory, b.installation.directory)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function origin(entry: ExtraModuleEntry): string {
  return JSON.stringify({
    module: entry.module,
    source: isDiscovered(entry) ? entry.installation.directory : entry.sourceManifest
  });
}
function isDiscovered(entry: ExtraModuleEntry): entry is DiscoveredExtra {
  return "installation" in entry;
}

/** 两份清单已完成自身校验；全局候选排序后按逻辑名补缺，决胜之前不解析 exports。 */
export function mergeGlobalExtras(
  manifest: ModuleManifest,
  candidates: ExtraModuleEntry[],
  report: Report
): ModuleManifest {
  const selected = new Map(manifest.extras.map((entry) => [entry.name, entry]));
  for (const entry of candidates) {
    const previous = selected.get(entry.name);
    if (previous)
      report(
        `Ignoring global Extra "${entry.name}": selected ${origin(previous)}; ignored ${origin(entry)}.`
      );
    else {
      selected.set(entry.name, entry);
      report(
        `Discovered global Extra "${entry.name}": selected ${origin(entry)}; configure with extraset, then start explicitly.`
      );
    }
  }
  return { ...manifest, extras: [...selected.values()] };
}

/** 仅在启用的 Extra 真正加载时解析入口；移除/替换后拒绝沿祖先目录加载另一份同名包。 */
export async function resolveExtraModule(entry: ExtraModuleEntry): Promise<string> {
  if (isDiscovered(entry)) {
    if ((await realpath(entry.installation.directory)) !== entry.installation.realDirectory)
      throw new Error("GLOBAL_EXTRA_INSTALLATION_CHANGED");
    if (
      (await metadata(path.join(entry.installation.directory, "package.json"))).name !==
      entry.module
    )
      throw new Error("GLOBAL_EXTRA_INSTALLATION_CHANGED");
  }
  return resolveModuleSpecifier(entry.module, entry.sourceManifest);
}
