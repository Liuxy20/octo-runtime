---
type: Review
title: "Issue 303：端点与所有权自查"
description: "审查规范地址、旧版竞争、资源归属、API 与 #306 依赖边界。"
tags: [runtime, ipc, lifecycle, architecture, review]
timestamp: 2026-11-04T06:40:00Z
source: self
---

# 自查结论

以下记录为独立修复阶段的历史审查。后续已按已发布 #306 PR head 完成此处要求的
接口、目录准备及预算整合，最新实测结论见 [联合验证](joint-validation.md)。

本地独立修改可审查，尚不构成 #303 最终可合并结论。#306 未落地，Home 验证/实际 IPC 预算与最终签名仍须按其主线实现整合；真实 macOS/Linux bind、长度边界及跨版本竞争未在本机执行。

## 承重路径

- **地址和调用链。** `componentEndpoint` 只为 Kernel 生成 `<home>/executor-kernel.sock`，去掉的固定后缀共 21 UTF-8 字节。Windows hash 管道及各平台 service ID 不变。`hostHomePaths`、CLI `runtimePaths`、创建、attach、Extra Kernel client、status 共用该派生结果；CLI doctor/recover 的执行清单仍为 `<home>/run/kernel-invocations.json`。Extra 控制端点只查询插件状态，保留独立旧布局，不承担 Kernel 路由。
- **过渡互斥。** 新规范 Kernel 先持有旧地址 `.owner`，再持有新地址租约，最后才建立监听。旧代码已认识 PID/nonce，因此无论谁先取得旧租约，另一方不能自动启动。没有第二监听、自动回退或请求转发。原生旧格式/未知 owner、旧 socket 或旧 endpoint-local `.runs` 保留并拒绝，必须先完成旧版本停止/恢复；不假设连接失败就可删除。
- **身份与回收。** 仅匹配本实现 marker/nonce 的死 owner 可回收；PID 复用、权限不明保守阻止。规范 socket 还要求匹配 Kernel owner 与相同文件身份；无 owner 不 unlink。owner 读取在同一描述符检查普通文件、身份及 4096 字节预算，拒绝链接/FIFO。独占创建后写入失败按该描述符身份回滚，失败聚合保留原 cause，不能假报 complete。
- **关闭与恢复。** Core/Run/日志/清单清理成功后才释放端点；新端点释放失败保留旧兼容租约。兼容锁不确认后代清理，也不绕过 InvocationManifest 的人工确认。旧 endpoint-only 默认 `.runs` 不随 socket 改名被忽略。CLI stateDirectory 不迁移，配置、凭据和身份文件不改写。
- **关闭后的 socket 确认。** Node 的 libuv 在关闭 Unix pipe 时执行 unlink，但没有将其返回值传播为 close 失败（已按 Node 24.19.0 内置源码核实）。删除原有的重复路径 rm，避免删到关闭后新建的文件；记录 bind 后文件身份，关闭后若本次 socket 仍在则保留租约并报告 incomplete，不因回调成功放行替换。POSIX 真实权限拒绝与替换文件两项均留作显式手动实测。
- **拓扑和职责。** Kernel、Adapter、Extra 仍由宿主原生装配，同进程调用继续 RPC。没有执行 worker、额外状态根、SDK Home 默认、进程批量终止或业务重放。只按独占测试资源清理，不改在线 Bot 或其他 checkout。

## API、文档与范围

规范路径变更要求所有硬编码旧地址的 attach/原生客户端/Extra 同步停止升级再重连。新增 `KernelEndpointUpgradeError` 为可识别错误，沿主包 `/executor-kernel`、`/host` 公开；其诊断只含路径、端点、操作与固定行动建议，CLI 文本路径用 JSON 转义，不打印旧记录正文。

直接地址的固定文件名列入 CLI 保留 profile 名；已有同名用户目录明确拒绝，不自动改名或删除。旧版本的 platform Home 仍可由宿主明确选择，端点迁移不改变所选目录。

双语入门、Extra 指南、Host SDK README、CLI/native 示例、迁移指南与架构规则同步。#306 拥有的默认 Home、环境覆盖删除、SDK 必填 Home 和路径验证 API 未复制进本分支；因此主线现有 Home 文档/API 仍须由 #306 一并替换，当前草案不得独立发布为最终联合合同。

未修改 GitHub workflow、job、matrix、trigger、Gate、默认脚本或 selector。新增专项只在 `test/manual` 显式执行。没有 commit/push/PR/公开评论/合并/关闭 Issue 授权，均未执行。

## #306 落地后的必做整合

1. 刷新并基于实际落地 commit 整合，不复制其草案。保留其 `componentEndpoint` 规范化及预算校验，只替换 Kernel 布局分支。
2. 在实际 `kernelStartupPaths`（若最终仍使用此 API）补入旧兼容 owner/recovery 的**文件系统**预算；旧路径绝不重新按 IPC socket 预算校验或 bind。该路径比新 endpoint 多 `sockets/`、`octo-runtime-` 及 owner/recovery 后缀。
3. 核对 #306 的目录准备边界：只创建已验证 Home 内的兼容子目录，不重建消失的 Home。必要时复用其最终 `prepareHomeDirectory`，不得另建 Home 校验器。
4. 用实际导出启用本专项的 #306 字节边界断言，复验中文、空格、长 Home、CLI 默认/显式优先与冲突环境；Extra 控制端点继续单独计预算。
5. 完整 build/typecheck、相关与全量检查重跑；macOS/Linux 执行本专项的真实 bind/旧版过渡/边界用例。不能用 Windows 文件租约模拟或合成 platform 计算替代。

## COMPREHENSION

1. **改变了什么？** POSIX 常驻 Kernel 地址直接落在指定 Home 根；所有自动使用方同步，旧地址仅留兼容租约阻止双启动。
2. **可能影响谁？** 硬编码旧路径的客户端/Extra 必须同步升级；未完成旧清理的 Home 会明确阻止新启动；Extra 私有控制路径不因本次更名改变。
3. **证据是什么？** 真实 Windows RPC/生命周期、文件租约故障与竞争控制、派生计算、既有相关回归及全量对照见验证记录。POSIX 真机与 #306 联合边界仍是明确缺口。
