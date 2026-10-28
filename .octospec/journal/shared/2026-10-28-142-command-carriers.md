---
type: Journal
title: "Issue 142：Windows 命令载体验证"
description: "标准 npm 包装器的脚本与 Provider 启动兼容，以及对应验证边界。"
tags: [testing, integration, adapter, envs]
timestamp: 2026-10-28T07:00:00Z
source: self
---

# Issue 142：Windows 命令载体验证

## 范围与行为

修复八个验证脚本的十三处 npm/octo-cli 调用，以及已复现同一启动机制的共享 JSON-lines、ACP、Codex 和 Grok ACP 入口。Windows 标准 npm cmd-shim 转为其声明的 JS/原生入口，probe 与实际启动复用解析。保持 argv、env/cwd、同步创建和所属 ChildProcess 的既有清理合同。

公共 SDK 方法签名、配置、根包导出、协议及依赖版本不变；新增子路径只供私有 workspace 包内部复用。不修改其他 Windows 行为。

## 离线回归与工程检查

- Windows 11 企业版 22621 x64，普通用户，Node 24.22.1、pnpm 11.19.0。
- `node --test test/windows-command-launch.test.js test/verification-command.test.js`：28 通过、0 失败、1 个原生 POSIX 专项跳过。
- fake Provider 经默认 Codex/Claude Adapter 完成；ACP/Grok 保持同步创建、initialize、close 和后续调用可用，关闭后所属 PID 消失。
- 覆盖空格/中文路径、JSON/特殊字符与空参数、独立 env/cwd、安装选择、未知/损坏入口、原生 exe、非零和取消。POSIX 透传分支有模拟覆盖，不作为原生 macOS/Linux 验收。
- 构建/typecheck、最终根类型检查、lint、lint:names、变更文件标准格式和 diff 检查通过。全仓格式在自动识别检出换行后通过；严格格式命令仍受本机 CRLF 检出影响。
- 相关九文件回归：73 通过、2 失败、10 跳过。未通过项为 Worker 清理及 native discovery fixture 删除 exe 的 EBUSY；后者原因未确认。
- `pnpm test:suites`：WebUI 35 通过，Node 全量仍有失败并停滞于 Grok 文件；确认归属后停止本次 runner 树，不能报告全量通过。
- 打包、隔离 prefix 的空缓存离线安装通过；安装包中内部模块可导入，其 helper 与 workspace 内容哈希一致。
- 公开源码和捕获的原有公开 .d.ts 指纹一致。

## Non-gating live acceptance

执行者：Codex 本机 Windows 自动化会话。初始实测源码为 `59cb21a14259b6dc828f8791b8117ba1f3689f4c` 加本任务未提交 diff，日期为 2026-10-28；相关实现与调查时 `4264fd7` 一致。

| 入口与场景 | 原生版本 | 结果 |
| --- | --- | --- |
| Codex 裸名/.cmd 的后端版本查询和 Adapter probe | 0.163.0 | 返回实际版本 |
| Claude 裸名/.cmd 的后端版本查询和 Adapter probe | 2.1.278 | 返回实际版本 |
| 同上，在离线安装的 tgz 内重复执行 | 同上 | 通过 |
| 验证脚本执行函数的 npm --version | 10.9.2 | 退出 0 |
| 验证脚本执行函数的 octo-cli version | 0.18.0 | shim 与原生 exe 均退出 0 |

Home 与凭据隔离，仅调用版本/probe，不发送真实模型或业务 API 请求。首次并发包外运行的 Claude probe 曾返回空版本，停止全量测试后复测通过，未放宽既有预算。真实模型、IM 和原生 macOS/Linux：NOT RUN。此记录不宣称完整 Provider 执行或全部工具后代清理通过。
