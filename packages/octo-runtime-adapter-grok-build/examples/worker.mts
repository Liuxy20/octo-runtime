import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createGrokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

/** 宿主选择 endpoint；初始化后通过 client 调用，退出时检查 close 的 complete。 */
export const createGrokKernel = (home: string, endpoint: string) =>
  createKernelService({
    home,
    endpoint,
    adapters: [createGrokBuildAdapter({ command: "/absolute/path/grok", env: process.env })]
  });
