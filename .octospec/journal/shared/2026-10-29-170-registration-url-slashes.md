---
type: Journal
title: Issue 170 Windows 注册 URL 尾斜杠修复验证
description: 真实 Gateway 启动链路复现注册路径不一致，局部复用已有 helper 后通过回归。
tags: [channel, windows, testing]
---

# 改动与归属

[任务简报](../../tasks/170-registration-url-slashes/brief.md)对应 Issue #170。
基线为 `main@96a6f58cf1ec8cfb0f33e88b522bea6b6a95e822`，修复分支 `fix/170-registration-url-slashes`。
仅在 registerBot 的 URL 拼接处复用已有 trimTrailingSlashes，保留路径前缀；公共 SDK、配置、身份、协议、错误分类及重试合同不变。

服务端如果归并重复斜杠，会让错误注册路径仍可用；成功上线本身不足以证明请求正确。专项严格匹配原始请求路径并检查生产 ImRuntime 的 online 状态，没有替换 fetch 或生产方法。

# Windows 验证

Windows 11 企业版 `10.0.22621`、x64、普通用户、PowerShell `7.6.5`、Node `24.22.0`、pnpm `11.19.0`。使用同提交源码构建与本修复工作树；没有运行日常全局 Runtime 或调用真实 Provider。

- 基线显式执行 `node --test test/manual/im-registration-url.test.mjs`：8 项中 4 通过、4 失败；双/三尾斜杠均在鉴权成功后返回 `IM_REGISTER_HTTP_404`，根路径及 `/api` 前缀一致。
- 修复后执行 `node --test test/manual/im-registration-url.test.mjs test/im-connection-state-machine.test.js test/im-protocol.test.js test/im-runtime.test.js`：126/126 通过，其中新增专项 8 项。
- 专项覆盖 0/1/2/3 尾斜杠、两种前缀；配置被接受，身份 key 等价，auth/register/其他 REST 均为规范路径，真实 WebSocket 握手后 online，close 后 stopped。
- `pnpm typecheck`：完整 workspace 构建和类型检查通过。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`：通过。新专项经 Prettier 格式检查；仅调整隔离 checkout 的换行方式，没有提交全仓格式变更。
- `.octospec/scripts/lint.py`：未通过，只有基线已有的三份 Issue 137 文档缺少 YAML frontmatter：`tasks/137-adapter-protocol-support/{brief,review}.md` 及 `journal/shared/2026-10-29-137-adapter-protocol-support.md`。核对其内容与 origin/main 无差异；没有扩入本 Issue 修复。

# 范围审查与未验证项

生产 diff 为一项导入、一条说明和一处拼接替换。测试在 `test/manual/` 显式运行，没有修改 workflow、package scripts、默认 glob 或 CI Gate。测试凭据在内存中动态生成；HTTP/WebSocket 与 Runtime 均由测试持有并关闭。

未执行全量 `test:suites`、发行包/安装验证、真实远端 IM/Provider、Windows 10、macOS 或 Linux 本机验收；现有跨平台 CI 结果由 PR 实际状态另报。逻辑共用不构成其他平台已实测的证据。
本轮不修改 Issue 内容、不合并、不部署。已有架构和工程规则足以约束该修复，无需新增通用 URL 清洗规则。
