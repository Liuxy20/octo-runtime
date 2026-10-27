---
type: Journal
title: Issue 192 全局 Extra 发现实施与验证
description: CLI 来源识别、延迟加载、包外 npm/pnpm 安装证据与已知验证边界。
tags: [cli, extra, installation, verification]
timestamp: 2026-10-27T00:00:00Z
---

# Issue 192 实施与验证

规划见[brief](../../tasks/192-global-extra-discovery/brief.md)，实施准备度 97/100。初始基线 main@a7c33b6；交付前同步 main@b424e1e 的 #195 文档更新。按用户要求提交 PR 到 main，不自动合并。

## 实施与自审

- CLI 独占全局发现；根据当前安装入口验证 npm prefix 或 pnpm 全局版本 5/v11 活动组，不执行 PATH 上的包管理器、不合并其他环境。
- 发现只读元数据；名称复用已有校验，先按内置 > Home > 全局去重，全局同名按包名/安装路径确定性取首项。所有冲突报告保留与忽略来源，manifest 自身重复项仍拒绝。
- pnpm 仅接受直接安装依赖及活动组链接；自审补充排除 hoisted 传递依赖和陈旧 target，避免扩大安装意图。
- 选中时才解析 ESM exports/import、加载并校验导出名；保留原安装目录和 realpath，删除/改向后拒绝隐式祖先回退。禁用或未启动 Extra 不加载。SDK 无扫描或公开 API 变化。
- CLI 服务定义保留经 realpath 验证的原安装入口；这是 pnpm 共享 store 场景必须保持的部署来源，不新增后台服务或生命周期 API。
- 双语 module-loading、CLI README、架构和 Extra 规则同步；共享 manifest 合并仅增强冲突来源诊断，不改变选择或解析。

## 验证结果

本机 macOS、Node 24.19.0、pnpm 11.19.0。

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check` 和 `git diff --check` 通过。双语检查发现新增 shell 注释语言不同，已统一代码块并复验通过。
- `test/global-extra-discovery.test.js` 与 `test/module-loading.test.js` 共 18 项通过。覆盖 Windows 路径、npm/旧 pnpm/v11、自定义路径、作用域与链接、元数据损坏/权限/缺失、排序冲突、禁用项、无副作用发现、导出名称、删除后拒绝回退、显式清单旁路和安装入口身份。
- 全量 Node 测试串行运行通过：1932 项，1878 通过、54 跳过。首轮默认并发出现 9 项 OpenCode fixture 的 2 秒版本探测超时；并发 4 时仍有 4 项同类超时。OpenCode 单独 25 项通过，完整串行再次通过；没有修改无关 Provider 实现或放宽产品超时。WebUI 35 项通过。
- 正式 `scripts/pack-release.mjs` 生成真实 tgz，在仓库外独占 npm prefix、pnpm home/store 中安装 Runtime 与两个 fixture Extra。npm 和 pnpm v11 独立组均按名发现，实际 ESM import 与插件 initializer 到达，POSIX npm/pnpm 安装的原生启动脚本也通过；fixture 随后主动抛错以验证失败收尾并避免启动系统服务/真实业务。
- 包外验证覆盖 scope/unscoped、两个包管理器共存、PATH 中 pnpm 优先时 npm 来源保持、运行时和 Extra 分次安装、下一次调用识别新增/移除、服务定义保留安装组路径。脚本 `pnpm run test:global-extras <runtime.tgz>` 可复现；CI 在 Linux/macOS/Windows 发行矩阵执行，Windows 另运行专项发现测试。
- octospec 全仓 lint 仍报告 7 个基线文件缺 frontmatter：dsh-upstream-sdk 两份任务文件、systemd-directive-paths 两份任务文件及 2026-10-22-systemd-directive-paths、2026-10-24-124-sass-build-fix、2026-10-26-dsh-upstream-sdk 三份 journal。本次新增文件不增加该错误；未改写无关历史记录。

## 真实边界

包外 fixture 验证的是发现、加载、进入初始化与失败收尾，不宣称企业 loop-daemon 业务成功、系统服务已部署或真实 IM/模型已联调。本机未运行 Windows 原生包管理器；已接入托管 CI，不将路径测试当作真机证据。旧 pnpm 版本 5 布局为 fixture 验证，实际安装证据为 pnpm 11.19.0；未知未来布局及直接 shared-store 入口明确回退 manifest。pnpm 更新中的目录替换不承诺原子部署，操作者更新后重启对应 Extra。
