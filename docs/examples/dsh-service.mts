import { createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";

/** 宿主维护 endpoint、worker 和 npm DSH JS 入口；同一配置用于 discovery 与每次执行。 */
export function createDshKernel(endpoint: string, workerEntrypoint: string, dshBin: string) {
  // 宿主负责 initialize、消费调用终态和业务尾流，退出时 close 并检查 complete。
  return createKernelService({
    endpoint,
    workerEntrypoint,
    adapterConfigurations: { dsh: { providerOptions: { dshBin } } },
    ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: "1" } } : {})
  });
}
