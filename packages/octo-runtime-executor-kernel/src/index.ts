// Kernel 在宿主进程拥有 Core 与 Run 管理；所有业务调用统一经过本地 RPC。
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
export {
  RuntimeHomeError,
  normalizeRuntimeHome,
  validateRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint,
  runtimePathFailure,
  kernelStartupPaths,
  prepareHomeDirectory,
  type StartupPathDiagnostic,
  type RuntimePath
} from "./runtime-home.js";
export { attachKernel } from "./client.js";
export { AsyncQuestionReply, type AsyncQuestionReplyResult } from "./async-question-reply.js";
export { isInvocationNotSubmitted, admissionClosedError } from "./submission-error.js";
export * from "./types.js";
export {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  reapOrphanedInvocationManifest
} from "./invocation-manifest.js";
export { acquireEndpoint } from "./endpoint.js";
