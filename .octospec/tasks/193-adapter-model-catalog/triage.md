---
type: Task
title: Issue 193 模型目录需求分诊
description: 需求价值、现有缺口、建议边界及规格阶段待决策项。
tags: [adapter, ipc, reasoning, schema]
timestamp: 2026-11-01T02:13:00+08:00
---

# 审查后的结论

2026-11-01 用户审查后明确：统一模型目录不属于 Runtime 的执行职责，目录事实归 Provider/实际后端，来源和展示归宿主。相同 Adapter 可能连接官方服务、第三方代理站或自定义 endpoint，不能统一推导模型集合或认证权限。

下文为初次分诊的历史记录。其中“建议 P2 推进目录 API”“至少接通一个 Provider”及对应范围和待决策项已撤回，不作为当前开发指令。当前需求为更新规格、架构约束和双语 docs，执行依据为 [brief.md](brief.md)。保留原记录用于说明此次职责误判和修正，不再开展目录 API 实现。

## 初次分诊结论（已被上述审查结论取代）

需求有意义，建议进入规格阶段；建议优先级 P2（中等），不属于执行链路阻断。
原始 issue 当前 OPEN，无补充评论。外部 Loop daemon 已提出具体消费需求，但其服务端实现及排期未在本仓核验。
来源：https://github.com/Mininglamp-OSS/octo-runtime/issues/193

## 价值与目标

用户在原生客户端选择 Adapter 后，需要获取该配置下 Provider 实际报告的模型 ID、默认提示和可报告的推理选项。
调用方仅使用公共 KernelClient；Provider 协议、进程及查询资源由 Adapter 边界管理。
统一发现入口可以减少 Go/Python 消费者重复实现 Provider 适配和凭据处理，避免静态目录漂移。
当前仍可显式指定模型执行，因此目录缺失影响选项展示和接入完整性，不阻断已有 invoke。
目录只表明 Provider 在某时点报告的选项，不保证账号额度、权限、后端健康或调用成功。

## 已核对的缺口

- Adapter SDK 的公共 Adapter 接口只有 metadata、probe、invoke，没有独立模型查询合同。
- Core describe 查询安装可用性、命令路径和版本；这不是模型目录或账号授权证明。
- KernelClient、server 方法白名单、IPC schema 和生成的 Go/Python 方法均无模型目录操作。
- ACP 和 CodeBuddy 在 invoke 的 session/new 或 session/load 响应中消费 configOptions/models.availableModels；这是会话内选模证据，不能直接当作无副作用的独立发现接口。
- 尚未执行真实 Provider 目录查询；Codex 等 Provider 的独立查询路径、版本兼容性和清理行为需在规格阶段核实。

证据入口：
`packages/octo-runtime-adapter-sdk/src/index.ts`、`packages/octo-runtime-executor-core/src/index.ts`、
`packages/octo-runtime-executor-kernel/src/{types,server,rpc,host-run-service}.ts`、
`packages/octo-runtime-protocol/schema/kernel-ipc.schema.json`、`native/codegen/`、
`packages/octo-runtime-adapter-{acp,codebuddy}/src/index.ts`。

## 建议范围

1. 增加按已配置 Adapter 查询的可选、只读操作，沿 Adapter → Core/worker → Kernel IPC → TS/Go/Python 公开；名称和数据形状留待规格决定。
2. 返回真实模型 ID，默认值仅作有来源的提示；未知默认和未知 effort 不冒充空选项或不支持。
3. 明确区分未实现目录、不存在的 Adapter、Provider 不可达、超时、非法响应和成功空目录；旧 Kernel 的 method-not-found 也应可识别。
4. 查询沿用宿主注入的 Adapter 配置，不触发认证准备、登录、安装、模型推理或执行配置修改；不让消费方启动 Provider CLI 或读取私有凭据文件。
5. 明确截止时间、取消、响应大小/数量边界和实际资源回收；不能只让 Promise 超时而遗留进程，也不能通过重启共享 worker 中断已有 Run。
6. 首期至少接通一个有安全独立查询路径的真实 Provider，其他 Adapter 返回明确不支持；只有接口和 fixture 不足以宣称满足验收。
7. 本地检查跨语言 codec、IPC 正反例、未知/空/失败、超时回收及 invoke/lifecycle 回归；专项与 native 检查显式手动运行，不扩大 GitHub CI。

## 架构边界与风险

模型目录是对显式查询的实际 Provider 数据返回，不恢复 executionFeatures/capabilities 注册中心，不承担产品选择器策略或运行准入。
现有 reasoning 规则固定 low/medium/high/xhigh 并允许映射或未应用提示；原生模型 effort 选项与 Runtime 实际 setter 支持必须分别表达。
不把目录作为 invoke 模型白名单，不因查询失败禁止显式选模，不依据目录修改省略参数时的默认行为。
部分协议只在会话创建后提供目录；如果创建会话会持久化或需要准备认证，不能以“只读”之名隐式执行，应先返回不支持或另行明确合同。
诊断仅返回安全错误码及受控消息，不透传 stderr、环境变量、认证内容或完整私有响应。

## 规格阶段待决策

- 首期支持哪些 Provider？建议选择至少一个可独立、无执行副作用查询的 Provider，并提供真实验收证据。
- 目录粒度是否依赖 providerAgentId、工作目录或配置？只暴露实际查询必需的维度。
- effort 字段如何同时表达原生选项、未知状态及 Runtime 可应用情况？不得把原生广告等同于 Adapter 已实现 setter。
- “默认”表示 Provider 默认、当前配置还是会话当前值？建议按来源明确区分，未知省略。
- 查询是否允许连接/启动短时 Provider 协议进程？应允许 Adapter 拥有的有界只读传输，但不允许隐式会话创建、登录或修改配置。
- 截止时间、取消传播、查询并发和目录大小上限，以及旧 Kernel/旧 Adapter 的兼容错误合同。

这些为建议与待审查项，尚未形成获认可的 brief.md。

## 环境与验证范围

- 仓库：Mininglamp-OSS/octo-runtime。
- 已 fetch origin/main；基线：a5a32835882deab5e2364b559dd06bf1675c1335。
- 主机：lvsijiaMacBook-Pro.local。
- Worktree：/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-193。
- 分支：feat/193-adapter-model-catalog。
- 本次仅分诊及文档记录；未修改功能、未运行功能测试、未提交或推送、未修改 CI。
- 原 main worktree 的既有未跟踪 .workbuddy/ 保持原状。
- 下一阶段：用户认可分诊后执行 start-spec。
