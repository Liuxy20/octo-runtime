---
type: Journal
title: "Issue 89：平台路径派生兼容修复"
description: "在 Host SDK 原辅助函数内统一所选平台的规范化与拼接，并记录原生 Windows 回归。"
tags: [runtime, identity, ipc, testing]
timestamp: 2026-10-27T11:02:25Z
source: self
---

# Issue 89：平台路径派生兼容修复

任务与范围见 [brief](../../tasks/89-platform-endpoint/brief.md)。基线为 main `005116ec7a28e27ccaddde75057e6289cfb549a5`，原生 Windows 11、PowerShell 5.1、普通用户、Node 24.18.0、pnpm 11.19.0。

## 修复与兼容

产品逻辑仅三处：引入 posix；normalizedHome 的非 Windows 分支使用 posix.resolve；componentEndpoint 的非 Windows 分支使用 posix.join 并传递已有 platform。补充就近合同注释。homeHash/componentServiceId 已传递 platform，其实现保持不变。

原接口、导出、默认参数、Windows 分支及管道命名、哈希算法和组件校验均保留。生成的 endpoint.d.ts 去掉注释后与修复前逐行一致；public/host.ts、Host SDK index/package.json、根 package.json、锁文件与调用方均无 diff。不改变运行拓扑、输入输出合同、清理或持久化。

## 验证

- 修复前新增回归：`node --test test/runtime-endpoint.test.js` 为 3 通过、3 失败；失败包括原测试及显式 darwin/linux，Windows/默认参数/组件校验通过。
- 修复后：`node --test test/runtime-endpoint.test.js test/kernel-clients.test.js` 为 10 通过、0 失败、0 跳过。其中 endpoint 为 6 项；Kernel 为 4 项现有 fake Adapter 测试，使用真实本地 Windows Pipe，验证观察/终态、完整身份、丢 ACK 不重复执行及异常连接隔离，并完成 fixture 清理。
- 源码基线和编译产物的仓库外 44 项补充检查，修复前为 30 通过、14 失败，修复后为 44 通过、0 失败。确定性绝对 POSIX fixture 只做字符串计算，不在 Windows 监听 POSIX socket。
- `pnpm --filter @mininglamp-oss/octo-runtime-host-sdk run build` 通过；随后补齐其他包与 CLI 的 TypeScript 构建、WebUI 后端的 tsc 构建及 public 构建，`pnpm exec tsc -p tsconfig.json --noEmit` 通过。
- `pnpm format:check` 通过；命名检查无 findings；`git diff --check` 通过。
- `pnpm exec eslint apps packages` 最终通过。首次全仓 lint 在其他包的 dist 尚未构建时出现未解析类型错误，补齐声明构建后重跑通过；未据此改动其他模块。
- PR 前再次运行上述 10 项 endpoint/IPC 回归，全部通过。OKF 全仓检查通过：429 个知识单元、20 条规则、3085 个本地文件链接。

## 验证边界与规则影响

沿用复现阶段冻结锁文件的依赖安装，跳过可选依赖和安装脚本；未执行 WebUI 资源打包、全套 test:suites、发行包或真实 Provider/Bot 验收。本轮没有原生 Linux/macOS 环境，Windows 上显式选择 POSIX 不替代其原生验收。

现有规则已覆盖在责任模块修复、内部处理平台差异和保持 SDK 合同，无需新增规则。用户已追加授权在核对通过后提交、推送并创建关联 #89 的 PR。最终核对确认 Issue 范围内的行为已修复且原生 Windows 回归通过，公共声明与调用方无漂移；原生 Linux/macOS 及完整发行检查交由 PR CI，不提前宣称通过。GitHub Issue 正文保持不变，不执行合并或发布。
