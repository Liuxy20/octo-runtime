export {
  attachKernel,
  AsyncQuestionReply,
  KernelError,
  isInvocationNotSubmitted,
  createKernelService,
  ServiceInitializationError
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export type { HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-core";
export {
  STARTUP_CATALOG,
  describeStartupError,
  formatStartupDiagnostic,
  restoreStartupDiagnostic,
  StartupError
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export type {
  StartupCatalogEntry,
  StartupDiagnostic,
  StartupContext,
  StartupCause,
  StartupLocation
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export type {
  KernelClient,
  AsyncQuestionReplyResult,
  KernelInvocationRecord,
  KernelInvocationDrainResult,
  KernelInvocationLifecycle,
  KernelService,
  KernelServiceOptions,
  KernelServiceStatus,
  ServiceCleanupResult,
  ServiceLifecycle,
  ServicePhase,
  KernelStatus,
  LookupKey,
  RunRef,
  RunSnapshot
} from "@mininglamp-oss/octo-runtime-executor-kernel";

export {
  RuntimeHomeError,
  normalizeRuntimeHome,
  validateRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export type { StartupPathDiagnostic } from "@mininglamp-oss/octo-runtime-executor-kernel";
