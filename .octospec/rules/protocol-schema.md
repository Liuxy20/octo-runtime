---
type: Rule
title: 协议 Schema 与生成合同
description: Schema、生成类型及运行时校验的职责和更新流程。
tags: ["protocol","schema"]
timestamp: 2026-10-24T00:00:00Z
implementation_baseline: 445d2bb
id: runtime-protocol-schema
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","test/*protocol*","test/context-*"]
  touches: ["protocol","schema"]
source: self
supersedes: []
---

# Protocol Schema 与类型生成

调用关系、协议分层、执行时序与审批／追问的回答路径见 [总体协议与调用设计](protocol-design.md)。本文维护 Schema 和生成流程。

可序列化数据的结构来源为 [protocol.schema.json](../../packages/octo-runtime-protocol/schema/protocol.schema.json)。[gen-types.mjs](../../packages/octo-runtime-protocol/scripts/gen-types.mjs) 使用 `json-schema-to-typescript` 生成 [protocol-types.ts](../../packages/octo-runtime-protocol/src/generated/protocol-types.ts)，不要手工修改生成文件。

## 当前边界

自有 Adapter capabilities、执行计划 required_capabilities 以及 ExecutionTarget 预留设计已经删除。不得在 schema 或生成类型中保留 AbilityProvider、executor_id、provider_binding_ref 的占位定义。Provider 原生协议的同名 capabilities 不属于此次删除范围，见 [Adapter 元数据](adapter-metadata.md)。

Schema 定义 ProviderSession、AgentConfig、Context、执行计划、Host 帧和 InvokeRequest wire 等数据形状。字段格式、权限和跨字段约束还由 Protocol 中相应的运行时校验器处理；生成 TypeScript 类型本身不会在运行时校验输入。

运行时常量、泛型 CanonicalEvent 以及带 `AbortSignal` 的 InvokeRequest 组合留在 [src/index.ts](../../packages/octo-runtime-protocol/src/index.ts)。函数、活对象及 AbortSignal 不通过 JSON wire 传输。

当前 Kernel、worker 入口及 Host SDK 是 TypeScript 实现。`native/` 提供 Go、Python 附着客户端及各自的 playboard demo；模型、校验规则、行为常量和 RPC 方法从 Schema 及 `kernel-client.behavior.json` 生成，客户端/生命周期在各语言包内单份维护。原生客户端只连接已有服务，不代启 Node/CLI，不拥有 Kernel。

Native SDK 按一份生成源码和一份手写源码组织：Python 为 `octo_runtime_generated.py` / `client.py`，`__init__.py` 仅作公开 API 导出；Go 为 `octo_runtime_generated.go` / `client.go`，Go 另有极薄的 `pipe_windows.go` 绑定 Windows 专用 API。Transport 和 codec 属于手写实现内部，不再单独拆文件；平台选择由 SDK 完成。按用户最新要求，native SDK、demo 及相关代码注释使用英文；核心入口仍须解释所有权、取消和失败边界。

生成入口为 `node native/codegen/generate.mjs`，`--check` 校验完整产物及输入/生成器 hash。Native 不接入 GitHub CI；生成器与 native 测试按需本地运行，SDK 安装和根 Runtime `build`/`prepare` 不调用 native 工具链。平台实测范围见 [Issue 51 实施记录](../tasks/51-native-rpc-clients/implementation.md)，目录中存在 Windows transport 不等于已通过实机验证。

## 修改流程

1. 修改 Schema 及相关运行时校验器。
2. 更新共享正反 fixtures 和受影响消费者。
3. 重新生成类型并构建：

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm --filter @mininglamp-oss/octo-runtime-protocol build
```

Protocol 包的 `build` 自动运行生成器。验证入口包括 `test/context-protocol.test.js` 和 `packages/octo-runtime-protocol/test/*.test.js`；具体测试范围随修改的合同决定。

Run 固定为 7、Context 固定为 `octo.context-envelope/v3`，Adapter transport 使用自身的版本 2。新增可选字段不机械升级这些版本，不新增旧格式识别、转换或回退。协议变更还必须同步 Worker、Harness 和桌面应用，构建并重启受影响实例，在 im-test 验证实际注册与执行；仅生成类型或全局链接不能代替实机验证。
