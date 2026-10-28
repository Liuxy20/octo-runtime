---
type: Validation
title: Issue 222 DSH 最低版本验收
description: 记录版本边界、升级提示、最终消息转换及真实 rc.4 验证结果。
tags: [adapter, testing, installation]
---

# 验证环境

- 日期：2026-10-28；执行者：Codex。
- 源码：`0ca12a03a055ccb766e6126716c51bb6cc6efe1c` 加本任务未提交修改，分支 `fix/issue-222-dsh-min-version`。
- 平台：macOS arm64，Node `24.19.0`；依赖安装使用仓库声明的 pnpm `11.19.0`。
- 官方 Client 保持 `0.2.1-rc.3`，未打补丁；新增直接依赖 `semver@7.8.5` 及类型依赖 `@types/semver@7.8.0`，lockfile 无其他依赖版本漂移。

# 离线验收

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，包含全 workspace 构建及 public 类型检查 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| 修改的 TS/JS/JSON 文件 `prettier --check` | 通过 |
| `node --test test/dsh-launch.test.js test/dsh-adapter.test.js test/dsh-sdk-boundaries.test.js test/cli-dsh.test.js` | 116 通过，0 失败，0 跳过 |
| `pnpm docs:check` | 通过，4 项示例测试及文档结构检查通过 |
| `node scripts/pack-release.mjs` | 生成发行包成功 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 0ca12a03a055ccb766e6126716c51bb6cc6efe1c` | 离线安装/卸载、公共类型及 SDK、Kernel/Extra/CLI 验证全部通过；未要求 clean，构建保留 dirty 来源 |
| `git diff --check` | 通过 |
| `git diff origin/main -- .github/workflows` | 空 diff |

SemVer 正向覆盖最低 rc.4、带 build metadata 的最低版本、rc.10、正式版、0.2.2-alpha.2、0.3.0、1.0.0-alpha.1；反向覆盖较低 patch、alpha、rc.3、带 build metadata 的 rc.3、非法前导零、空串和非法文本。非法 stdout 不进入公共错误。

Adapter 在四组不同 Provider/serverInfo 版本下，仅凭 committed assistant message 正确转换 `hello 世界` 并返回唯一 `run.completed`。非法服务身份或空 serverInfo 版本返回 `DSH_PROTOCOL_ERROR`，不发送 prompt。Core 和 Kernel 的低版本错误保留升级提示及 `OH-ADP-3005`。原有续聊、取消、清理、轨迹和 SDK 边界测试通过。

首次新增测试有两处测试调用错误，已修正：Core 的执行环境必须通过第二参数传入，Kernel list 的版本字段是 `providerVersion`。上述 116 项结果来自修正后的完整专项重跑。

# 独立真实验收（Non-Gating）

保留本机全局 DSH `0.2.1-rc.2`，在任务独占临时目录 `/tmp/octo-dsh-222.Y3LLca` 安装 `@deepseek-ai/dsh@0.2.1-rc.4`，使用 `--ignore-scripts`；未升级全局 Provider、修改认证或重置 Home/既有会话。真实模型调用使用默认 DSH 认证及持久化路径，只新建测试会话。

1. 对真实全局 rc.2 调用 `resolveDshLaunch`，在 SDK 初始化前返回：

```text
DSH_VERSION_UNSUPPORTED: DeepSeek Harness requires version >= 0.2.1-rc.4. Please upgrade DeepSeek Harness. Detected version: 0.2.1-rc.2.
```

diagnostics 为 `detectedVersion=0.2.1-rc.2`、`minimumVersion=0.2.1-rc.4`。

2. 显式执行真实安装发现、版本探测和 SDK 初始化，不发送模型请求：

```sh
OCTO_DSH_NATIVE_BIN=/tmp/octo-dsh-222.Y3LLca/node_modules/@deepseek-ai/dsh/lib/bin.js \
OCTO_DSH_NATIVE_PATH=/tmp/octo-dsh-222.Y3LLca/node_modules/.bin \
node --test test/dsh-native.test.js
```

结果：2 通过，0 跳过；CLI 向 Kernel 传入真实 npm 入口，官方 Client 成功初始化并关闭。

3. 通过 `createKernelService`、真实 DSH worker、`KernelClient.invoke` 发起一次真实模型请求（默认 `deepseek-account` / `deepseek-flash`）。输入要求仅回复运行期随机 marker 且不使用工具，运行预算 90 秒；断言唯一终态、canonical final 包含原 marker，finally 关闭 Kernel 并删除临时工作目录。结果：

```json
{"providerVersion":"0.2.1-rc.4","terminalTypes":["run.completed"],"finalMarkerMatched":true}
{"cleanup":{"complete":true,"errors":[],"pendingResources":[]}}
```

未记录凭据或原始模型轨迹。验收后清理上述 rc.4 临时安装，重跑需重新独立安装。真实模型验证只覆盖 rc.4 的新会话最终消息；更高版本、真实续聊、Electron、Windows、Linux 及 IM 本轮未验证。默认离线回归覆盖相应 fixture 合同，不作为这些原生环境通过的证据。未运行全仓 `pnpm test`；本次未修改共享 Core/Kernel/Protocol 行为。

# CI 与交付边界

无 workflow、job、矩阵、触发条件、必需状态或 Gate 依赖变更，也未增加既有 job 的步骤或默认真实验证开关。现有普通离线测试内补充此 bug 的回归；原生验证仍需显式 opt-in，live 脚本仅将报告版本改为实际探测值。

实施验收时工作保留在独立 worktree，尚未提交。用户随后授权双轴审查、自动修复及通过后提交 PR；最终审查记录见本目录 `review.md`，已创建 [PR #228](https://github.com/Mininglamp-OSS/octo-runtime/pull/228)。创建期间 main 并发更新，分支 rebase 到 `27c5cde4b7f46a986c1c9a91d0f06d24f428e8da`，仅合并目录索引的两条任务入口，DSH 代码保持；最新基线重新执行 `pnpm typecheck` 与 116 项专项，结果另记最终交付回执。未部署或发布。
