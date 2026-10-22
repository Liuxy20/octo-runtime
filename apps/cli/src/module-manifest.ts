import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeModuleManifests,
  readModuleManifest,
  type ModuleManifest
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

/** CLI 独占默认目录与 Home 扩展策略；SDK 原生装配不读取这两份文件。 */
export async function loadCliManifest(
  home: string,
  override?: string,
  report: (message: string) => void = (message) => console.error(message)
): Promise<ModuleManifest> {
  if (override) return readModuleManifest(resolve(override), { legacy: true });
  const builtin = await readModuleManifest(
    fileURLToPath(new URL("./manifest.json", import.meta.url))
  );
  const extension = await readModuleManifest(join(home, "manifest.json"), { optional: true });
  return mergeModuleManifests(builtin, extension, report);
}
