// Kernel transport delegates execution to the single Core implementation.
export {
  type HostedAdapter,
  type HostedAdapterMetadata,
  DEFAULT_RUNTIME_LIMITS,
  prepareRunContext,
  type PreparedRunContext,
  type WorkspaceAssignments
} from "@mininglamp-oss/octo-runtime-executor-core";
export { HostRunService } from "./host-run-service.js";
export { startKernelServer, type KernelServerOptions } from "./server.js";
export { attachKernel } from "./client.js";
export * from "./types.js";
export {
  InvocationManifest,
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
