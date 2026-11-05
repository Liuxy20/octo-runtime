---
type: Task
title: Issue 309：客户端边界与双包发行设计
description: 定义公开入口、共享依赖和对象身份、协议兼容、发布中间状态及恢复行为。
tags: [architecture, protocol, lifecycle, packaging, release]
---

# 设计

以下为用户确认的设计合同。基线见[简报](brief.md)，已完成的本地实现证据见[验证记录](validation.md)，平台和真实发布边界单独列明。

## 1. 一个实现与一个协议来源

| 层 | 计划职责 | 允许依赖 |
| --- | --- | --- |
| 私有 protocol | Schema、生成 wire types、公共数据组合类型、常量与校验 | Node 标准库；本次不新增运行依赖 |
| 公开 client | attach、RPC、invoke、调用登记、交互/取消、有界恢复、AsyncQuestionReply | protocol 与 Node 标准库 |
| 完整 Runtime | CLI、原生 Kernel/Core/Adapter/Host/Extra 和 direct 装配 | 精确同版本 client；服务端既有依赖 |

迁移 `client.ts`、`types.ts`、`invocation-lifecycle.ts`、`submission-error.ts` 和 `async-question-reply.ts` 的唯一实现到 client。Kernel 原路径保留转发或改为直接导入，不保留原逻辑副本。CLI 和 Extra IPC 可以沿兼容 Kernel 导出调用，最终必须进入同一 client；KernelService.client 同样复用。Extra direct 保持 #312 的 scoped execution，不创建 client。

`HostedAdapterMetadataWire` 已由 protocol schema 生成，但其 protocolSupport 为可选；Core 注册后的 `HostedAdapterMetadata` 要求 protocolSupport 必填。计划在 protocol 导出对生成 wire type 的收窄组合类型，Core 与 client 共用。不得为了迁移把 Core 注册合同放宽，也不得手抄一套 wire 字段或手改生成文件。本轮不改变 Schema，Go/Python 生成输入应保持不变。

端点校验和错误诊断从 `runtime-home.ts` 中抽出纯路径计算部分，放入 client 内部模块；Home 的 stat/getconf、目录探测与创建继续留在完整 Runtime。保留现有错误类别、字段、长度和平台限制。纯函数存在于 client 不意味着 attach 会创建或验证某个 Home 目录。

同步 main 的 #314 后，统一启动诊断的纯投影、净化和 catalog 同样由 client 保存唯一实现，Kernel 原模块显式转发现有导出。`RuntimeHomeError` 使用统一诊断，保留不可枚举的旧路径字段别名；client 和完整 Runtime 各自在发行物内部共享该错误类及 catalog。诊断所需的 `ServicePhase`、`ServiceCleanupResult` 仅为数据类型；服务生命周期实现、启动记录 IO 仍留在完整 Runtime，不增加 client 到服务端的依赖。

## 2. 公开入口清单

| 入口 | 本轮计划导出 |
| --- | --- |
| client 根 | attachKernel、KernelClient、KernelError、AsyncQuestionReply/Result、isInvocationNotSubmitted、KernelInvocationRecord/DrainResult/Lifecycle、LookupKey、RunRef、RunSnapshot、KernelStatus，以及常用 InvokeInput/InvokeEnvironment/HostFrame/CanonicalEvent/交互类型 |
| client `/protocol` | 私有 protocol 的公共类型、值和校验；不导出服务工厂 |
| client `/protocol/schema.json` | protocol.schema.json 原始内容 |
| client `/protocol/ipc-schema.json` | kernel-ipc.schema.json 原始内容 |
| client `/protocol/ipc-fixtures.json` | kernel-ipc-fixtures.json 原始内容 |
| client `/protocol/behavior.json` | kernel-client.behavior.json 原始内容 |
| client `/protocol/browser`、`/protocol/notification` | 既有 protocol 对应子入口，供完整 SDK 转发和协议消费者使用；不承诺浏览器 transport |
| client `/internal` | 仅用于本仓同版本 Runtime 装配所必需的调用登记/拒绝证据/路径校验及纯启动诊断辅助；不承诺独立版本兼容，不在普通接入示例推荐 |
| full `/executor-kernel`、`/protocol` 及现有 schema 路径 | 保持现有导出名、签名与行为；客户端/协议部分转发到共享实现 |

`createKernelService`、`createExtraService`、AgentExecutor、HostedAdapter、Adapter 注册、Home IO、租约、服务监听与关闭不进入 client。`/internal` 不得包含上述服务实现；实施时清点确实被 full 使用的符号，未使用辅助不得为了“以后可能使用”扩充入口。

## 3. 发行依赖与对象身份

client tgz 包含自身 dist、协议 schema、README/LICENSE、构建来源元数据，以及唯一私有 protocol 的 dist/manifest。protocol 作为 bundled dependency 随 client 交付，不作为第三个 npm 包发布。所有 workspace/link/file 引用在发行 manifest 中清除。

runtime tgz 将 client 和 protocol 的编译产物一并物化在包内 node_modules，并列入 bundled dependencies，沿用现有自包含发布方式。runtime 内部的 CLI、Kernel、Host 和 client 解析同一份包内 protocol；不通过独立 client npm 包下载满足运行前提。两个归档从同一次构建产生，版本、Git commit、dirty、buildTime 与 schema 来源一致。

用户确认的发行约束：**一份源码、两种自包含发行物**。完整 Runtime 与独立 client 分别随包交付必要依赖；单独拿到任意一个 tgz 都可在空缓存中离线安装。protocol 保持私有，不产生第三个 npm 发布物。

每个发行物内部保证 attachKernel、KernelError、AsyncQuestionReply、InvokeInput、代表性 validator 和拒绝证据为单一模块实例。应用同时安装完整包和独立 client 时，可能加载两个物理副本，因此不承诺跨发行物的类/函数 ===、instanceof 或 WeakSet 证据互认；即使版本相同也不承诺。不得使用全局 Symbol 注册表伪造跨副本身份。跨发行物要求严格结构类型兼容、协议数据/校验行为一致；错误判断使用产生错误的入口导出的 KernelError，或检查公开 code。该约束按用户选择覆盖 issue #309 原先的跨发行物值身份验收方向。

本地源码开发仍使用 pnpm workspace 链接，各调用方共享仓库内同一实现；发布时复制编译产物和依赖，不携带 workspace 软链。既有 runtime 单 tgz 离线、全局 npm/pnpm、Extra 发现与原生 SDK 验收继续保持，不能为了独立 client 发布要求完整包安装者额外准备第二份归档。

## 4. 版本兼容与拒绝行为

| 组合/情况 | 本期支持声明与行为 |
| --- | --- |
| 同 tag 的 client X 与 Kernel X | 本期承诺支持的标准发行组合；必须有包外执行和生命周期证据 |
| client X 与拆包前基线 Kernel | 以 `de3ff37a` 为本轮额外兼容目标，按相同 IPC v1 合同手动验证；未通过不得声明该组合支持 |
| client 与其他 npm 版本的 Kernel | 不因 npm 版本不同主动拒绝；本期不笼统承诺任意范围。只将有证据的组合写入兼容表 |
| status 返回 ipc_version 非 1 | 使用既有 status 响应检查明确抛 KernelError `KERNEL_IPC_VERSION_UNSUPPORTED`；submit 在既有 status 前置查询处停止，不发 invoke |
| status 数据形态不合法 | 报 INVALID_RESPONSE；不得继续提交或把缺失字段当支持 |
| 不支持的 Run/Context/帧/方法 | 沿既有输入/帧校验及服务端 RPC 错误拒绝，不自动转换、降级或重放 |

上述 status 校验是本次实现增量；拆包前基线只做类型断言，不能写成基线已有保证。`get/subscribe/cancel/respond` 不为了版本探测增加新握手；保留原引用和既有 wire/身份校验。没有全协议协商或预先发现所有不兼容字段的保证。IPC=1、Run=7、Context=v3、Adapter transport=2 分别解释，schema hash 记录内容来源，不代替兼容范围。

同步 main 的 #317 后，client 使用 protocol 的 `assertKernelStatus` 唯一校验器，保留可选 `service_processes` 及其安全白名单/数量上限。没有该字段的旧 status 仍接受；缺失或畸形响应继续报客户端 `INVALID_RESPONSE`，明确不支持的数值 IPC 版本先报 `KERNEL_IPC_VERSION_UNSUPPORTED`。校验失败不发送 invoke；Kernel 旧客户端入口继续转发到 client，不恢复第二份实现。Codex 常驻服务及 execution scope 留在完整 Runtime，不进入独立 client 依赖闭包。

## 5. 同 tag 双包发布与部分失败

源码版本继续保持 0.0.0。新 tag 注入同一个稳定 SemVer，现有 pack 入口产出两个确定文件名：`mininglamp-oss-octo-runtime-X.Y.Z.tgz` 与 `mininglamp-oss-octo-runtime-client-X.Y.Z.tgz`。不直接对 workspace package 执行未经物化的 npm publish。

发布沿既有 validate、verify、publish、Release 和 latest 作业推进。只调整产物及发布对象，不新增 workflow/job/matrix/trigger/required status/needs。新增专项测试不接入这些作业。

发布前预检两个包的远端 SHA-512 和本地归档；已存在且内容不同则停止，在上传任何缺包前暴露冲突。仅确切 E404 可判定缺失，鉴权/网络/元数据错误必须失败。先发 client，再发 runtime，使用原有 `release-X.Y.Z` 临时 dist-tag；每包沿原有等待策略核验可读性。

| 观察到的状态 | 处理与完成条件 |
| --- | --- |
| 两包均不存在 | 按上述顺序发布；两包完整性匹配后上传两个 GitHub 附件 |
| client 已存在、runtime 缺失 | 验证 client 来源/完整性，复用其构建时间，只发布 runtime；不重发 client |
| runtime 已存在、client 缺失 | 验证 runtime 来源/完整性，复用其构建时间，只补 client；不重发 runtime |
| 两包已存在且匹配、附件不全 | 不再 npm publish，只补对应附件 |
| 任一包来源/integrity 不符 | 停止；不覆盖 npm 版本、不自动 unpublish、不重打 tag |
| 发布响应未知或上传后暂不可见 | 沿既有有界读取确认；到期失败并留诊断，恢复时先读远端状态，不直接重发 |
| latest 在部分更新时中断 | 下次重新读取两个 npm latest 与 GitHub latest，从完整发行集合继续收敛；不回退到较低版本 |

恢复脚本查询两个包。任一存在时下载并验证该包归档元数据；两者均存在时 commit、clean、buildTime 必须一致；均不存在才产生新 buildTime。构建来源读取需识别两包各自元数据位置，client 不携带 CLI 仅为复用旧路径。只有完整重建后的两份 SHA-512 匹配才允许恢复，不能只比较 commit/time。

完整发行集合要求：两个 npm 版本均可读、两份附件存在且分别与 npm integrity 匹配。两 npm latest 与 GitHub latest 仅指向这个集合中不低于当前稳定 latest 的最高版本；任一失败不报告整体成功。操作不能原子提交，中间短暂不一致属于可恢复状态，不承诺“同时可见”。

历史单包 tag 保持原归档及使用方式；本设计不向其补发 client，也不把其误判为新双包的成功记录。新流程的恢复和双包 latest 以首次双包发行开始，不更改历史 npm 字节。

dry-run 在发布前允许传入尚未发布的候选版本，但该输入不加入 `readState()` 返回的已验证完整版本集合。输出分别报告 `candidate.version/verified` 与 `targetVerified`；只有目标已通过远端双包/附件/integrity 检查时，才在 `actions` 返回提升计划。未经验证的候选仅返回 `conditionalActions`、空 `actions` 和明确警告，表示发布与完整性校验成功后的假设计划，不表示发布就绪。两类 dry-run 均零远端写入；读取、鉴权和完整性错误继续失败，latest 下界检查不放宽。正式执行在 CLI 和函数入口均拒绝 `candidate`。

## 6. 风险及停止条件

| 风险 | 对策与检查 | 未满足时 |
| --- | --- | --- |
| 发行物内部解析出两份 client/protocol | 正常物化包内依赖；每个发行物内部身份检查；跨发行物只做类型/协议兼容 | 停止公开交付，调整打包方案后重新评估 |
| 声明把 Core/Adapter 带回 client | 公共元数据组合自生成 wire；检查全部传递 d.ts import | client 不算独立可安装 |
| endpoint 抽取带入 IO 或改变错误 | 只迁移纯计算/诊断；原平台路径用例和错误身份复验 | 保持旧行为，不绕过校验 |
| 移动破坏取消、恢复、未知结果 | 原行为差异审查，ACK 丢失/原游标恢复/尾流/独立清理专项 | 不以执行成功路径代替合同验收 |
| 第二包发布失败或 latest 回退 | 双预检、精确补缺、不可变归档、三 latest 重读收敛 | 保留已发包，不宣布完整发布 |
| 完整 SDK 的单 tgz 离线/全局安装失效 | 内置 client/protocol；npm/pnpm 空缓存单归档及原有 Extra 场景 | 修复打包，不能要求安装者额外准备 client 归档 |
| 将拆包扩成架构重写/CI 扩围 | 保留 #294/#312；比对工作流结构、默认脚本及实际检查列表 | 删除范围外改动后重评 |
| npm 凭据无新包发布权限/平台环境缺失 | 正式发布前按授权核对新包权限；平台/真实 Provider 单独列未验 | 不推断权限或平台通过，不实际发布试探权限 |
