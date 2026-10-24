---
type: Review
title: Issue 51 六项代码审查问题修复
description: 关闭观察与取消竞态、整数绑定、大帧扫描和 Windows 最终回收的修复与回归证据。
tags: [native, ipc, testing, lifecycle, schema]
timestamp: 2026-10-24T00:00:00Z
---

范围说明：以下是移除 Rust 前的历史评审与运行记录；当前仅交付 Go/Python，命令入口见 [native README](../../../native/README.md)。

# 范围与修复

用户授权修复本轮 code review 的全部六项问题。修改维护源后重新生成客户端；未提交、推送、发布或关闭 Issue 51。

| 审查项 | 修复 | 回归入口 |
| --- | --- | --- |
| P1 Python 关闭观察撤销已触发的取消 | watcher 触发后把控制任务交给 client；同一调度轮取消并关闭观察也保留意图。Rust 同构路径使用独立的观察关闭通知，仅停止尚未触发的 watcher。 | `native/tests/lifecycle.test.mjs`：先阻塞真实 ACK，关闭观察后才放行；普通关闭 cancel=0，显式取消 cancel=1，均无 subscribe。 |
| P2 Go Close 后迟到订阅 | 观察使用独立 context；接纳在有界后台任务完成；关闭状态与订阅发布同步，迟到 ref 保持 unobserved；Close 可以立即解除首个 Next 的等待。 | 同上，Go driver 使用 race instrumentation；另覆盖 Close 前显式取消。 |
| P2 Rust/Python 大行重复扫描 | 每次读取只扫描新加入缓冲的字节；返回一行后重新处理剩余行。 | Rust 近 40 MiB 分块 UTF-8 行、尾行、无换行超限；Python 累计扫描量断言及精确边界。 |
| P2 Go/Rust 拒绝 1.0/1e0 数学整数 | Go 仅在目标整数槽位精确绑定；Rust 由 Schema 生成整数反序列化属性；序号/身份比较使用数学值。开放扩展不经 float64。修复中同时消除 Rust Value→flatten 对 u128 扩展值的拒绝。 | 两语言 codec 单测：可选整数、requestId、safe integer 上界、非法小数/bool/null、opaque 大整数与 1.0 保留；三语言 RPC/stream relay 注入小数形式的整数。 |
| P2 Python Windows 关闭被取消后泄漏 handle | 多个关闭调用共享独立回收任务；重复取消不打断 completion 等待；最终释放一次 handle，再传播调用方取消。 | Python Win32 API stub：两次 Task.cancel、completion 前不释放、completion 后恰好一次释放、重复 close 无重复释放。 |
| P2 Go 初始化失败后 Next panic | 初始化失败统一结束迭代；后续 Next 稳定 EOF，不再次访问空 subscription。 | Go 单测覆盖预取消、非法输入及停止接纳，均检查无连接/登记。 |

# 验证口径

共享 `lifecycle` 套件已接入默认 `native/tests/run.mjs`，CI 也执行 Rust 单测及 Python unittest。自动化仍使用真实 TS Kernel + 隔离 worker + fake Provider。

Windows 关闭回归是可移植的控制流验证，不能替代 Windows 实机 OVERLAPPED / named-pipe 验收。此前 Linux/Windows、完整压力矩阵和真实 Provider 取消/交互待验范围继续保留，不以修复六项问题宣称 A01–A40 全部完成。

本轮最终命令、工具链及结果写入同目录 `evidence/review-fixes-macos-2026-10-24.json`。首次 Rust 包测试遇到 crates.io 索引传输超时；重跑使用 `CARGO_NET_OFFLINE=true` 和已有依赖缓存，包外独立构建与运行仍实际执行。

# 本机结果

macOS arm64：Go 1.26.1、Rust 1.98.1、Python 3.11.16 各通过完整原生套件 **44 项，0 失败、0 skip**，包含原有 339 个协议 fixtures、真实 IPC/faults、三种 ACK barrier 以及仓外独立包/demo。Go 1.25.0/1.26.1 race 单测、Rust 1.85.0/1.98.1 单测、Python 3.11.16/3.14.7 单测另行通过；Rust Clippy、生成漂移/生成器/CI Gate、lint、命名、docs 和格式检查通过。

证据：[review-fixes-macos-2026-10-24.json](evidence/review-fixes-macos-2026-10-24.json)。本轮未重跑真实 Provider，之前的真实 Codex 记录保留为初始实施历史。

OKF lint 仍仅报告基线的三处 systemd-directive-paths frontmatter 缺失，本轮记录无新增错误。

# 复审修复与 Python 单入口

用户再次授权修复复审的四项问题，并明确 Python 平台传输放在同一个 `transport.py` 中。已删除 `transport_windows.py`，在 SDK 内按 `sys.platform` 自动选择 Unix socket / Windows named pipe。调用方始终安装 `octo-runtime-client`、导入 `octo_runtime.Client`；Linux/macOS 不加载 Windows 依赖，Windows 仅安装声明的条件依赖 `pywin32`，不需要额外平台脚本或发行包。

| 复审问题 | 修复与回归 |
| --- | --- |
| Windows CancelIoEx 失败后提前释放 | 保存非 1168 的取消错误，继续等待实际 completion，再释放 event/buffer 并报告错误。Python 回归覆盖 read/write、重复取消、并发 close，completion 前无释放，完成后 event/handle 各一次。 |
| Go Next 等待取消 ACK 时 Close 无法解除等待 | 两处等待均监听独立 observation；关闭只停止等待，控制任务继续维护原取消。Go 回归覆盖 caller cancel / 显式 cancel 等待，另验证正常耗尽保留控制错误。维护模板后重新生成。 |
| Go Extra 的非法 UTF-8 被替换 | 在开放对象 marshaler 输出 Extra 前检查键与 RawMessage。回归覆盖 Encode/json.Marshal、非法键、非法 UTF-8、孤立 surrogate，以及合法 Unicode 和精确 opaque 数字。 |
| Go/Python MCP URL 校验差异 | Python 读取解析结果的 port 以触发格式/范围校验，并拒绝空白 hostname；Go 检查 hostname 和 16 位端口范围。共享回归新增 8 项，每项先经 TS InvokeInput 权威入口确认，再运行三语言 codec，包括非法端口/空格及合法边界/IPv6。 |

Python transport 单测另验证同一 Transport 的 Linux/Windows 自动分支；包外 wheel 消费检查安装目录中不存在 `transport_windows.py`，并实际运行同一 Python demo。Windows 资源顺序仍为 API stub 验证，不能替代 Windows 实机验收。本轮无真实 Provider 调用，也未提交或发布。

复审修复的最终验证记录见 [证据](evidence/rereview-fixes-macos-2026-10-24.json)。

macOS arm64 三语言完整套件再次各通过 **44 项，0 失败、0 skip**；每语言协议样例由 339 增至 347。Go 1.25.0/1.26.1 race 测试、Python 3.11.16/3.14.7 各 5 项 transport 单测通过；14 个生成产物无漂移、生成器/CI Gate 两项回归和 lint/names/docs/format 检查通过。包外消费包含每语言自己的 demo，Python 从 sdist 构建 wheel 后在新环境隔离运行。

OKF lint 再验仍只有前述三个基线 frontmatter 错误，本次修改无新增错误。
