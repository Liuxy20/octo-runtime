import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeModuleManifests,
  readModuleManifest,
  type ModuleManifest
} from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

import { withStartupContext } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** CLI 装配 Adapter 目录；显式清单完全替换默认与 Home 来源。 */
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
  return mergeModuleManifests(builtin, extension, report);
}
