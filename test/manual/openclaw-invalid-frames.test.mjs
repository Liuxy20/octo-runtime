// 显式运行：node --test test/manual/openclaw-invalid-frames.test.mjs；不加入默认 CI。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getEventListeners, once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenClawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture } from "../kernel-fixture.js";
import {
  gatewayFixture,
  sessionReply,
  finalResult,
  eventually,
  collect
} from "../../test-support/openclaw-invalid-frames.mjs";

const logSink = (records) => (level, event, data) => records.push({ level, event, ...data });
const invalid = [
  ["null", "invalid_shape"],
  ["42", "invalid_shape"],
  ['"text"', "invalid_shape"],
  ["true", "invalid_shape"],
  ["[]", "invalid_shape"],
  ["{}", "invalid_shape"],
  ["{broken", "invalid_json"],
  ['{"type":42}', "invalid_shape"],
  ['{"type":"future"}', "unknown_type"],
  ['{"type":"event"}', "invalid_event"],
  ['{"type":"event","event":42}', "invalid_event"],
  ['{"type":"event","event":""}', "invalid_event"],
  ['{"type":"res","ok":true}', "invalid_response"],
  ['{"type":"res","id":42,"ok":true}', "invalid_response"],
  ['{"type":"res","id":"","ok":true}', "invalid_response"]
];

for (const [text, reason] of invalid)
  test(
    `A1/A2: ${text} is skipped before a valid event and response`,
    { timeout: 5000 },
    async (t) => {
      const logs = [];
      const f = await gatewayFixture(t, (frame, reply, socket) => {
        socket.send(text);
        socket.send(
          JSON.stringify({ type: "event", event: "progress", payload: null, extension: true })
        );
        reply({ answer: frame.id });
      });
      const client = f.client({ log: logSink(logs) });
      await client.connect();
      const events = [];
      client.onEvent((event) => events.push(event));
      const result = await client.request("agent", {});
      assert.equal(result.answer, f.requests.at(-1).id);
      assert.deepEqual(events, [{ event: "progress", payload: null }]);
      assert.deepEqual(logs, [
        {
          level: "warn",
          event: "openclaw.gateway.invalid_frame",
          adapter_type: "openclaw",
          reason_code: reason,
          frame_count: 1
        }
      ]);
      assert.equal(f.sockets.length, 1);
      assert.equal(f.sockets[0].readyState, 1);
      assert.deepEqual(
        f.requests.map((frame) => frame.method),
        ["connect", "agent"]
      );
    }
  );

test(
  "A3: invalid frames before challenge and during connect preserve the same handshake",
  { timeout: 5000 },
  async (t) => {
    const logs = [];
    const f = await gatewayFixture(t, sessionReply, {
      beforeChallenge: ["null", "[]"],
      beforeHello: ["null", "{broken"]
    });
    const client = f.client({ log: logSink(logs) });
    assert.equal((await client.connect()).protocol, 4);
    assert.equal(logs.length, 4);
    assert.equal(f.sockets.length, 1);
    assert.deepEqual(
      f.requests.map((frame) => frame.method),
      ["connect"]
    );
  }
);

test(
  "A2/A4: matching invalid responses retain concurrent pending and accepted callbacks",
  { timeout: 5000 },
  async (t) => {
    const logs = [];
    const held = [];
    const f = await gatewayFixture(t, (frame, reply, socket) => {
      held.push({ frame, reply, socket });
      for (const ok of [undefined, null, "true", 1])
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok, payload: { status: "ok" } }));
    });
    const client = f.client({ log: logSink(logs) });
    await client.connect();
    const accepted = [];
    let settled = 0;
    const a = client
      .request(
        "agent",
        {},
        { expectFinal: true, onAccepted: (value) => accepted.push(value.status) }
      )
      .then((value) => {
        settled++;
        return value;
      });
    const b = client.request("other", {}).then((value) => {
      settled++;
      return value;
    });
    await eventually(() => logs.length === 8);
    assert.equal(settled, 0);
    assert.deepEqual(accepted, []);
    held[0].reply({ status: "accepted" });
    await eventually(() => accepted.length === 1);
    assert.equal(settled, 0);
    held[1].reply({ answer: "b" });
    held[0].reply(finalResult("a"));
    assert.equal((await a).status, "ok");
    assert.deepEqual(await b, { answer: "b" });
    assert.equal(settled, 2);
  }
);

test(
  "A5: repeated invalid frames do not reset the original RPC timer or abort cleanup",
  { timeout: 5000 },
  async (t) => {
    let peer;
    const logs = [];
    const f = await gatewayFixture(t, (_frame, _reply, socket) => {
      peer = socket;
      socket.send("null");
    });
    const client = f.client({ log: logSink(logs) });
    await client.connect();
    const controller = new AbortController();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = client.request("agent", {}, { timeoutMs: 100, signal: controller.signal });
      const rejected = assert.rejects(pending, /timed out after 100ms/);
      await eventually(() => logs.length === 1);
      t.mock.timers.tick(90);
      peer.send("{broken");
      await eventually(() => logs.length === 2);
      t.mock.timers.tick(10);
      await rejected;
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      assert.equal(peer.readyState, 1);
    } finally {
      t.mock.timers.reset();
    }
  }
);

test(
  "A3/A5: invalid handshake messages cannot extend the original connect timeout",
  { timeout: 5000 },
  async (t) => {
    const logs = [];
    const f = await gatewayFixture(t, sessionReply, {
      challenge: false,
      beforeChallenge: ["null"]
    });
    const client = f.client({ log: logSink(logs), connectTimeoutMs: 100 });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const rejected = assert.rejects(client.connect(), /handshake timed out after 100ms/);
      await eventually(() => logs.length === 1);
      t.mock.timers.tick(90);
      f.sockets[0].send("null");
      await eventually(() => logs.length === 2);
      t.mock.timers.tick(10);
      await rejected;
    } finally {
      t.mock.timers.reset();
    }
  }
);

test(
  "A6: timeout-free requests survive junk until result or explicit abort",
  { timeout: 5000 },
  async (t) => {
    const logs = [];
    const held = [];
    const f = await gatewayFixture(t, (_frame, reply, socket) => {
      held.push(reply);
      socket.send("null");
    });
    const client = f.client({ log: logSink(logs), requestTimeoutMs: 1 });
    await client.connect();
    const abort = new AbortController();
    const a = client.request("agent", {}, { timeoutMs: null });
    const b = client.request("other", {}, { timeoutMs: null, signal: abort.signal });
    const rejected = assert.rejects(b, /aborted/);
    await eventually(() => logs.length === 2);
    await delay(20);
    abort.abort();
    await rejected;
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
    held[0]({ answer: "later" });
    assert.deepEqual(await a, { answer: "later" });
  }
);

test(
  "A7: well-formed RPC errors still fail, including absent native error details",
  { timeout: 5000 },
  async (t) => {
    const f = await gatewayFixture(t, (frame, _reply, socket) => {
      socket.send("null");
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: false }));
    });
    const client = f.client();
    await client.connect();
    await assert.rejects(client.request("agent", {}), /Gateway request failed/);
    assert.equal(f.sockets[0].readyState, 1);
  }
);

for (const mode of ["close", "error"])
  test(`A7: actual socket ${mode} still settles pending`, { timeout: 5000 }, async (t) => {
    const f = await gatewayFixture(t, (_frame, _reply, socket) => {
      socket.send("null");
      if (mode === "close") socket.close(1011, "fixture unavailable");
      // 非法 WebSocket opcode 由 ws 传输层拒绝，不属于已解码消息的容错范围。
      else socket._socket.write(Buffer.from([0x83, 0x00]));
    });
    const client = f.client();
    await client.connect();
    await assert.rejects(
      client.request("agent", {}),
      mode === "close" ? /closed.*1011/ : /Invalid WebSocket frame/
    );
  });

test(
  "A10: 1000 invalid messages produce 20 bounded metadata records and a valid result",
  { timeout: 5000 },
  async (t) => {
    const logs = [];
    const f = await gatewayFixture(t, (_frame, reply, socket) => {
      for (let i = 0; i < 1000; i++) socket.send("null");
      reply(finalResult());
    });
    const client = f.client({ log: logSink(logs) });
    await client.connect();
    assert.equal((await client.request("agent", {})).status, "ok");
    assert.deepEqual(
      logs.map((item) => item.frame_count),
      [
        ...Array.from({ length: 10 }, (_, i) => i + 1),
        ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100)
      ]
    );
    assert.ok(logs.every((item) => JSON.stringify(item).length < 512));
  }
);

for (const mode of ["throw", "reject"])
  test(
    `A10: diagnostic sink ${mode} cannot break later valid messages`,
    { timeout: 5000 },
    async (t) => {
      const f = await gatewayFixture(t, (_frame, reply, socket) => {
        socket.send("null");
        reply(finalResult());
      });
      const client = f.client({
        log: () => {
          if (mode === "throw") throw new Error("diagnostic unavailable");
          return Promise.reject(new Error("diagnostic unavailable"));
        }
      });
      await client.connect();
      assert.equal((await client.request("agent", {})).status, "ok");
      await delay(10);
    }
  );

test(
  "A8: probe uses factory log; invocation and disconnect reconciliation use invocation log",
  { timeout: 7000 },
  async (t) => {
    const factoryLogs = [],
      invocationLogs = [];
    let agents = 0;
    const f = await gatewayFixture(
      t,
      (frame, reply, socket) => {
        socket.send("null");
        if (frame.method === "agent") {
          agents++;
          reply({ status: "accepted", runId: frame.params.idempotencyKey });
          socket.close(1011, "fixture disconnected after acceptance");
        } else if (frame.method === "agent.wait") reply({ status: "ok", endedAt: 1 });
        else sessionReply(frame, reply);
      },
      { beforeChallenge: ["null"] }
    );
    const adapter = createOpenClawAdapter({ log: logSink(factoryLogs) });
    assert.equal((await adapter.probe({ providerOptions: f.providerOptions })).available, true);
    const probeCount = factoryLogs.length;
    assert.ok(probeCount > 0);
    const events = await collect(adapter.invoke(f.request(), { log: logSink(invocationLogs) }));
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(factoryLogs.length, probeCount);
    assert.ok(invocationLogs.filter((item) => item.frame_count === 1).length >= 2);
    assert.equal(f.sockets.length, 3);
    assert.equal(agents, 1, "accepted execution must never be replayed");
  }
);

test(
  "A9: bad OpenClaw input leaves sibling and later invocations on the same native Kernel",
  { timeout: 15000 },
  async (t) => {
    const held = new Map();
    const f = await gatewayFixture(t, (frame, reply, socket) => {
      if (frame.method === "agent") {
        held.set(frame.params.message, { reply, socket });
        reply({ status: "accepted", runId: frame.params.idempotencyKey });
      } else sessionReply(frame, reply);
    });
    const kernel = await kernelFixture(t, {
      adapterConfigurations: { openclaw: { providerOptions: f.providerOptions } },
      adapters: (
        await import(
          (await import("node:url")).pathToFileURL(
            resolve("test/manual/openclaw-invalid-frames-worker.mjs")
          ).href
        )
      ).adapters
    });
    const before = await kernel.client.status();
    const run = (text) =>
      collect(
        kernel.client.invoke(
          invocationInput(f.request({ prompt: text, modelInput: text }), "canonical", "openclaw")
        )
      );
    const a = run("a"),
      b = run("b");
    // 所有 promise 从创建时即观察，故障版本也不能留下迟到的 unhandled rejection。
    const both = Promise.all([a, b]);
    void both.catch(() => {});
    await eventually(() => held.size === 2);
    held.get("a").socket.send("null");
    held.get("a").socket.send("{broken");
    held.get("a").reply(finalResult("a done"));
    held.get("b").reply(finalResult("b done"));
    for (const events of await both)
      assert.ok(events.some((event) => event.type === "run.completed"));
    const c = run("c");
    void c.catch(() => {});
    await eventually(() => held.has("c"));
    held.get("c").reply(finalResult("c done"));
    assert.ok((await c).some((event) => event.type === "run.completed"));
    const after = await kernel.client.status();
    assert.equal(after.kernel_instance_id, before.kernel_instance_id);
    assert.equal(after.pid, before.pid);
    assert.equal(after.kernel_instance_id, before.kernel_instance_id);
    assert.equal(after.execution_ready, true);
  }
);

test(
  "A11: isolated child survives null and stderr never contains arbitrary frame bodies",
  { timeout: 5000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [resolve("test/manual/openclaw-invalid-frames-child.mjs")],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (text) => {
      stdout += text;
    });
    child.stderr.setEncoding("utf8").on("data", (text) => {
      stderr += text;
    });
    const closed = once(child, "close");
    void closed.catch(() => {});
    t.after(async () => {
      const errors = [];
      let timer;
      try {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (!child.kill("SIGKILL")) errors.push(new Error(`Child kill failed: ${child.pid}`));
          } catch (error) {
            errors.push(error);
          }
        }
        // 测试超时不约束 after；退出确认必须有独立期限，即使 kill 失败也尝试确认。
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Child exit timeout: ${child.pid}`)), 2000);
          })
        ]);
      } catch (error) {
        errors.push(error);
      } finally {
        clearTimeout(timer);
      }
      if (errors.length) throw new AggregateError(errors, "Child fixture cleanup failed");
    });
    const [code, signal] = await closed;
    assert.equal(code, 0, stderr);
    assert.equal(signal, null);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.ok(!stderr.includes(result.canary));
    const lines = stderr.trim().split("\n");
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.ok(Buffer.byteLength(line) < 512);
      const diagnostic = JSON.parse(line);
      assert.equal(diagnostic.event, "openclaw.gateway.invalid_frame");
      assert.deepEqual(Object.keys(diagnostic).sort(), [
        "adapter_type",
        "event",
        "frame_count",
        "level",
        "reason_code"
      ]);
    }
  }
);
