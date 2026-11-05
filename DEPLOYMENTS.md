# 部署与发行

同一稳定 tag 对外同版本发布 `@mininglamp-oss/octo-runtime` 与 `@mininglamp-oss/octo-runtime-client`。其余 workspace 包保持 private；protocol 不独立发布。要求 Node.js 24.x 或 26.x，范围为 `^24.0.0 || ^26.0.0`；Provider 的安装和认证由宿主负责。

CI 在两个 Node.js 主版本上持续构建、测试并验证打包后的 CLI/SDK，任一版本失败都会阻塞 CI Gate。发布、恢复及 latest 协调工具固定使用 24，并只消费 Ubuntu/24 的已验证归档；这是发行工具基线，不限制使用方选择 26。每次新 LTS 到来或受支持版本接近 EOL 时审查支持范围，新增版本须先通过同等检查，移除支持须提前在发行说明公告。

## 构建与离线验证

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm lint
pnpm lint:names
pnpm format:check
pnpm test:suites
node scripts/pack-release.mjs --version 1.2.3
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-1.2.3.tgz
```

打包脚本从同一构建生成两个 tgz，不复制 workspace symlink 或开发依赖。完整 runtime 将 client/protocol 及既有生产依赖物化到包内 node_modules；独立 client 只内置 protocol。任一归档均可单独空缓存离线安装，不要求完整包使用者额外下载独立 client。验证脚本继续检查公开 .d.ts（skipLibCheck=false）、Core、原生 Kernel、Extra、默认 CLI manifest、旧 bin 缺席以及卸载保留 Home。两包 build-info 记录相同 commit、dirty 和构建时间；发布流水线要求固定 commit 且干净。

发布前同时核对两份归档的官方 npm SHA-512；已存在版本有冲突时停止，只有 E404 允许视为缺包。先发布 client，再发布 runtime；恢复只补缺包，复用任一已发布包的构建时间且核对来源，两包均存在时元数据必须一致。两包 npm 完整性确认后上传两个 GitHub Release 附件。两个 npm latest 和 GitHub latest 只晋升到双包、双附件完整且完整性匹配的最高稳定版本，失败重读恢复，不回退、不覆盖 npm 字节或重打 tag。历史单包 tag 不补发 client。

client 拆包与双包故障专项仅显式本地运行，不增加默认 CI 检查。示例：`OCTO_CLIENT_TEST_VERSION=1.2.3 node --test test/manual/runtime-client-309.test.mjs test/manual/runtime-client-release-309.test.mjs`。实际平台、体积和未验环境见本任务验证记录。

Windows 使用 `node scripts/verify-windows-release.mjs ARCHIVE COMMIT` 执行同一验收；平台结果只能由该平台实际执行给出。

## 用户服务

```bash
npm install -g @mininglamp-oss/octo-runtime
octo-runtime executor-kernel install --autostart=true
octo-runtime executor-kernel start
octo-runtime extraset channel-gateway < gateway.json
octo-runtime channel-gateway install --autostart=true
octo-runtime channel-gateway start
octo-runtime status
```

首次和重复 install 不带选项均默认开启自启；只有显式 `--autostart=false` 才禁用。两个服务独立；channel-gateway 不负责维护或拉起 Kernel。卸载服务不清理身份、凭据或配置。

## 新架构版本之间的更新

先停止相应组件，更新 npm 包，再启动。若 Node、安装目录、Home 和服务定义均未变化，可直接 restart；绝对程序路径变化时重新 install 更新定义。所有操作始终使用同一个 --home。升级安排在没有活动任务时，Kernel 重启不会恢复或重新 invoke 旧 Run。

## SDK 宿主

宿主可以在自己的发行目录中携带 Node 和完整发行包，使用 /host 管理组件；不启动 CLI 或解析终端输出。宿主原生构造 Kernel 并注入 Adapter 对象，管理 Extra 声明和配置来源。只消费已有 Kernel 的业务应用可仅安装 client。参见 [SDK 入门](docs/zh-CN/getting-started/sdk.md)。

## 验收边界

本地自动化、原生 launchd/systemd/Task Scheduler、真实 Provider 和 im-test 端到端验收分别记录。本地 fixture 或 Schema 校验不能替代其他层的证据。当前记录见 [.octospec 实施任务](.octospec/tasks/executor-kernel-host-lifecycle/implementation.md)。
