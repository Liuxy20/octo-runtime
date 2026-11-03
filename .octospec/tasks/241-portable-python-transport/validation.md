---
type: Validation
title: "Issue 241：Windows Python transport 验证"
description: "当前 main 的失败基线、异步模拟对照、真实背压及两版本回归。"
tags: [testing, ipc, python, windows]
timestamp: 2026-11-03T09:54:06Z
source: self
---

# 基线与范围

- 仓库：Mininglamp-OSS/octo-runtime；基于 main `1956b46ec531d840658faaf8dd9258c363045807`。
- 独立分支：`fix/241-portable-python-transport-tests`；源码位于本聊天 `work/octo-runtime`。
- Windows 11 企业版 x64，10.0.22621/build 22621，普通用户；PowerShell 7.6.5。
- Node 24.19.0（win32）、pnpm 11.19.0、Codex CLI 0.163.0。
- Python 3.11.9：python.org 官方 Windows amd64 embedded runtime，独占目录、显式 `._pth` 指向本次源码；未冒充系统 Python/venv。
- Python 3.12.14：本机 bundled runtime 创建的独占 venv，以本 checkout 的 pyproject 安装 editable 项目。
- 两版本均为 `pywin32==311`；3.11 wheel SHA-256 为 `3ce80b34b22b17ccbd937a6e78e7225d80c52f5ab9940fe0506a1a16f3dab503`，与 uv.lock 一致。
- 测试 Home/TEMP/TMP/AppData/配置与 Codex Home 位于 checkout 外、本聊天独占的 `work/validation-state`；只使用 fake Provider/loopback/本次原生服务夹具，无在线 Bot 接管或身份重置。

# 失败与根因

在 `native/python` 执行：

```powershell
<python311> -W default -m unittest discover -s tests -p test_transport.py -v
```

未修改 main：6 个方法，4 通过、2 个方法报错，共 3 条 error（两个 explicit_close subTest 加一个平台选择方法）。Windows 缺少 asyncio.open_unix_connection，create=True 建立普通 Mock，await tuple 失败；未使用 create=True 的位置直接 AttributeError。

运行期仅替换两个 patch 为 AsyncMock/create=True：缺失属性和 tuple 症状消失，但两个 close 子场景仍超时。记录到实际 drain 入口与返回的发送缓冲均为 0：Windows 内核接收了整条 4 MiB 发送，原夹具未建立实际背压。此外同步请求校验/编码在负载下超过两秒，不应计入 IO 预算。

修复后实测 drain 入口为 4,194,512 字节；timeout 子场景由 RPC 期限释放，close 子场景关闭后缓冲归零。保留 `KERNEL_TIMEOUT`、`CONNECTION_CLOSED`、peer 仍打开、channels 为空及最终 buffer=0 断言。公开生产 SDK 不变。

# 修复与验证

- 两个 Unix patch 显式 AsyncMock/create=True，继续检查 awaited 调用；Windows 平台分支与清理断言保留。
- 对端暂停读取、限制接收窗口；Windows 客户端关闭内核发送缓冲，保留 Unix 原设置。使用真实 TCP 写入和真实 drain，不用成功 Mock 冒充背压。
- 用事件观察 drain，提前结束的 RPC 直接取回异常；原两秒预算从 mocked open 起算，不延长 150 ms invokeAck 或 5 s close 场景 ACK 预算。
- 所属 RPC/事件任务均取消并 gather，客户端与双方 writer 均等待清理。

| 检查 | 结果 | 证据（本聊天 work/validation-logs） |
| --- | --- | --- |
| 3.11.9 完整 transport 标准 discover | 6/6，exit 0 | transport311.log |
| 3.12.14 完整 transport 标准 discover | 6/6，exit 0 | transport312.log |
| 3.11.9 全 Python 单元，重复 3 轮 | 每轮 7/7；两个 close 子场景均通过 | python-unit-311-repeat3.log |
| 3.12.14 全 Python 单元，重复 3 轮 | 每轮 7/7；两个 close 子场景均通过 | python-unit-312-audit-repeat3.log |
| 3.11.9 transport 任务审计 | 6/6；每方法 pending_tasks=0、loop_errors=0 | transport-311-audit.log |
| 3.12.14 任务审计 | 三轮每方法 pending_tasks=0、loop_errors=0 | python-unit-312-audit-repeat3.log |
| 移除 abort 的运行期反向对照（不改生产文件） | 预期失败：两个 close 子场景均受原两秒期限阻止；审计无遗留任务/loop error | no-abort-control-311.log |
| 3.11.9 native 五套回归 | 42/42、无 skip；含 434 条协议 fixture | native-python311.log |
| 3.12.14 native 五套回归 | 42/42、无 skip；含 434 条协议 fixture | native312.log |
| frozen install | exit 0；lockfile 不变 | pnpm-install-retry2.log |
| pnpm typecheck（含 build） | exit 0 | typecheck.log |
| pnpm lint / lint:names | exit 0 / 0 | lint.log / lint-names.log |
| pnpm format:check | 失败：718 个未修改文件为 CRLF | format-check.log |
| format:check --end-of-line auto（只读诊断） | exit 0；未改配置/源码绕过检查 | format-control.log |
| OKF lint | exit 0：629 单元、20 规则、3873 本地链接 | octospec-lint.log |
| pnpm test:suites | exit 1：WebUI 35/35；Node 2401 项中 2318 通过、4 失败、79 skip、0 cancelled | test-suites.log |
| 最终代码全 Python 单元与任务审计 | 两版本各 7/7；两个 close 子场景实际通过，六个 transport 方法均无遗留任务/loop error | final-python311.log / final-python312.log |

native 命令（仓库根，分别设置 OCTO_NATIVE_PYTHON 指向两版本独占解释器）：

```powershell
$env:OCTO_NATIVE_LANGUAGE = 'python'
node --test --test-concurrency=1 native/tests/protocol.test.mjs native/tests/interop.test.mjs native/tests/faults.test.mjs native/tests/lifecycle.test.mjs native/tests/playboard-demo.test.mjs
```

native 通过的是当前真实 Kernel/Windows named pipe 与 fake Provider 互操作；平台选择方法的 Unix 分支是模拟，不能代表 Linux/macOS 真机结果。审计通过的日志未见未取回任务异常、ResourceWarning 或未 await coroutine；同步大请求的 asyncio slow-task 提示不是任务异常。

# 既有失败与未验边界

- 完整重跑的四项失败：OpenClaw typed/untyped 启动均为 `SERVICE_INITIALIZATION_FAILED (ORPHAN_CLEANUP_INCOMPLETE)`；executable probing 期望版本 `24.19.0` 实际 null；session 私有权限检查的 PowerShell ACL fixture 在 10 秒后 SIGTERM。
- main 生产源码及这些 Node 测试均未修改。四项串行定向对照中，两 OpenClaw 错误重复；executable probing 与 session 权限通过。这只证明后两项在全量环境下不稳定，未确认其进一步根因。Node 默认 suite 不加载本次 native/python 测试，不将这些问题并入 #241 或擅自修复。
- 首轮全量与另一次 F24 单独运行曾在同一个 PowerShell ACL helper 超时；最终完整重跑 F24 通过。保留该暂态失败事实，不混入 #240 的 ACL 问题。
- full suite 首轮执行会话丢失，未取得整体退出码与汇总；原因未确认。不以已输出的通过项宣称全量通过，重新完整运行。
- 完整重跑的四个原生 Windows 服务 install/query/delete 场景全部通过。首轮中断遗留一个具有本次独占 Home/XML/随机 ID 证据的 scheduler fixture，按现有 backend.uninstall 回收并 inspect 确认 not_installed；没有按进程名/通配任务删除，也未删除用户状态。最终没有指向本 checkout 的测试进程，独占服务 sidecar 无遗留。
- Windows 新开 PowerShell 一度 stack overflow/内存错误，改由 cmd 启动独占 Python 调度器继续相同命令，未修改系统策略或终止无关进程。
- Linux、macOS、Windows 10 未验证；包外 wheel 打包 suite 和真实 Provider/IM 不在本次 transport 修复专项范围，未运行。
- 无 workflow/job/matrix/default gate 改动。初次交付为本地 diff；用户随后明确授权提交、推送并创建关联 #241 的 PR。PR 使用 Closes #241、Refs #14，不合并或手动关闭 Issue。

# 审查

对照 brief 与 architecture/local-execution/engineering/collaboration：修改归测试；无生产 SDK 签名、导出、协议、配置或 worker 变化。两个 close 子场景、两平台选择、错误码与清理断言全部保留，新增真实在途写入和 awaited 参数断言。可复用结论归档至 journal；现有 engineering 已要求从合同事件计时，保持规则范围，不新增自动门禁。

PR 准备时重新 fetch main，仍为上述验证基线，无需 rebase 或重跑未变化的构建/全量测试。按仓库 PR 模板使用英文标题与正文，完整披露全量失败和未验证的平台；提交前重跑 OKF lint 与 diff 检查。
