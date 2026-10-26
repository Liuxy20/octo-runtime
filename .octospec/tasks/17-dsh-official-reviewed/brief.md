---
type: Task
title: Issue 17 官方 DSH Client 重新接入
description: 撤回旧实现，以官方 HarnessClient 和版本锁定补丁重新交付独立 Adapter。
tags: [dsh, adapter, testing, lifecycle]
timestamp: 2026-10-25T00:00:00Z
---

# 目标与基线

用户最新决定：撤回 #173，关闭 #174，基于最新 main 重新提交 PR，并修复之前的 review。回滚 #175 已于 2026-10-25 合入 main@a35aeae，保留通用诊断、命名测试和 Windows 验收超时预算；#176 已迁移到该 main 基线。迁移后全树与已审查的 55bab98 一致，再更新本轮基线文档，功能代码没有变化。

npm 于 2026-10-25 核对的最高版本仍为 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3`，标签 `next`，与本机 Desktop CLI 同版。使用官方公开 HarnessClient 的 initialize、resumeSession、setWorkingDirectory、prompt、request、subscribe、close；没有自建 RPC Client、替代 sink、进程代理或私有字段访问。

# 决定权与范围

业务方提供模型、Provider、目录、Home、profile、权限和显式 Provider session。Adapter 仅映射本轮输入和原生轨迹，不补历史、不默认 reset、不安装 Provider、不修改认证或 GUI。CLI 与 SDK 经同一 Adapter；Channel Gateway 保持公共事件投影，不解析 DSH。

Provider 兼容边界：不把 Provider 内部实现习惯升级为 Runtime 的强制协议。DSH 原生 seq 只用于按会话去重，允许非零起点和向前跳号，不因跳号单独判失败；未映射的原生事件类型忽略。Core 独立生成 Runtime HostFrame seq，两种序号不耦合。强制校验限于正确关联和映射结果、确认执行终态、资源预算与清理所需的合同。仍需 receipt、root turn/end、非空 committed answer、session/wait 和清理完成证据；明确失败、必要证据缺失或矛盾、传输中断和资源超限不能伪装成功。验收应同时证明原生跳号可正常完成、HostFrame 序号连续，以及真实失败仍被正确报告。

后续 review 的大小误判修复：原始帧字节数只在 Protocol 解码前计量，不对解析后的通知重新 JSON.stringify 再套用原始预算；科学计数法的表示展开不应导致合法通知失败。投影后的 CanonicalEvent 继续使用现有 DriverQueue 的独立事件和队列预算。启动 args 单项最多 4096 UTF-8 bytes，超量在版本探针前报 DSH_CONFIG_INVALID；现有启动合同只允许无参数入口或 Node 加单个入口路径，因此受支持的显式 args 总量也不超过 4096 bytes，不新增任意多参数启动方式。订阅 false-filter、内部捕获 producer 错误与同目录恢复合同保持，分别增加官方 SDK 行为和目录别名/错误子目录回归。

官方高层 run 保留整轮数组，本接入使用低层订阅同步投影到已有有界 DriverQueue，回调返回 false，避免额外无界队列。新会话才发送控制指令；原会话先恢复再设置本轮目录，失败不能另建替代。

# 两项 P1 的修复设计

原版官方库缺少进程树所有权及解析前行预算，因此通过 pnpm patchedDependencies 提交两个与精确版本绑定的补丁，而非另写客户端。补丁与完整 MIT license、变更说明一同保留在发行物。

Client 补丁增加四个可选输入：detached、createProcessCleanup、rawMessageMaxBytes、maxSessionRelationships。spawn 捕获本轮清理函数，close 的同一 Promise 在 shutdown 后调用现有 Adapter SDK createProcessCleanup；POSIX 独立进程组不受 leader 已退出影响，TERM/KILL 后确认组消失才允许终态。finally 关闭 transport、订阅和输出流；失败不能报告清理成功。Desktop 入口仍只 execve，保留官方拥有的 PID/stdio。

本轮独立 Standards/Spec 审查还复现了 SDK stderr 和关系表的无界路径。补丁将未换行 stderr 后缀限制为 16384 个 UTF-16 code unit（最多 49152 UTF-8 bytes），尾部每行最多 1024 code unit、总量最多 65536 UTF-8 bytes；仅保留诊断后缀，不暴露原文。SDK 的 lineage 在 filter 前最多登记 128 项，每个身份最多 191 字符，超量关闭本轮并返回 STREAM_QUEUE_ITEMS_EXCEEDED。版本探针保留原始 IO cause、安全 errno、数字 exitCode，并在回收失败时聚合首错与清理事实。

Protocol 补丁在 StringDecoder、拼接和 JSON.parse 前按原始分片计数字节，检查所有响应和通知，并覆盖尚无换行的数据。CR 计入预算，LF 分隔符不计入；恰好上限接收，超过一字节即拒绝。拒绝清空缓冲、移除 reader、拒绝 pending 和后续 request，以稳定 PROVIDER_MESSAGE_TOO_LARGE 通知 Client 和 Adapter。原有 RPC 编码、方法、订阅和错误类型继续使用官方实现。

旧 review 的其他项：命名测试在回滚中修复；官方 subscription.close 同步拒绝 pending next，故 finally 的等待有确定退出路径并有回归；打包依据实际 require.resolve 路径核对入口，不再固定 lib/index.js 布局。回滚后续审查要求保留公共诊断，因此 #175 的 703b69e 保留 context.log、通用安全字段、Core reason_code 和 QA CLI 配置及错误诊断，并增加独立于 DSH 的回归；本次新集成以该提交为基线。

# 实施准备度与验收

本轮设计自评 95/100：固定 API/版本 20/20，所有权方案 19/20，字节边界方案 19/20，发行补丁及许可 18/20，回归与真实验收计划 19/20。依据为精确 npm 源码/类型、既有进程清理合同和可执行 fixture；这是设计准备度，不是测试完成率。补丁原型与边界回归同步推进，未将旧方案评分或旧验收冒充本轮通过。

验收包括：超大握手响应、分片 UTF-8、无换行、恰好字节上限、多行同分片；正常/异常 parent exit、忽略 TERM 的工具、兄弟隔离、清理失败和晚到取消；公开 Core 与直接 Adapter 两条调用；真实 Desktop 新建/续聊/工具/取消/恢复；空缓存离线安装后的公开 Adapter/SDK/CLI；真实 im-test SDK/CLI 群聊与浏览器已有好友 DM。记录每次实际命令、提交与限制，先 verified-review，再以回滚后的 main 为固定点进行 Standards/Spec 独立审查。

原生 Windows DSH 尚未验收，POSIX 组回收证据不推广到 Windows；Windows taskkill 仍受父进程先退出的树枚举限制。非 default actmode、逐轮 MCP、交互审批和实时 token 通知仍不支持，按已有合同明确拒绝或说明。DM 不创建好友关系，只使用已有关系。
