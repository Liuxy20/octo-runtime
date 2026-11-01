import { mock } from "node:test";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import * as kernel from "../../packages/octo-runtime-executor-kernel/dist/index.js";

// 真实关闭后再注入失败；记录本次端点目录供测试所有者回收，不扫描其他实例。
mock.module("@mininglamp-oss/octo-runtime-executor-kernel", {
  namedExports: {
    ...kernel,
    createKernelService(options) {
      const service = kernel.createKernelService(options);
      const close = service.close.bind(service);
      service.close = async () => {
        const result = await close();
        if (!result.complete) throw new Error("Fixture Kernel failed actual cleanup");
        if (process.platform !== "win32")
          appendFileSync(
            process.env.ORT166_TRACE,
            JSON.stringify({ temporary: dirname(options.endpoint) }) + "\n"
          );
        if (process.env.TEST_PLAYBOARD_CLEANUP === "reject")
          throw new Error("TEST_CLEANUP_REJECTED");
        return { ...result, complete: false };
      };
      return service;
    }
  }
});
