---
type: Validation
title: "Issue 166：自动审批本地验证与真实 Codex 证据"
description: "记录当前未提交实现的两模式审批、跨语言协议、回归、资源回收和真实环境边界。"
tags: [cli, interaction, protocol, testing, integration]
---

# 版本与执行环境

- 基线与 HEAD：`4a0f53b50723422d90f051944ae19eb28f60712a`，分支 `fix/166-playboard-auto-approval`，实现位于 dirty 工作区，未提交或推送。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-166`，主机 `lvsijiaMacBook-Pro.local`，macOS arm64。
- Node `v24.22.2`，pnpm `11.19.0`，Codex CLI `0.164.0`；Python codec 使用 Python 3.12 的本地独立 venv。
- 本次实现新增 responseRequired 公共事实及校验，Codex 与共享 AcpApprovalBridge 发射事实，CLI 仅在无需外部回答时继续；CLI 缺省 full_access，SDK 缺省 ask 保持不变。TS、Go、Python 生成产物同步。

## 检查结果

| 命令 | 结果与含义 |
| --- | --- |
| `pnpm build` | 通过；现有 Vite chunk/directive 提示不影响退出码 |
| `pnpm typecheck` | 通过，包含最终生产源码 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| `node scripts/manual/166-playboard-auto-approval.mjs` | 19 通过、0 失败；专项显式运行，未进入默认入口 |
| `node native/codegen/generate.mjs --check` | 通过，3 份产物输入和文件 hash 匹配 |
| `pnpm test`，本机原 Node 目录 | 2388 通过、91 跳过、1 失败；主线也复现同一环境冲突，见下文 |
| `pnpm test`，同版本隔离 Node 目录 | 2389 通过、91 按既有条件跳过、0 失败；另包含既有 WebUI 检查，未更改测试范围 |
| `node scripts/manual/166-playboard-live.mjs` | 真实 Codex canonical/native 均完成，工具回执核对通过 |

新专项内容与[规格](brief.md) A1–A8 对应：两模式下默认/显式 full_access 每组合连续三次成功（共 12 次）；顶层/Context ask 和 full_access 来源、非法值和冲突；question、elicitation、先审批后追问及时失败；旧字段缺省保守处理；SDK ask 由原 responder 答复后完成，full_access 自动完成；响应写入屏障故障、过期、取消；SIGINT/SIGTERM；清理拒绝/incomplete 不误报成功；实际 cwd、显式目录及 preset；30 组交互字段分别通过 TS、Schema、Go/Python codec 对照。

自动响应计数由假 Provider 写入测试独占回执验证，每次只发生一个响应，无 question/elicitation 自动答复。CLI 集成使用真实 Kernel/worker/Codex Adapter 与假 Provider，disposer 核对所属 Provider/worker PID 不存在后回收目录。写入屏障专项使用模拟子进程，确认响应回调未完成前没有 resolved，然后注入错误、过期或取消；它证明 Driver 状态转换，不代替 OS 清理证据。

已有 Playboard、Codex、ACP 回归初次执行时发现早期校验影响 OpenClaw 简写归一化，已将完整校验保留在原共享入口；最终全量中该两项均通过。现有 ask 专项只将输入改为显式 ask，未新增默认扫描用例。

## 全量测试的环境对照

原失败位于 `test/verification-command.test.js` 的 missing installation 用例。测试将 Node 可执行目录加入 PATH，而本机该目录也安装了 `octo-cli`，因此“缺少安装”前提不成立。

在独立未修改基线 worktree `/tmp/ort63-baseline` 执行 `node --test test/verification-command.test.js` 复现同一失败（7 通过、10 跳过、1 失败）。相关测试和 `scripts/verification-command.mjs` 均无本次 diff。

将**同一 Node 二进制**复制到独占 `/tmp/ort63-node-xqqpbz/node` 后，该测试 8 通过、10 跳过。使用该 Node 和既有 pnpm 重跑完整入口：

```sh
PATH=/tmp/ort63-node-xqqpbz:$PATH /tmp/ort63-node-xqqpbz/node \
  /Users/lvsijia/.nvm/versions/node/v24.22.2/bin/pnpm test
```

结果为 2389 通过、91 跳过、0 失败。未排除测试、修改用例断言、切换开关或更换 Node 版本。

## Non-gating 真实验收

由本执行者在上述 macOS、Node、Codex 版本上显式运行 `scripts/manual/166-playboard-live.mjs`。每次创建独占工作目录，要求真实模型仅调用命令工具创建 `receipt.txt`，内容为运行期唯一 marker，不请求网络、不操作原用户工作目录；输入省略审批策略和工作目录，验证实际 Playboard 默认值。

| 模式 | CLI 退出码 | 实际审批通知 | 终态 | 工具回执 |
| --- | --- | --- | --- | --- |
| canonical | 0 | 1 | run.completed | receipt.txt 内容与本次 marker 一致 |
| native | 0 | 1 | completed control | receipt.txt 内容与本次 marker 一致 |

两次均真实完成且 CLI 退出，按成功条件回收独占目录。真实脚本失败/超时时仅 leader 退出不能证明全部后代退出，因此保留目录并报告未确认，不把信号或退出请求写成清理完成。本次无超时。真实输出只记录上述安全摘要，不归档账号、凭据或完整模型轨迹；未显式选模，实际模型由既有 Provider 配置决定，不声称覆盖全部模型。

## CI 范围与未验边界

相对固定目标基线，`.github/`、根 package scripts、默认测试 glob 无 diff；新增脚本均在 `scripts/manual/`，无自动入口。读取基线 GitHub checks：CI Gate、Secret Scan、Update Release Draft、既有 macOS/Ubuntu Node24/26 构建测试打包与 Windows Node24/26 发行包检查，未新增或修改其依赖。该基线的检查通过不代表本次未推送代码已在 GitHub 执行。

- Windows Server 2022 真机：NOT RUN，本机为 macOS；不把原 Issue 历史版本证据当本版本通过。
- Linux、其他 Provider 的真实调用、全部 native Provider 自动审批：NOT RUN，不在本次新增支持声明中。
- 仓库外桌面/Harness 部署、重启及 im-test 注册执行：NOT RUN，本次未获部署/发布授权；需对应宿主团队按新协议产物独立核实，不宣称已验收外部应用。
- 本地结果等待用户审查；未执行 GitHub 提交、推送、PR 或合并。

双轴审查及问题处置见[审查记录](review.md)。YAML/全库知识检查和最终 diff 检查结果随 Loop 实现评论记录。

## 最新主线交付复验

用户随后授权更新代码、提交与创建 PR，原分支 rebase 到 `origin/main@42102c60103a9b18166c499b0c74a23e0d2295c6`。仅日志和中英文 CLI 文档发生文本冲突：保留双方日志、保留主线新版入门结构，将本次审批策略说明移至首轮 Playboard 调用段落。生产实现、协议产物及已有测试与同步前已审查内容一致；主线 Kernel 配置快照更改保留。

在此交付基线上重新运行：

- `pnpm typecheck`（含构建）、`pnpm lint`、`pnpm lint:names`、生成产物 `--check`：通过。
- 使用上述同版本隔离 Node 运行 `pnpm test`：2389 通过、91 跳过、0 失败，未变更默认测试范围。
- `node scripts/manual/166-playboard-auto-approval.mjs`：19 通过、0 失败。首次与全量入口清理构建目录重叠时因 dist 暂时不存在未启动，构建完成后重跑通过。
- `node scripts/manual/166-playboard-live.mjs`：canonical/native 均退出 0、completed、回执匹配，各观察 1 次审批通知。
- 全库知识 lint：572 单元、20 规则、3552 本地链接通过；YAML 与 diff 检查通过。
- 相对交付基线 `.github/`、默认 package scripts 和测试入口无变更，既有 GitHub 检查列表无扩展。

本节结果覆盖即将提交的实现内容。提交及 PR 的确切引用记录在 Loop 交付评论；未执行合并。Windows、Linux 与仓库外宿主的未验边界继续有效。
