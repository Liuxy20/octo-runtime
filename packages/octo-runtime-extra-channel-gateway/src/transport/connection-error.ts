/** 只携带连接协议事实；恢复策略由 Bot 编排决定，不保留响应正文或凭据。 */
export class ImConnectionError extends Error {
  constructor(
    code: string,
    readonly retryable: boolean,
    readonly retryAfterMs = 0
  ) {
    super(code);
  }
}

/**
 * 保留 WuKong 原因码，区分连接中断与明确拒绝；不把服务端主动断开等同于凭据失效。
 * DISCONNECT 与失败 CONNACK 均默认允许重新鉴权建联，覆盖滚动更新、节点迁移和新增码。
 * 只有机器可读的明确认证、权限或协议拒绝才永久失败，不由原因文案猜测所有权。
 */
export function wukongConnectionFailure(
  phase: "CONNECT_REJECTED" | "SERVER_DISCONNECTED",
  reason: number
): ImConnectionError {
  // 认证、黑/白名单、封禁、禁止发送及明确协议/密钥错误，不靠重新连接消除。
  const terminal = [2, 4, 8, 9, 11, 13, 19, 20, 21, 23, 27].includes(reason);
  return new ImConnectionError(`IM_${phase}_${reason}`, !terminal);
}

/** 将连接依赖的异常归一为脱敏恢复事实；显式分类优先，调用方据此安排回收后的重试。 */
export function connectionFailure(error: unknown): ImConnectionError {
  if (error instanceof ImConnectionError) return error;
  const code =
    error instanceof Error && /^IM_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "IM_CONNECTION_FAILED";
  // 未分类异常可能来自宿主凭据服务或连接依赖，不能单凭缺少类型就永久停止恢复。
  // 本地已确认的身份、配置、协议及资源所有权错误仍须修正后才能重新连接。
  const terminal = [
    "IM_CREDENTIALS_REQUIRED",
    "IM_BOT_TOKEN_INVALID",
    "IM_BOT_IDENTITY_MISMATCH",
    "IM_TENANT_NOT_ACTIVE",
    "IM_AUTH_IDENTITY_INVALID",
    "IM_REGISTRATION_INVALID",
    "IM_WS_URL_INVALID",
    "IM_WS_TLS_REQUIRED",
    "IM_ALREADY_CONNECTED",
    "IM_DISPOSE_FAILED",
    "IM_TRANSPORT_DISPOSE_FAILED",
    "IM_FIELD_TOO_LARGE",
    "IM_FRAME_TRUNCATED",
    "IM_BINARY_REQUIRED",
    "IM_FRAME_TOO_LARGE",
    "IM_LENGTH_INVALID",
    "IM_KEY_INVALID",
    "IM_HANDSHAKE_REQUIRED",
    "IM_PROTOCOL_ERROR",
    "IM_MESSAGE_KEY_INVALID",
    "IM_PAYLOAD_INVALID"
  ].includes(code);
  return new ImConnectionError(code, !terminal);
}

export async function connectionFetch(
  url: string,
  init: RequestInit,
  phase: "AUTH" | "REGISTER"
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError")
      throw new ImConnectionError(`IM_${phase}_TIMEOUT`, true);
    if (init.signal?.aborted) throw error;
    // fetch 的 TypeError 可能包含敏感 URL；只暴露阶段和确定的网络分类。
    throw new ImConnectionError(`IM_${phase}_NETWORK_ERROR`, true);
  }
}

export async function httpConnectionFailure(
  response: Response,
  phase: "AUTH" | "REGISTER"
): Promise<ImConnectionError> {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  const retryAfterMs = Math.max(0, seconds !== undefined ? seconds * 1000 : date - Date.now());
  await response.body?.cancel();
  // 仅明确认证、资源/请求或协议错误停止；服务超时、冲突、限流及未知服务故障默认重试。
  // 禁止重定向仍是接入约束，不能自动把凭据带到另一个地址。
  const terminal =
    response.status < 400 ||
    [
      400, 401, 403, 404, 405, 407, 410, 411, 413, 414, 415, 416, 417, 422, 426, 428, 431, 451
    ].includes(response.status);
  return new ImConnectionError(
    `IM_${phase}_HTTP_${response.status}`,
    !terminal,
    Number.isFinite(retryAfterMs) ? retryAfterMs : 0
  );
}

export async function connectionJson(
  response: Response,
  phase: "AUTH" | "REGISTER",
  invalidCode: string
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw new ImConnectionError(`IM_${phase}_TIMEOUT`, true);
    if (error instanceof TypeError) throw new ImConnectionError(`IM_${phase}_NETWORK_ERROR`, true);
    throw new ImConnectionError(invalidCode, false);
  }
}
