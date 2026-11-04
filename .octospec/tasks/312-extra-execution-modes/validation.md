---
type: Validation
title: Issue 312 实现与验证记录
description: 记录 direct/IPC Extra 的实现、手动专项、全量回归、包外发行和真实 Codex 证据与限制。
tags: [extra, lifecycle, ipc, testing]
---

# 实现基线与范围

基线 `6fe5b5fc72084a0c2de91844a3606a9bc81e17d3`，本记录的验证针对该基线上的 dirty 实现。环境为 macOS arm64、Node v24.22.2、pnpm 11.19.0，2026-11-04 执行。用户明确先完成 #312，暂缓 #313；本次没有修改 Codex Adapter 的 app-server 生命周期。

实现包含精确 execution union 与运行期互斥；direct 不要求 Home，借用同一 Core；IPC 和 legacy 复用 client；每 Extra 独立 scope；共用有界 HostRunService 后台消费；Core 按原 receipt 观察首次清理；实际 probe 纳入 scope；三个内置 Extra 迁移；公共 Codex 子路径及双语说明。

# 已执行验证

| 命令/边界 | 结果 |
| --- | --- |
| `pnpm build`、`pnpm typecheck` | pass；Vite 保留现有 use-client/chunk-size 警告 |
| `pnpm lint`、`pnpm lint:names` | pass |
| `pnpm docs:check` | pass；35 paired pages、71 Markdown、20 JSON、14 Mermaid、12 builtin context、4 tests |
| OctoSpec lint（`uv run --with pyyaml python .octospec/scripts/lint.py`） | pass；649 OKF units、20 rules、3942 links |
| `node --test test/manual/extra-execution-312.test.mjs test/manual/extra-execution-builtins-312.test.mjs` | pass，28 项；仅显式手动调用，含独立控制端点、128 调用容量、接纳前/后 signal 与旧插件回滚 |
| 既有相关回归：extra-service-shutdown、host-sdk-lifecycle、extra-dependency-container、extras、webui-extra、native-host | pass，54 项 |
| `pnpm test:suites`（已先构建） | pass；Node 2334 pass / 66 skip / 0 fail，WebUI 35 pass |
| `node test/manual/extra-execution-live-312.mjs --run` | pass；真实 Codex CLI 0.164.0，direct / IPC 各一次 native turn，均 completed、Extra complete、owner complete；5692 / 4088 ms 是本次观测，不是性能比较 |
| `node scripts/pack-release.mjs` | pass，生成本地 0.0.0 tgz，不代表发布 |
| 仓库外离线安装 tgz、严格类型编译与执行 | pass；仅主包公共子路径，`strict + exactOptionalPropertyTypes + skipLibCheck=false`；真实 Codex Adapter + fake CLI，direct Core/Channel 装配、独立 Kernel 宿主进程 IPC，均核对关闭结果 |

包外测试源码为 `test/manual/extra-execution-public-312.mts`；复制到独立临时工程后编译，产品 JS/types 只从安装包解析，编译器与 Node 类型来自本机开发工具。未使用产品源码软链、NODE_PATH 或 workspace 私有导入。

本次 tgz SHA-512：`7346e7aec22cba5dbcc8930b6b59a3b4e8f95136e53ff4711ccec1a7b008ae238105307fd8228502cfe63b7847821d45d9ee675d2b491375883ad5b4f72213ca`。后续实现修改须重做受影响验证并记录新产物摘要。

# 验收映射

- A01-A04：运行期非法/混用配置、严格 TS 反例、无 Home direct、IPC/legacy、canonical/native、公共产物均有专项证据。
- A05-A07：关闭 A 保留 B/宿主调用；身份冲突不能取消原宿主调用；双模式 canonical/native 审批回答与跨 scope 拒绝。
- A08-A10：同 Core 同名拒绝、不同 Core 同名共存、完整关闭后替换；停止观察不取消；慢观察者明确 STREAM_GAP；Gateway 断线不取消或重复提交。窗口容量算法复用现有 HostRunService，全量相关回归通过。
- A11-A13：完整 receipt、错误 receipt、延迟/失败 finally、清理期限、重复 close 与失败占有；初始化失败取消所属调用并保留 cause；宿主关闭可用性、真实 probe 超时后仍计入清理。
- A14：真实 Gateway/WeCom 模块使用 fake transport；真实 WebUI HTTP/SSE；均跑 direct/IPC 执行与停止。旧 ExtraPlugins/kernel 兼容路径由既有回归验证，包外类型 fixture 明确可选 kernel 收窄。
- A15：包外公共导入、严格类型与独立 Kernel 进程验证通过。
- A16：真实 Provider 仅本机 Codex 的两次正常 native turn；macOS 原生 socket 已测。真实 IM/WeCom、Windows/Linux 原生、外部 Electron/业务 App **not run**，不将 mock、模拟平台或 Node 成功作为这些环境的证明。

# 交付审查

code-review 两轴静态独立审查已完成，Standards / Spec 均 0 项需修复问题，详见[审查记录](review.md)。相对目标 main 的 `.github/workflows`、默认测试入口、scripts/gate 均无修改；package.json 仅增加 Codex 公共导出，lockfile 仅增加 host-sdk 对 Core 的 workspace 依赖。文档检查曾发现双语示例不一致，已修正后复验。用户已授权审查无问题后提交并创建 main PR；未授权 merge 或发布。
