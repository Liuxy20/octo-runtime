import net from "node:net";
import { isAbsolute } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const transientCodes = new Set([
  "ENOENT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "KERNEL_UNAVAILABLE",
  "KERNEL_TIMEOUT",
  "CONNECTION_CLOSED",
  "QA_STATUS_CLOSED",
  "QA_STATUS_TIMEOUT"
]);

/** 只等待可重试的只读探针；子进程退出及未知错误不能被轮询吞掉。 */
export async function waitFor(
  predicate,
  reason,
  timeout = 30000,
  { beforeAttempt = () => {}, interval = 200 } = {}
) {
  const until = performance.now() + timeout;
  let lastError;
  do {
    beforeAttempt();
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      if (!transientCodes.has(error?.code ?? error?.message) && error?.retryable !== true)
        throw error;
      lastError = error;
    }
    const remaining = until - performance.now();
    if (remaining <= 0) break;
    await pause(Math.min(interval, remaining));
  } while (performance.now() < until);
  throw new Error(reason, { cause: lastError });
}

/** status 响应、错误、超时及提前关闭共用一次完成路径，调用方拥有该探针连接。 */
export function inspectStatus(endpoint, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.setEncoding("utf8");
    let text = "",
      done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      socket.setTimeout(0);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    socket.setTimeout(timeout, () => finish(new Error("QA_STATUS_TIMEOUT")));
    socket.once("error", (error) => finish(error));
    socket.once("close", () => finish(new Error("QA_STATUS_CLOSED")));
    socket.once("connect", () => socket.write('{"jsonrpc":"2.0","id":"qa","method":"status"}\n'));
    socket.on("data", (chunk) => {
      if (done) return;
      text += chunk;
      if (Buffer.byteLength(text) > 1024 * 1024)
        return finish(new Error("QA_STATUS_RESPONSE_TOO_LARGE"));
      if (!text.includes("\n")) return;
      try {
        const response = JSON.parse(text.split("\n")[0]);
        if (
          response.jsonrpc !== "2.0" ||
          response.id !== "qa" ||
          response.error ||
          !response.result ||
          Array.isArray(response.result) ||
          typeof response.result !== "object"
        )
          throw new Error("QA_STATUS_RESPONSE_INVALID");
        finish(undefined, response.result);
      } catch {
        finish(new Error("QA_STATUS_RESPONSE_INVALID"));
      }
    });
  });
}

/** 单条坏消息不影响其他回读；保留 ID 和发送者校验，坏 payload 不参与 marker 匹配。 */
export function historyMessages(messages) {
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    try {
      const payload =
        typeof message.payload === "string"
          ? JSON.parse(Buffer.from(message.payload, "base64").toString("utf8"))
          : message.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      if (payload.content !== undefined && typeof payload.content !== "string") return [];
      return [{ ...message, id: String(message.message_idstr ?? message.message_id), payload }];
    } catch {
      return [];
    }
  });
}

const environmentKeys = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "LANG",
  "LC_ALL",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
]);
const providerKeys = new Set([
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID"
]);

/** 子进程仅继承平台/代理/证书环境；只有 Kernel 可接收明确的 Codex 配置。 */
export function childEnvironment(source, { provider = false } = {}) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => environmentKeys.has(key) || (provider && providerKeys.has(key))
    )
  );
}

/** 兼容旧版 CLI 的文件凭据优先行为，显式选择 trial 独占的空账号库。 */
export function octoEnvironment(source, { token, configDirectory }) {
  if (typeof configDirectory !== "string" || !isAbsolute(configDirectory))
    throw new Error("QA_CLI_CONFIG_DIRECTORY_REQUIRED");
  return {
    ...childEnvironment(source),
    OCTO_TOKEN: token,
    OCTO_CONFIG_DIR: configDirectory,
    OCTO_API_BASE_URL: "https://im-test.deepminer.com.cn"
  };
}
