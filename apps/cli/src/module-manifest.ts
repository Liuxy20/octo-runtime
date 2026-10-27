import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeModuleManifests,
  readModuleManifest,
  type ModuleManifest
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

import { discoverGlobalExtras, mergeGlobalExtras } from "./global-extras.js";

/** CLI 独占内置、Home 与全局 Extra 目录；SDK 不扫描，显式清单完全替换。 */
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
  return mergeGlobalExtras(
    mergeModuleManifests(builtin, extension, report),
    await discoverGlobalExtras(report),
    report
  );
}
