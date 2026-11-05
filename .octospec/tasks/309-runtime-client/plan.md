---
type: Task
title: Issue 309：分阶段实施计划
description: 记录独立 worktree 的五阶段实施顺序、完成状态和仍未执行的平台及真实发布边界。
tags: [architecture, packaging, release, testing, documentation]
---

# 实施计划

状态：M1-M5 的本地实现与验证已完成，初始草稿的类型错误已修正。实际命令与结果见[验证记录](validation.md)，审查问题闭环见[Review](review.md)。未执行的平台、真实 Provider/Electron 与正式发布单独标记，不以本地通过代替。

## M1：锁定客户端依赖边界

主要位置：`packages/octo-runtime-client/`、`packages/octo-runtime-executor-kernel/src/{client,types,invocation-lifecycle,submission-error,async-question-reply,runtime-home}.ts`、protocol 的类型导出、Core 元数据类型导出、各 workspace manifest 和 lockfile。

1. 对照基线逐项检查现有草稿与[设计](design.md)，纠正超出 API 清单的导出和字段副本；草稿不约束方案选择。
2. 抽取唯一客户端及调用登记/错误证据；Core 元数据组合自 protocol 生成类型，不反向引入 Core。
3. 抽取纯端点/路径诊断，Home IO 保持完整 SDK；Kernel 兼容入口转发同一实现。
4. 核对 CLI、KernelService.client、Extra IPC 最终调用链，Extra direct 不改变。
5. 原有状态查询加入设计规定的版本/形态拒绝；在所有权、未知结果和关闭合同旁保留中文说明。

出口：运行依赖和 d.ts 依赖没有禁止模块；原有公开类型不被放宽；build/typecheck/lint 通过。M1 失败先修边界，不进入“client 已可发布”的声明。

## M2：产出两个独立归档

主要位置：`scripts/pack-release.mjs`、必要的 client 物化辅助、根/包 manifest、原始 schema 导出、构建来源读取。

1. 同一次构建注入两包相同版本；client 收集唯一私有 protocol，runtime 内置 client 及唯一 protocol，保留自包含归档。
2. runtime 的 client/protocol 保持正常包内解析，保留原 schema 路径和内容。
3. 两包携带同源构建元数据、LICENSE 与各自 README；不携带源码工作区软链或构建/安装脚本。
4. 清点 exports 的 JS、d.ts、JSON 文件全部存在，记录归档内容/体积/依赖闭包。
5. 本地执行包外 npm/pnpm 安装、类型、发行物内身份与跨包类型兼容与 SDK 原生组合检查，尽早暴露打包方案不可行点。

出口：A01-A06 取得真实归档证据。单包工作区 import 成功、源码搜索无依赖或 tsc 通过均不能替代外部安装。

## M3：适配既有发布与恢复

主要位置：`scripts/check-release-registry.mjs`、`resolve-release-build-time.mjs`、`read-release-build-info.mjs`、`reconcile-release-latest.mjs`、既有 npm/release workflow 的产物对象。

1. registry 检查显式接收包名，对两个归档分别校验；上传前同时预检，单包冲突不得先上传另一包。
2. 发布 client 后发布 runtime；恢复按设计状态表仅补缺失包。支持从任一已发包恢复 buildTime，交叉核对双包来源，保留完整 SHA-512 约束。
3. 既有 artifact 上传/下载集合和 GitHub 附件扩为两个文件，既有 job/needs/矩阵/触发和必需状态不变。
4. latest 只在双包双附件完整且内容匹配后更新；重读三方状态，保持不回退和并发恢复语义。
5. 以本地可控 registry/命令夹具模拟部分成功、冲突、网络和未知响应；不调用真实 publish。

出口：A10-A13 通过；不能只证明工作流 YAML 里多了一条 npm publish。

## M4：保留现有离线、全局 Extra 和平台验收

主要位置：`scripts/verify-release.mjs`、`verify-global-extra-installations.mjs`、必要的 Windows 包消费适配、现有发行测试的固定单包断言。

1. npm/pnpm 空缓存分别仅提供 runtime tgz 或 client tgz；完整包沿现有 global 方式安装，不需要配套下载独立 client。
2. 保留既有 offline、public SDK、原生 Kernel/Extra、全局 Extra 发现和清理验收。仅适配输入材料和新增内置依赖位置，不塞入新专项检查。
3. client 专项与双包恢复专项放 `test/manual/`，只显式手动执行；默认 selector、默认测试开关和现有 job 的检查集合不扩大。
4. 对比 origin/main 的 workflow 结构、scripts/default selectors，以及远端提交后实际 check 列表；未提交时只记录基线和本地 diff。

出口：原场景仍被原检查验证，第二个产物能用于既有安装流程；无新增 CI job/status/gate/专项。

## M5：文档、回归与证据收尾

1. 同步 `docs/{en,zh-CN}/getting-started/sdk.md`、相关包参考、client README、INTEGRATION、DEPLOYMENTS，以及架构/协议规则的 client 归属和离线交付说明。与 #293 保持当前 API/所有权一致，保留 #312 direct 选项。
2. 增加 client-only 和原生 full SDK 的包外示例，分别说明连接、初始化、取消、尾流、业务收尾、关闭和 incomplete。文档示例不能隐式启动服务。
3. 按[验收矩阵](acceptance.md)记录 revision/dirty、命令、退出码、两包文件/内容/体积/依赖，以及每项通过/失败/not run。
4. 运行适用的 build/typecheck/lint/docs 和既有跨包完整测试；native 检查显式本地运行，不接入默认构建。
5. Windows/Linux/macOS、Node 24/26、Electron 和真实 Provider 分开报告。实际 npm 发布只在另行授权后执行，不把本地 tgz 验收写成已发布。

出口：所有必需本地验收有结果，失败有处置，未验平台有边界；规划评分不能代替交付结论。当前已达到本地交付出口，用户追加授权英文提交并创建目标 main 的 PR；不执行合并、打 tag 或正式发布。
