---
type: Journal
title: Issue 103 OpenCode 2 调研记录
description: npm 2.1.3、固定上游源码及本仓缺口核对，V1 明确报错合同与后续验收计划。
tags: [adapter, protocol, testing, invocation]
timestamp: 2026-10-23T00:00:00Z
---

# 本轮结果

最新 P2 跟进修正 POSIX fixture 搬迁动态链接 Node 的假设，保留 Windows 原生查找场景；命名测试增加缺 rg 的非 Git 遍历回退、Git 真实祖先拒绝和 Windows 测试入口。README 补 PATH/UNC 边界，工具终态显式白名单增加回归。两个独立审查中发现的外部链接边界已修复复审。`1467724` 托管 Windows 完整 job 均通过，macOS 首次进程组清理超时经一次 job 重跑后通过，首次失败保留，不推断成已确认的 runner 原因；见 [P2 与托管验证](../../tasks/103-opencode-v2/validation.md#最新-p2-与托管重验)。

2026-10-24 按 PR #116 最新审查追加修复：缺失最终输出返回失败终态，文本类型及 step 状态与 normalizer 对齐，Windows 根相对／盘符相对命令按本轮 cwd 解析；PATH 绝对项示例和 rg 环境意见按实际证据逐项处理。OpenCode 回归 23 项、Node 1702 通过/40 跳过、UI 35 项及重跑的 16 个真实场景通过，两个独立审查无待修复问题。新增原生二进制路径测试进入 Windows Node 24/26 CI，本机证据仍仅 macOS。详见 [最新验收](../../tasks/103-opencode-v2/validation.md#yujiawei-最新审查修复)和[逐项审查](../../tasks/103-opencode-v2/review.md#yujiawei-最新审查逐项处理)。

后续实施已完成：最低支持版本确定为 2.1.3，旧 nvm 全局 V1 已按用户要求卸载。CLI/ACP 的 16 个真实 DeepSeek 场景、真实测试 IM 往返及独立 V1 二进制拒绝均通过；最终回归与双轴审查见 [验收记录](../../tasks/103-opencode-v2/validation.md)及 [review](../../tasks/103-opencode-v2/review.md)。下文保留最初调研时的状态，候选版本与待验表述不代表最终支持合同。

用户进一步明确凭据禁止入库：本任务先前写入固定无效认证样例的做法已撤回，错误认证及本地 MCP 认证值改为运行期在内存随机生成；真实认证仍由宿主已有配置提供。禁止提交任何凭据值及固定测试占位值的要求已回写 [架构约束](../../rules/architecture.md#凭据值严禁进入代码仓库)和工程规则，来源、纠正及验证见 [验收记录](../../tasks/103-opencode-v2/validation.md#凭据禁止入库约束纠正)。

按用户后续要求 rebase 到最新 main@cc49c8b，保留双方知识目录条目及 main 安全整改。OpenCode 实现、回归和真实验收脚本未改变；精确历史扫描指纹同步新提交 SHA，更新后验证见 [记录](../../tasks/103-opencode-v2/validation.md#rebase-到最新-main)。

从最新 `origin/main@445d2bb` 建立 `research/103-opencode-v2` 独立 worktree。按用户要求先调研，创建 [任务简报](../../tasks/103-opencode-v2/brief.md)、[官方资料与源码对照](../../tasks/103-opencode-v2/reference.md)、[实施与验收矩阵](../../tasks/103-opencode-v2/validation-plan.md)。

用户确认 OpenCode 1 应直接报 error，不再支持。probe 与直接 invoke、ask/full_access、自定义 executable 都纳入版本门禁计划。未知版本或检测失败不能当作支持。

确认 npm 的 `@opencode/cli latest=2.1.3`，且有对应 v2.1.3 tag；旧 `opencode-ai latest=1.19.4` 和 GitHub releases 列表不能代表 V2 发布状态。初次仅查 release 列表的疑问已按 npm 证据纠正。

用户随后确认本机已升级，复核交互式 shell 及绝对路径 `/Users/lvsijia/.opencode/bin/opencode --version` 均返回 `opencode v2.1.3`。此前 Agent 非交互环境选中 nvm 目录保留的 1.18.30，两者同时存在。后续 V2 验证固定新路径，旧路径保留为 V1 拒绝样本，不将 PATH 差异误判成用户未升级。

源码确认 CLI 独立 `--variant` 与 V2 模型引用不一致；本仓还存在 ACP 本轮 inline 环境配置被固定覆盖、CLI buildCommand 中途失败可漏删临时目录等缺口。V2 原生 permissions/MCP、CLI standalone、ACP 历史重放与 effort、usage 需要逐项适配和实测。

当前建议保留两传输验证，最低候选 2.0.0、最新稳定 2.1.3；全部真实验收仍为待验，不能宣称 V2 兼容已完成。

## 验证边界

2026-10-24 再次按用户要求 rebase 到 main@c01c0c9，8 个重放提交内容一致。补修 yujiawei 在 a5f5cac 提出的 Windows 环境别名和普通 ACP 内建错误分类遗漏；其 glob／版本 banner 意见前提与代码不符，保留核对证据。最新基线上 Node 1705 通过/40 跳过、UI 35 项、16 个真实 Provider 场景通过；Standards 与 Spec 独立复核无新增问题。Windows 专属分支与 rebase 后 Secret Scan 待新 head 托管检查，详见[最新验证](../../tasks/103-opencode-v2/validation.md#最新-main-与环境别名复核)。以下为最初调研时的历史边界，不代表当前仍未实施。

已执行 issue/网页/registry/固定源码读取和本机两个 executable 的版本查询。用户已安装 V2，本轮未安装或覆盖 Provider；未进行 Runtime 调用或真实模型/工具/审批测试，未修改产品实现。

最初 `python3 .octospec/scripts/lint.py` 因当前 Python 缺少 PyYAML 无法启动；改用 `uv run --with pyyaml python .octospec/scripts/lint.py` 后，仅报告以下 3 个基线已有文件缺少 frontmatter，已通过 `git show HEAD:<path>` 确认，不属于本次变更：

- `.octospec/tasks/systemd-directive-paths/brief.md`
- `.octospec/tasks/systemd-directive-paths/review.md`
- `.octospec/journal/shared/2026-10-22-systemd-directive-paths.md`

本次 4 个新增 OKF 文档及 context.yaml 的 YAML/必需元数据检查通过；全量检查未报告新增文件或链接错误，`git diff --check` 通过。没有提交、推送、PR 或发布操作。
