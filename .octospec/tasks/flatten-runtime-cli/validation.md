---
type: Validation
title: Runtime 顶层 CLI 实际验证
description: macOS Node 26 的构建、回归、离线发行验收与未验范围。
tags: [runtime, lifecycle, testing]
---

# 实际验证

基线 47f0624f，当前 worktree 修改态；Node 26.13.0、pnpm 11.25.0、macOS。方案可执行性 96 分与以下结果分别记录。

- 冻结锁文件安装及全 workspace 构建通过。
- ESLint、命名检查、根 TypeScript 检查通过。
- 默认全量测试：1608 项，1547 通过、61 显式跳过、0 失败。
- 双语 docs 检查和 4 项共享 SDK 示例通过。
- octospec lint：691 单元、20 规则、3275 链接通过。
- 离线 npm tgz 安装/卸载、公共类型编译、SDK 本地 Kernel、恢复探针、顶层 run 启动后的 status/list 与退出确认通过；卸载保留 Home。
- 回归证据：首轮暴露 Commander 提前显示未知命令帮助的问题，新增未知根命令校验后通过。临时移除该 guard，旧前缀拒绝用例失败；恢复后重跑通过。没有保留突变。
- 服务定义 argv 的 Linux/macOS/Windows 参数构造断言通过；本次未运行真实 Windows/Linux 服务管理器或真实模型。现有跨平台 CI 结果在 PR 中另记。

## 发布和迁移边界

没有发布 npm 包或修改用户系统服务。旧 executor-kernel 语法直接拒绝；已有系统服务按双语文档显式 stop/install/start 更新 argv。服务 ID、IPC 地址、Home、配置及 status JSON 键保持。
