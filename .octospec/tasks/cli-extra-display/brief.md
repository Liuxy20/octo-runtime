---
type: Task
title: CLI 与 Extra 命令统一展示
description: Commander 命令树、Extra 完整配置子命令、文档与全局安装。
tags: [cli, extra, documentation]
timestamp: 2026-10-27T00:00:00Z
---

# CLI 与 Extra 命令统一展示

基线：`origin/main@aa16c894b2b2`，分支 `codex/cli-extra-display`。

## 目标与责任

用户要求采用接近 Cobra 的统一命令体验：根目录按实际发现的命令列出名称和用途，不再展示 `<extra-name>` 模板、独立 namespace 列表或重复 Usage。此需求属于 Runtime CLI 的产品展示和参数解析，不改变 SDK、Kernel、Extra 服务或业务配置。

采用 Commander.js 承担命令树、参数解析及帮助排版；Extra 保留现有声明与动态加载机制，由 CLI 适配为子命令。根帮助只读模块元数据，所选 Extra 的自有命令才加载 `/commands`。普通离线生命周期不依赖业务命令模块。名称与说明来自有效目录，不由帮助渲染器按业务名称分支。

## 范围与验收

- 根帮助只有一份 Usage、Available Commands 和 Flags；实际 Extra 与内置命令统一列出且有用途说明。
- 组件的服务命令和自有命令合并展示；嵌套帮助、必填参数、示例、全局参数层次一致。
- `help <command>` 与 `<command> --help` 指向同一命令；帮助不写配置、不创建服务、不调用 handler。
- 保留 Home/manifest 来源选择、凭据错误脱敏、JSON 和离线控制行为；配置命令不支持 profile。
- 完整声明通过 `<extra> extraset/extraget` 读写；顶层同名入口隐藏兼容。删除内置 config set/get 与通用 configCommands 生成器，业务子命令归 Extra 声明。
- 根帮助恢复版本、commit 和 build 信息，version/--version 同时保留完整元数据。
- 根命令按 executor-kernel、channel-gateway、channel-wecom、webui 优先展示，仅展示有效目录内的命令；其余命令按名称排序。
- Extra 内先列公共命令，前六项固定为 install、uninstall、start、stop、restart、run；其余公共命令之后按声明顺序加载业务命令。
- 帮助中的 Examples 独立放在 Usage 后；宿主提供通用操作示例，插件提供自有命令示例，根帮助不为示例导入插件。
- extraset 示例使用 Bash/Zsh `<<<` 加完整 JSON，并带上有效目录中对应的 module 以标识用途；配置示例由目录的可选 configExample 提供，不作为业务默认值、不读取已存凭据，损坏目录不能阻断离线配置修复。
- docs 中英文 CLI 入门、Extra 指南及插件中英文 README 同步新命令；Gateway/WeCom 完整声明列出 model/effort，紧接说明两者省略时使用 Harness 本身默认值。
- 回归动态第三方扩展、显式清单替换、加载隔离和既有 CLI 行为；构建、类型、lint 与相关测试通过。

服务仍由 CLI 当前服务进程原生构造；本任务不新增进程、执行实现或生命周期公共接口。用户已授权将本 worktree 构建的 npm 包安装到当前全局环境，并于 2026-10-27 授权更新最新 main、提交、推送、创建 PR 和按仓库门禁合并到 main；不发布 npm。

提交前已同步 `origin/main@5c0d2c6`，无冲突；原始需求基线仍为 `aa16c894b2b2`。

## 提交前本地审查

范围为当前 worktree 相对基线的全部已跟踪改动与新增文件；不逐行审查锁文件及构建产物。按职责与需求逐文件核对命令解析、懒加载、离线配置、错误输出、帮助元数据/排序/示例及迁移文档，并实际运行参数边界与配置写读。根 README Quickstart 使用 channel-gateway，分别说明 configure 按 ID 更新与 extraset 完整替换；示例核对真实 CLI 和配置 Schema。结论区分已验证行为、未解决缺陷及仅能由 CI 覆盖的平台；不以历史通过替代本次验证。
