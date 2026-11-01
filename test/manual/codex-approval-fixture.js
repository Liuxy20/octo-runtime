import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

// 真实 Writable 的回调和 highWaterMark 控制背压；Provider stdout 独立继续消费。
export function approvalFixture({ hold = false, highWaterMark = 16 * 1024 } = {}) {
  const child = new EventEmitter();
  const writes = [];
  let held;
  let started = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  const close = (code = 0) => {
    if (child.exitCode !== null) return;
    child.exitCode = code;
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code, null);
  };
  child.kill = () => {
    close(1);
    return true;
  };
  child.stdin = new Writable({
    highWaterMark,
    write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString());
      writes.push(message);
      if (message.method) {
        const result =
          message.method === "config/read"
            ? { config: {} }
            : ["thread/start", "thread/resume"].includes(message.method)
              ? { thread: { id: "thread-fixture" } }
              : message.method === "skills/list"
                ? { data: [] }
                : message.method === "turn/steer"
                  ? { turnId: "turn-fixture" }
                  : message.method === "turn/start"
                    ? { turn: { id: "turn-fixture" } }
                    : {};
        send({ id: message.id, result });
        if (message.method === "turn/start") started = true;
      }
      if (!message.method && hold) held = callback;
      else callback();
    },
    final(callback) {
      close();
      callback();
    }
  });
  return {
    child,
    writes,
    send,
    close,
    get started() {
      return started;
    },
    get responses() {
      return writes.filter((m) => !m.method);
    },
    release() {
      hold = false;
      const callback = held;
      held = undefined;
      callback?.();
    },
    request(id, method = "item/commandExecution/requestApproval", extra = {}) {
      send({
        id,
        method,
        params: {
          threadId: "thread-fixture",
          turnId: "turn-fixture",
          command: "read-only-fixture",
          ...extra
        }
      });
    },
    complete() {
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-fixture",
          turnId: "turn-fixture",
          turn: { status: "completed" }
        }
      });
    }
  };
}
export async function until(predicate, message = "condition", timeout = 2000) {
  const end = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > end) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
