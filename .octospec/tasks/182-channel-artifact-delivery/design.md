---
type: Task
title: Issue 182 设计与可执行性评估
description: 源码证据、实现位置、验收矩阵及真实联验缺口。
tags: [channel, delivery, testing]
---

# 设计

1. `delivery/artifact-policy.ts` 从可信 Bot 配置和本轮 request 的有效 workspace/agentSource 派生合同，`execution/dispatcher.ts` 在 merge 后写入权威 Context，失败预算不静默省略合同。
2. `delivery/artifacts.ts` 用既有 mdast parser 收集有效引用和 token 地址位置，保留源格式；在配置目录内打开/核验文件，顺序上传，realpath 结果复用，部分失败留在同一条最终回复。
3. `transport/api/files.ts` 使用当前 Bot 获取预签名凭据并 PUT 已核验字节；原样回显签名头，不向存储服务传 Bot Token，仅返回独立长期 downloadUrl。有界响应、超时、禁止重定向和临时下载地址校验，不引入 CLI 运行依赖。
4. `application/im-channel.ts` 将冻结合同与投递 signal 交给 `replyFinal`，维护每会话交付 controller，stop/reset 取消，代次验证阻止旧发送；不改变模型执行重试策略。
5. `transport/channel.ts` 按 effect 缓存产物转换与 mention 转换 Promise，发送继续沿原 connection、stableEffectKey 和历史观察器。
6. 上传准备返回已改写文本及去重后的普通文件元数据，`transport/channel.ts` 为每个文件生成稳定 effect，通过 `WukongConnection.sendFile` 发送原生 type=8 消息。文件卡复用 WS 加密、ACK、取消和历史位置观察；文本重试复用完整准备 Promise。卡片未确认时将稳定原因加入同条 final，下载链接仍保留。

## 验收矩阵

| 编号 | 场景 | 证据目标 |
| --- | --- | --- |
| A01 | mode 默认、tools、动态 Context/重试冻结 | invocation 与 runtime 自动化 |
| A02 | HTML 游戏、PDF/Office、未知扩展 | 文件内容与直传字节一致 |
| A03 | PNG/JPEG/WebP/GIF/SVG/TIFF/BMP | 保留图片语法、alt、title |
| A04 | reference、嵌套格式、转义及共享定义 | 只改目标，引用/代码示例不变 |
| A05 | 云地址与主动工具上传 | 零 Gateway 上传、单 final |
| A06 | 同文件多种语法及发送重试 | 单次上传、原投递身份 |
| A07 | 部分失败、超时、无效响应 | 成功链接保留、失败明确、不重跑 |
| A08 | traversal/symlink/FIFO/目录/缺失/大小/MIME | 不读取或上传被拒绝目标 |
| A09 | Windows/file URL/相对路径/远程 Provider | 本机语义与明确不可读 |
| A10 | mention 与转换顺序 | UTF-16 偏移仍指向正确名称 |
| A11 | stop/reset/shutdown | 等待展示收尾及上传期间均可取消交付，旧 final 不发送、有界退出；已确认模型终态保持 |
| A12 | 线上 HTML 与图片往返 | 匿名收件侧下载、内容核对、消息历史与图片呈现分别记录 |
| A13 | HTML / Markdown 普通文件 | IM 附件和原生 type=8 文件卡，不受企业服务部署影响 |
| A14 | 链接与卡片同时保留 | final 保留原链接文字与附件地址；图片语法不变 |
| A15 | workflow 与 ToolCall 边界 | final 后确定性路由；主动上传结果零次二次上传 |
| A16 | 文件卡部分失败、未知结果及取消 | 独立回执、稳定编号、明确提示、不重跑、不重复卡片 |

## 2026-10-26 补充体验

用户复核产品意图后撤销自动企业服务路由：群里发文件不应新增文档 ACL、后加入成员和转发访问障碍；服务部署只表示能力，不表示协作意图。删除企业服务开关、探测、创建/导入、授权及相关专项脚本和测试。在线协作只走明确的 LLM ToolCall。最终 Markdown 的附件链接与原生文件卡同时存在，图片内嵌展示。

原生文件消息合同经 octo-web FileContent 和 File 渲染器确认：type=8，包含 url/name/size/extension；不是 type=17 互动卡或 type=18 文档分享卡。上传采用已验证的预签名 PUT/独立 downloadUrl，文件卡沿原 WS 发送机制确认，不另建 REST 重试体系。

## PR #187：完成后的停止行为

用户确认采用最小修复，沿用最终交付完成前可停止的行为。模型终态 `completed` 只证明执行完成，不代表自动上传、文件卡及最终文本已经交付。`/stop`、`/cancel` 在展示收尾和后续交付期间取消剩余交付；不撤销已经确认的模型终态，不再次调用模型取消，也不回滚已经完成的上传或消息。最终交付完成后，停止命令沿用“当前没有可停止的执行”反馈。

实现只调整执行登记到交付登记的交接顺序：先登记交付 controller，再移除 task 和 active invocation，然后等待 `presentation.finish()`；返回后检查同一 controller，已取消则退出。所有提前退出均释放该 controller。展示清理可以继续返回或报错，不以清理结束重新创建可用交付资格。reset 的代次隔离和 shutdown 的共享有界 drain 保持既有合同。

验收用 gate 延迟 `presentation.finish()`，在其等待期间触发 `/stop`、reset、shutdown 或 stop 后展示清理报错：后续上传、文件卡及 final 数量均为 0，模型调用为 1，已完成模型取消调用为 0，执行终态仍为 `completed`；正常对照应交付一次且释放取消登记。既有执行中与上传中取消测试继续验证相邻阶段。

## 可执行性：96/100

评分为实施准备度，不是完成率或成功概率。责任与触发 20/20，API 合同与源码证据 19/20，文件访问及失败边界 20/20，生命周期及接入位置 19/20，验收可操作性 18/20。每项均有具体模块、输入、输出和验证入口，超过用户要求的 95 分。原生文件卡字段和发送合同已取得源码证据，实际验证单独记录。

剩余限制：线上部署可能与测试环境不同；未在 Windows 上运行本次文件系统测试；本版无持久上传账本，进程中断后不承诺跨重启事务恢复；长期 URL 不含临时签名已验证，但未等待跨日有效期。若服务只返回临时下载链接，本版明确报告交付失败，不伪造长期地址。
