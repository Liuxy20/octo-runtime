---
type: Journal
title: Issue 62 Windows 文件保护测试兼容修复
description: 用真实 DACL 和负向 fixture 替换 Windows 上的 POSIX mode 判据，保持 SDK 与产品实现不变。
tags: [testing, windows, mcp]
timestamp: 2026-10-27T00:00:00Z
source: self
---

# Issue 62 验证记录

任务：[brief](../../tasks/62-windows-file-protection/brief.md)。

## 基线与根因
- 基于 `aa16c894b2b2c7ae9a2771cf10a427f7b677c976` 的独立 checkout。
- 原生 Windows 11 Enterprise build 22621 x64，普通用户，PowerShell 5.1；Node 24.22.0，pnpm 11.19.0。
- 修改前 MCP 原命令在 `context-mcp.test.js:150` 复现 `438 !== 384`。OpenClaw 功能已通过，WebUI 原权限测试跳过 Windows。

## 实现与边界
- 共享测试 helper 用 lstat 要求普通文件；POSIX 保留 `0600`；Windows 使用系统自带 PowerShell 只读检查测试文件的实际 DACL。
- 当前用户、SYSTEM 和本机 Administrators 属于该测试账号边界。其他主体的读取 Allow ACE、无 DACL 或不受信任 owner 均拒绝。无法读取 ACL 或缺少 PowerShell 保留原始失败。
- 负向对照仅给独占虚构文件添加 Everyone Read，验证判据会拒绝；POSIX 对照显式 chmod 为 `0666`。路径包含中文、空格、`#` 和 `%`。
- MCP、OpenClaw 与已迁移的 WebUI 权限测试复用相同判据。原内容、清理和 overlay 断言保留；无生产源码、公开导出、类型、Schema、依赖或服务装配改动。
- 这是保守的 fixture DACL 检查，不是任意 Windows deny/group/有效令牌的完整 AccessCheck；未执行跨账号登录读取。测试要求当前账号的私有临时目录，不通过修改产品 ACL 或系统策略弥补环境前提。

## 验证
- 初次验证复用同一基线已通过的完整构建，并运行根 `tsc -p tsconfig.json --noEmit`；提交 PR 前再次执行完整 `pnpm typecheck`（包括 workspace 构建），通过。
- `node --test --test-reporter=tap --test-timeout=60000 test/file-protection.test.js test/context-mcp.test.js test/channel-tool-environment.test.js test/webui-extra.test.js test/webui-session-store.test.js`：初次 34 通过，0 失败，0 跳过；未加载诊断 loader。新增模块路径回归后的结果见下文。
- 上述覆盖真实 Windows DACL 正负对照、MCP 私有引用/配置/删除/overlay、OpenClaw 更新/no-op，以及 WebUI HTTP、权限、失败恢复与原生文件锁场景。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`git diff --check`：通过。
- `git diff --exit-code -- packages public apps pnpm-lock.yaml package.json`：通过，产品及公共 SDK 无差异。
- 未运行全量 suite、Windows 10 或 macOS/Linux；后两者保留原 POSIX 判据，实际平台回归待 CI。

## 经验
- mode 数值在 Windows 不证明跨账号访问权限；修复应位于测试判据，不因测试失败新增产品策略。
- 现有 engineering 文件权限 fixture 规则已覆盖负向对照和 umask 注意事项，本次不新增工程规则。

## Issue 验收逐项核对
- MCP 原测试完整执行配置内容、清理与 overlay；OpenClaw 和 WebUI 原功能断言均保留并通过。
- POSIX 分支仍严格检查 `0600`；Windows 检查实际 DACL，独占虚构文件的 Everyone Read 负向对照被拒绝，无宽泛跳过。
- OpenClaw 和已迁移的 WebUI 权限测试共享同一判据，Windows 不再跳过 WebUI 权限验证。
- 无真实凭据、新运行时依赖、系统级策略或公共 SDK 差异，未从 mode 数值推断漏洞。
- Windows 端对应验收已具备证据；完整交付仍须等待 PR 的 macOS/Linux CI，不将本机结果表述为所有平台已通过。

## PR CI 发现的测试环境差异
- PR #201 初轮 Windows Node 24/26 运行到文件安全步骤时，新增 helper 的 `Get-Acl` 报 `CouldNotAutoloadMatchingModule`。
- CI 由 pwsh 启动 Node，Node 再启动 Windows PowerShell 时继承 pwsh 的模块搜索路径。此行为及处理依据见 [Microsoft PSModulePath 文档](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath)。
- 用测试独占目录中声明需要 PowerShell 99 的虚构 Security 模块污染子进程环境，在本机复现相同 autoload 失败。
- ACL 检查和负向 fixture 的 PowerShell 子进程只使用 `$PSHOME\Modules`；不改变父进程或系统环境。新增的模块路径回归验证真实子进程可检查文件。
- Windows CI 原有文件安全步骤补入 MCP、文件保护正负对照和 WebUI 用例，避免只在本机运行这些新检查。
- 修正后本机五个相关测试文件：35 通过、0 失败、0 跳过，包含新增模块路径回归。
- 本机执行扩展后的 Windows CI 安全命令：47 通过、2 失败、2 跳过；两个失败均为 `hourly-log.test.js` 创建 symlink 时的 EPERM，属于本 issue 明确排除的 G06 环境前提。该文件与产品实现均未修改，不扩展修复范围。
- 首轮提交 `fa8d53f` 的 macOS/Linux、Node 24/26 四个完整 CI 作业全部成功；Windows 模块路径兼容修正提交后的 CI 需重新核对。
