---
type: Task
title: Issue 312：方案可执行性评估
description: 保留已撤回的规划评分及风险依据，实际实现状态以验证记录为准。
tags: [architecture, extra, lifecycle, testing]
---

# 可执行性评估

**原 95/100 规划评分已撤回。** 初次评估没有充分处理 Codex app-server 的服务生命周期问题，不能将现有行为当作正确架构。该问题已作为 #313 P0 单独登记；用户随后明确暂缓 #313，先实现 #312。以下分项表保留为历史评估，不能引用为当前准备度或上线保证；本次结果见[验证记录](validation.md)。

| 维度 | 得分/满分 | 依据 |
| --- | --- | --- |
| 背景、目标与收益 | 15/15 | 区分嵌入装配成本与 Core 已有能力；两种拓扑的收益和故障代价具体 |
| 范围与决定权 | 15/15 | 宿主/Extra/Core/Kernel 所有权明确；不引入 launcher、单例、数据库、产品默认或 CI 扩围 |
| API 与兼容 | 19/20 | 精确 execution union、运行期互斥、legacy、Home 例外、第三方类型迁移明确；发行导出仍待实际包外证明 |
| 生命周期与容量 | 23/25 | 给出按 receipt 清理证据、观察独立驱动、共享容量、接纳前取消隔离及原 4 秒期限；关键 Core 增量仍须失败夹具验证 |
| 实施顺序 | 15/15 | 五个里程碑有输入、文件、出口；先解决清理证据再集成；#296/#309 合入次序有处理路径 |
| 验收与交付证据 | 8/10 | A01-A16 可逐项执行；操作系统、真实 Provider 与外部宿主环境尚未实测 |
| 合计 | 95/100 | 目标合同清晰，剩余扣分全部有验证出口 |

## 剩余 5 分在哪里

| 缺口 | 扣分 | 关闭条件 | 未关闭时的限制 |
| --- | --- | --- | --- |
| Core 逐调用清理观测是新增能力，现有 iterator 耗尽不能证明清理 | 2 | M1 通过延迟/失败 finally、错误 receipt、拒绝接纳、卡住 next 和兄弟调用隔离；导出类型锁定 | 不宣布 direct 支持，不以全局 shutdown 替代 |
| #296 的 Codex 入口和新 facade 尚未在实际发行物验收 | 1 | M5 对最终 tgz 严格编译并运行公共导入，声明/JS/exports 一致 | npm 接入示例保持目标说明，不宣称可直接安装运行 |
| 原生平台差异缺乏本次实现证据 | 1 | 对最终 revision 分别记录 POSIX 与 Windows pipe、冲突和关闭场景 | 仅报告已测平台，模拟分支不补分 |
| 真实 Provider/Channel 与外部宿主尚未验证 | 1 | 记录真实 Codex、授权测试 Channel 和可用外部宿主的版本及运行/清理结果 | Node/fake Provider 通过不提升为真实端到端通过 |

不通过把未知项改写成“已支持”来达到 95 分。新增 helper 的最终名字属于 M1 的常规实现选择，不能改变“只读、原 receipt、首次清理事实、无全局 shutdown”的行为；若该最小能力不可实现，必须调整设计并重新评分。

## 关键风险及处置

| 风险 | 发现方式 | 处置 |
| --- | --- | --- |
| 复用错 HostRunService.invokeFrames，observer 仍拥有执行 | A09 检查 return 后 Provider 是否继续及 cancel 次数 | 使用独立 submit/pump + 窗口，不透传原 Core iterator |
| 终态早于实际清理，错误返回 complete | A11 延迟/抛错 finally | Core owner 清理凭据；pending/failed 保留 incomplete |
| 接纳冲突时按 invocationId 误取消宿主调用 | A05/A07/A11 强制重复身份和接纳前取消 | 未确认 receipt 仅取消本次 signal，禁止直接路由 id |
| 每 Extra 各建大窗口，实例增多放大内存 | A08/A10 多 scope 总字节/条数计数 | executor 对象级协调器共享中央预算；记录序列化字节而非声称 RSS 恒定 |
| Home 校验被简单删除，控制/日志路径失去保护 | A02/A12 独立目录与失败 bind | direct 分支取消 Home 前提，显式资源仍沿原路径/端点保护 |
| 类型兼容被误写成所有第三方 direct 可用 | A14 包外旧插件/收窄样例 | IPC-only 文档化；内置先全部迁移；公开 TS 迁移成本 |
| #309 合入后出现第二份 client | M1 基线复核及 M3 导入检查 | IPC 只复用合入后的共享实现；不从 issue 旧 worker 文本恢复 worker |
| 专项顺手加入默认测试/pack job | 目标分支 workflow/script diff 与实际 checks | 专项只放 manual 并显式执行；不改默认 selector/gate |

## 当前决策状态

没有需要用户重新选择 direct/ipc 命名、是否保持 endpoint 独占、是否创建新 factory 的待决项，issue 已明确这些要求。当前允许先实现 SDK 合同与本地可控验收；最终公开示例受 #296 的最小导出和实际发行物验收约束。#309 的完整拆包不是本任务前置条件。

本次只创建规划文档并检查知识格式/链接；不执行实现、真实模型或部署，不提交、推送、创建 PR 或修改 issue。
