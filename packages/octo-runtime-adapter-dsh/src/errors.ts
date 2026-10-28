import {
  JsonRpcResponseError,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError
} from "@deepseek-ai/dsh-sdk-client";

export const DSH_MIN_VERSION = "0.2.1-rc.4";
/** 保留原公开名称作为最低版本别名；实际安装版本由 probe 返回。 */
export const DSH_VERSION = DSH_MIN_VERSION;

const messages = {
  DSH_CONFIG_INVALID: "DeepSeek Harness configuration is invalid for this invocation.",
  DSH_ACTMODE_UNSUPPORTED: "DeepSeek Harness supports only the default actmode.",
  PROVIDER_MESSAGE_TOO_LARGE: "DeepSeek Harness protocol line exceeded the configured limit.",
  STREAM_QUEUE_ITEM_TOO_LARGE: "DeepSeek Harness event exceeded the configured queue item limit.",
  STREAM_QUEUE_BYTES_EXCEEDED: "DeepSeek Harness event queue exceeded the configured byte limit.",
  STREAM_QUEUE_ITEMS_EXCEEDED: "DeepSeek Harness event queue exceeded the configured item limit.",
  DSH_EXECUTABLE_NOT_FOUND: "The host-configured DeepSeek Harness JavaScript entry is missing.",
  DSH_VERSION_UNSUPPORTED: `DeepSeek Harness requires version >= ${DSH_MIN_VERSION}. Please upgrade DeepSeek Harness.`,
  DSH_START_FAILED: "DeepSeek Harness could not start.",
  DSH_INITIALIZE_TIMEOUT: "DeepSeek Harness initialization timed out.",
  DSH_RPC_ERROR: "DeepSeek Harness rejected a protocol request.",
  DSH_REQUEST_TIMEOUT: "DeepSeek Harness request timed out; execution may have occurred.",
  DSH_TRANSPORT_CLOSED: "DeepSeek Harness transport closed before execution was confirmed.",
  DSH_PROTOCOL_ERROR: "DeepSeek Harness returned an invalid protocol envelope.",
  DSH_TRAJECTORY_INVALID: "DeepSeek Harness execution evidence was incomplete or inconsistent.",
  DSH_SESSION_RESUME_FAILED: "DeepSeek Harness could not restore the requested session.",
  DSH_SESSION_BUSY: "The requested DeepSeek Harness session is already executing.",
  DSH_EXECUTION_FAILED: "DeepSeek Harness reported an execution failure.",
  DSH_NO_FINAL_OUTPUT: "DeepSeek Harness returned no committed assistant answer.",
  DSH_CANCEL_FAILED: "DeepSeek Harness cancellation cleanup could not be confirmed.",
  DSH_CLEANUP_FAILED: "DeepSeek Harness process cleanup could not be confirmed."
} as const;

export type DshErrorCode = keyof typeof messages;

/** 安全文本与原生原因分开；远端 message/data/stderr 不进入公共错误或日志。 */
export class DshError extends Error {
  constructor(
    readonly code: DshErrorCode,
    readonly diagnostics: Record<string, string | number | null> = {},
    options?: ErrorOptions
  ) {
    super(
      `${code}: ${messages[code]}${code === "DSH_VERSION_UNSUPPORTED" ? ` Detected version: ${diagnostics.detectedVersion ?? "unknown"}.` : ""}`,
      options
    );
    this.name = "DshError";
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nativeCode(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value)) return value;
  return undefined;
}

export function dshError(error: unknown, fallback: DshErrorCode): DshError {
  if (error instanceof DshError) return error;
  if (error instanceof RequestTimeoutError)
    return new DshError(
      fallback === "DSH_INITIALIZE_TIMEOUT" ? fallback : "DSH_REQUEST_TIMEOUT",
      {},
      { cause: error }
    );
  if (error instanceof TransportClosedError)
    return new DshError("DSH_TRANSPORT_CLOSED", {}, { cause: error });
  if (error instanceof SdkProtocolError)
    return new DshError("DSH_PROTOCOL_ERROR", {}, { cause: error });
  if (error instanceof JsonRpcResponseError) {
    const code = nativeCode(error.code);
    return new DshError("DSH_RPC_ERROR", code === undefined ? {} : { nativeCode: code }, {
      cause: error
    });
  }
  const code = record(error) ? nativeCode(error.code) : undefined;
  if (typeof code === "string" && Object.hasOwn(messages, code))
    return new DshError(code as DshErrorCode, {}, { cause: error });
  return new DshError(fallback, code === undefined ? {} : { nativeCode: code }, { cause: error });
}
