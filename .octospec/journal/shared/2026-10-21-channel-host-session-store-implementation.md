---
type: Journal
title: Gateway 宿主会话存储库内交付
description: 记录工厂接线、逐 Bot 句柄生命周期、SDK 文档和库内验证，宿主真实测试按用户安排在 main 合入后执行。
tags: [extra, lifecycle, channel, session, storage, testing]
---

# 实现与边界

基于 `main@0c1d1c9`、分支 `feat/channel-host-session-store`，用户在完成规划评估后明确授权实施并 merge 到 main，再由用户执行真实测试。工作目录 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-channel-host-session-store`。保留 Git 配置作者，GitHub PR/提交使用英文，提交附 Codex trailer。

实现 [Gateway 专属依赖](../../../packages/octo-runtime-extra-channel-gateway/src/ports.ts)、[真实工厂接线](../../../packages/octo-runtime-extra-channel-gateway/src/extra.ts)、[endpoint 所有权](../../../packages/octo-runtime-extra-channel-gateway/src/lifecycle/manager.ts)和[句柄包装](../../../packages/octo-runtime-extra-channel-gateway/src/application/host-session-store.ts)。初始化前登记、配置双向隔离、必需/可选方法及 this 转发、尾写后撤权、可异步 close 一次、失败阻止替换与迟到回收均有回归。默认 Memory、借用 sessions、兄弟 Extra/Kernel 及统一 invoke 合同保留。

公共类型仅进入 `/extras/channel-gateway`，没有新增通用 `/extra` 字段或特化 loader。没有增加 SQLite 包依赖或 Runtime 适配实现；新增测试/样例使用宿主内存替身。SQLite 的驱动、建表/迁移、事务、持久落盘和真实 Electron 集成都归宿主。

两篇根 SDK 指南、Gateway README、Extra 指南及规则同步概念、全部方法语义、装配/关闭/错误、scope、数据保留及最新 main submodule 接入。[可运行样例](../../../test-support/public-extra/gateway-store.mts)由包外 verifier 编译运行；SQLite 片段明确为宿主示意，不用缺失 helper 冒充完整项目。逐项证据见 [实施验收](../../tasks/channel-host-session-store/implementation.md)。

## 验证结果

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`：通过。
- `pnpm test:suites`：WebUI 35/35，Node 1401 通过、10 条件跳过，0 失败；Node 总计 1411。
- `node --unhandled-rejections=strict --test test/gateway-host-session-store.test.js`：35/35；包含真实 Kernel IPC + 原生 Gateway 的尾写和兄弟 Run 隔离。
- 全量复跑曾暴露新增测试在关闭前已经消费完更新，不能可靠注入尾保存故障；改用真实 IPC response 屏障，先保留已经产生的 session.update，再在 owner close 后释放，修正后专项和全量均通过。未将 Provider 取消后生成新更新作为合同。
- `node scripts/pack-release.mjs` + `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`：离线安装、strict/skipLibCheck=false 类型、实际 Kernel/Extra、Gateway 工厂及默认 Memory、UI 静态资源和 CLI 通过。测试包为源码占位版本，不执行发布。
- OKF 格式/本地链接检查通过：283 个单元、20 条规则、1797 个本地文件链接；diff whitespace 检查通过。干净提交 build-info/tgz 及 GitHub CI 在提交后核对，不能将之前 dirty 测试包称作正式发行。

## 用户后续真实验收

A05/A23/A24、D09 以及 D07 的消费工程升级由用户在 main 合入后完成：真实 SQLite 文件重开、Provider 续聊/恢复失败、reset、切账号、共享 DB、Electron/内置 Node/驱动版本及平台结果。此处没有执行真实 IM/Provider，也没有宣称 Electron、SQLite 持久性或全部平台已通过。源码消费方更新到当时最新远端 main 并记录 SHA/lockfile，不依赖功能分支或 #65。

完整业务验收保持待确认；本轮交付库内实现、可执行 SDK 示例与文档。未发布 npm，未修改宿主数据库或凭据。
