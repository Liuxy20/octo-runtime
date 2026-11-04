import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeModuleManifests,
  readModuleManifest,
  type ModuleManifest
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

import { discoverGlobalExtras, mergeGlobalExtras } from "./global-extras.js";
import { withStartupContext } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** CLI 独占内置、Home 与全局 Extra 目录；SDK 不扫描，显式清单完全替换。 */
export async function loadCliManifest(
  home: string,
  override?: string,
  report: (message: string) => void = (message) => console.error(message)
): Promise<ModuleManifest> {
  const read = async (path: string, options?: { optional?: boolean; legacy?: boolean }) => {
    try {
      return await readModuleManifest(path, options);
    } catch (error) {
      throw withStartupContext(error, {
        component: "cli",
        phase: "created",
        context: {
          path,
          resource: "module-manifest",
          operation: "read-manifest",
          configKey: "manifest"
        }
      });
    }
  };
  if (override) return read(resolve(override), { legacy: true });
  const builtin = await read(fileURLToPath(new URL("./manifest.json", import.meta.url)));
  const extension = await read(join(home, "manifest.json"), { optional: true });
  return mergeGlobalExtras(
    mergeModuleManifests(builtin, extension, report),
    await discoverGlobalExtras(report),
    report
  );
}
