---
type: Task
title: Issue 309：方案可执行性评估
description: 给出基于源码核对的 95 分规划自评、剩余 5 分和必须重新评分的条件，不代表实现完成。
tags: [architecture, packaging, release, testing, risk]
---

# 可执行性评估

评估日期：2026-11-05。**方案可执行性自评 95/100**，不是测试通过率、上线成功概率或发布完成度。评估对象为[简报](brief.md)、[设计](design.md)、[实施计划](plan.md)和[验收矩阵](acceptance.md)，不包括未完成代码草稿。

## 分项依据

| 维度 | 得分/满分 | 可复查依据 |
| --- | --- | --- |
| 背景、目标、收益 | 15/15 | 已定位单包安装闭包、client 类型耦合和单产物发布缺口；收益有检查口径，未虚构体积/性能数字 |
| 责任与范围 | 15/15 | 宿主/client/服务分工清楚；按最新 #294/#312 修正 issue 旧 worker 描述；保留直接 Core 与 Extra direct，限制 CI 范围 |
| API、依赖与兼容 | 19/20 | 精确导出清单、元数据生成类型收窄、纯路径抽取、包内 client/protocol 依赖和跨发行物身份边界；兼容表区分同进程身份与跨进程 wire |
| 发布与失败恢复 | 23/25 | 同 tag 两包、先双预检、client 先发、仅补缺包、任一包构建时间恢复、双 integrity/附件、三 latest 和历史 tag 边界明确 |
| 实施顺序 | 15/15 | M1-M5 明确文件、依赖和出口；早期包外安装发现方案问题；原 CI 安装场景保持单归档材料，不隐藏新增专项 |
| 验收与风险证据 | 8/10 | A01-A16 覆盖独立安装、d.ts、身份、生命周期、版本拒绝、恢复、npm/pnpm/global；平台和真实发布权限另列未验 |
| 合计 | 95/100 | 剩余分数全部有关闭条件，方案不存在必须在开发中临时决定的核心发布语义 |

## 规划时剩余 5 分

下表保留规划评分依据。实施后依赖闭包、归档身份、部分发布和本机安装已取得证据，见[验证记录](validation.md)；跨平台、真实 Provider/Electron 与官方 npm 权限仍未核验。不通过改写原始评分宣称上线成功概率。

| 缺口 | 扣分 | 关闭条件 | 未关闭限制 |
| --- | --- | --- | --- |
| npm/pnpm 包内依赖解析、各发行物内部对象身份及跨包类型兼容尚无最终 tgz 证据 | 1 | A02-A04 对最终两包完成严格类型、全传递声明、运行时 ===/instanceof/WeakSet 证据 | 不宣布“独立 client 和共享身份已实现”；失败则调整设计重评 |
| 双包部分发布、双来源构建时间恢复与三 latest 收敛未做故障注入 | 2 | A10-A13 对各中间状态、冲突、未知上传、并发旧版恢复和 dry-run 有完整执行记录 | 不实际发布、不宣称可恢复；不能只改 workflow 后补评分 |
| 两种自包含归档的离线/global 安装在跨平台和严格 pnpm 隔离下未验证 | 1 | A14 在可用平台复验现有 global/Extra/原生组合，明确 Windows pipe、路径和清理证据 | 只声明已测平台；分支模拟不记为真机验证 |
| 官方 npm 新包权限、真实 Provider 与外部 Electron 环境未核验 | 1 | 发布获授权后核对新包权限；用实际可用环境记录真实组合、运行和清理；未执行项保持可见 | 不试发探测权限，不将 Node/fake Provider 结果扩为真实发布/宿主通过 |

这些是实施证据缺口，不是“之后再定”的方案核心决策。不能通过把 not run 改成通过提高评分；只有实际证据可关闭扣分。

## 已消除的规划歧义

- 包名沿用 scope；只有 runtime/client 两个公开 npm 包，protocol 保持私有并随 client 交付。
- 两包同 tag、同版本，runtime 内置同版本 client/protocol；两种发行物复用同一源码，不发布第三个 protocol 包。
- 普通业务只用 client；服务工厂和直接 Core 仍在 full；#312 direct 不被改为 IPC。
- npm 非原子发布：client 先发，双预检避免已知冲突下产生新半成品，恢复只补缺项，latest 等待双包/双附件完整。
- 完整 SDK 单 tgz 离线能力保持；两个归档分别在空缓存 npm/pnpm 环境验收。
- npm 版本不等不自动拒绝，兼容范围只列可验证组合；非 IPC v1 的 status 明确拒绝，没有新协商协议。
- 新双包发行不改写历史单包 tag；新增专项不变成默认 CI 检查。

## 撤回评分的条件

发现以下任一事实必须重新评分并修订计划：client 仍需 Core/Host 等声明依赖；发行物内部身份只能靠全局 Symbol 补丁维持，或两份发行物维护不同源码实现；严格 pnpm/global 单归档安装无法正确解析依赖；恢复不能保持已发归档 SHA-512；必须新增 CI job/gate 才能完成设计；或最新 main 出现与本边界冲突的架构改动。不得为维持 95 分掩盖阻塞。

本次规划不要求用户重复决定 issue 已明确的“两个包同批发布”。用户已授权按更新后的内置发行设计开始实施。

## 规划阶段检查（历史记录）

以下仅描述用户授权实施之前的规划阶段；最新构建、测试和审查结果见[验证记录](validation.md)及[两轴审查](review.md)。

- 5 份任务 Markdown 的 YAML mapping、type/title/description 非空字符串、tags 列表，以及 context.yaml 的 planning_only 状态均已检查通过。
- 全库 `.octospec/scripts/lint.py` 通过：654 个 OKF 单元、20 条规则、3960 个本地文件链接。系统 Python 缺 PyYAML，实际通过 `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` 在临时依赖环境运行，未修改仓库依赖。
- `.octospec` 的 git diff 空白检查通过；相对 origin/main 的 `.github/workflows` diff 为空。当前未提交，没有本轮远端 check 列表，不把本地检查记为 GitHub CI 通过。
- 本轮未继续修改代码或执行产品构建/测试；此前未完成代码草稿仍保留，先前 build 因 PathLimits 类型引用缺失而失败。该问题留在实现阶段处理，本轮不修复、不掩盖，也不计入规划验收通过。
