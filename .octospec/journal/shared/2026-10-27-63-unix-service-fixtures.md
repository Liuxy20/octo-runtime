---
type: Journal
title: "Issue 63：Windows 上的模拟 Unix 服务 fixture 修复"
description: "分离 POSIX spec 与原生存储，保留原有服务管理断言及严格平台校验。"
tags: [testing, installation]
timestamp: 2026-10-27T00:00:00Z
source: self
---

# Issue 63：验证记录

基线 main@5c0d2c635b6af214c7347249264bffaff2ac469d，分支 `fix/63-windows-unix-service-fixtures`。原生 Windows 11 企业版 22621、x64、普通用户、PowerShell 5.1、Node 24.22.0、pnpm 11.19.0；源码构建与此基线一致。

## 修复与边界

原两个文件 50 项中有 15 项失败，均未到达目标功能断言。渲染 spec 改用 POSIX join；生命周期 spec 使用独立 Unix Home，测试辅助函数仅在文件操作边界映射到独占原生临时目录，并在测试结束恢复 ESM 文件函数。XDG 路径同样模拟为 POSIX 路径。

CLI 的本机 Home 和真实 IPC 保持原生；注入测试 backend 时将 spec 的 command、CLI 入口和 Home 投影为 Unix 路径，仍调用真实 launchd 安装、查询、启停和重启实现。映射前核对 CLI 原始 command/cwd/argv，bootstrap 核对 plist 内容和原生定义文件路径。macOS 保留短 `/tmp` Home。安装进度与 Extra 状态等原断言全部保留。

所有实现变更仅涉及两个测试文件与一个测试辅助文件；公共 SDK、产品源码、导出、类型、配置和依赖均未改变。既有隔离规则已覆盖本次结论，不增加新规则。

## 验证

- 原 8 项 focused 命令全部通过。
- 两个完整文件：58 通过、0 失败、0 跳过（原 50 项，加 linux/darwin 的 8 项 Windows 盘符路径拒绝断言）。
- 加上 `cross-service-failures.test.js`：73 通过、0 失败、0 跳过；涵盖 fake Windows task、管理器失败、停止确认及定义保留。
- 单独运行 Windows definition I/O 编码及原子幂等用例：1 通过；未运行真实任务安装用例。
- `pnpm format:check`、`pnpm lint:names`、`pnpm typecheck`、构建完成后的 `pnpm lint` 和 `git diff --check` 通过。首次 lint 与 clean/build 并发引发类型解析错误，构建完成后按序重跑通过。
- 扩展运行 `runtime-endpoint.test.js` 时，#89 的 POSIX endpoint 断言仍独立失败，实际为 Windows 路径；未纳入修复。
- 临时目录检查仅剩 Node 编译缓存，没有遗留 fixture 目录；未安装真实系统服务、调用模型或修改用户配置。

## 验证限制

用户明确本任务仅做 Windows 本地验收，并授权提交 PR。macOS/Linux 原生执行尚未验证，Windows 上模拟 Unix backend 的通过不能替代原生平台验收。未执行全仓测试；本次验证仅覆盖本 Issue 及相关服务回归。
