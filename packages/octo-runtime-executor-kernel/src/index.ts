// Kernel 只提供 IPC、Run 观察与 worker 监督；执行逻辑统一委托给 worker 中的 Core。
export {
  type HostedAdapter,
  type HostedAdapterMetadata,
  DEFAULT_RUNTIME_LIMITS,
  prepareRunContext,
  type PreparedRunContext,
  type WorkspaceAssignments
} from "@mininglamp-oss/octo-runtime-executor-core";
export { HostRunService } from "./host-run-service.js";
export {
  createKernelService,
  type KernelService,
  type KernelServiceOptions,
  type KernelServiceStatus
} from "./service.js";
export * from "./lifecycle.js";
export { attachKernel } from "./client.js";
export { isInvocationNotSubmitted } from "./submission-error.js";
export * from "./types.js";
export {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  processStartIdentity,
  reapOrphanedInvocationManifest
} from "./invocation-manifest.js";
export { readAdapterConfigurations } from "./runtime-configuration.js";
export { spawnWorker } from "./process.js";
export { serveWorker } from "./serve.js";
export type { WorkerProcess, SpawnWorkerOptions } from "./process.js";
export {
  WorkerRpcClient,
  WorkerRpcServer,
  type WorkerRpc,
  type RpcTrace,
  type RpcTraceDirection
} from "./rpc.js";
export { acquireEndpoint } from "./endpoint.js";
