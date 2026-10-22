# 部署与发行

对外只发布 `@mininglamp-oss/octo-runtime`，内部 workspace 包保持 private。要求 Node.js 24.x 或 26.x（LTS），范围为 `^24.0.0 || ^26.0.0`；Provider 的安装和认证由宿主负责。

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

打包脚本从生产依赖图生成单一 tgz，不复制 workspace symlink 或开发依赖。验证脚本使用空 npm cache 在仓库外离线全局安装，并检查公开 .d.ts（skipLibCheck=false）、Core、独立 Kernel、Extra、默认 CLI manifest、旧 bin 缺席以及卸载保留 Home。build-info 记录来源 commit、dirty 和构建时间；发布流水线要求固定 commit 且干净。

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

首次 install 不带选项默认关闭自启。两个服务独立；channel-gateway 不负责维护或拉起 Kernel。卸载服务不清理身份、凭据或配置。

## 旧版弃用与重新安装

`1.0.1` 为旧 daemon 架构的 deprecated 版本，不支持升级或迁移到当前架构。已有安装先用旧版本命令或原生服务管理器停止并移除旧 daemon 服务，再卸载 npm 包并重新安装：

```bash
npm uninstall -g @mininglamp-oss/octo-runtime
npm install -g @mininglamp-oss/octo-runtime@<NEW_VERSION>
octo-runtime --help
```

`<NEW_VERSION>` 替换为已发布的新架构版本，不能使用 `1.0.1`。重新安装后重新配置并分别注册两个组件；不提供旧配置、状态或服务定义的迁移流程。npm 卸载不自动清理旧进程、系统服务或 Home。

发行维护者须在 npm registry 将旧版本标记为 deprecated，提示使用方卸载后重新安装。操作命令为：

```bash
npm deprecate @mininglamp-oss/octo-runtime@1.0.1 "Deprecated daemon architecture. In-place upgrades are not supported. Remove the old service, run npm uninstall -g @mininglamp-oss/octo-runtime, then install a new-architecture release and configure it again."
```

以上命令是发行操作说明，不代表本工作区已修改 npm registry。

## 新架构版本之间的更新

先停止相应组件，更新 npm 包，再启动。若 Node、安装目录、Home 和服务定义均未变化，可直接 restart；绝对程序路径变化时重新 install 更新定义。所有操作始终使用同一个 --home。升级安排在没有活动任务时，Kernel 重启不会恢复或重新 invoke 旧 Run。

## SDK 宿主

宿主可以在自己的发行目录中携带 Node 和此发行包，使用 /host 管理组件；不启动 CLI 或解析终端输出。宿主提供自己的 worker 入口及 Adapter 集合、Extra 声明和配置来源。参见 [接入指南](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。

## 验收边界

本地自动化、原生 launchd/systemd/Task Scheduler、真实 Provider 和 im-test 端到端验收分别记录。本地 fixture 或 Schema 校验不能替代其他层的证据。当前记录见 [.octospec 实施任务](.octospec/tasks/executor-kernel-host-lifecycle/implementation.md)。
