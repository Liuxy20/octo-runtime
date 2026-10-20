---
type: Journal
title: KernelClient 统一 invoke 本地实施验证
description: Issue 69 公共入口、Extra 迁移、受控 IPC 故障和 owner 排空的本地证据。
tags: [kernel, invoke, extra, lifecycle, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 当前实现与来源

用户确认允许破坏性更新、Gateway 消费 invoke 结果做 delivery，随后授权实施。基线 main@fae6333632010602506774b0648b639b70d25e22；分支 feat/69-kernel-client-invoke，尚未提交。没有借用 PR #65，也没有提交、推送或远端业务写入。

普通 App、owned.client、内置/第三方 Extra 以及 Playboard 共用 KernelClient.invoke；SDK 注入 ctx.kernel，原 SDK 执行桥和独立渠道执行类型删除。调用身份、ACK 查询、原游标恢复、按 ID 控制和 owner 元数据排空归 Kernel 包，业务 delivery/dispose 仍归消费者。完整断言和 A01-A32 的证据映射见 [实施记录](../../tasks/69-kernel-client-invoke/implementation.md)。

# 本机验证

环境为 macOS arm64、Node 24.19.0、pnpm 11.19.0。以下命令实际执行成功：

| 检查 | 实际结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 安装成功，没有锁文件变更 |
| pnpm typecheck | 全 workspace/public 构建及根类型检查通过 |
| pnpm lint / pnpm lint:names / pnpm format:check | 通过；命名扫描 982 个文件，findings 为空 |
| node --test test/kernel-invoke.test.js test/kernel-invoke-lifecycle.test.js test/kernel-invoke-consumers.test.js test/host-sdk-lifecycle.test.js | 42 通过，0 失败、0 跳过 |
| pnpm test:suites | WebUI 35/35；Node 1328 项中 1318 通过、10 条件跳过、0 失败 |
| node --expose-gc --test test/context-loader.test.js test/openclaw-queue-bounds.test.js | 13/13，覆盖默认套件中两个 GC 条件测试 |
| node scripts/pack-release.mjs | 生成源码占位版本 mininglamp-oss-octo-runtime-0.0.0.tgz，未发布 |
| node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz | offlineInstall/publicTypes/ownedKernel/independentExtra/cliKernel/uninstallPreservedHome 全部 true |
| uv run --with pyyaml python .octospec/scripts/lint.py | 256 OKF 单元、20 条规则、1600 个本地文件链接通过 |
| git diff --check | 通过 |

包外 fixture 使用 strict 与 skipLibCheck=false 验证 native/canonical/变量模式重载和反向类型断言，并在未加载 Extra 时执行 attach/invoke，再验证 owned.client.invoke 和第三方 Extra。产物保留 dirty 标识，没有假设未提交实现拥有独立 SHA。

# 可复用结论

高层调用不能把丢 ACK 当作未执行，或把断流当作执行已结束；复用原身份查询和窗口，不能重提。取消 ACK 只表达请求接纳，真实终态与未知仍分开。共享视图只在正常耗尽后抛 signal.reason，才能保留具体故障并允许主动 return。owner 以 client 为调用范围，排空共享绝对期限，查询替代额外订阅；未知登记不能清空冒充成功。

校验与执行准备仍由 Core 负责。Kernel 客户端提前校验尚待补默认值的 Context 会拒绝合法输入，首次全量回归已暴露并修复该问题。观察到源终态后还要等待 delivery/dispose；连接关闭、进程退出及强制回收均不能证明业务资源完整清理。

# 未验范围

Windows 专项已接入 CI，本地未执行 Windows/Linux；没有真实 Provider/IM 或宿主产品联验。条件跳过保留原范围，没有降低断言或伪造平台通过。#30 的 Gateway 最终交付策略、#66 其他公共 API 和持久恢复均不在本次新增范围。

# 架构说明补充

用户进一步确认产品级优先使用 KernelClient。根架构讲解及权威规则现已明确此推荐，并对照进程内 AgentExecutor：InputInvoke、业务输入和 native/canonical 输出相同，传输、故障影响、iterator 关闭、显式控制、owner 清理及 streamLimits 支持不同。推荐依据是隔离、监督和有界恢复，不扩大为执行必成功或故障后自动重跑。此轮仅补充文档，以源码核对和 OKF/diff 检查验证，不重复计入产品测试或平台证据。

# GitHub 交付授权

用户随后明确授权提交、创建 PR 并合并进入 main。以上“尚未提交”和平台未验是本地验收时的状态；后续 Git 提交、CI 和合并结果以 PR 的实际记录为准。提交保留当前配置作者，英文说明附一次 Codex trailer。main 保护要求 CI Gate 成功、至少一名审阅者批准及会话解决；本次不修改或绕过保护。远端 main 在提交前仍为原基线，没有待同步的新提交。
