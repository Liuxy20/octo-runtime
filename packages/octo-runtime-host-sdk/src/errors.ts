import {
  describeStartupError,
  type StartupContext,
  type StartupDiagnostic
} from "@mininglamp-oss/octo-runtime-executor-kernel";

export class HostRuntimeError extends Error {
  readonly diagnostic?: StartupDiagnostic;
  constructor(
    readonly code: string,
    readonly scope: string,
    readonly retryable: boolean,
    message: string,
    options?: ErrorOptions & { context?: StartupContext }
  ) {
    super(message, options);
    this.name = "HostRuntimeError";
    // Host 的执行/身份错误仍属于原 scope；只有启动相关 Home 错误附加启动投影。
    if (/^HOME_|^(LOCAL_STATE_INVALID|WRITE_FAILED)$/.test(code))
      this.diagnostic = describeStartupError(this, {
        component: "host",
        phase: "created",
        context: options?.context
      });
  }
}
