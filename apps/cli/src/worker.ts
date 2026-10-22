// CLI 自有执行 worker。顶层 Kernel 仍由 CLI 调用进程创建；SDK 原生入口不使用此装配。
import { loadManifestAdapters } from "@mininglamp-oss/octo-runtime-executor-kernel/manifest-adapters";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { readExtraDirectory } from "@mininglamp-oss/octo-runtime-host-sdk";
import { dirname, join } from "node:path";

const adapters = await loadManifestAdapters();
// 旧显式清单允许省略 type；以所选实例真实类型判断，不猜包名，也不在父进程重复实例化。
if (adapters.some((adapter) => adapter.metadata.type === "openclaw")) {
  const profileRoot = process.env.OCTO_RUNTIME_CLI_PROFILE_ROOT;
  if (!profileRoot) throw new Error("CLI_PROFILE_ROOT_REQUIRED");
  const { initializeCliOpenClaw, syncCliOpenClawToolEnvironment } = await import("./openclaw.js");
  await initializeCliOpenClaw(profileRoot);
  if (process.env.OCTO_RUNTIME_CLI_SYNC_OPENCLAW_TOOLS === "1")
    await syncCliOpenClawToolEnvironment(
      profileRoot,
      await readExtraDirectory(join(dirname(profileRoot), "extras"))
    );
}
// 产品连接准备完成后才建立既有 list/probe 握手；所有实例仅交给唯一 Core 注册一次。
serveWorker(adapters);
