export { RUNTIME_RUN_CONTRACT } from "@mininglamp-oss/octo-runtime-protocol";
export type { RuntimeLoggingOptions } from "@mininglamp-oss/octo-runtime-adapter-sdk";
export * from "./endpoint.js";
export * from "./home.js";
export * from "./identity.js";

export {
  RuntimeHomeError,
  normalizeRuntimeHome,
  validateRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint,
  runtimePathFailure,
  type StartupPathDiagnostic
} from "@mininglamp-oss/octo-runtime-executor-kernel";
export { HostRuntimeError } from "./errors.js";
export {
  STARTUP_CATALOG,
  describeStartupError,
  formatStartupDiagnostic,
  StartupError,
  type StartupDiagnostic,
  type StartupContext,
  type StartupLocation,
  type StartupCause
} from "@mininglamp-oss/octo-runtime-executor-kernel";
