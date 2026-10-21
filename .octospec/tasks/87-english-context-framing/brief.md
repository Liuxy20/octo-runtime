---
type: Task
title: Issue 87：Context 固定英文格式
description: 将共享 renderer 的固定边界和标签统一为英文，保留业务多语言内容和原有执行语义。
tags: [context, model-input, testing]
---

# 目标

处理 [Issue #87](https://github.com/Mininglamp-OSS/octo-runtime/issues/87)。从当前 octo-runtime 仓库最新 `origin/main@d064cfe` 创建独立 worktree，分支为 `feat/87-english-context-framing`。先规划、可执行性达到 95 分后实施，提交面向 main 的英文 PR。

## 决定权与范围

- 开源使用者需要直接阅读框架生成的模型输入；固定格式由通用 Executor Core 拥有，因此在唯一共享 renderer 修改。
- 调用方显式提交 Context items，业务方仍决定内容、语言、顺序及发送时机；框架不翻译 guidance/payload、不限制模型回答语言。
- 合同内动作只有固定字符串替换及配套测试、文档更新；不得增加业务读取、缓存、过滤策略或控制通道升权。
- CLI、SDK、Provider 共用该 renderer，固定文本统一变化。没有服务装配、进程拓扑、资源所有权或公共 API 变更。

## 关键合同

- 开始边界为 `<--- Context information begins: the following is the current context --->`，结束边界为 `<--- Context information ends --->`。
- guidance 标签为 `Guidance:`，payload 标签为 `Data:`；guidance 缺省或空字符串时仍省略。
- 保留 contexts/context-item 外壳、缩进、换行、item 顺序、namespace/name 白名单、空 Context 行为、递归对象键排序与数组顺序、非 XML 转义语义。
- 保留调用方原对象及多语言值；控制指令继续走独立通道。普通输入、parts、显式 fresh fallback 均复用现有注入路径。
- Run 7 / Context v3 不变；模型可见文本有变化，匹配旧文本的集成必须更新。

## 实施顺序

1. 修改 `packages/octo-runtime-executor-core/src/model-input.ts` 的四个固定字符串及就近合同注释。
2. 更新 model-context/run-context 精确断言，覆盖多语言保留、递归排序、空 guidance、英文 framing 与控制分离，以及主输入/恢复输入和图片 parts。
3. 同步权威 context-input 规则、protocol README 及 mention 示例说明，增加完整英文格式样例和迁移提示。
4. 运行类型、lint、格式、命名、文档/OKF 与完整自动化测试，核对 diff 和旧格式残留；结果写入 journal，按授权提交、推送、创建 main PR。

## 范围外

不翻译业务数据、既有历史记录或整个公共文档集；不变更 Schema、Provider 行为、会话策略、CLI 部署或发行版本。真实模型语言遵循率不属于固定字符串合同的验收。

## 验收

| 条件 | 证据 |
| --- | --- |
| 全部固定边界及标签英文 | renderer 完整字符串断言、旧格式引用扫描 |
| 多语言 guidance/payload 原值保留 | renderer/run 编译断言、原对象不变 |
| 过滤、排序、序列化、空项及控制分离保持 | model-context、run-context、context-extension/envs/mcp 等现有回归 |
| 主输入、恢复文本及 parts 正确注入一次 | withModelContexts 精确输入断言与 Core native/canonical 测试 |
| 当前合同及样例一致，迁移影响明确 | context-input、protocol README、mention 指引、docs:check、OKF lint |
| 工程检查通过 | pnpm typecheck、lint、lint:names、format:check、test:suites |

规划阶段尚未执行验证；评分见 [可执行性评估](assessment.md)。

## PR 90 CI 后续处理

远端已合并 main 的 #53（318b0f2），本地快进至 2cdf0ae 后继续处理 Windows CI 失败。Run 39591260941 的关闭测试尾日志存在、执行器 incomplete 仍返回失败、进程回收及清单断言通过，仅跨进程时间戳顺序断言失败。

本次只修改测试与 fixture：在父进程调用 taskkill 前同步追加 trace 标记，按共享文件事件顺序核对 logging.close.finished 先于 tree.cleanup.started；对子进程 trace 注入一分钟偏移，证明顺序校验不依赖父子时钟。预算、日志、失败保留与进程存活断言继续有效。生产关闭路径和 CI 门禁不变。

可执行性 98/100：失败位置、因果链、窄范围修改与远端 Windows 验证入口明确；本机 macOS 无法替代 Windows 结果。先运行构建及本地相关测试，再推送同一 PR 并等待原生 Windows CI。
