import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { access, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { kernelFixture, kernelInput } from "../../test/kernel-fixture.js";
import { kernelRelay } from "../../test/kernel-relay.js";
import { build, call } from "./driver.mjs";
const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
// Use an ACK barrier to order admission and observer closure deterministically.
test(`${language} observation closure during admission`, async (t) => {
  build(language);
  for (const scenario of ["close", "cancel-same-tick", "cancel-watcher-started"]) {
    await t.test(scenario, async (t) => {
      const f = await kernelFixture(t, { manifest: resolve("native/tests/adapters.json") });
      const gate = join(f.directory, "admitted");
      let closed = false;
      const relay = await kernelRelay(t, f, {
        async response(value, connection) {
          if (connection.request.method !== "agent_run.invoke" || !value.result) return;
          await writeFile(gate, "admitted");
          const until = Date.now() + 6000;
          while (Date.now() < until) {
            try {
              await access(gate + ".closed");
              closed = true;
              return;
            } catch {
              await delay(1);
            }
          }
          throw Error("observation did not close before ACK");
        }
      });
      const cancel = scenario !== "close";
      const request = { ...kernelInput("wait-for-cancel"), protocol_mode: "native" };
      const result = await call(language, {
        endpoint: relay.endpoint,
        input: request,
        gate,
        op: cancel ? "cancel-close-admitting" : "close-admitting",
        yieldWatcher: scenario === "cancel-watcher-started"
      });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.equal(closed, true);
      assert.equal(relay.count("agent_run.invoke"), 1);
      assert.equal(relay.count("agent_run.subscribe"), 0);
      assert.equal(relay.count("agent_run.cancel"), cancel ? 1 : 0);
      assert.equal(result.registry[0].phase, "unobserved");
      const record = result.registry[0];
      if (cancel) {
        let snapshot;
        for (let tries = 0; tries < 100; tries++) {
          snapshot = await f.client.get(record.key, record.ref.kernel_instance_id);
          if (snapshot.terminal) break;
          await delay(10);
        }
        assert.equal(snapshot.terminal?.control.state, "cancelled");
      } else {
        const snapshot = await f.client.get(record.key, record.ref.kernel_instance_id);
        assert.equal(snapshot.terminal, undefined);
        await f.client.cancel(record.ref, "fixture_cleanup");
      }
    });
  }
});

// Block four cancel ACKs while a fifth control queues; release the ACKs only after drain returns.
test(`${language} drain bounds previously queued cancellation`, async (t) => {
  build(language);
  const f = await kernelFixture(t, { manifest: resolve("native/tests/adapters.json") });
  const gate = join(f.directory, "controls");
  let received = 0,
    held = 0,
    afterDrain = 0;
  const relay = await kernelRelay(t, f, {
    request(value, connection) {
      if (value.method === "agent_run.cancel") {
        connection.cancelIndex = ++received;
        if (existsSync(gate + ".drained")) afterDrain++;
      }
    },
    async response(value, connection) {
      if (!connection.cancelIndex || connection.cancelIndex > 4) return;
      if (++held === 4) await writeFile(gate + ".ready", "ready");
      const until = Date.now() + 5000;
      while (!existsSync(gate + ".drained")) {
        if (Date.now() >= until) throw Error("drain did not finish before cancel ACK release");
        await delay(1);
      }
    }
  });
  const result = await call(language, {
    op: "drain-queued-cancels",
    endpoint: relay.endpoint,
    gate,
    input: { ...kernelInput("wait-for-cancel"), protocol_mode: "native" }
  });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(held, 4);
  assert.equal(afterDrain, 0, "queued cancel must not start after drain returns");
  assert.equal(received, 4, "the fifth cancel must expire while queued");
  assert.equal(result.drain.complete, false);
  assert.equal(result.drain.unresolved.length, 1);
  assert.deepEqual(result.repeated, result.drain, "repeat drain retains the first deadline/result");
});
