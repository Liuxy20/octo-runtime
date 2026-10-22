---
type: Task
title: Issue 85：Adapter/Extra 双模式装配实施与验收
description: 验证 SDK 无 manifest 原生导入，CLI 双清单合并、来源解析及默认全量发行。
tags: [architecture, adapter, extra, installation, testing]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 实施顺序

M0–M3 已在本 worktree 实施。本地自动化及实际 tgz 隔离安装结果见[实施记录](implementation.md)；真实 Provider/IM 和业务 FDE 产物不在本次验收范围。

| 阶段 | 改动 | 验证 |
| --- | --- | --- |
| M0：依赖与清单 | Kernel 移除具体 Adapter 依赖，核对 Host SDK/Core 无具体 Extra 依赖；CLI 持有全量依赖；现有默认 JSON 迁为 manifest.json 并加入 extras；更新构建复制、发行文件及 lockfile | 依赖闭包、默认 12 个 Adapter 与三个 Extra 声明一致 |
| M1：CLI 合并加载 | 新增用户 Home manifest，合并/来源解析，复用纯 JS ESM resolver；内置 runner 接受已解析的 Adapter 启动快照并在重启时复用；Extra 按名称加载清单中的模块，迁移旧 config.module | 双来源锚点、无导入去重、错误与空集合、显式覆盖、独立服务 |
| M2：原生 SDK 与发行 | 保留既有原生工厂和 worker；只选部分 Adapter/Extra 的包外 fake fixture，未选包物理缺失；实际 tgz 保持默认 App 全量 | SDK 无清单文件、严格类型、invoke/cleanup，CLI 实际发行回归 |
| M3：文档合同 | 本轮已先写双语设计与整体架构约束；实施时对齐真实字段和迁移步骤，保留实际验证状态 | 双语等价、链接和示例校验，规则与实现一致 |

FDE 的复制目录、业务依赖安装与交付流程由业务方处理。库内隔离 fixture 仅证明框架和选择机制，不是交付工具。与最初 #85 相比，统一 Extra 清单及 Home 扩展是用户新增的 CLI 装配需求。

## 验收矩阵

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| A01 | 框架依赖中立 | Core/Kernel/Host SDK 的生产闭包不含具体 Provider 或业务 Extra；共享工具仍可依赖；默认 App 持有完整具体模块依赖 |
| A02 | SDK 原生 Adapter | 宿主 worker 原生 import 子集、serveWorker 注册；Kernel 在宿主进程原生构造；不读、不复制、不生成 manifest |
| A03 | SDK 原生 Extra | 仅 import 所需 Extra 并传给 createExtraService，JSON config 和宿主函数依赖直接传入；不扫描 CLI Home、不自动装配其他 Extra |
| A04 | CLI 统一默认表 | 只有一份 apps/cli/src/manifest.json，adapters 为原 12 项，extras 为三个内置模块；构建、CLI、Playboard 和发行资源均使用同一来源 |
| A05 | Home 扩展 | 默认 ~/.octo-runtime/manifest.json；--home 使用对应 Home；文件缺失无扩展，损坏/权限/格式错误明确反馈；不读取其他 Home |
| A06 | 合并与去重 | Adapter type、Extra name 各自去重；内置优先，同名用户项有诊断且不解析/import/调用工厂；单文件重复键报错 |
| A07 | 两个来源的解析 | 内置裸包从内置 manifest 查找，用户裸包/相对路径从 Home manifest 查找；改变 cwd 不改变结果；来源在合并后保留 |
| A08 | ESM 与平台路径 | scope/subpath/exports、import-only、import/require 双导出选择正确；相对/绝对/file URL、特殊字符与 Windows 盘符/UNC 保持正确 |
| A09 | 显式 --manifest 与空集合 | 显式文件完整替换两个默认来源；旧 adapters-only 文件规范化 extras=[]；空数组不触发全量回退 |
| A10 | Extra 选择与配置 | manifest 列出不等于启用或自启；Kernel 不 import Extra；仅运行启用的目标 Extra；用户配置/业务凭据不迁入 manifest |
| A11 | 旧 Extra 配置迁移 | 旧 module 与 manifest 一致可用，不一致/缺声明明确提示，不静默换模块、不重写 Home；新增配置允许省略 module |
| A12 | 错误与资源隔离 | 缺实际加载模块、坏导出、工厂/协议错误、type/name 不符与重复注册在对应服务就绪前失败并回收；未启动 Extra 缺包不阻止 Kernel |
| A13 | 部分集合独立运行 | 包外 fixture 中仅选部分 Adapter/Extra，未选模块物理缺失或导入即抛错仍能启动、fake invoke、取消并清理；不探测真实 Provider |
| A14 | 重启快照 | worker 替换使用本次启动的已解析集合，修改磁盘清单不隐式生效、不重放 Run；集合更新由显式服务重启应用 |
| A15 | 全量发行 | 实际 tgz 在仓库外安装，统一默认清单和 runner 存在，默认 12 个 Adapter 可加载，三个 Extra 的公开入口及资源可用，不自动启动所有 Extra |
| A16 | 类型和生命周期 | 仅所选包的 SDK fixture 严格编译；共享 invoke、Extra 独立关闭、清理 incomplete、数据库归宿主等合同保持 |
| A17 | 双语与架构 | docs/en、docs/zh-CN 对应页面、JSON/代码示例一致；整体架构包含强制边界；规划行为与当前实现区分 |

## 检查范围

按跨包改动运行 typecheck、lint、lint:names、test:suites、docs:check 和发行相关检查。复用现有 fake Provider、清理和 CLI 服务回归，测试范围随双来源解析及 Extra 迁移扩展，不增加真实模型调用。实际结果与命令记录于实施记录。

纯文档阶段验证 OKF、规则索引、本地链接、双语页面和示例一致性及 diff。既有 OKF 检查脚本仍禁止根 docs，而当前 main 已恢复该目录；检查结果需单列该基线冲突，不能宣称完整脚本通过。

外部 Electron、真实 Provider/IM、原生系统服务真机验收单独记录。本轮不构建业务 FDE 产物，不把 fake fixture 当作实际客户验收。
