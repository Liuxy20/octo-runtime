import { mock } from "node:test";
import { spawn } from "node:child_process";
import * as kernel from "@mininglamp-oss/octo-runtime-executor-kernel";

// 普通失败模式先真实关闭；pending 保留监听及所属子进程，验证命令返回后的人工强退。
mock.module("@mininglamp-oss/octo-runtime-executor-kernel", {
  namedExports: {
    ...kernel,
    createKernelService(options) {
      const service = kernel.createKernelService(options);
      const close = service.close.bind(service);
      service.close = async () => {
        if (process.env.TEST_PLAYBOARD_CLEANUP === "pending") {
          const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            detached: process.platform !== "win32",
            stdio: "ignore"
          });
          process.stderr.write(`PLAYBOARD_CLEANUP_PENDING_PID=${child.pid}\n`);
          return { complete: false, errors: [], pendingResources: ["kernel"] };
        }
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
