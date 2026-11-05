export { RUNTIME_RUN_CONTRACT } from "@mininglamp-oss/octo-runtime-protocol";
export type {
  RuntimeLoggingOptions,
  ExtraStatusRecord
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
export * from "./extras.js";
export * from "./extra-config.js";
export * from "./context-loader.js";
export * from "./extra-service.js";
export type { ExtraExecution, ExtraExecutionContext } from "./execution.js";
export * from "./endpoint.js";
export * from "./home.js";
export * from "./identity.js";
export * from "./extra-commands.js";

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
