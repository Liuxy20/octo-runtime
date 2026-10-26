---
type: Task
title: Issue 182：渠道本地产物交付
description: 本地输出交付为 IM 文件卡和内嵌图片，保留最终 Markdown 链接，不引入文档权限。
tags: [channel, delivery, context]
---

# 目标

基于 origin/main `81284c9`，分支 `feat/182-channel-artifact-delivery`，处理 [Issue 182](https://github.com/Mininglamp-OSS/octo-runtime/issues/182)。生成的产物应直接交付给当前聊天用户，无需用户再要求一次上传。普通文件链接上传为 IM 附件并发送原生文件卡；最终 Markdown 保留链接文字及附件地址，卡片不是链接的替代品。图片以 Markdown 图片内嵌展示。

## 产品理由

群里发文件的目标是让收件人按现有 IM 文件合同打开、下载和转发。自动转成在线文档会新增所有者、文档 ACL 和授权步骤；即便批量授权当前成员，也不自动解决后加入成员及跨群转发。部署了服务只表示能力可用，不表示用户选择在线协作。文件卡改善呈现，不能以增加访问障碍为代价。因此此前自动路由到 Docs/HTML 的方案属于越界设计，现明确撤销。

## 产品意图与所有权

业务入口 Channel Gateway 决定交付体验；宿主提供可信 Bot 配置及文件访问范围。Gateway 在执行前通过本轮 Context 明示固定交付合同，执行后只处理成功 final 中显式 Markdown 文件引用。工具调用仍负责用户主动要求的上传、网盘保存或其他业务动作。已返回云地址的工具结果直接保留，Gateway 不补发第二条回复。

Kernel、Host、Adapter 和 WeCom 不接管此产品策略，不增加通用协议或 Provider 特判。问题属于 Gateway 的结果投递职责；旧 blanket tool-only 规则按本需求修正，不据此开放任意业务编排。

## 关键合同

- 这是 Channel Gateway workflow 的确定性交付步骤，不是让 LLM 决定或发起 ToolCall。顺序为成功 final → 按可信策略核验本地产物 → 上传 IM 附件 → 改写当前 final 并发送原生文件卡 → 原消息发送链；主动业务上传仍由普通 ToolCall 承担，两种行为独立。
- HTML、Markdown 与其他文件使用同一 IM 附件合同；不自动发布/导入在线文档，不探测企业服务，不授予文档角色或创建公开分享，不保留企业服务路由开关。在线协作、文档发布、保存网盘属于明确的普通 ToolCall 业务。
- 普通文件链接额外发送原生 type=8 文件卡，字段为附件 URL、文件名、字节数、扩展名；保留最终 Markdown 的链接文字和已替换地址。原生文件卡独立于互动/进度 `cards` 开关。仅图片语法不额外发文件卡，同图另有下载链接时共用一次上传并最多一张文件卡。
- 图片 final 必须保留 Markdown 图片语法，仅有下载链接不满足图片交付。文件下载链接可以按用户要求另附，但不能代替内嵌图片。
- Bot `artifact_delivery.mode` 省略为 `channel`，显式 `tools` 关闭固定上传；该选择在模型前冻结，并写入 `extra.im/artifact-delivery`。不检测输入关键词、工具是否被调用或正文中的指令。
- 默认允许当前本地 Agent 有效工作区；宿主可显式提供绝对目录列表（空列表拒绝全部）、MIME 限制及更小预算。preset/远程工作区不作为本地目录读取，即使机器上恰有同名路径。
- 普通链接、图片及 reference 定义使用结构化 Markdown AST 和 destination token 位置，仅替换地址；代码、引用、HTML 和未使用定义不触发。共享定义含被引用示例时采用局部展开，避免改变示例。
- 绝对路径、相对路径、file URL 支持本机路径语义；其他操作系统路径明确不可读，不误当云链接。realpath 检查目录、链接逃逸、打开描述符身份、regular file、大小、MIME；无扩展名白名单。上传同一个已核验描述符的有界字节。
- 每次 final 最多 16 个不同文件、单文件 20 MiB、总计 50 MiB、整个准备 30 秒，宿主可收紧；顺序上传限制峰值占用。服务端实际上传策略仍可拒绝。
- API 来自 octo-cli `internal/registry/specs/file.json` 及 octo-server `modules/bot_api/file.go`：当前 Bot 调用 `GET /v1/bot/upload/presigned?filename=...&fileSize=...`，按返回的 `PUT`、`contentType`、`contentDisposition` 直传同一批已核验字节，不向存储服务转发 Bot Token。只将独立 `downloadUrl` 用于聊天，拒绝内嵌认证、鉴权预览路由及临时签名下载链接；临时上传 URL 不交付。测试环境已明确停用旧 multipart 路径（HTTP 410），不再依赖它。不猜测对象路径或去掉签名造公开地址。
- 成功链接保留；失败目标保持原值，并在同条回复明确列出不可交付文件名及稳定原因，不将本地路径描述为云附件，不附加主机绝对目录或原始错误。生成终态保持成功，不重跑模型。
- 同一文件 realpath 去重（图片/下载共用），同一 effect 的最终准备 Promise 缓存在消息闭包内，发送重试复用。上传后按独立稳定编号发送文件卡并记录回执，再计算 mention 并发送最终文本；文本重试不重新上传或补发文件卡。文件卡失败/结果未知在最终文本明确提示，仍保留已上传文件的下载地址，不声称卡片已送达。
- final 交付使用独立可取消 controller：stop/reset 取消准备并禁止旧代次发送，shutdown 沿原共享有界 drain；reset 不取消仍在执行的模型，不改固定工作区。

## 范围外

目录扫描、工具输出探测、HTML 内依赖递归上传、任意网站部署、远程 Provider 文件拉取、持久上传账本、临时链接刷新、自动在线文档创建/导入/授权及文档分享卡均不在本次范围。

## 验收与证据

详见 [设计与执行评估](design.md)。自动化覆盖 HTML/文档/任意格式、图片、reference、精确保真、部分失败、云链接、不重复上传、权限及生命周期竞态；运行 build/typecheck/lint、Gateway 回归与 OKF 检查。真实验证仅使用线上测试环境，单独记录下载、历史地址及客户端图片呈现结果，未完成项不得写成通过。

实现、自动化与测试环境真实往返见[实施记录](../../journal/shared/2026-10-26-182-channel-artifact-delivery.md)。此前附件上传和企业服务的真实证据仅表示当时实现，不能替代本轮原生文件卡验收。用户已授权按收敛后的体验修复代码，并特别确认最终 Markdown 链接必须保留。继续依此前授权，在本地 verified-review 通过后提交并创建本需求自己的 PR，之后每 15 分钟跟进该 PR review；不选取其他已有 PR 代替。
