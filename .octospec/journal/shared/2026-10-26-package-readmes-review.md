---
type: Journal
title: 包文档及启动器移除的本地审查
description: 按 verified-review 完成静态与运行审查，修正文档示例及迁移遗漏。
tags: [documentation, architecture, testing, review]
timestamp: 2026-10-26T10:00:00Z
---

# 范围与基线

用户授权先本地审查，再创建 PR 并合入 main，仅关联 #15。审查采用 verified-review，串行检查全部变更文件与新增 README，基线为 `87291ca6efc79a9afdcffe4144f416f1637fd74c`，审查时 worktree 有未提交修改；平台 darwin/arm64，Node.js v24.19.0，pnpm 11.19.0。无生成代码、二进制或 lockfile 变更；纯格式 hunks 不作缺陷，删除文件作为调用和合同的上下文检查。

# 审查修正

- Medium，reproduced：Core、Kernel 的 DSH 示例缺少 `approvalMode: "full_access"`，原输入读取首个事件即抛出 `APPROVAL_MODE_UNSUPPORTED`。当前示例显式设置此值，DSH 与 Antigravity 的注册示例同步。复现使用公开 Core/DSH 入口和 README 输入，无需启动真实 Provider。
- Medium，read-confirmed：Core 原示例在消费失败时跳过 `shutdown()`；ACP 示例缺少关闭；Kernel 示例未检查成功终态。改为在 finally 中关闭并检查结果，消费方识别失败、取消及缺失终态。使用仓库 DSH fixture 运行中英文 Core 示例，成功与 Provider 失败均得到 complete 清理结果。
- Medium，read-confirmed：删除旧原生 SDK 指南后，仍有链接声称新页面包含完整 submodule 初始化与升级步骤，但内容未迁移。双语 SDK 入门现包含 main 跟踪、宿主固定 commit、workspace 依赖、过滤构建和 CI 固定版本步骤。
- Medium，read-confirmed：WebUI、WeCom 及 apps 导航仍描述旧装配路径。改为各 Extra 独立 CLI 服务，由 CLI 入口直接调用工厂；Host SDK 不启动通用组件子进程。
- Medium，reproduced：协议 README 将 final 表述为仅在成功终态之后可用。使用最小真实 Adapter/Core 调用观察到 `message.delta(channel=final)` 先于 `run.completed`，已区分流式 final 与成功后业务投递。
- Medium，read-confirmed：Adapter 的“一次调用”节只注册和构造输入，并未执行。改为明确的注册/输入节，注明 canonical 模式，并链接到 Core 完整消费、终态及清理示例。

过滤和第二遍检查后，无未解决的 medium 及以上问题。没有改变 Provider、Core、Kernel 或 Extra 的执行策略。

# 验证

- 包导航及 25 个包共 52 个 README：52 个 TypeScript 代码块严格类型检查、504 个本地链接检查通过；同包双语可执行代码一致。临时审查脚本位于 `/tmp/octo-readme-review.mjs`，未作为产品测试提交。
- `/tmp/octo-readme-runtime-review.mjs` 提取中英文 Core 示例，仅替换模块解析路径并将 Provider 指向仓库 DSH fixture，注入 success/provider-error 两种场景；四次执行的结果及清理均符合预期。另验证 final 早于终态的实际顺序。未调用真实 Provider 或 IM。
- `pnpm test` 再次通过：清理构建全部 workspace，WebUI 测试通过，Node 共 1925 项，1871 通过、54 按条件跳过、0 失败。
- `pnpm docs:check` 通过：17 对页面、35 个 Markdown、20 个 JSON 示例、16 个 Mermaid、12 个内置 Context 示例，以及 4 项本地运行测试。
- `pnpm format:check`、`pnpm lint:names` 和 `git diff --check` 通过。
- 原有 OKF frontmatter 基线限制见[README 阶段记录](2026-10-26-package-readmes.md)；本轮未扩大到无关历史任务。

CLI/SDK 实际 tgz 验证与 Windows 适用范围见[启动器移除记录](2026-10-26-remove-native-component.md)。提交后的 clean release、远端 CI 与合并状态以 PR 和交付时的实际结果为准，本条记录不将未执行的跨平台或线上检查表述为通过。

# 首轮远端 CI 与环境隔离

提交 `cc5d1767b486c10ea987c026ba9196b7686153d2` 后重新构建，并通过实际 tgz 的 `--expected-commit` 与 `--require-clean` 验证。PR #191 首轮 CI run `40349164977` 中，macOS 和 Windows 的 Node 24/26 四组均通过；Ubuntu 两组仅失败于 `cross-service-systemd-native`：本机 `/usr/lib/systemd/system/` 下三个既有服务的 CPUAccounting 废弃警告触发 stderr 必须为空的断言。同一基线 main 的 run `40320086849` 有相同失败，相关生产源码和测试在文档提交中均未修改。

修复仅限测试：`SYSTEMD_UNIT_PATH` 指向独占临时目录，提供解析所需的最小 target，继续验证真实渲染 unit 的退出码与空 stderr，不过滤警告文本。追加非法相对 WorkingDirectory 的负例，确保原生解析错误仍会失败。该变量覆盖 unit 搜索路径的行为见 [systemd-analyze 官方说明](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html)。本机没有可用 Linux systemd，原生通过结果以修复后的托管 CI 为准。

用户问及此前 macOS 失败：run `40293575316` 两组均在约 30 秒的原生大 socket 容量测试中得到 KERNEL_TIMEOUT。main 的 #189 已改为受控 Duplex 分块来验证容量，仍保留真实大文本、UTF-8 拆包及后续连接恢复。该修复已包含在本分支基线，当前 macOS CI 均通过，本次不再次修改该用例。
