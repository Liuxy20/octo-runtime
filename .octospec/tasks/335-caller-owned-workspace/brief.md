---
type: Task
title: Issue 335 工作目录归调用方
description: 删除工作区模式及随机分配，仅使用调用方已成功创建的目录并返回稳定错误码。
tags: [workspace, architecture, protocol, execution]
---

# 目标与决定

来源：[Issue 335](https://github.com/Mininglamp-OSS/octo-runtime/issues/335)。在 #334 的同一独立分支继续；规划起点 `7a76a454`，原始最新 main 为 `3f83ecf4`。用户追加授权同时处理 #335、写 octospec，明确“直接去掉，不考虑兼容性”“Agent Run 时业务方已经创建成功目录”“workdir 不存在应报错且有 errorcode”。后续追加的 Gateway #23 已明确取消，外部仓库仍仅只读审计；不用管 Work App。

业务方决定目录选择、创建、复用及清理。Runtime 只执行具体路径，不负责创建应用目录。合同内动作是校验路径、执行及返回明确错误；越界动作是随机分配、缺失补建、切换替代目录、按会话补造工作区。Runtime 的 Home/log/IPC/Provider 原生状态不属于应用目录，继续各自拥有。

## 最终合同

- `octo.execution/workspace` payload 仅 `{ path: "/absolute/prepared/path" }`；删除 mode 的 fixed/random/none 分支、模式字段和相关公开类型/回执字段。旧格式按未知字段失败，不建立兼容层、迁移转换或配置回退。
- 普通本地执行要求调用方显式指定路径，允许 agentEnv.workdir 作为已有明确入口；与 Context workspace.path 同时存在时必须相同。Core/Kernel 不从 process.cwd、用户 Home 或旧会话补路径。
- SDK 与 CLI 均要求本次请求指定已创建目录；本次不保留 CLI 隐式 cwd 便利策略。调用方可自己读取 cwd 或创建临时目录后传入。
- 外部/preset Agent 或明确 `metadata.workspace: false` 的 Adapter 没有本地工作区覆盖时允许缺省，不制造本地路径。OpenClaw 不消费本地 cwd，不强制 stat 远端目录；原有忽略警告仅存在于已无消费者的旧分配器中，随分配器删除，不新增警告机制。
- 本地目录在启动 Adapter 的 Provider 操作前检查：非空绝对路径、存在、是目录、可访问。检查失败不创建任何应用目录。检查与实际 spawn 间仍有文件系统竞态；后续原生错误继续如实返回，不承诺锁定目录。
- 稳定原因码：缺路径 `WORKDIR_REQUIRED`，非绝对路径 `WORKDIR_INVALID`，不存在 `WORKDIR_NOT_FOUND`，文件 `WORKDIR_NOT_DIRECTORY`，无访问权/其他不可用 `WORKDIR_UNAVAILABLE`。异常 `.code`、canonical 失败 payload.code/failure.reasonCode、native error control 保留具体码；沿用现有配置错误公共分类 `OH-ADP-3004`，不创建平行错误目录。
- 续接和 fresh recovery 使用同一本次请求路径，目录消失仍报 WORKDIR_NOT_FOUND，不重建。调用方临时目录与普通目录执行方式相同。

## 已核对的实施路径

1. Schema ContextWorkspacePayload 改为 path-only；RunContextProjection.execution、ContextPreparationReceipt 去掉 workspace_mode。运行时校验与 execution-plan 冻结比较同步，按生成流程更新声明、fixtures、示例和消费者。
2. Core invoke-input 删除 process.cwd 默认值与 mode，context 解析允许表达外部 Agent 无覆盖；真实 Executor 按已注册 metadata 判断本地路径需求。在同一原生/canonical Provider 执行 try 内先校验，再创建 scope/invoke，使失败按现有终态/清理机制返回而不误报 HOST_FRAME_INVALID。
3. 删除无内部调用的 execution-preparation.ts、prepareRunContext 和 WorkspaceAssignments 导出。仓库没有 assignment store 实现，无数据迁移或删除；不扫描用户历史随机目录。实际 Runtime 运维目录和 Provider 生命周期代码保留。
4. AgentConfig.workdir、显式 env.workdir、Context path 必须一致；不从 Provider 私有配置偷偷选目录。现有无真实目录的 fake 测试应由测试调用方创建目录，而不是降低生产校验。
5. 更新双语合同/SDK/CLI 示例；Gateway 审计记录其当前自身创建默认路径符合调用方责任，但输出仍带 fixed mode，需要仓外单独升级。此次不修改 Gateway、不声称组合可直接运行。

## 交付与版本

准备度至少 95 分并经实施前双轴审查后编码；#334/#335 同一正式英文 PR，实施后再审查。源码 0.0.0 与 Run7/Contextv3/IPC2/transport2 不机械升级；现有发行流程决定版本，本次不发布 npm。无兼容承诺。专项仅手动执行，不扩大任何 GitHub CI 范围；最终检查 workflow diff 和实际 checks。英文里程碑提交保留配置作者与 Codex trailer，按现有保护规则合并 main。
