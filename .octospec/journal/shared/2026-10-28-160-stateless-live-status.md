---
type: Journal
title: Issue 160 无状态探针状态读取修复与验证
description: 记录 JSON 状态读取、失败传播、真实 CLI 受控回归及未验边界。
tags: [testing, stateless]
---

# 实施

基线 `origin/main@aac7ec7`，分支 `fix/160-stateless-live-status`，独立 worktree `octo-runtime-issue-160`。先完成[任务简报与 97/100 可执行性评估](../../tasks/160-stateless-live-status/brief.md)，再实施。

`readStatelessComponentStatus` 接收探针原有的 `runCli`，显式增加 `--json`。输出回调只保存完整 stdout/stderr；先检查返回码，再解析成功结果，校验对象及 Gateway bots 数组。非零码的错误消息包含退出码及原始诊断；直接抛出的异常原样传播。脚本的在线断言、模型回复、终态、数据库列表和旧库 mtime 断言保留。

没有修改 CLI、SDK、Kernel 或 Extra 的实现及配置，不启动或控制本机原生服务。自动化使用临时 Home、受控原生管理器和本地 JSON-RPC 状态服务；不调用模型或真实 IM。

## 证据

- 原调用的受控复现：实际 `runCli(["--home", home, "status"])` 加原始 JSON.parse 回调，确认首段输出为人类文本、返回码为 1、componentStatus 仍为 undefined。
- `node --unhandled-rejections=strict --test test/stateless-live-probe.test.js test/stateless-executor.test.js test/cli-status.test.js test/cli-lifecycle.test.js`：23 通过，0 失败/跳过。新增探针回归 15 项，包含显式参数、完整缓冲、stdout/stderr、退出码、抛错、无输出、无效 JSON/结构、离线列表及真实 CLI 成功/失败。
- 真实 CLI 成功用例连接受控 Gateway JSON-RPC 服务；失败用例使用损坏的临时 Home 配置，确认原 JSON error 输出完整保留在探针异常里。
- 首轮 22 通过/1 失败来自测试误用缺失 manifest 触发错误：status 按现有合同不读取 manifest。更正为损坏配置后上述 23 项通过，生产修复没有因此扩大。
- `pnpm typecheck`：通过，包含完整 workspace 构建。仅有已有 WebUI bundler 的模块指令及体积警告。
- `pnpm lint`、`pnpm lint:names`：通过。
- 三个变更 JS/MJS 文件的 Prettier 检查与 `git diff --check`：通过。
- 系统 `python3` 缺少 PyYAML；改用 `uv run --with pyyaml python .octospec/scripts/lint.py` 后通过。收尾复验：441 个 OKF 单元、20 条规则、3130 个本地文件链接全部通过。
- lockfile 与协议生成文件无漂移。

## 复核与边界

逐项核对任务验收与 diff：错误优先级、结构验证、既有下游断言与资源关闭路径符合计划；未发现需修复的问题。可复用的 CLI 状态消费约定已回写 engineering 规则。

完整 `verify-stateless-live.mjs` 未执行；真实 Work App renderer/CDP、已登录状态、线上 IM 注册和真实 Codex 回复未作为本轮通过证据。未做原生 Windows 实测，也未运行全量跨包测试或发行验收；本次只修改验证工具，相关回归与全量构建/类型检查覆盖本地变更范围。托管平台 CI 状态另以 PR 实际结果为准。不自动合并、不发布、不部署。
