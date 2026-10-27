import { join } from "node:path";
import { resolveExtraModule } from "./global-extras.js";
import {
  assertExtraName,
  assertStoredExtra,
  readStoredExtra,
  type ExtraRegistration,
  type ExtraPluginModule,
  type StoredExtra
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { withSetupLock, writeJsonAtomic, type RuntimePaths } from "./state.js";
import { type ModuleManifest } from "@mininglamp-oss/octo-runtime-adapter-sdk/module-manifest";

/** Generic full replacement: no platform-specific CLI fields or validation. */
export async function setExtra(
  paths: RuntimePaths,
  name: string,
  input: NodeJS.ReadableStream
): Promise<unknown> {
  assertExtraName(name);
  if ((input as NodeJS.ReadStream).isTTY)
    throw new Error("extraset requires one JSON object on stdin");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new Error("EXTRA_CONFIG_TOO_LARGE");
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("extraset stdin must contain one valid JSON object");
  }
  assertStoredExtra(value);
  const file = join(paths.home, "extras", name, "config.json");
  return withSetupLock(paths, async () => {
    await writeJsonAtomic(file, value);
    return { saved: true, name, file, reload_required: true };
  });
}

/** CLI 将模块目录与业务配置装配；仅 load 时解析/import，禁用项及未启动项不执行模块。 */
export async function readExtra(
  paths: RuntimePaths,
  name: string,
  manifest: ModuleManifest
): Promise<ExtraRegistration> {
  assertExtraName(name);
  const stored = await getExtra(paths, name);
  const entry = manifest.extras.find((item) => item.name === name);
  if (!entry) throw new Error("EXTRA_MANIFEST_DECLARATION_REQUIRED");
  if (stored.module !== undefined && stored.module !== entry.module)
    throw new Error("EXTRA_MODULE_MIGRATION_REQUIRED");
  return {
    name,
    module: entry.module,
    config: stored.config,
    enabled: stored.enabled,
    load: async () => {
      try {
        const plugin = (await import(await resolveExtraModule(entry))) as ExtraPluginModule;
        if (plugin.name !== name) throw new Error("EXTRA_NAME_MISMATCH");
        return plugin;
      } catch (error) {
        if (error instanceof Error && error.message === "EXTRA_NAME_MISMATCH") throw error;
        throw new Error("EXTRA_MODULE_LOAD_FAILED", { cause: error });
      }
    }
  };
}

export async function getExtra(paths: RuntimePaths, name: string): Promise<StoredExtra> {
  assertExtraName(name);
  try {
    return await readStoredExtra(join(paths.home, "extras"), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("EXTRA_NOT_REGISTERED", { cause: error });
    throw error;
  }
}
