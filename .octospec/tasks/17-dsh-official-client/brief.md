---
type: Task
title: Issue 17 改用官方 TypeScript Client
description: 删除自实现协议客户端，使用 npm 当前最高版本的 HarnessClient 调用本机 Desktop。
tags: [dsh, adapter, testing, lifecycle]
timestamp: 2026-10-25T00:00:00Z
---

# 目标与决定权

> 本文保留已关闭 #174 的历史状态，当前方案及修复见[重新接入](../17-dsh-official-reviewed/brief.md)。下文未回滚、未修复和未验收描述均为当时记录。

用户否决 #173 的自实现 Client，并明确要求直接使用最新版官方 TypeScript Client。以 `origin/main@982a2fe7b976071f76b9626af4cb65c9d2e50d08` 为基线，在原独立 worktree 切换到 `fix/17-dsh-official-client`。回退分支已准备但依用户后续评估要求暂停，尚未创建或合并回退 PR。

2026-10-25 查询 npm versions/dist-tags：最高版本为 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3`，标签 `next`；`latest` 仍指向 `0.0.1-rc.1`。锁定最高版本，不沿用参考项目的 `0.1.0-rc.6`，不以 tag 名称猜测版本。

业务方决定 Provider、模型、目录、Home、profile、权限和 Provider session。Adapter 将显式配置交给官方 HarnessClient；官方库拥有 spawn、握手、RPC、订阅、超时、shutdown 和直接子进程回收。Adapter 保留本轮 canonical 投影、receipt/终态核对和错误脱敏。禁止读取官方私有 child/transport 字段，禁止重写 JSON-RPC、自动安装 Provider 或修改认证。SDK/CLI 保持同一调用链。

# 入口和发行

官方公开 API 有两层：DeepSeekHarness 的高层 run，以及 HarnessClient 的低层方法。本 Adapter 使用后者，避免高层 run 收集整轮事件数组，并保留现有 session/wait 终态核对。调用 initialize、resumeSession、setWorkingDirectory、prompt、request、subscribe、close。

官方 Client 用 process.execPath 启动 dshBin。macOS Desktop 的入口只执行 execve，将同一个 PID 和 stdio 交给 Electron/asar CLI，不代理协议。其他 Node CLI module 使用显式 dshBin；旧 Node executable 加单一 module argv 仍接受，任意 executable/argv 组合明确拒绝。

源码保留官方 SDK 精确生产依赖。发行时用 esbuild 收集 Adapter 入口、官方 Client 和官方 Protocol 的实际 JS imports，workspace 包保持 external；不遍历 SDK 的完整 Provider 依赖。通过 metafile 检查官方 Client/Protocol 已进入产物且没有 Provider 代码，保留上游版本与 MIT 许可通知。消费方离线安装不下载 Provider，Adapter 始终提供显式 dshBin。

# 已知上游边界

- 官方 0.2.1-rc.3 reader 忽略非 JSON 行，没有解析前字节上限。Adapter 的通知字节预算在 SDK 解析之后检查，不宣称完整原始行有界。无效启动输出最终按握手超时失败。
- 官方 Client 关闭并确认直接子进程退出，不拥有独立进程组。正常工具清理由 DSH shutdown 负责；父进程异常退出后孤儿工具回收不在本版 SDK 保证内。原孤儿测试显式跳过，不计通过，不将旧自实现的进程组证据套用到新 Client。
- 官方 API 不暴露 PID/request ID，不从错误文本提取诊断，保留安全 code、阶段和时间。
- 其他固定版本限制保持：显式 full_access、无交互审批/逐提示词 cancel、无实时 token 通知；DM 测试需已有好友关系的其他专用账号，尚缺账号名称或配置位置；原生 Windows DSH 未验收。

# 实施准备度

本次工程自评 95/100：官方接口/版本 20、Desktop 启动原型 20、事件与错误映射 19、发行 JS 收集 18、验收步骤与边界 18。依据是官方类型/源码、真实官方 Client Desktop 握手、替换原型的真实会话/工具/取消探针，以及产物生成。该分数只表示可继续实施和验证，不是验收完成率；旧自实现方案的 95 分不能证明本方案通过。

# 验收与审查计划

逐文件检查官方 public API、取消/超时首错、订阅同步投影、session 恢复不替换、Desktop execve 的 PID/stdio 和打包的 module 路径。用 fixture 验证失败/会话/大小/队列/凭据 canary；运行 build、typecheck、lint、全量 Node/UI、文档与格式检查。

用实际 Desktop 执行 KernelClient 新建/续聊、文件副作用、取消/兄弟任务/恢复。发行后空 npm cache 离线安装，公开 Adapter 执行 fixture，并用安装包的公开 SDK 再调用 Desktop。verified-review 串行审查源代码及执行结果；已知上游限制单独报告，不通过删除失败断言冒充行为未变。
