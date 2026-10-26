import {
  appendFileSync,
  constants,
  openSync,
  fstatSync,
  lstatSync,
  readSync,
  closeSync
} from "node:fs";
import { isMainThread } from "node:worker_threads";
import WebSocket from "ws";

function readControl(controlFile) {
  const entry = lstatSync(controlFile);
  if (!entry.isFile()) throw new Error("QA_FAULT_CONTROL_UNSAFE");
  const fd = openSync(
    controlFile,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      (process.platform !== "win32" && info.mode & 0o022) ||
      entry.dev !== info.dev ||
      entry.ino !== info.ino
    )
      throw new Error("QA_FAULT_CONTROL_UNSAFE");
    if (info.size > 4096) throw new Error("QA_FAULT_CONTROL_TOO_LARGE");
    const bytes = Buffer.alloc(4097);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > 4096) throw new Error("QA_FAULT_CONTROL_TOO_LARGE");
    const value = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    if (
      !value ||
      typeof value.blocked !== "boolean" ||
      !Number.isSafeInteger(value.drop) ||
      value.drop < 0 ||
      Object.keys(value).some((key) => !["blocked", "drop"].includes(key))
    )
      throw new Error("QA_FAULT_CONTROL_INVALID");
    return value;
  } finally {
    closeSync(fd);
  }
}

/** 只在本验证进程注入测试站鉴权失联和 socket 丢失，不改变系统网络。 */
export function recoveryLiveFaults({ controlFile, eventsFile }) {
  // 初始化拒绝不安全输入；后续原子替换仍逐次在实际描述符上校验。
  let current = readControl(controlFile);
  const fetchOriginal = globalThis.fetch;
  const sendOriginal = WebSocket.prototype.send;
  const sockets = new Set();
  let lastDrop = 0,
    failures = 0,
    lastError,
    timer,
    disposed = false;
  const record = (event) =>
    appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), ...event }) + "\n", {
      mode: 0o600
    });
  const control = () => {
    try {
      const next = readControl(controlFile);
      current = next;
      failures = 0;
      lastError = undefined;
      return next;
    } catch (error) {
      failures = Math.min(failures + 1, 5);
      const code =
        error instanceof SyntaxError ? "QA_FAULT_CONTROL_INVALID" : (error.code ?? error.message);
      if (lastError !== code) record({ event: "control_error", code });
      lastError = code;
      return undefined;
    }
  };
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
    const testAuth =
      parsed.origin === "https://im-test.deepminer.com.cn" &&
      parsed.pathname === "/api/v1/auth/verify-bot";
    if (testAuth) control();
    if (testAuth && current.blocked) {
      record({ event: "blocked_auth" });
      throw new TypeError("RECOVERY_QA_LOCAL_NETWORK_FAULT");
    }
    return fetchOriginal(url, init);
  };
  WebSocket.prototype.send = function (...args) {
    if (!sockets.has(this)) {
      sockets.add(this);
      this.once("close", () => sockets.delete(this));
    }
    return sendOriginal.apply(this, args);
  };
  const tick = () => {
    if (disposed) return;
    const next = control();
    if (next && next.drop > lastDrop) {
      lastDrop = next.drop;
      record({ event: "drop", sockets: sockets.size });
      for (const socket of sockets) socket.terminate();
    }
    timer = setTimeout(tick, next ? 100 : Math.min(100 * 2 ** failures, 2000));
    timer.unref();
  };
  timer = setTimeout(tick, 100);
  timer.unref();
  return () => {
    disposed = true;
    clearTimeout(timer);
    globalThis.fetch = fetchOriginal;
    WebSocket.prototype.send = sendOriginal;
  };
}

// 日志 worker 继承 NODE_OPTIONS，但故障只由服务主线程注入和记录。
if (isMainThread && process.env.OCTO_RECOVERY_QA_CONTROL && process.env.OCTO_RECOVERY_QA_EVENTS)
  recoveryLiveFaults({
    controlFile: process.env.OCTO_RECOVERY_QA_CONTROL,
    eventsFile: process.env.OCTO_RECOVERY_QA_EVENTS
  });
