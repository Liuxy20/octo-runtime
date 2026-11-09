---
type: Task
title: Runtime CLI 生命周期命令平铺
description: 删除 executor-kernel 子命令前缀，以顶层命令管理唯一执行服务。
tags: [runtime, lifecycle, architecture, testing]
---

# 目标与授权

用户要求直接使用 `octo-runtime start / run / logs`，新开 worktree、按 octo-spec 达到 95 分可执行性后实施，提交 PR 并合并 main。该授权覆盖本任务简报及必要命令、文档和回归修改，无待决产品选择。

## 关键合同与责任

- CLI 是唯一执行服务的运维入口，将 install/uninstall/start/stop/restart/run/status/logs/recover 全部放在根命令；旧 executor-kernel 路径明确拒绝，不保留别名或转换层。
- 产品目标是去掉多余命令层级，决定权在 CLI；SDK、Kernel IPC、服务身份和 Home 数据不变，不删除 Kernel 概念或公共包路径。
- root status 保留现有聚合 JSON 结构，doctor/adapter/playboard/version/help 继续可用。
- install/start/restart/run 的 Home 准备、组件锁、就绪确认及前台关闭语义保持；logs/help 不加载 Adapter 或启动服务。
- 生成的系统服务 argv 必须直接执行 run，继续使用原服务 ID、Home、锁与所有权记录。已有旧 argv 服务需显式重新 install 刷新定义，文档说明；不自动修改其他服务。
- 参数和帮助、诊断恢复建议、发行验证脚本、SDK 外部消费者说明同步。历史任务/日志保留原事实。

## 范围外

不改变调用协议、环境绑定、Provider 行为、Gateway 命令、服务名称/文件布局或 CI 矩阵，不加入旧 CLI 兼容层。Dependabot 升级在各自 PR 独立合并。

## 验收

1. 顶层生命周期命令可解析；全局参数可放在命令前后，重复/错配参数拒绝。
2. 旧前缀被拒绝，且帮助/版本与无效命令不创建 Home 或访问服务管理器。
3. install/start 的服务 argv 是 `<cli> run --home …`；身份、配置、日志与退出码行为保持。
4. 前台 run 真实启动本地 IPC，可通过 status/list 观察并在信号后确认退出；不依赖真实模型账号。
5. 更新 CLI/生命周期/日志/恢复/发行测试、中英文现行文档及用户可执行诊断提示。
6. 运行构建、lint、命名、类型、全量测试、docs 检查、发行验收与 octospec lint；记录实际执行与未验范围。PR 通过 CI 后合并。

## 实施顺序

先改命令树与分派，再改服务 argv 和诊断；同步调用方、现行文档与回归；验证、审查、提交 PR、等待门禁合并。
