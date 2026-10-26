---
type: Task
title: Issue 59 Windows IPC 夹具失败清理与回归迁移
description: 最小修复测试夹具的初始化失败路径并补齐 UTF-8 和容量回归。
tags: [ipc, testing]
---

# 目标与边界

基于 `main@167205c`，按 [Issue 59](https://github.com/Mininglamp-OSS/octo-runtime/issues/59) 的实测范围修复。用户授权本地实施与验证，并在验证后授权提交 PR；不包含合并或发布。

- 业务目标：Windows 原生测试的监听错误正常拒绝，部分初始化不遗留所属资源，历史传输回归有当前等价测试。
- 决定权与显式输入：测试拥有临时目录、端点、relay 和 fake Provider；平台端点仍由现有 fixture 选择。产品调用者不增加输入或清理责任。
- 合同内动作：测试初始化前登记清理；失败立即执行同一清理；保留原错误并聚合真实清理失败；复用现有 Kernel/worker 与 relay。
- 越界动作：修改公共 SDK、类型、Schema、默认容量/超时；恢复 daemon API；新增运行时依赖；更改真实用户配置或活动 Runtime。
- 拓扑保持：测试进程直接构造 Kernel，Kernel 创建已有 worker；relay 只转发测试流。其他 SDK/Extra 产品不受影响，无公共 API 删除或迁移。

## 实施范围

1. 删除 `host-stream-transport` 未使用的 socket helper 与 imports，保留最大合法帧及兄弟请求断言。
2. 修复 `kernel-fixture` 与 `kernel-relay` 的部分初始化清理、监听错误拒绝。clients ACK 测试复用已有 relay，消除重复有缺口的夹具。
3. 回归真实 Kernel/worker 大 UTF-8 与并发兄弟调用；接收拆包及按字节超限；初始化失败的原错误和资源清理。
4. 仅当 UTF-8 测试证明测试 relay 的逐 chunk 解码破坏字节时，在该 helper 内修复解码；不修改产品传输。
5. 扩展回归发现 worker 强杀测试可能在流断开后、监督器处理退出前立即清理。仅补测试内的恢复屏障，沿用既有监督器测试方式，不修改产品回收逻辑或忽略 incomplete。
6. PR #189 的 macOS Node 24/26 CI 暴露约 40 MiB 原生超限输入受机器吞吐影响而查询超时。容量断言改为客户端受控双 chunk 输入，随后恢复真实 IPC 验证下一连接；不提高超时，不改产品代码或跳过测试。

## 验收

- 新失败路径回归先在未修复 helper 上失败，再修复通过；不吞异常、不跳过或改产品时限。
- 大 UTF-8 精确相等、单一完成、兄弟调用完成；跨字符 chunk 保真；容量错误按当前边界断言。
- Windows 相关回归、格式、lint、类型检查与适用知识文件检查通过；全仓构建若受已有可选依赖限制则明确记录。
- 维护历史行为映射与本轮结果；检查 diff 仅触及测试和任务记录。macOS/Linux 与真实模型未验证则明确写出。
