---
type: Task
title: PR 179 评审修复
description: 按三份评审的代码与原生复现证据处理环境消费者、恢复出口及服务诊断。
tags: [runtime, lifecycle, adapter, envs, installation, testing]
---

# 依据与方案

用户已授权修复并继续原 PR 交付。评审基线为 `6e2f54bc4b13ea56d6225d210baa6fd6c5c6de66`，原 main 为 `8af836068780ebb76581225254ad7bef18cc8170`。本轮已 rebase 至最新 `main@78bb88a`，仅知识目录有冲突，保留上游 DSH 任务与本任务条目；上游依赖改动通过 frozen install 重新安装。

| 评审意见 | 核验及处置 |
| --- | --- |
| Jerry-Xin：合并后消费者仍大小写敏感 | 原生 Windows 对比复现：旧 main 成功，PR 的 MCP/Claude 报 MCP_ENV_MISSING、probe 报 command_not_found、DSH 报 DSH_EXECUTABLE_NOT_FOUND。新增共享只读查询，覆盖 MCP、probe、DSH 和相同模式的 ZCode executable 查找。 |
| mochashanyao：ACP/Grok 最终 spawn 再次引入别名 | 共用逐层环境合并；原生子进程集成回归验证真实接收到高优先级值。 |
| mochashanyao：清理失败永久阻塞 | 同身份存活 worker 原本已重试；保留该行为。leader 消失后增加显式运维确认，备份原记录并以原文 SHA-256 绑定确认；旧确认不能放行新记录，不声称已经验证清空后代。doctor 展示路径，CLI/SDK 提供同一恢复能力。 |
| mochashanyao：POSIX 扩大阻塞 | 持久 cleanupIncomplete 阻塞仅作用于 Windows，POSIX 保持原先 best-effort 回收行为，不在此专项重写 POSIX 僵尸进程管理。 |
| 两份评审：SID 失败误报不匹配 | 查询返回 null 表示未知；原文一致仍可确认，否则 status 为 unknown 并提供原因，不能伪造匹配或误报身份 drift。 |
| mochashanyao：XML 字符串序列化合同缺失 | 公共 JSDoc 和包 README 明确 UTF-16LE BOM，并提供写入示例；不改变返回类型。 |
| yujiawei：P0 原型污染 | 未证实。Object.fromEntries 创建自有数据属性；原生传值验证原型未变。变量名验证已拒绝 NUL/等号；现有合同允许 prototype-like 名称，不新增破坏兼容的名称过滤。 |
| yujiawei：platform 注入及 manifest 升版 | 没有已确认运行故障；不扩展平台参数，不对可选兼容字段盲目升版。为内部存储结构补兼容说明。 |
| yujiawei：30 秒升到 40 秒 | 该值和相应测试在 main 基线已存在，本 PR 没有改变。 |

# 恢复合同

`acknowledgeOrphanCleanup(path)` 代表操作者已停止未归属的工具后代，不代表 Runtime 自行证明整树为空。它拒绝仍存活的原 Kernel、仍匹配或无法验证身份的 worker；只写原文归档与绑定摘要的确认 sidecar，不直接删除清单。下次 open 仅在原记录相同、worker 缺失或身份已不匹配时消费确认，并正常创建新记录。归档保留。清理成功仍走原有删除流程。

CLI 为 `executor-kernel recover --acknowledge-orphan-cleanup --home <home>`，默认不确认，不自动停止服务或扩大杀进程范围；`doctor --home <home>` 只读展示状态与路径。普通启动绝不因重试次数耗尽而丢弃未确认记录。需要恢复的部署应先 stop Kernel 并检查遗留工具；重启机器后仍可通过显式确认恢复。

# 验证

本轮 rebase 前，定向回归 29 项通过；新增 11 项还独立重验通过，包含归档被改写和旧确认不能释放新清单的断言。类型、构建、lint、命名、格式及 diff 检查通过。完整 UI 35 通过；Node 1844 项，1679 通过、95 失败、70 跳过，失败名称与 `main@8af8360` 的 95 项完全相同，相对原基线新增 25 项全部通过。

rebase 至 `main@78bb88a` 并重新安装构建后，29 项定向回归再次全通过，四组原生计划任务矩阵和编码迁移通过；类型、lint、命名、格式及文档检查通过。完整 UI 35 通过，Node 1673 通过、94 失败、70 跳过；最新 main 为 1647 通过、95 失败、70 跳过。没有分支独有失败，基线额外的 2 秒启动超时断言单独重跑通过；新增 25 项全通过，详细证据见[验收](validation.md)。OctoSpec lint 两边均为相同 7 处旧错误。

上一提交的六平台 CI 已通过，但不能作为新提交的 CI 结论。Session 0 控制台编码、离线域控延迟及真实 Codex 白名单行为仍未实测，不记为已验证。

# 5049add 后续评审

本轮核验 Jerry-Xin review `5647527164` 及 yujiawei review `5647509288`，用户授权每 15 分钟检查、集中修复提交推送并评论，直到通过。

| 意见或同类检查 | 最终处置 |
| --- | --- |
| OpenCode 仍直接读 OPENCODE_CONFIG_CONTENT | 改用共享查询；覆盖配置保留 instructions/provider/MCP、独立覆盖优先级及非法 JSON 拒绝，POSIX 不混同变量名。 |
| ZCode 仍直接读 ZCODE_BIN/LOCALAPPDATA | 两处改用共享查询；覆盖显式桌面脚本选择及 Windows 临时目录中的自动发现。这里只验证配置构建和文件发现，不声称执行真实 Provider。 |
| 同类排查：Codex CODEX_HOME | 补齐同类读取；Adapter 固定 Home 环境合并使用共享 helper，不生成大小写别名。覆盖 Windows 最终值与唯一键、POSIX 两个独立名字。 |
| --manifest 是否覆盖恢复清单 | 现有参数选择模块清单，既有 Kernel stateDirectory 固定为 Home/run。保留此合同，在全局及组件帮助、CLI 指南明确说明；前台 Kernel、doctor、recover 共享路径派生，增加同时携带 --home/--manifest 的回归，模块清单保持不变。 |
| 确认 sidecar 遗留 | 消费确认创建新清单、成功回收或正常 close 后清理失效 sidecar，保留归档；清理失败不阻塞新实例。验证失效清理、归档保留与不可删除辅助路径的失败边界。 |
| CLI 恢复是否超范围 | 上轮明确接受显式运维恢复，并已回写简报、规则与指南；此次只补参数说明和路径一致性，不扩展模块清单为运行状态配置。 |
| timeout gate 扫描仍报告 30→40 秒 | 当前 main 及 merge-base diff 均无该项变更；作为工具旧基线归因问题回复，不修改既有超时或断言。 |

完整构建及类型检查通过；Codex 最后修改后另行重建包并运行根 TypeScript 检查。新增 9 项与相邻定向回归合计 38 项全部通过。完整 Windows Node 1846 项，1682 通过、94 失败、70 跳过，UI 35 项通过；失败名称与上一轮完全一致，没有相对 main 的新增失败。四组原生 SDK/CLI 计划任务矩阵和编码迁移均通过。lint、命名、format、docs 检查通过，OctoSpec 仍为相同 7 处基线错误。完整记录见[验收](validation.md)。新提交 CI 单独执行，旧 head 的成功不冒充本轮通过。
