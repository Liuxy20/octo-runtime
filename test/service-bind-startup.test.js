import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { testAdapter } from "./fixtures/test-adapter.js";
import { waitFor } from "./runtime-fixture.js";

async function delayedBind(t) {
  const home = await mkdtemp(join(tmpdir(), "obd-"));
  const endpoint = componentEndpoint(home);
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let server;
  let failure;
  const listen = net.Server.prototype.listen;
  const mocked = t.mock.method(net.Server.prototype, "listen", function (...args) {
    if (args[0] !== endpoint) return Reflect.apply(listen, this, args);
    server = this;
    entered.resolve();
    void resume.promise.then(() => {
      if (failure) this.emit("error", failure);
      else Reflect.apply(listen, this, args);
    });
    return this;
  });
  t.after(async () => {
    resume.resolve();
    mocked.mock.restore();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    endpoint,
    entered: entered.promise,
    resume: (error) => {
      failure ??= error;
      resume.resolve();
    },
    get server() {
      return server;
    }
  };
}

for (const mode of ["success", "failure", "late-failure"])
  test(
    `Kernel cancellation observes in-flight bind and rollback (${mode})`,
    { timeout: 10000 },
    async (t) => {
      const bind = await delayedBind(t);
      const options = { home: bind.home, endpoint: bind.endpoint, adapters: [testAdapter] };
      const kernel = createKernelService(options);
      const controller = new AbortController();
      const initializing = kernel.initialize({ signal: controller.signal });
      const rejected = assert.rejects(initializing, (error) => {
        assert.equal(error.cause, controller.signal.reason);
        assert.equal(error.cleanup.complete, mode !== "late-failure");
        return true;
      });
      await bind.entered;
      controller.abort();
      let closed = false;
      const closing = kernel.close().then((result) => {
        closed = true;
        return result;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, false);
      if (mode === "late-failure") await rejected;
      bind.resume(mode === "success" ? undefined : new Error("BIND_FAILED"));
      await rejected;
      assert.equal((await closing).complete, mode !== "late-failure");
      // 即使服务已超时返回，迟到失败仍须被观察，原 server 的回滚也须实际结束。
      if (process.platform !== "win32")
        await waitFor(async () => {
          try {
            await stat(`${bind.endpoint}.owner`);
            return false;
          } catch (error) {
            if (error.code === "ENOENT") return true;
            throw error;
          }
        });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(bind.server.listening, false);
      t.mock.restoreAll();
      const replacement = createKernelService(options);
      t.after(() => replacement.close());
      await replacement.initialize();
      assert.equal((await replacement.close()).complete, true);
    }
  );
