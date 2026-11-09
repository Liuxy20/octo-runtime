---
type: Journal
title: fast-uri 安全升级本地验证
description: Dependabot 第 3 至 6 条告警的定向修复与本地全量验证结果。
tags: [security, dependencies, testing]
---

2026-11-09，从最新 origin/main@3f83ecf4 创建独立 worktree。
pnpm-workspace.yaml 定向 override fast-uri@3.1.8 → 3.1.9，锁文件仅更新
该依赖、AJV 引用及 override。处理 Dependabot #3、#4、#5、#6。
参考：https://github.com/advisories/GHSA-w74x-v6f9-j3xg。
GitHub 将告警标注为 development，但本地依赖链显示 DSH 的传递依赖也使用 AJV/fast-uri。

本地 macOS arm64、Node 24.22.2、pnpm 11.19.0 验证：

- `pnpm install --frozen-lockfile --ignore-scripts` 通过。
- `pnpm build` 和构建后 `pnpm lint` 通过。
- 协议、Context、Kernel IPC、Runtime selection 与协议包相关测试 338 项通过。
- `pnpm test:suites`：1607 项，1546 通过，61 条件跳过，0 失败。
- 手动检查百分号编码危险 scheme 不被解码成 javascript、编码 http 不与原始 http 判等，以及 AJV 本地 $ref 正反校验，均通过。
- `pnpm why --recursive fast-uri` 只解析 3.1.9，覆盖根 AJV 与 DSH 依赖链。
- `pnpm audit --json` 不再包含 fast-uri 告警；仍有另一个独立 worktree 处理的 minimatch 告警，因此 audit 退出码为 1。
- OKF lint 与 `git diff --check` 通过。系统 Python 缺少 PyYAML，使用仓库外临时 venv 安装 PyYAML 后检查。

未运行 Windows、Node 26 或真实 DSH 服务。未修改 .github、package.json、scripts、test，CI 范围不变。
基线实际检查包括 CI Gate、六项 Node 24/26 Linux/macOS/Windows 构建或打包验证、
CodeQL、Secret Scan、Release Draft、welcome/label；基线 Secret Scan 显示失败，与本次依赖变更无关。
用户已授权提交、推送并创建目标为 main 的 PR；合并未授权。
提交前重新 fetch，确认分支基线与 origin/main 一致，核对实际检查列表及 CI 范围无变化。
远端告警需合并后由 GitHub 重新扫描确认。
