import { mock } from "node:test";
import * as kernel from "@mininglamp-oss/octo-runtime-executor-kernel";

// 仅在独立测试进程替换关闭结果；真实 Kernel/worker 已先完成清理，避免故障注入留下资源。
mock.module("@mininglamp-oss/octo-runtime-executor-kernel", {
  namedExports: {
    ...kernel,
    createKernelService(options) {
      const service = kernel.createKernelService(options);
      const close = service.close.bind(service);
      service.close = async () => {
        const result = await close();
        if (!result.complete) throw new Error("Fixture Kernel failed actual cleanup");
        if (process.env.TEST_PLAYBOARD_CLEANUP === "reject")
          throw new Error("TEST_CLEANUP_REJECTED");
        return { ...result, complete: false };
      };
      return service;
    }
  }
});
