---
type: Journal
title: Issue 51 三语言 playboard 实施与联调
description: native 内三套客户端/demo、双工具链与包外消费验证、真实 Codex 结果及后续验收范围。
tags: [protocol, schema, native, ipc, testing]
timestamp: 2026-10-24T00:00:00Z
---

# 最新范围与复验

最终按“一份生成源码 + 一份手写实现”合并 SDK。生成文件统一命名为 `octo_runtime_generated` 加语言扩展名。Python 实现在 `client.py`，`__init__.py` 仅导出公开 API；Go 实现在 `client.go`，另有 8 行 `pipe_windows.go` 自动绑定平台 API。同一份完整源码全平台使用，调用方不选择或复制平台版本。Transport、codec 和生命周期均是手写实现内部细节；删除独立 rules 等模块。SDK、demo 和相关代码注释使用英文。两语言各完整重跑 45 项本地套件通过，含仓外安装和 demo；Go race、Python 七项单测、生成器两项回归和 Linux/Windows amd64 交叉编译通过，交叉编译不作为实机 IPC 证据。

用户移除 Rust，仅保留完整 Go/Python SDK；示例统一为语言包内的 `demo_playboard.go` / `demo_playboard.py`。生成文件头部携带 octo-runtime Schema commit 与输入/生成器摘要，完整 manifest 记录来源。Native 不接入 GitHub CI。两语言各 45 项/354 协议样例通过，Go race、Python 七项单测及生成/包外/demo 验证通过。

无 rg 的命名测试缺陷已复现并修复：TMPDIR 在 checkout 内时，非 Git fixture 先移出所有真实 Git 祖先。默认与仓内 TMPDIR 两环境各 9 项通过，子进程 PATH 清空。源码合并前完整 Node 1706 通过/40 既有 skip、UI 35 通过。当前生成源码为 2 文件/1959 行，手写运行时代码为 3192 行。详见[当前实施记录](../../tasks/51-native-rpc-clients/implementation.md)。下文保留原三语言实施历史。

# 历史结果

用户要求从规划进入实施，并最终明确 demo 就放在本仓库 `native/`，每种语言都有自己的实现。当前 worktree `codex/51-native-rpc-clients` 已完成 Go、Rust、Python SDK 与同命令接口的 CLI playboard，原外部 demo 目录恢复为空。

三套 CLI 支持输入 JSON/prompt、native/canonical 输出、receipt、get/subscribe/cancel、原生/标准交互、等待另一个 CLI 回答、显式回复文件、deadline 和 owner drain。客户端不管理 Kernel，不调用 Node；已修复快速终态漏存回执以及同一个原生请求双通知重复回复问题。

macOS arm64 上三语言最低/当前工具链六组合各通过 39 项测试、339 个协议 fixture，含真实 Kernel/worker 故障、CLI、三种语言包的仓外消费与空客户端 PATH。真实 Codex 0.154.0 另跑三语言 native/canonical 六次，全部完成并按原回执查询确认。真实审批/追问和取消未覆盖。TS 全量回归 1702 项、1662 通过、40 个既有 skip、0 失败；WebUI、类型、lint、文档、格式、生成和 Gate 负例检查通过。

代码、证据及 A01-A40 剩余项见 [实施记录](../../tasks/51-native-rpc-clients/implementation.md) 和 [合同对照](../../tasks/51-native-rpc-clients/contract-diff.md)。18 格 CI 已配置，但 Windows/Linux 尚无本轮执行证据，完整容量、原始字节、并发竞态和强类型审计未闭合，因此 Issue 51 保持实施中。未 commit/push/PR/发包/关闭 issue。

# 可复用经验

快速终态会清理 registry，owner 保存回执必须保留原调用 key/instance；原生 request/pending 只回答一次；观察关闭与执行取消分开。包外 Go module cache 的只读目录应使用限定到该临时 cache 的 Go 清理命令，避免测试 after hook 中断服务 teardown。Rust 最低版本需要同时检查传递依赖的 MSRV，不能只写 manifest。

完整 OKF lint 仍只有基线三个 systemd-directive-paths 文件缺少 frontmatter；新增文档没有新增错误。

## 后续代码审查修复

用户随后授权修复全部六项审查问题。已修复观察关闭/取消/接纳竞态、数学整数绑定、大行扫描、Windows 最终回收及 Go 重复 Next，并修复 Rust 同构取消路径；维护源与生成产物同步。三语言完整原生套件各 44 项通过，双版本语言单测通过，详见[修复记录](../../tasks/51-native-rpc-clients/review-fixes.md)。Windows API stub 不作为实机通过证据；首次 Rust 包测试的网络超时与最终离线缓存重跑均在证据中说明。

再次复审后，按用户要求把 Python 两平台异步实现收敛进同一个 `transport.py`，删除独立 Windows 模块。修复 Windows 取消 API 失败时的过早回收、Go 等待取消 ACK 时不能关闭观察、Go Extra 非法 Unicode 替换和 Go/Python URL 校验差异；SDK 始终为单包、单公开导入。新增同模块分支、read/write completion、Go 两类等待及八个 TS 对照 URL 回归，详见同一修复记录。
