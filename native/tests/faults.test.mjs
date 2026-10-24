import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { kernelFixture, kernelInput } from "../../test/kernel-fixture.js";
import { kernelRelay } from "../../test/kernel-relay.js";
import { build, call } from "./driver.mjs";
const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
const input = (prompt = "normal", mode = "native") => ({
  ...kernelInput(prompt),
  protocol_mode: mode
});
const fixture = (t) => kernelFixture(t, { manifest: resolve("native/tests/adapters.json") });
test(`${language} admission, recovery, controls and observation semantics`, async (t) => {
  build(language);
  await t.test(
    "mathematical integer tokens bind across RPC results and stream identity",
    async (t) => {
      const f = await fixture(t);
      const keys = new Set([
        "seq",
        "session_generation",
        "latest_seq",
        "oldest_seq",
        "ipc_version"
      ]);
      function decimalIntegers(value) {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (keys.has(key) && Number.isSafeInteger(child)) value[key] = JSON.rawJSON(`${child}.0`);
          else decimalIntegers(child);
        }
      }
      const relay = await kernelRelay(t, f, {
        response(value) {
          decimalIntegers(value);
        }
      });
      const result = await call(language, {
        endpoint: relay.endpoint,
        op: "invoke",
        input: input()
      });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.deepEqual(result.registry, []);
      assert.equal(result.events.at(-1).control.state, "completed");
      assert.equal(relay.count("agent_run.invoke"), 1);
    }
  );
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} interaction`, async (t) => {
      const f = await fixture(t);
      const relay = await kernelRelay(t, f);
      const r = await call(language, {
        endpoint: relay.endpoint,
        op: "interaction",
        input: input("interaction", mode)
      });
      assert.equal(r.error, undefined, JSON.stringify(r));
      assert.deepEqual(r.registry, []);
      assert.equal(
        relay.count(mode === "native" ? "agent_run.native.respond" : "agent_run.respond"),
        1
      );
      assert.equal(relay.count("agent_run.invoke"), 1);
    });
  await t.test("lost admission ACK queries original identity once", async (t) => {
    const f = await fixture(t);
    let dropped = false;
    const relay = await kernelRelay(t, f, {
      response(v, c) {
        if (c.request.method === "agent_run.invoke" && v.result && !dropped) {
          dropped = true;
          c.disconnect();
          return false;
        }
      }
    });
    const startsFile = join(f.directory, "starts");
    const request = input();
    request.runMetadata = { startsFile };
    const r = await call(language, { endpoint: relay.endpoint, op: "invoke", input: request });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(relay.count("agent_run.invoke"), 1);
    assert.equal(relay.count("agent_run.get"), 1);
    assert.equal((await readFile(startsFile, "utf8")).trim(), "start");
    assert.deepEqual(r.registry, []);
  });
  await t.test("lost ACK and unavailable lookup retains unknown without replay", async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f, {
      response(v, c) {
        if (c.request.method === "agent_run.invoke" || c.request.method === "agent_run.get") {
          c.disconnect();
          return false;
        }
      }
    });
    const r = await call(language, { endpoint: relay.endpoint, op: "invoke", input: input() });
    assert.equal(r.error, "ACCEPTANCE_UNKNOWN");
    assert.equal(relay.count("agent_run.invoke"), 1);
    assert.equal(relay.count("agent_run.get"), 3);
    assert.equal(r.registry.length, 1);
    assert.equal(r.registry[0].phase, "acceptance_unknown");
  });
  await t.test("two disconnects resume last contiguous cursor", async (t) => {
    const f = await fixture(t);
    let failures = 0;
    const relay = await kernelRelay(t, f, {
      response(v, c) {
        if (c.cut) return false;
        if (v.method === "agent_run.event" && v.params.seq === failures + 2 && failures < 2) {
          failures++;
          c.cut = true;
          c.disconnect();
          return false;
        }
      }
    });
    const r = await call(language, { endpoint: relay.endpoint, op: "invoke", input: input() });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(failures, 2);
    assert.equal(relay.count("agent_run.invoke"), 1);
    assert.equal(relay.count("agent_run.subscribe"), 3);
    assert.deepEqual(
      r.events.map((x) => x.seq),
      r.events.map((_, i) => i + 1)
    );
    assert.deepEqual(
      relay.requests
        .filter((x) => x.method === "agent_run.subscribe")
        .map((x) => x.params.after_seq),
      [0, 1, 2]
    );
  });
  for (const failure of [
    "STREAM_GAP",
    "STREAM_EXPIRED",
    "STREAM_CURSOR_INVALID",
    "KERNEL_INSTANCE_CHANGED",
    "RUN_IDENTITY_MISMATCH",
    "FUTURE_SERVER_ERROR"
  ])
    await t.test(`explicit ${failure} is preserved`, async (t) => {
      const f = await fixture(t);
      const relay = await kernelRelay(t, f, {
        response(v, c) {
          if (c.request.method === "agent_run.subscribe" && v.id)
            return {
              jsonrpc: "2.0",
              id: v.id,
              error: {
                code: -32001,
                message: "Kernel request failed",
                data: { code: failure, future: { retained: true } }
              }
            };
        }
      });
      const r = await call(language, { endpoint: relay.endpoint, op: "invoke", input: input() });
      assert.equal(r.error, failure);
      assert.equal(relay.count("agent_run.invoke"), 1);
      assert.equal(relay.count("agent_run.subscribe"), 1);
    });
  await t.test("cancel ACK loss is unknown and is not retried", async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f, {
      response(v, c) {
        if (c.request.method === "agent_run.cancel") {
          c.disconnect();
          return false;
        }
      }
    });
    const r = await call(language, {
      endpoint: relay.endpoint,
      op: "cancel",
      input: input("wait-for-cancel")
    });
    assert.equal(r.error, "OPERATION_OUTCOME_UNKNOWN");
    assert.equal(relay.count("agent_run.cancel"), 1);
  });
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} response ACK loss is unknown and not retried`, async (t) => {
      const f = await fixture(t);
      const relay = await kernelRelay(t, f, {
        response(v, c) {
          if (["agent_run.respond", "agent_run.native.respond"].includes(c.request.method)) {
            c.disconnect();
            return false;
          }
        }
      });
      const r = await call(language, {
        endpoint: relay.endpoint,
        op: "interaction",
        input: input("interaction", mode)
      });
      assert.equal(r.error, "OPERATION_OUTCOME_UNKNOWN");
      assert.equal(
        relay.count(mode === "native" ? "agent_run.native.respond" : "agent_run.respond"),
        1
      );
    });
  await t.test("repeated explicit invocation cancel shares one control", async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f);
    const r = await call(language, {
      endpoint: relay.endpoint,
      op: "cancel-invocation",
      input: input("wait-for-cancel")
    });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(relay.count("agent_run.cancel"), 1);
    assert.equal(r.events.at(-1).control.state, "cancelled");
    assert.deepEqual(r.registry, []);
  });
  await t.test("abandoned observation does not cancel original Run", async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f);
    const r = await call(language, {
      endpoint: relay.endpoint,
      op: "abandon",
      input: input("wait-for-cancel")
    });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(relay.count("agent_run.cancel"), 0);
    assert.equal(r.registry.length, 1);
    const record = r.registry[0];
    const snapshot = await f.client.get(record.key, record.ref.kernel_instance_id);
    assert.equal(snapshot.terminal, undefined);
    await f.client.cancel(record.ref, "fixture_cleanup");
  });
  await t.test("drain confirms terminal with bounded queries and no extra subscribe", async (t) => {
    const f = await fixture(t);
    const relay = await kernelRelay(t, f);
    const r = await call(language, {
      endpoint: relay.endpoint,
      op: "drain",
      input: input("wait-for-cancel")
    });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(r.drain.complete, true);
    assert.deepEqual(r.drain.unresolved, []);
    assert.equal(relay.count("agent_run.cancel"), 1);
    assert.equal(relay.count("agent_run.subscribe"), 1);
  });
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} actual worker loss remains unknown`, async (t) => {
      const f = await fixture(t);
      let killed = false;
      const relay = await kernelRelay(t, f, {
        async response(v, c) {
          if (!killed && c.request.method === "agent_run.subscribe" && v.result) {
            killed = true;
            process.kill((await f.client.status()).worker.pid, "SIGKILL");
          }
        }
      });
      const r = await call(language, {
        endpoint: relay.endpoint,
        op: "invoke",
        input: input("wait-for-cancel", mode)
      });
      assert.equal(r.error, "RUN_OUTCOME_UNKNOWN", JSON.stringify(r));
      assert.equal(relay.count("agent_run.invoke"), 1);
      assert.equal(r.registry.length, 1);
      if (mode === "native") assert.equal(r.events.at(-1).control.state, "lost");
      else
        assert.equal(
          r.events.some((x) => x.type === "run.completed"),
          false
        );
    });
});
