export {
  createExtraService,
  componentEndpoint,
  componentServiceId,
  homeHash,
  normalizedHome
} from "@mininglamp-oss/octo-runtime-host-sdk";
export type {
  ExtraService,
  ExtraServiceOptions,
  ExtraServiceStatus
} from "@mininglamp-oss/octo-runtime-host-sdk";
export type {
  RuntimeLoggingOptions,
  ExtraStatusRecord
} from "@mininglamp-oss/octo-runtime-host-sdk";
export {
  createKernelService,
  ServiceInitializationError,
  KernelEndpointUpgradeError
} from "./executor-kernel.js";
export type {
  KernelService,
  KernelServiceOptions,
  KernelServiceStatus,
  ServiceCleanupResult,
  ServiceLifecycle,
  ServicePhase
} from "./executor-kernel.js";

export {
  RuntimeHomeError,
  normalizeRuntimeHome,
  validateRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export type { StartupPathDiagnostic } from "@mininglamp-oss/octo-runtime-executor-kernel";
