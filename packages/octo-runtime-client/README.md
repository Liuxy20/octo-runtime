# @mininglamp-oss/octo-runtime-client

Standalone Node.js SDK for an **existing local Executor Kernel**. No CLI, server, Core, Provider Adapter or business consumer is installed. Node.js 24 or 26 is required.

```sh
npm install @mininglamp-oss/octo-runtime-client
```

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime-client/protocol";

// The host supplies an existing Unix socket or Windows named pipe endpoint.
async function execute(endpoint: string, input: InvokeInput) {
  const client = attachKernel({ endpoint });
  try {
    const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
    for await (const event of client.invoke(
      { ...content, parts, protocol_mode: "canonical" },
      sessionId,
      providerSession,
      agentEnv
    )) {
      console.log(event);
    }
  } finally {
    // Close releases this client's connections; it does not stop the Kernel or cancel runs.
    client.close();
  }
}
```

The root exports `attachKernel`, `KernelClient`, `KernelError`, `AsyncQuestionReply`, invocation lifecycle types and common protocol types. `/protocol` exports all shared public protocol types, constants and validators. `/protocol/browser` and `/protocol/notification` retain specialized protocol entrypoints. The two Draft-07 schemas are available at `/protocol/schema.json` and `/protocol/ipc-schema.json`. `/protocol/ipc-fixtures.json` is a separate, intentionally published conformance sample set, not a schema. Other test fixtures are not shipped. The private protocol package is bundled rather than independently published.

Schema cleanup removes `/protocol/behavior.json`: client limits, timeouts and retry defaults remain owned by the existing client implementation, without another config copy. The IPC Schema `$id` now ends in `kernel-ipc:v2`, matching the existing IPC version 2; update references registered under the old v1 identifier. Unused channel/history types, their validators, and `x-octo-methods` metadata are removed. See the [complete upgrade notes](../octo-runtime-protocol/README.md) for the public deletion list.

A standard Draft-07 validator enforces standard structural constraints, but it needs explicit support for `x-octo-*` semantic checks. Existing runtime validators enforce byte/depth budgets, Unicode, uniqueness, cross-field and lifecycle constraints. Type generation does not replace those checks. The IPC version and Run error-code list are generated from the Schema to avoid independent declarations.

`/internal` contains same-version Runtime composition helpers, including pure path validation and invocation bookkeeping. It is not a stable application API and does not construct services. Ordinary applications use the root API.

`invoke` owns bounded call registration and observation recovery. Cancellation ACK is distinct from execution completion. Consumers must finish their own persistence/delivery work and explicitly cancel unwanted runs. Owners stop admission, drain their registered calls within a deadline, finish business cleanup, then close. `submit`/`subscribe` are advanced APIs whose callers manage their own run references, cancellation and observation. A lost ACK is queried using the original identity; execution and control actions with unknown outcomes are never automatically resubmitted.

Both public npm packages are released from one stable tag with matching versions. The full Runtime bundles its own client and protocol under its internal node_modules, preserving single-archive offline installation. The standalone client bundles only the private protocol. Both use the same source implementation; neither requires downloading the other public artifact. Existing full SDK `/executor-kernel` and `/protocol` imports remain supported. Native service creation and direct Core use take source workspace dependencies on Kernel/Core, shared helpers and selected Adapters. See [SDK integration](../../docs/en/getting-started/sdk.md); these private source packages are not independently published npm packages.

Values and error classes are shared within each distribution. Installing both distributions may create separate module instances even at the same version: do not compare functions/classes across distributions or rely on cross-copy `instanceof` or invocation rejection evidence. Use the error class from the producing API, or inspect its public `code`. Client interfaces and protocol data remain structurally compatible.

Package versions are distinct from IPC v2, Run 7, Context v3 and Adapter transport 2. Matching release pairs are supported. Cross-version attachment requires the same wire contracts and support for every field/method used; arbitrary older combinations are not guaranteed. There is no negotiation or compatibility translation. `status()` rejects unsupported IPC versions with `KERNEL_IPC_VERSION_UNSUPPORTED` and malformed status with `INVALID_RESPONSE`; submission uses that existing status query before writing an invocation. Existing RPC and frame validators report unsupported requests/frames; the client does not silently retry execution or downgrade. Schema provenance is the same tagged repository revision as the package, with build source recorded in build-info.json. This extraction does not add browser/network transport, remote authentication, Provider installation or Home initialization.

中文：本包只连接宿主提供的本地 Kernel，不拥有服务。根入口提供客户端、错误、调用登记和旁路问题接口；`/protocol` 提供共享类型与校验，`/protocol/schema.json` 与 `/protocol/ipc-schema.json` 提供两个 Draft-07 Schema，`/protocol/ipc-fixtures.json` 单独提供刻意公开的一致性样本。`/protocol/behavior.json` 已删除，默认值由客户端实现维护；IPC Schema 标识改为 v2，实际 IPC 版本不变。闲置渠道/历史类型和校验器的删除清单见协议升级说明。标准校验器须额外实现 `x-octo-*` 才能检查相应语义；手写运行时校验仍保留。两个 npm 包从同一 tag 同版本发布，完整包内置 client/protocol，独立 client 仅内置 protocol；任一 tgz 均可单独离线安装。每个发行物内部共享错误与协议值；跨发行物可能是两个模块副本，不承诺 ===、instanceof 或 WeakSet 证据互认。npm 版本与 IPC/Run/Context 版本分别管理；跨版本须满足实际 wire 合同，无自动协商、降级或重放。取消回执不等于执行完成，关闭连接不取消 Run，业务收尾及服务生命周期始终归宿主。

Business channels use the independent `@mininglamp-oss/octo-channel-gateway` package and only the public client.

中文：CLI 启动执行服务后，独立 App 只依赖本 client；纯原生宿主从源码 workspace 按需依赖 Kernel/Core、公共辅助包与所选 Adapter，不通过 CLI 聚合包接入。依赖、加载和所有权见 [SDK 接入](../../docs/zh-CN/getting-started/sdk.md)。

For local Agent execution, applications must pass an already prepared absolute directory through a path-only `octo.execution/workspace` item. Client/Kernel do not choose cwd, create a directory or recreate it during recovery. External/preset Agents that own their workspace can omit the local override. Old `mode` payloads are removed without compatibility conversion. See [workdir validation, error codes and migration](../../docs/en/reference/invoke-input.md). The independent Gateway still requires its own workspace and prompt migration before adopting this release.

中文：本地执行必须显式传入已经准备好的绝对目录（仅含 path 的 workspace item）；client/Kernel 不默认选择 cwd、不创建目录，也不在恢复时补建。自行管理工作区的外部/preset Agent 可省略本地覆盖。旧 mode payload 无兼容转换；目录错误码与迁移见输入参考。独立 Gateway 的工作区与提示词仍须另行迁移。
