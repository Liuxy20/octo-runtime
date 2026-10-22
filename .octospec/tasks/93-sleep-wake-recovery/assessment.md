---
type: Review
title: Issue 93 规划可执行性自评
description: 按可实现的合同、源码依据、调查分支、验收和交付门槛评估准备度，公开剩余不确定性。
tags: [architecture, testing, lifecycle, channel]
timestamp: 2026-10-22T00:00:00Z
---

# 结论与评分口径

本计划工程可执行性自评 **95/100**，达到用户要求。它衡量工程师是否能按步骤开始调查、实现和判定验收，不代表成功概率、产品质量、95% 测试通过、独立评审或根因已经确认。reason12 部署语义与 Kernel 执行失效尚缺现场证据；二者是实施/关闭门槛，不因评分达标而豁免。

| 维度 | 满分 | 得分 | 依据 | 扣分 |
| --- | --- | --- | --- | --- |
| 需求、范围与责任 | 20 | 20 | CLI/SDK 同时覆盖；拓扑、资源、所有权、非目标与用户追加日志范围明确 | 无 |
| 行为与接口 | 20 | 19 | 5/10/15/15 秒、暂态/终态、首次离线、close、logs命令/stdout/背压/三平台策略均有合同 | 状态 sink 类型及包外兼容需实施验证 |
| 故障分析与调查路径 | 20 | 18 | F01-F17 源码定位；H1-H6 四组探针；reason12 分支与阻塞条件明确 | 部署 reason12 与事故 Kernel 根因各缺一份决定性现场证据 |
| 阶段、依赖与回退 | 15 | 15 | M0-M6 每阶段有产物、文件、退出门槛与失败处理；不依赖未合并分支 | 无 |
| 验收与证据 | 15 | 14 | A01-A27、S01-S14、双模式证据、真实合盖/自启、未知无重跑、状态日志专项完整 | 长时、三平台及真实 Provider/IM 证据尚未执行 |
| 文档与规则追溯 | 10 | 9 | brief/context/分析/设计/计划/验收/索引/journal；规划检查独立记录 | 完整本地知识 lint 有既有 docs 断言冲突，未在本任务修改 |
| 合计 | 100 | 95 | 调查和实现都有明确下一步，不以未知假设冒充已定结论 | 剩余5分保留 |

# 自查修正

- 已将报告的两次重启现象与“socket 监听失效”的假设分开；M0 必须先对原 endpoint 取证。
- 未把 SDK 支持缩减为 CLI 测试，也未把旧 Run 续流与新请求恢复混为一谈。
- 用户追加决策覆盖旧规则的 30 秒退避目标：采用 5/10/15/15 秒，保留服务器 Retry-After。
- 用户明确 logs 只看 Extra 工作状态。增加独立事件/字段白名单，排除聊天、具体 session/run、模型/工具内容；真实 stdout 与状态镜像共同验收。
- 已核查 Windows Task 不支持原生 stdoutPath；采用宿主状态镜像而非只加 launchd/systemd 重定向。
- 已识别共享 RuntimeLogging 的 callback 不能复制到 Worker workerData、worker NDJSON stdout 不能混日志两个实施风险。
- 首次离线后台恢复会改变当前 channel 规则；此为 Issue 明确目标，实施必须同时改旧断言和文档，不保留相互矛盾的合同。

# 关闭 P0 的硬门槛

1. 单 owner 的一小时事故具备明确环境和两层失败定位；若受环境限制未复现，不能声称事故已确认解决。
2. reason12 的安全恢复依据成立；若协议不区分 owner 替换，需要相关服务合同改造及验证，不能仅终态保留后关闭。
3. CLI 与原生 SDK 各自新 direct-Kernel 和 IM 请求通过，恢复不要求手动重启/reinitialize。
4. 未知旧 Run 不自动重跑；接管循环、重复副作用、资源累计、健康假报均为阻塞项。
5. macOS 真机、自启、重复/长时完成；Windows/Linux 未验项按 Issue 要求公开具体缺口和后续责任，不能推断通过。
6. `channel-gateway logs` 可读取真实 Extra 状态 stdout 镜像且无聊天信息；15 秒重连目标有确定性与实际时间线证据。

# 本轮实际检查

已读取 Issue 全文、标签及评论，fetch 最新 main，创建新 Git worktree，核查相关源码和规则。由于当前聊天的 cwd 是多个仓库的父目录，桌面 managed-worktree 工具返回 `Not a git repository`；随后在 octo-runtime 仓库内用标准 `git worktree add` 成功创建。原 main checkout 未被修改。

上游 OctoSpec OKF 格式校验已通过，最终文件数见 [context.yaml](context.yaml)。仓库 `.octospec/scripts/lint.py` 在未改动基线就失败，唯一输出为 `已退出的文档目录仍存在: docs`；该脚本会先遍历所有 frontmatter、规则索引和本地链接，再汇总错误。最终仍需检查输出没有新增错误，不得写成完整 lint 通过。`git diff --check` 检查文本差异；新增未跟踪文件另检行尾空白。

未运行产品构建、单元测试、真实 Provider/IM、系统服务、睡眠/断网或重启操作。本次只有规划文档，未 commit/push/PR，未修改运行中服务。
