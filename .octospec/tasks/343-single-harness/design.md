---
type: Design
title: Issue 343：单实例复用与逐线程配置
description: 定义通用 CLI 装配约束、Codex 单进程所有权与逐线程配置。
tags: [architecture, adapter, lifecycle, envs, mcp]
---

# 装配与所有权

CLI 默认受管通用 Harness 按 Adapter type 唯一装配，声明重复在 import/构造前拒绝；未声明类型的动态工厂须校验返回类型并纳入失败回滚。CliAdapterResource 保持既有资源合同，不引入统一 Engine 接口、进程扫描或全局注册平台。其他 Adapter 的逐轮执行模型不因 Codex 的常驻模式而改写。

createCliCodexAdapter 创建唯一 managed owner，将 provider 注入 Adapter。owner 内只保存一个 CodexService；service 内维护唯一当前 incarnation、共享 stdio reader/writer 和关联器。配置变化不选第二个 service，正常完成/取消只释放原 channel。恢复先确认旧代回收再替换，沿用有界退避与不重放合同。

CLI Host 拥有 Kernel 和 app-server 两类资源。Kernel 与 Host 共用 OS PID；doctor 的进程快照仍合并同 PID 角色，文本将 Kernel 标明 in-process，和 app-server 平级。SDK 自管 Engine 可显式创建多个 owner 作为账户等强隔离边界；此功能不通过 cwd 或请求差异触发。

# 配置作用域

| 输入 | 生效位置 |
| --- | --- |
| executable、argv、宿主环境、CODEX_HOME | owner 创建时固定；启动不显式设置 spawn cwd，自然继承宿主目录，CODEX_HOME 只选择数据目录 |
| cwd、模型、审批、effort | 原生 thread/turn 参数，保留已有映射 |
| envs | shell_environment_policy.set 与本地 stdio MCP env；原生 MCP 自有 env 具有更高优先级，按平台变量身份合并 |
| 动态 MCP | 每轮展开模板，thread config.mcp_servers；HTTP 使用 http_headers，不生成共享进程私有环境变量 |
| 已核实容量 | 本轮 config.model_context_window / model_auto_compact_token_limit，不改变服务 argv |
| rawMessageMaxBytes | 活动调用决定连接的有界解析上限，路由后的 client 再检查各自预算；图片回显沿原合同有界放宽 |
| codexServiceRevision | 明确 CODEX_SERVICE_REVISION_UNSUPPORTED；账户/启动配置变更由宿主关闭重建 owner |

请求 envs 不更改共享 Provider 的认证/启动环境，认证归 owner。原生配置读取失败或动态 MCP 命名冲突仍在发起 thread 前拒绝。Runtime 不落盘请求 header/环境；原生会话数据生命周期由 Provider/Home owner 维护。低层 buildCodexCommand 是显式构造独占命令的 helper，不用于 managed owner 的进程选择。

# 并发

并发接纳和资源配额由宿主决定。移除八配置池、八活动 channel、启动等待人数、累计 thread 数和交互总数限制。所有调用共用同一次启动；owner 不按 Agent 数量或估算的 lease 内存设接纳门槛，不新增资源预算配置。高并发也不创建第二个进程。各调用按原生 thread/turn 身份路由，取消等待只结束本调用的等待，不取消共享启动。

共享 writer 的普通/控制条目沿用协议队列默认 4096 项和原有字节预算（当前 main 普通 64 MiB、控制 64 KiB）。控制预留不保留旧八项限制，以免批量取消导致共享连接失效。stdout 和路由通知继续执行既有传输限制；同 thread 并发仍拒绝。只保留当前执行的临时 RPC/thread/turn 路由，释放时删除；清理未确认的归属继续保留到确认回收，不伪造结束。不保留已结束 thread 的历史集合、累计计数或业务 session 映射。

未知 thread 的早到通知仅在存在待决 thread/start 时暂存；最后一个 start 成功、拒绝或取消后，丢弃仍无法关联的通知，清零对应计数，并拒绝孤立反向请求，避免临时路由变成跨调用历史。

没有 turnId 的反向请求只允许投递到本调用 thread/start 确认创建的 thread；当前 channel 保存这个布尔事实。thread/resume 的无 turnId 请求一律明确拒绝，因为当前身份无法证明因果归属。此判定不依赖任何已结束调用的历史，也不影响携带正确 threadId/turnId 的原生交互。

测试分别证明确定性 100 活动 turn/审批/批量取消、真实 100 并存 thread/MCP 隔离和真实三轮模型共享。100 原生 thread 未发模型 turn，不能据此声称真实模型 100 路吞吐通过。

# 接入与发行场景

CLI 执行服务与纯原生源码宿主分别装配。CLI 发行物携带内置 Adapter，由实际服务进程拥有 Kernel 和默认 Harness；独立 App 只依赖 octo-runtime-client，经 RPC 调用。纯原生宿主在自己的 workspace 声明 Kernel/Core、公共辅助包和所选 Adapter 的源码依赖，直接或动态 import，在 Kernel 初始化前完成对象构造与注册，并按明确所有权关闭服务及自有 Engine。private 源码包不单独 npm 发布。

删除完整包 `/adapters/codex`、`/adapters/dsh` 聚合导出及 facade 源文件。其他通用导出保持既有发行边界，不作为纯原生按需接入建议。仅用 Codex 不引入 OpenClaw，反之亦然；client 不加载 Adapter。当前 CLI 加载 manifest 全部装配项，Codex app-server 首次调用才启动；模块选择与进程惰性启动不混用。双语 docs 的场景表、workspace 依赖示例、所有权和私有 bean 消费示例是接入说明。
