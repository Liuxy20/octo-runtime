import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  DependencyPool,
  createDependencyProxy
} from "../packages/octo-runtime-host-sdk/dist/dependencies.js";
import { deferred, waitFor } from "./runtime-fixture.js";
function channels() {
  const a = new EventEmitter(),
    b = new EventEmitter();
  const endpoint = (send, receive) => ({
    send: (value) => queueMicrotask(() => send.emit("message", structuredClone(value))),
    on(listener) {
      receive.on("message", listener);
      return () => receive.off("message", listener);
    }
  });
  return [endpoint(a, b), endpoint(b, a)];
}
test("cancelled proxy calls retain host capacity until the actual promise settles across epochs", async () => {
  const [host, child] = channels();
  const pool = new DependencyPool(8);
  const gate = deferred();
  let calls = 0;
  const unbind = pool.bind(host, "one", "epoch", {
    loadContexts: () => {
      calls++;
      return gate.promise;
    }
  });
  const proxy = createDependencyProxy(child, "one", "epoch");
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  const results = controllers.map((controller) =>
    assert.rejects(proxy.loadContexts({}, { signal: controller.signal }), /CANCELLED/)
  );
  await waitFor(() => calls === 8);
  for (const controller of controllers) controller.abort();
  await Promise.all(results);
  assert.equal(pool.inFlight, 8);
  await assert.rejects(proxy.loadContexts({}, { signal: new AbortController().signal }), /BUSY/);
  proxy.close();
  unbind();
  const nextUnbind = pool.bind(host, "two", "next", { loadContexts: () => [] });
  const next = createDependencyProxy(child, "two", "next");
  await assert.rejects(next.loadContexts({}, { signal: new AbortController().signal }), /BUSY/);
  gate.resolve([]);
  await waitFor(() => pool.inFlight === 0);
  assert.deepEqual(await next.loadContexts({}, { signal: new AbortController().signal }), []);
  next.close();
  nextUnbind();
  await pool.close();
});
