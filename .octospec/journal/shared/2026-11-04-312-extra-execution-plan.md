---
type: Journal
title: Issue 312：独立 worktree 与需求规划记录
description: 记录最新主线来源、OctoSpec 规划产物、检查事实及尚未执行的实现验收。
tags: [extra, architecture, lifecycle, planning, testing]
---

# 规划记录

日期：2026-11-04，Asia/Shanghai。任务为 [Issue #312](https://github.com/Mininglamp-OSS/octo-runtime/issues/312)，读取的 issue 最后更新时间为 `2026-11-04T11:03:01Z`，未发现评论。任务入口为[brief](../../tasks/312-extra-execution-modes/brief.md)。

## 基线与工作区

- 通过 HTTPS fetch main，取得 `bd287f9557e1280d8197a184201136bb6caf0100`，与 GitHub commits/main API 查询结果一致。该提交为 `fix(sdk): require a host-provided validated Runtime Home (#310)`。
- 新 worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-312`，分支 `codex/312-extra-execution-plan`。原 checkout 的未跟踪文件未改动。
- 原 remote SSH fetch 因 publickey 失败；改用 HTTPS 拉取，没有更改 remote 配置。当前聊天位于父目录，应用 worktree 工具返回 Not a git repository，因此在实际仓库通过 git worktree add 创建。
- 使用仓库 octospec-workflow 与 technical-writing-zh。用户授权仅需求规划，未创建 commit、推送、修改 issue 或创建 PR。

## 规划结果

完成 brief/design/plan/acceptance/assessment/context 六份材料，并在 index/log 建立入口。当前规则不改写成“direct 已实现”；记录实现阶段需调整的 #294 RPC 与 #306 Home 适用范围。

方案的主要实施前置项是 Core 单次调用清理凭据：终态与 iterator 耗尽不证明私有 owner 清理完成；Extra 不得 shutdown 共享 Core。设计同时说明 direct 的独立 pump、有界窗口、接纳前取消隔离、Adapter describe 查询，以及 Extra 原有 4 秒共享关闭预算。

执行性自评 95/100；剩余 5 分来自清理能力原型 2 分、#296 的发行导出 1 分、原生平台 1 分、真实 Provider/Channel 和外部宿主 1 分。该评分衡量规划准备度，不代表测试、发布或线上成功。

## 检查事实

| 检查 | 实际结果 |
| --- | --- |
| 干净新 worktree 的知识 lint | pass：637 个 OKF 单元、20 条规则、3900 个本地文件链接 |
| 六份规划材料写入后的知识 lint | pass：642 个 OKF 单元、20 条规则、3910 个本地文件链接 |
| 默认 python3 直接运行 lint | 缺 PyYAML；改用 `uv run --with pyyaml python .octospec/scripts/lint.py` 后通过 |
| 最终知识 lint | pass：643 个 OKF 单元、20 条规则、3915 个本地文件链接 |
| 本次 frontmatter / YAML / 空白 | pass：6 份知识 Markdown 的 type/title/description/tags、context.yaml 及新增文件尾空白检查通过；git diff --check 通过 |
| 相对基线的 workflow/package.json/scripts diff | 空，无 CI 或默认检查范围变更 |
| CI 范围 | 仅改 .octospec 文档；未改 workflow/job/matrix/trigger/gate、默认测试入口或打包验证脚本 |
| 托管 checks 查询 | 两次 check-runs API 调用均返回 unexpected end of JSON input，未取得可验证列表；本任务没有 PR，不声称远端检查通过 |

核对了 ci.yml 现有 check / verify-windows-release / gate、test:suites 默认 glob 与 verify-release 调用位置。实施计划将新专项放在 test/manual 且显式运行；未来提交实现时仍需对比当时目标分支及实际 PR checks，不能用本次规划检查替代。

## 未执行边界

未改产品代码，未安装 Node 依赖，未跑构建、类型或实现测试；未调用真实 Provider，未发送测试消息，未运行原生平台或外部 HostApp。验收矩阵 A01-A16 全部为 not run。#296 和 #309 读取时均为 OPEN，未因规划声称依赖已经完成。
