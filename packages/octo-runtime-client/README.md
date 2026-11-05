# @mininglamp-oss/octo-runtime-client

Standalone Node.js SDK for an **existing local Executor Kernel**. No CLI, server, Core, Provider Adapter or Extra is installed. Node.js 24 or 26 is required.

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
    for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
      console.log(event);
    }
  } finally {
    // Close releases this client's connections; it does not stop the Kernel or cancel runs.
    client.close();
  }
}
```

The root exports `attachKernel`, `KernelClient`, `KernelError`, `AsyncQuestionReply`, invocation lifecycle types and common protocol types. `/protocol` exports all shared public protocol types, constants and validators. `/protocol/browser` and `/protocol/notification` retain specialized protocol entrypoints. Raw schemas are available at `/protocol/schema.json`, `/protocol/ipc-schema.json`, `/protocol/ipc-fixtures.json` and `/protocol/behavior.json`. Schemas are copied from the authoritative private protocol package, which is bundled rather than independently published.

`/internal` contains same-version Runtime composition helpers, including pure path validation and invocation bookkeeping. It is not a stable application API and does not construct services. Ordinary applications use the root API.

`invoke` owns bounded call registration and observation recovery. Cancellation ACK is distinct from execution completion. Consumers must finish their own persistence/delivery work and explicitly cancel unwanted runs. Owners stop admission, drain their registered calls within a deadline, finish business cleanup, then close. `submit`/`subscribe` are advanced APIs whose callers manage their own run references, cancellation and observation. A lost ACK is queried using the original identity; execution and control actions with unknown outcomes are never automatically resubmitted.

Both public npm packages are released from one stable tag with matching versions. The full Runtime bundles its own client and protocol under its internal node_modules, preserving single-archive offline installation. The standalone client bundles only the private protocol. Both use the same source implementation; neither requires downloading the other public artifact. Existing full SDK `/executor-kernel` and `/protocol` imports remain supported. Service creation, direct Core use and Extra construction require `@mininglamp-oss/octo-runtime`.

Values and error classes are shared within each distribution. Installing both distributions may create separate module instances even at the same version: do not compare functions/classes across distributions or rely on cross-copy `instanceof` or invocation rejection evidence. Use the error class from the producing API, or inspect its public `code`. Client interfaces and protocol data remain structurally compatible.

Package versions are distinct from IPC v1, Run 7, Context v3 and Adapter transport 2. Matching release pairs are supported. Cross-version attachment requires the same wire contracts and support for every field/method used; arbitrary older combinations are not guaranteed. There is no negotiation or compatibility translation. `status()` rejects unsupported IPC versions with `KERNEL_IPC_VERSION_UNSUPPORTED` and malformed status with `INVALID_RESPONSE`; submission uses that existing status query before writing an invocation. Existing RPC and frame validators report unsupported requests/frames; the client does not silently retry execution or downgrade. Schema provenance is the same tagged repository revision as the package, with build source recorded in build-info.json. This extraction does not add browser/network transport, remote authentication, Provider installation or Home initialization.

中文：本包只连接宿主提供的本地 Kernel，不拥有服务。根入口提供客户端、错误、调用登记和旁路问题接口；`/protocol` 提供共享类型与校验，`/protocol/*.json` 提供原始 schema。完整 Runtime 原入口继续兼容。两个 npm 包从同一 tag 同版本发布，完整包内置 client/protocol，独立 client 仅内置 protocol；任一 tgz 均可单独离线安装。每个发行物内部共享错误与协议值；跨发行物可能是两个模块副本，不承诺 ===、instanceof 或 WeakSet 证据互认。npm 版本与 IPC/Run/Context 版本分别管理；跨版本须满足实际 wire 合同，无自动协商、降级或重放。取消回执不等于执行完成，关闭连接不取消 Run，业务收尾及服务生命周期始终归宿主。
