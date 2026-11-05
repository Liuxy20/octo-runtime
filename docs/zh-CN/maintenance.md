# 维护与验证

[English](../en/maintenance.md) | [文档目录](README.md)

[启动诊断目录](guides/startup-diagnostics.md)从共享 catalog 生成。修改定义或恢复建议后，显式运行 `node test/manual/generate-startup-catalog.mjs`，构建后运行 `node --test test/manual/startup-diagnostics.test.js`。这些手动检查不加入默认测试或 CI。

## 范围与基线

本页供文档维护者查阅，记录源码版本、旧文档的用途和验证方法。本库首次核对的源码为 `d44f5cd42694b5f8cb7c8c18daa65eff0265ba8e`，日期为 2026-10-21。这是首次验证的基线，不代表后续所有页面都只核对到该版本；后续局部更新及其验证范围记录在下方。架构参考根目录的架构和接入文档，接口字段按源码和 Schema 核对。

中英文分别位于 `docs/en` 和 `docs/zh-CN`，页面路径一一对应，语言切换链接指向同一主题。可执行示例共用 `docs/examples`。本库直接使用仓库 Markdown，不依赖文档站；Octospec 继续用于研发过程记录。

## 现有文档对应表

| 现有入口                                                                     | 用途                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 根 [README](../../README.md)、[INTEGRATION](../../INTEGRATION.md)            | 项目介绍和接入选型，具体接口链接到本库。                    |
| [ARCHITECTURE](../../ARCHITECTURE.md)                                        | 设计背景、历史比较和未来目标；当前模块接口见本库。          |
| [SDK Gateway 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md)                       | 保留中文 IM 配置和存储实现细节；通用 Extra 生命周期见本库。 |
| [CLI 运维](getting-started/cli.md)、[部署](../../DEPLOYMENTS.md)、CLI README | 提供服务运维和发行步骤。                                    |
| 包 README                                                                    | 提供包内实现和贡献说明；应用接入接口见本库。                |
| `release/README.md`                                                          | 已删除，打包使用根 README。CI 临时下载目录不受影响。        |
| Octospec                                                                     | 保存研发上下文和过程记录，接入 SDK 无需阅读。               |

仓库内链接已指向上表列出的整合页面，根目录重复的 CLI 和原生 SDK 指南已删除。本库的通用 SDK 接入内容均提供中英文；业务专篇暂时保留原语言，后续修改这些专篇时再补充相应翻译。

## 更新规则

接口或行为变化时，同步更新两种语言的说明、共享示例和图，并记录本次核对的源码版本、页面范围和实际验证结果。保留历史验证记录；局部更新不应把全库改标为已经在新版本上验证。API 名称保持原文。新增或删除 Context 类型时，同时更新类型参考和 `contexts.json` 示例。

先运行 `pnpm build`，再运行 `pnpm docs:check`。检查包含本地链接、双语页面与代码示例的一致性、JSON 结构、内置 Context 示例完整性，以及 `.mts` 示例的类型检查。它还通过测试用 Adapter 执行本地 Kernel 调用，检查服务关闭、交互、取消和图片校验。

`docs:check` 只检查 Mermaid 代码块类型和数量。修改图后，还需要用 Mermaid 渲染器检查语法并查看布局。

打包验证使用 `scripts/verify-release.mjs`。脚本将共享示例复制到独立工程，在该工程中安装生成的 tgz，再检查公开接口类型并运行测试用 Adapter 调用。它也检查包内 README 是否与根 README 相同。此过程只验证本地包，不发布到 npm。

## 验证边界

| 检查                                                | 依据与限制                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 构建、示例、JSON/目录/链接/双语                     | 构建后执行的确定性仓库检查                                                                  |
| 服务/调用、交互、取消、图片完整性                   | 使用测试用 Adapter 和真实本地 Kernel IPC，不调用模型。                                      |
| 公开 tgz 消费                                       | 现有打包/验证加共享示例，离线安装                                                           |
| MCP 准备与映射                                      | 现有定向 `test/context-mcp.test.js`，地址使用 `example.com`                                 |
| Mermaid                                             | 双语架构、监督、输入、IPC 恢复、MCP、Extra 生命周期图，另行渲染验证                         |
| 真实 Provider、MCP 调用、IM、Electron、Windows 原生 | 本次未执行，需要相应环境中的集成测试。                                                      |
| Harness 安装、Computer Use、账号额度                | 2026-10-21 核对源码命令及厂商官方文档；未执行 Provider 安装、登录、付费调用或桌面工具操作。 |

2026-10-21 在 macOS 上通过构建、文档检查（16 组双语页面、14 个 JSON 示例、全部 12 类内置 Context 示例、4 项测试）、MCP/IPC 定向测试（7 项），以及 tgz 打包安装验证。全部 16 张图使用 Mermaid CLI 12.0.0 和本地 Chrome 成功渲染。补充 CLI 和 Harness 安装配置后，再次通过文档检查，并对照构建后的 CLI 帮助核对命令；此次未修改图表或 Runtime 代码。

2026-10-22，基于 `102fb9caf995d9eb1ac53acaf5b91922be4f023d` 的 Issue #101 实施分支同步更新中英文说明，覆盖 Gateway 指令组合（宿主在前、渠道默认在后）、Bot mention、自消息拒绝、逐轮提醒及模型遵守的 compaction 保留提示。这些局部更新补充上述基线，不改变公共 Context schema 或合并规则。顺序调整后，Gateway 构建和相关 90 项测试通过；未进行线上双 Bot 联调。Compaction 保留按设计交给模型，不属于验证范围。

2026-11-01，本次上手路径修订依据 `49f9b11f58c13a65cc62e74d2c4751cac99a3707` 加未提交的文档和示例变更，在 macOS arm64、Node.js 24.22.2 上复核。范围为文档入口、CLI/SDK 入门、Extras、Harness 前置条件、排障、本页及两个共享入口示例。上述历史验证仍绑定各自原版本。

`pnpm install --frozen-lockfile`（含构建）、`pnpm docs:check` 和 `node scripts/check-developer-docs.mjs --scope current` 通过。`node scripts/pack-release.mjs` 及 `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 通过现有离线包、公开类型、Kernel 和独立 Extra 检查。本地 `0.0.0` 产物未发布。

另在独立临时 npm 消费工程中编译实际共享示例，以关闭的 stdin 执行编译后的 DSH worker，并运行 `attach.mts` 连接测试用 Adapter：输出回复，关闭客户端后 Kernel 仍可调用。新增 DSH 宿主入口使用替代的测试 Adapter 完成真实本地 Kernel 调用，不是 DSH Provider 实测。Gateway 两种 loader 均返回有效的当前 Context、读到更新的数据并处理取消；完整 Gateway 装配检查未初始化 IM 连接。CLI 页的原始请求通过 Protocol 校验，并经打包版 `playboard` 和 fake Codex 完成，临时 Kernel 目录已回收。这些是 fixture 检查，不代表真实模型或 IM 验收。

本次未修改图、Runtime 代码、默认测试命令或 GitHub CI 范围。真实 Provider 初始化/模型调用、线上 IM、外部 MCP、Electron 和原生 Windows 未执行；[Windows 验收 #14](https://github.com/Mininglamp-OSS/octo-runtime/issues/14) 仍单独跟踪。

2026-11-01 提交 PR 前，同一批文档变更已 rebase 至 `4a0f53b50723422d90f051944ae19eb28f60712a`。在同一平台重新通过构建、格式检查、文档检查、当前链接审计、安装包验证（校验该源码提交）及上述独立 npm 消费检查。这些结果覆盖该源码基线加准备提交的文档变更；真实环境验收的未执行范围不变。
