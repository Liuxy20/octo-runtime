---
type: Task
title: Issue 192 CLI 全局 Extra 自动发现
description: 同环境 npm/pnpm 全局包发现、确定性去重和延迟加载。
tags: [cli, extra, installation]
timestamp: 2026-10-27T00:00:00Z
---

# Issue 192：CLI 全局 Extra 发现

基线：`origin/main@a7c33b64064b8a54f59f70178873983ba143c1b3`。交付前同步 `origin/main@b424e1e`（#195，仅文档）；独立 worktree、分支 `codex/192-global-extra-discovery`；交付英文 PR 到 main，不自动合并。

## 目标与归属检查

企业通过 npm/pnpm 独立发布 Extra，安装后 CLI 按名称识别，无需逐 Home 重复维护模块声明。包安装和启用由操作者决定；CLI composition root 读取安装元数据和 Home 配置，SDK 继续原生 import。显式输入为当前 CLI 安装入口、两份 manifest 和已安装包元数据。合同内动作是发现、确定性去重和按需加载；不安装包、不处理 registry 认证、不扫描 Adapter、不替宿主决定业务配置或启动，不热替换运行实例。

服务拓扑不变：CLI run 进程直接构造公共服务，Kernel worker 只装配 Adapter。后台服务保留经当前入口 realpath 验证的安装入口路径，让 pnpm 全局组来源在后续启动中保持可识别。SDK 公共 API、Extra 资源所有权和关闭行为不变。

## 实施步骤与关键合同

1. CLI 新增独立发现模块。从当前 CLI 文件与经 realpath 核对的 argv[1] 推导安装来源，绝不执行 PATH 上 npm/pnpm 或合并其他环境。npm 使用对应 prefix/lib/node_modules（Windows prefix/node_modules）与安装 bin 证据；pnpm 旧版使用全局版本目录，v11 使用该环境下有效安装组链接。只扫描顶层直接安装包，不扫描 Runtime 捆绑依赖、虚拟存储中的其他包或陈旧安装组。
2. 名称接受 `octo-runtime-extra-<name>`、`@scope/octo-runtime-extra-<name>`，复用 assertExtraName；package.json.name 必须与安装项一致。仅读元数据，损坏或不可读项诊断并跳过，无法确认全局来源回退 manifest。保留选中包的逻辑安装路径及 realpath，选中时验证来源仍存在，禁止删除后沿祖先目录偷偷加载别的同名包。
3. 先合并内置/Home，再按包名和安装路径的 Unicode 码位顺序排列发现项，按逻辑名称取首项。内置 > Home > 全局；冲突输出选中与忽略来源。显式 --manifest 直接返回，完全绕过发现。重复声明的原有校验保持。
4. 复用现有 readExtra 延迟 load，按原安装锚点执行 ESM import/exports 解析；未使用、被覆盖、禁用项不解析入口、不导入。已选失败给出稳定错误及来源诊断；导出 name 必须匹配。每次目录读取重新发现，运行中实例不热更。
5. 双语 module-loading、CLI README、架构和 Extra 规则同步。说明新插件 extraset/start、来源诊断、局部开发回退及 pnpm 直接 real store 入口限制。

## 验收矩阵

- 单测：npm/pnpm 混合与 PATH 干扰、自定义前缀、scope、无 scope、pnpm symlink/有效安装组、Windows 路径推导、局部开发、不可读/缺失目录、无效元数据、冲突稳定顺序。
- 加载：import 条件优先于 require，包 exports 隐藏 package.json 也可发现；同名候选无副作用；名称不匹配、包移除、破损未使用和禁用项；显式 manifest 不扫描；后台服务保留有效安装入口。
- 仓外发行：正式打包脚本生成 tgz，独占 npm prefix 和 pnpm home 实际安装 Runtime 与测试 Extra；实际 CLI 配置/run、模块标记、来源、独立组及重读新增/删除验证；不使用真实用户全局环境。
- 检查：lint、lint:names、typecheck、相关测试、全量现有测试、文档校验和 diff 自审。线上 IM/模型不在改动范围内，不调用真实业务接口。

## 可执行性评估：97/100

需求/责任 20/20；代码路径与加载合同 20/20；来源识别与冲突规则 19/20；测试可执行性 19/20；交付/回退 19/20。无待定产品决策，可开始实施。扣分来自包管理器版本布局演进和本机 macOS 无法原生验证 Windows；用纯路径测试、CI 及明确回退降低风险，不将路径测试宣称为 Windows 真机验收。该分数表示实施准备度，不表示验收通过率。

资料：[npm 安装布局](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)、[pnpm 全局安装组](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/global-packages.md)。最终支持范围以安装测试证据为准。
