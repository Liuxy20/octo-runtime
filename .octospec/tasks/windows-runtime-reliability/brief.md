---
type: Task
title: Windows 运行可靠性专项
description: 修复孤儿后代回收、调用启动故障隔离、计划任务编码与环境覆盖。
tags: [runtime, lifecycle, adapter, envs, installation, testing]
---

# 目标与基线

2026-10-26，从最新 `origin/main@8af8360` 建立独立 worktree，分支 `fix/windows-runtime-reliability`。处理 GitHub #131、#135、#134、#146，交付实现、回归和实际验证记录。

## 产品意图与关键合同

这是 Runtime 自身的进程、传输、安装与环境映射责任；宿主继续决定 Provider、配置、认证来源和服务部署。显式输入沿用 manifest 身份、CommandSpec、ServiceSpec、Context envs 与 executionEnvOverrides，不增加业务协议或宿主平台开关。

服务拓扑保持宿主直接构造 Kernel -> 内部独立 worker -> Provider/工具后代。Kernel 拥有 worker 与身份清单；Adapter 拥有本次 Provider 和管道；CLI/SDK 服务后端拥有本次命名计划任务与 XML。业务协议和 composition root 不变；评审后补充只读恢复诊断、显式确认 API/CLI 及共享环境读写助手，见[评审修复](review-fixes.md)。不增加外部 Node launcher、原生二进制、Job Object broker 或业务持久化。

## 根因与实施方案

| Issue | 根因 | 修改及验收 |
| --- | --- | --- |
| #131 | Windows orphan reaper 只 signal leader，且忽略最终退出确认 | 匹配启动身份后先 taskkill /T /F；命令或退出确认失败保留 manifest 并拒绝 open 替代。真实多代进程、身份不符、无关进程、失败留档回归。 |
| #135 | spawnJsonLines 未监听 stdout/stderr 错误，readline 也可转发 error | 在 reader 建立后同步安装输出错误监听，统一到本调用失败及 cleanup；保留 spawn 原 errno，监听存续到管道关闭。真实 spawn 失败与故障注入覆盖活动 sibling 和后续调用。 |
| #134 | schtasks 导入 UTF-8 XML 在已复现系统失败 | Windows XML 使用 UTF-16 声明及 UTF-16LE BOM；原子写入保留，读取兼容旧 UTF-8 sidecar，drift 仍比较解码正文。真实 SDK/CLI ASCII、Unicode/空格 Home、enabled 两值安装/查询/删除。 |
| #146 | JS 对象大小写敏感与 Windows 环境键规则不一致，spawn 再展开会重新引入重复 | 在 Adapter SDK 复用统一逐层合并：继承 < Context < executionEnvOverrides < Adapter；Windows 不区分大小写，每次返回新对象，POSIX 保持区分。底层 spawn 使用相同合并规则。 |

## 里程碑与检查

1. 定位与方案：记录代码调用链、合同、测试入口及可执行性评估。
2. 实现与定向回归：四项均覆盖成功、失败及隔离；Windows 原生命令仅作用于本次唯一 fixture，finally 回收。
3. 集成验证：format、lint、lint:names、typecheck/build、完整测试、Octospec lint；Windows CI 纳入专项回归。记录实际通过/跳过/失败原因。
4. 收尾：更新环境、回收规则及 journal/log，审阅 diff。用户随后授权英文提交、正式 PR 及合入 main；提交前先 rebase 最新 origin/main，远端合并遵守 CI 与 reviewer 门禁，不发布 npm。

## 范围与限制

不修改系统 LongPathsEnabled，不使用全局 uncaughtException 抑制，不扫描或终止无关应用，不重置现有 Home/身份/配置。#131 只增强 leader 仍可识别时的树回收；leader 在清理前已消失时仍无 Job Object 级后代保证。不把本机 Windows Server 结果扩大为 Windows 10/11、普通账号和所有 locale 的实测结论。

四项已实施；验收命令、实际结果及基线对照见[实施与验收](validation.md)和[journal](../../journal/shared/2026-10-26-windows-runtime-reliability.md)。未运行的检查不得计为通过。
