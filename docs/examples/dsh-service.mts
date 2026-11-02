import { createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

/** 宿主原生装配实例与 endpoint；DSH 内部负责启动 Provider，Kernel 不启动 worker。 */
export function createDshKernel(endpoint: string, dshBin: string) {
  // 宿主负责 initialize、消费终态和业务尾流，退出时 close 并检查 complete。
  return createKernelService({
    endpoint,
    adapters: [dshAdapter],
    adapterConfigurations: { dsh: { providerOptions: { dshBin } } }
  });
}
