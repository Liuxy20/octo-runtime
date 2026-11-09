---
type: Journal
title: Issue 343：CLI 同类型 Harness 单实例实现
description: 修复配置分池、移除 Adapter 自设接纳配额及已结束 thread 历史，记录验证范围。
tags: [architecture, adapter, lifecycle, envs, mcp, testing]
---

# 用户决定与实现

用户要求最新 main 独立 worktree，按 octospec 处理 [Issue 343](https://github.com/Mininglamp-OSS/octo-runtime/issues/343)：CLI 默认纳管同类型通用 Harness 只装配一次；Codex owner 只有一个 app-server，不按 cwd、任务命令、模型、环境、MCP、容量或并发数分池。账户等强隔离须显式选择。

基线为 origin/main@4d7e272d，worktree issue-343-single-harness，分支 fix/343-single-harness。CLI 拒绝同类型重复装配；Codex owner 使用唯一惰性服务，每轮配置经原生 thread/turn 传递。doctor 展示 CLI Host 拥有平级 Kernel（in-process，共享 PID）和 app-server。

用户进一步明确并发接纳、资源配额和耗尽风险由宿主/使用方决定。本次撤销实现过程中自行添加的 maxRetainedBytes 及 16 KiB 估算；删除旧八路、启动等待人数、累计 thread 和全进程交互配额。不新增资源接纳配置。

旧 #usedThreads 曾保存已释放 thread ID，并在累计 4096 个后拒绝新 thread。本次删除整个集合，Runtime 不保存已结束 thread 历史或业务 session 映射。执行时保留临时 RPC/thread/turn 路由，释放时删除；未确认清理仍保留原归属事实。无 turnId 交互仅根据当前调用是否新建 thread 判定，resume 无法证明因果关系时拒绝。

# 验证与交付边界

类型、lint、命名检查和文档示例通过；全量既有离线测试 1548 通过、61 跳过；53 项手动回归全部通过，含 100 个同时活动 turn、百路审批/取消、2200 个并发 lease 与单进程累计 5000 个 thread。真实 Codex 验证 100 个并存原生 thread/MCP 隔离和另一专项的 3 次真实模型 turn；两者均完成 owner 清理。100 路真实模型吞吐未验收。

已回写架构、环境和 MCP 规则及双语开发者文档；旧 #339 方案加历史替代说明。无 workflow、package scripts 或默认测试 selector 变更，不扩大 CI。完整命令、结果、修正范围和平台限制见 [验收](../../tasks/343-single-harness/validation.md)与[复核](../../tasks/343-single-harness/review.md)。

尚未 commit、push、创建 PR、安装或重启用户服务。用户可在本次 managed worktree 检查全部源码及证据。

# 最新 main 与本地审查

按用户追加要求 rebase 到 bf665881095690fdfe3d2aca5796ca9f18e53bd0，适配 #344 的 AgentEnv 直传接口，由 Adapter 读取 bean；没有 agentConfig 兼容层。处理 9 处冲突后，独立 Standards/Spec 和主 Agent verified-review 复现并修复两项 medium：原生回执发布竞态、既有早到孤立通知跨调用残留。同类扫描同步原子发布既有 live 回执，两个轴最终各 0 项未解决 medium 及以上问题。

当前基线全量 1455 通过/61 跳过，五组手动专项共 120 项全部通过；类型、lint、命名与文档检查通过。再次真实验证 100 个并存原生 thread 共用一次 app-server spawn、100 组环境/MCP 隔离及最终回收，未发模型 turn。零模型 resume 探针因原生 no rollout found 未能验证配置替换；旧三轮模型结果不冒充本轮证据。详细命令与范围保留在上述 validation/review，不扩大 CI，仍未提交或修改用户服务。

# 源码接入和文档场景约束

用户明确删除完整包两条 Adapter 聚合入口，纯原生统一源码 workspace 按需依赖/加载，不独立发布 private 包；CLI 启动服务后，独立 App 仅依赖 client。双语架构/SDK docs 给出场景、依赖示例和生命周期责任，区分 CLI manifest 全量装配与 Codex 首次调用启动。包 README、开发规则和示例同步迁移；agentEnvItem 与 invocationModel 补齐中文注释和文档地址，私有 bean 由 Adapter 校验后映射原生调用。

复审修正 client README 和 authoring 规则的旧全量包接入要求，无剩余 medium 及以上问题。最终构建/类型/lint/文档通过，全量 1455 通过/61 跳过、手动 120 通过；CLI/client 本地归档离线验证通过，源码六轮 PID 复用及独立 client 11 项通过。既有发行文档检查位置随源码接入迁移，未增加 CI 检查。用户已授权提交 PR 到 main，明确暂不自动合并；没有变更用户现有服务或认证。

已提交 [PR #345](https://github.com/Mininglamp-OSS/octo-runtime/pull/345)。首轮 CI 暴露 CODEX_HOME 被错误设为 spawn cwd，干净 runner 缺目录导致跨平台失败；本地用不存在数据目录复现。修复为 managed server 启动不显式指定 cwd，业务目录仍经 thread/turn RPC 传入，Home 默认顺序保持。新增显式手动回归并同步文档；用户要求修复后等待全部既有 CI，禁止自动合并。
