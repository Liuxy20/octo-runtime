---
type: Review
title: AgentEnv 直传实现审查
description: 记录标准与需求双轴审查、测试和验证脚本的独立审查及问题复验。
tags: [adapter, protocol, review, testing]
---

# 范围与方法

实现初始基线 d5aeae707fcda0b138b360136f164c085c9a5e87，提交前整合 main 4d7e272d1bb30957c815410f68758a9d2445d708。按 code-review 的 Standards/Spec 两轴独立审查，主 Agent 按 verified-review 顺序检查实现与实际运行；另由子 Agent 定向审查测试 helper、JS 验证脚本、子进程入口和包外公开 SDK。

重点追踪信封所有权、配置消费方、默认值、目录和权限拒绝、预算配置时点、可信连接隔离及失败后的清理事实。锁文件和生成类型不做人工作用审查，分别通过依赖构图和 schema 生成验证；格式化与 import 重排不视为功能变更。较大的 fixture 删除主要是旧执行计划合同移除，保留结构边界并在手动专项验证已移到 Adapter 的负例。

# 已发现并修复

| 问题 | 证据及修复 |
| --- | --- |
| 准备校验迁入 Adapter 后被记为清理不完整 | SDK 只为尚未启动 Provider 的纯准备失败提供本次 context 证据；Core 继续严格检查真实 iterator/Provider 清理。手动专项验证准备拒绝 cleanup=complete、跨调用复用同一 Error 的 Provider 失败 cleanup=incomplete |
| OpenClaw 请求克隆丢失宿主连接选项 | 克隆后重绑本轮可信选项；并发可信选项隔离，信封不变 |
| 读取测试 helper 偷补条目、Kernel helper 覆盖审批配置 | 删除 itemBean；显式构造与纯读取分开；非法覆盖信封先拒绝，Kernel full_access 仅作为测试调用方基线，显式模式优先 |
| 包外 fixture 导入私有 SDK | 发行消费者使用公开 /adapter-sdk；内部模块闭包测试保留私有 SDK 依赖，分别验证两种装配路径 |
| Codex 常驻 writer 误用 128 项启动等待预算 | 恢复 stdin-writer 既有 4096 项、64MiB 和独立控制预留；保留 256/512 审批和 EPIPE 首因断言 |
| Grok/OpenCode 外层物化默认信封 getter | 外层继续返回独立副本；检索其他 Adapter 包装并加入逐 Harness 手动 mutation 回归 |
| 外层 Provider 探测先于目录校验和预算配置 | OpenCode 在 probe 前做纯准备及配置 watchdog；Grok 纯校验失败保留本次准备证据，Provider 操作失败不能伪装成准备拒绝 |
| 验证 JS 旧字段让故障分支未到达 | 迁移动态 approvalMode、Windows cwd、私有 namespace、子进程导入和预算接线；保留原生字段与进程回收断言 |

# 最终复验

Standards：0 项剩余硬性问题，0 项需处理的判断性问题。Spec：0 项剩余问题。测试和验证 JS 定制审查：0 项剩余问题。所有问题均保留反例断言，未通过降低审批容量、删除清理断言或调大生产超时取得通过。

context-fixtures.json 超过 1500 行变更，人工重点抽查旧计划块删除和保留的结构边界；已识别配置负例在手动 Adapter 专项中逐项执行，未消费材料不再假称 Adapter 校验。锁文件、生成类型和纯格式化不重复做人工作用审查，已通过构建、schema/协议回归及离线包外安装覆盖相应风险。

最新 main 整合后默认全量 1516 项：1455 通过、61 跳过、0 失败；专项与包外验证见 [validation.md](validation.md)。无未解决阻断，允许按授权英文提交和创建目标 main 的 PR；不启用自动合并。
