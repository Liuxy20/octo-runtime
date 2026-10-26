import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { kernelFixture } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";

function containsError(error, expected) {
  return (
    error === expected ||
    (error?.cause && containsError(error.cause, expected)) ||
    error?.errors?.some((item) => containsError(item, expected))
  );
}

test("Kernel fixture cleans its directory immediately when initialization fails", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "kf-"));
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    await rm(directory, { recursive: true, force: true });
  });
  const original = Object.assign(new Error("fixture listen denied"), { code: "EACCES" });
  t.mock.method(net.Server.prototype, "listen", function () {
    queueMicrotask(() => this.emit("error", original));
    return this;
  });
  try {
    for (const key of Object.keys(previous)) process.env[key] = directory;
    await assert.rejects(kernelFixture({ after: (cleanup) => cleanups.push(cleanup) }), (error) =>
      Boolean(containsError(error, original))
    );
    // 不等测试结束才修补遗留目录；初始化失败必须已回滚所属资源。
    assert.deepEqual(await readdir(directory), []);
    assert.equal(cleanups.length, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Kernel relay rejects the original listen error and registers cleanup before binding", async (t) => {
  const cleanups = [];
  let registeredAtListen;
  const original = Object.assign(new Error("fixture pipe occupied"), { code: "EADDRINUSE" });
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
  });
  t.mock.method(net.Server.prototype, "listen", function () {
    registeredAtListen = cleanups.length;
    // 保留观察 listener，使旧夹具的未处理错误表现为可断言的 Promise 超时。
    this.once("error", () => {});
    queueMicrotask(() => this.emit("error", original));
    return this;
  });
  const controller = new AbortController();
  try {
    await assert.rejects(
      Promise.race([
        kernelRelay(
          { after: (cleanup) => cleanups.push(cleanup) },
          { directory: tmpdir(), endpoint: "unused" }
        ),
        delay(1000, undefined, { signal: controller.signal }).then(() => {
          throw new Error("fixture did not reject its listen failure");
        })
      ]),
      (error) => error === original
    );
    assert.equal(registeredAtListen, 1);
    assert.equal(cleanups.length, 1);
  } finally {
    controller.abort();
  }
});
