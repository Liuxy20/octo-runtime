import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

// 手动在仓库外安装 Provider/Electron；这里分别验证普通 Node 和真实 Electron Node mode。
const installation = resolve(process.argv[2]);
const require = createRequire(join(installation, "package.json"));
const electron = require("electron");
const dshBin = join(installation, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
for (const executable of [process.execPath, electron]) {
  const result = spawnSync(
    executable,
    ["--test", "test/cli-dsh.test.js", "test/dsh-launch.test.js", "test/dsh-native.test.js"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        OCTO_DSH_NATIVE_BIN: dshBin,
        OCTO_DSH_NATIVE_PATH: join(installation, "node_modules", ".bin")
      },
      timeout: 120000
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `DSH platform verification failed: status=${result.status}, signal=${result.signal}`
    );
}
