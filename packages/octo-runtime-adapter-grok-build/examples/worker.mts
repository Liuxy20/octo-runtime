import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { grokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

/** 宿主选择 endpoint；初始化后通过 client 调用，退出时检查 close 的 complete。 */
export const createGrokKernel = (endpoint: string) =>
  createKernelService({ endpoint, adapters: [grokBuildAdapter] });
