import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import load from "../packages/octo-runtime-extra-channel-gateway/dist/extra.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { ImConnectionError } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/connection-error.js";
import {
  WukongConnection,
  registerBot
} from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { verifyBotIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/auth.js";

const bot = (patch = {}) => ({
  bot_id: "state-machine-bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  bf_token: `bf_${randomUUID()}`,
  adapter: { adapter_type: "codex", workdir: process.cwd() },
  ...patch
});
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function snapshot(runtime, state, error = null) {
  assert.equal(runtime.status.state, state);
  assert.equal(runtime.status.connected, state === "online");
  assert.equal(runtime.status.error, error);
}
function fixture(t, options = {}) {
  const attempts = [],
    closed = [],
    diagnostics = [];
  let behavior = async () => {};
  t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
    attempts.push(this);
    await behavior(this, signal);
  });
  t.mock.method(GatewayTransport.prototype, "close", async function () {
    closed.push(this);
    await options.cleanup?.(this);
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  t.mock.method(performance, "now", () => Date.now());
  const runtime = new ImRuntime(bot(options.config), {
    kernel: {},
    signal: options.signal,
    onDiagnostic: (code) => diagnostics.push(code)
  });
  t.after(() => runtime.close().catch(() => {}));
  return {
    runtime,
    attempts,
    closed,
    diagnostics,
    behavior(value) {
      behavior = value;
    },
    async tick(ms) {
      t.mock.timers.tick(ms);
      await settle();
    },
    drop(code = "IM_DISCONNECTED", retryable = true) {
      attempts.at(-1).callbacks.onDisconnect(code, retryable);
    }
  };
}

for (const code of [
  "IM_CREDENTIALS_REQUIRED",
  "IM_AUTH_HTTP_401",
  "IM_REGISTER_HTTP_403",
  "IM_CONNECT_REJECTED_2"
]) {
  test(`initial terminal failure ${code} never retries`, async (t) => {
    const f = fixture(t);
    f.behavior(async () => {
      throw new ImConnectionError(code, false);
    });
    await f.runtime.start();
    snapshot(f.runtime, "failed", code);
    await f.tick(300_000);
    assert.equal(f.attempts.length, 1);
    await f.runtime.close();
    snapshot(f.runtime, "stopped");
  });
}

for (const code of ["IM_CONNECT_TIMEOUT", "IM_AUTH_NETWORK_ERROR", "IM_REGISTER_HTTP_503"]) {
  test(`initial transient failure ${code} recovers without restarting Extra`, async (t) => {
    const f = fixture(t);
    f.behavior(async () => {
      throw new ImConnectionError(code, true);
    });
    await f.runtime.start();
    snapshot(f.runtime, "retrying", code);
    await f.tick(4999);
    assert.equal(f.attempts.length, 1);
    f.behavior(async () => {});
    await f.tick(1);
    snapshot(f.runtime, "online");
    assert.equal(f.attempts.length, 2);
  });
}

for (const error of [
  new Error("dependency unavailable"),
  new Error("IM_SERVICE_UNAVAILABLE"),
  undefined
]) {
  test(`unclassified connection dependency failure ${error?.message ?? "undefined"} recovers`, async (t) => {
    const f = fixture(t);
    f.behavior(async () => {
      throw error;
    });
    await f.runtime.start();
    snapshot(
      f.runtime,
      "retrying",
      error?.message === "IM_SERVICE_UNAVAILABLE" ? error.message : "IM_CONNECTION_FAILED"
    );
    f.behavior(async () => {});
    await f.tick(5000);
    snapshot(f.runtime, "online");
    assert.equal(f.attempts.length, 2);
  });
}

for (const code of [
  "IM_CREDENTIALS_REQUIRED",
  "IM_BOT_TOKEN_INVALID",
  "IM_BOT_IDENTITY_MISMATCH",
  "IM_TENANT_NOT_ACTIVE",
  "IM_AUTH_IDENTITY_INVALID",
  "IM_REGISTRATION_INVALID",
  "IM_WS_TLS_REQUIRED"
]) {
  test(`confirmed local rejection ${code} remains terminal`, async (t) => {
    const f = fixture(t);
    f.behavior(async () => {
      throw new Error(code);
    });
    await f.runtime.start();
    snapshot(f.runtime, "failed", code);
    await f.tick(300000);
    assert.equal(f.attempts.length, 1);
  });
}

test("recovery stays retrying, uses 5/10/15/15/15 seconds, and resets after each success", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  snapshot(f.runtime, "online");
  for (let cycle = 0; cycle < 2; cycle++) {
    f.behavior(async () => {
      throw new ImConnectionError("IM_REGISTER_HTTP_503", true);
    });
    f.drop();
    snapshot(f.runtime, "retrying", "IM_DISCONNECTED");
    await settle();
    for (const delay of [5000, 10000, 15000, 15000, 15000]) {
      const before = f.attempts.length;
      await f.tick(delay - 1);
      assert.equal(f.attempts.length, before);
      await f.tick(1);
      assert.equal(f.attempts.length, before + 1);
      snapshot(f.runtime, "retrying", "IM_REGISTER_HTTP_503");
    }
    let release;
    f.behavior(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await f.tick(15000);
    snapshot(f.runtime, "retrying", "IM_REGISTER_HTTP_503");
    release();
    await settle();
    snapshot(f.runtime, "online");
  }
});

test("explicit restart retries a failed first attempt, concurrent starts do not duplicate", async (t) => {
  const f = fixture(t);
  f.behavior(async () => {
    throw new Error("IM_CREDENTIALS_REQUIRED");
  });
  await f.runtime.start();
  snapshot(f.runtime, "failed", "IM_CREDENTIALS_REQUIRED");
  let release;
  f.behavior(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const first = f.runtime.start(),
    second = f.runtime.start();
  await settle();
  snapshot(f.runtime, "connecting");
  assert.equal(f.attempts.length, 2);
  release();
  await Promise.all([first, second]);
  snapshot(f.runtime, "online");
});

test("a disconnect during the first handshake cannot be overwritten by late success", async (t) => {
  const f = fixture(t);
  f.behavior(async (transport) => {
    transport.callbacks.onDisconnect("IM_DISCONNECTED", true);
  });
  await f.runtime.start();
  snapshot(f.runtime, "retrying", "IM_DISCONNECTED");
  f.behavior(async () => {});
  await f.tick(5000);
  snapshot(f.runtime, "online");
  assert.equal(f.attempts.length, 2);
});

test("terminal disconnects and unknown protocol failures stop recovery", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  f.drop("IM_SERVER_DISCONNECTED_2", false);
  snapshot(f.runtime, "failed", "IM_SERVER_DISCONNECTED_2");
  await settle();
  await f.tick(30000);
  assert.equal(f.attempts.length, 1);
  await f.runtime.start();
  f.behavior(async () => {
    throw new Error("IM_FRAME_TRUNCATED");
  });
  f.drop();
  await settle();
  await f.tick(5000);
  snapshot(f.runtime, "failed", "IM_FRAME_TRUNCATED");
  const count = f.attempts.length;
  await f.tick(30000);
  assert.equal(f.attempts.length, count);
});

test("stop cancels waiting recovery and stale messages/diagnostics cannot change its state", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  const old = f.attempts[0];
  old.callbacks.onDiagnostic("IM_CARD_ACTION_POLL_FAILED");
  snapshot(f.runtime, "online");
  f.drop();
  f.drop();
  await settle();
  await f.runtime.close();
  old.callbacks.onDisconnect("IM_DISCONNECTED");
  old.callbacks.onDiagnostic("IM_DELIVERY_FAILED");
  await f.tick(30000);
  snapshot(f.runtime, "stopped");
  assert.equal(f.attempts.length, 1);
});

test("owner abort stops pending startup even if a transport returns late success", async (t) => {
  const controller = new AbortController();
  const f = fixture(t, { signal: controller.signal });
  let release;
  f.behavior(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const starting = f.runtime.start();
  await settle();
  controller.abort();
  snapshot(f.runtime, "stopped");
  release();
  await starting;
  await f.runtime.close();
  await f.tick(30000);
  snapshot(f.runtime, "stopped");
  assert.equal(f.attempts.length, 1);
});

test("recovery cleanup must finish before the first backoff begins", async (t) => {
  let release,
    blocking = false;
  const f = fixture(t, {
    cleanup: () =>
      blocking
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined
  });
  await f.runtime.start();
  blocking = true;
  f.drop();
  await settle();
  await f.tick(30000);
  snapshot(f.runtime, "retrying", "IM_DISCONNECTED");
  assert.equal(f.attempts.length, 1);
  blocking = false;
  release();
  await settle();
  await f.tick(4999);
  assert.equal(f.attempts.length, 1);
  await f.tick(1);
  snapshot(f.runtime, "online");
});

test("cleanup failure stops recovery and does not overlap connections", async (t) => {
  let broken = false;
  const f = fixture(t, {
    cleanup: () => {
      if (broken) throw Error("private cleanup error");
    }
  });
  await f.runtime.start();
  broken = true;
  f.drop();
  await settle();
  snapshot(f.runtime, "failed", "IM_DISCONNECTED");
  assert.ok(f.diagnostics.includes("IM_DISPOSE_FAILED"));
  await f.tick(30000);
  assert.equal(f.attempts.length, 1);
});

test("Retry-After can extend the wait without advancing the backoff twice", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  f.behavior(async () => {
    throw new ImConnectionError("IM_REGISTER_HTTP_429", true, 45000);
  });
  f.drop();
  await settle();
  await f.tick(5000);
  const count = f.attempts.length;
  await f.tick(44999);
  assert.equal(f.attempts.length, count);
  f.behavior(async () => {});
  await f.tick(1);
  snapshot(f.runtime, "online");
});

test("Extra status keeps per-Bot startup failures visible and isolates healthy/disabled Bots", async (t) => {
  let status, dispose;
  t.mock.method(GatewayTransport.prototype, "start", async function () {
    if (this.config.bot_id === "bad") throw new Error("IM_CREDENTIALS_REQUIRED");
  });
  t.mock.method(GatewayTransport.prototype, "close", async () => {});
  await load(
    {
      signal: new AbortController().signal,
      kernel: {},
      onStatus: (fn) => {
        status = fn;
      },
      onDispose: (fn) => {
        dispose = fn;
      }
    },
    { bots: [bot({ bot_id: "bad" }), bot({ bot_id: "good" }), bot({ enabled: false })] }
  )({});
  t.after(dispose);
  assert.deepEqual(
    status().bots.map((b) => [b.state, b.error, b.connected]),
    [
      ["failed", "IM_CREDENTIALS_REQUIRED", false],
      ["online", null, true],
      ["stopped", null, false]
    ]
  );
});

test("long waits and a delayed wake never overflow timers or replay missed attempts", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  f.behavior(async () => {
    throw new ImConnectionError("IM_AUTH_HTTP_429", true, 2_147_483_647 + 60000);
  });
  f.drop();
  await settle();
  await f.tick(5000);
  assert.equal(f.attempts.length, 2);
  await f.tick(2_147_483_647);
  assert.equal(f.attempts.length, 2);
  await f.tick(59999);
  assert.equal(f.attempts.length, 2);
  f.behavior(async () => {
    throw new ImConnectionError("IM_AUTH_NETWORK_ERROR", true);
  });
  await f.tick(1);
  assert.equal(f.attempts.length, 3);
  await f.tick(600000);
  assert.equal(f.attempts.length, 4);
  snapshot(f.runtime, "retrying", "IM_AUTH_NETWORK_ERROR");
  await f.tick(14999);
  assert.equal(f.attempts.length, 4);
  await f.tick(1);
  assert.equal(f.attempts.length, 5);
});

test("stopping an in-flight recovery suppresses its late result and old callbacks after restart", async (t) => {
  const f = fixture(t);
  await f.runtime.start();
  let release;
  f.behavior(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  f.drop();
  await settle();
  await f.tick(5000);
  const old = f.attempts.at(-1);
  const closing = f.runtime.close();
  snapshot(f.runtime, "stopped");
  release();
  await closing;
  f.behavior(async () => {});
  await f.runtime.start();
  old.callbacks.onDisconnect("IM_SERVER_DISCONNECTED_12", true);
  old.callbacks.onDiagnostic("IM_DELIVERY_FAILED");
  snapshot(f.runtime, "online");
  await f.tick(60000);
  assert.equal(f.attempts.length, 3);
});

async function server(t) {
  let status = 200;
  const http = createServer((_req, res) => {
    res.writeHead(status);
    res.end("private response");
  });
  const ws = new WebSocketServer({ server: http });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(async () => {
    for (const peer of ws.clients) peer.terminate();
    ws.close();
    await new Promise((r) => http.close(r));
  });
  const port = http.address().port;
  return {
    http,
    ws,
    url: `http://127.0.0.1:${port}`,
    registration: { robot_id: "bot", im_token: randomUUID(), ws_url: `ws://127.0.0.1:${port}` },
    status: (value) => {
      status = value;
    }
  };
}
function string(value) {
  const bytes = Buffer.from(value),
    length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function handshake() {
  const key = generateKeyPairSync("x25519")
    .publicKey.export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
  const body = Buffer.concat([
    Buffer.alloc(8),
    Buffer.from([1]),
    string(key),
    string("0123456789abcdef")
  ]);
  return Buffer.concat([Buffer.from([0x20, body.length]), body]);
}

test("real WS protocol preserves reconnectable reason 12 and cannot report a closed socket as connected", async (t) => {
  const s = await server(t);
  const disconnected = [];
  const client = new WukongConnection(
    () => {},
    (error) => disconnected.push(error)
  );
  t.after(() => client.close());
  s.ws.on("connection", (peer) =>
    peer.once("message", () => {
      peer.send(handshake());
      peer.send(Buffer.from([0x90, 3, 12, 0, 0]));
    })
  );
  await client.connect(s.registration).catch((error) => {
    assert.equal(error.message, "IM_SERVER_DISCONNECTED_12");
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(client.connected, false);
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].message, "IM_SERVER_DISCONNECTED_12");
  assert.equal(disconnected[0].retryable, true);
});

// 按真实二进制帧核对两条入口，防止只改状态机 mock 而漏掉传输分类。
for (const reason of [0, 2, 4, 8, 9, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 27, 255]) {
  for (const phase of ["handshake", "disconnect", "early-disconnect"]) {
    test(`${phase} reason ${reason} preserves recovery eligibility`, async (t) => {
      const s = await server(t);
      const retryable = ![2, 4, 8, 9, 11, 13, 19, 20, 21, 23, 27].includes(reason);
      let reportDisconnect;
      const disconnected = new Promise((resolve) => {
        reportDisconnect = resolve;
      });
      const client = new WukongConnection(() => {}, reportDisconnect);
      t.after(() => client.close());
      s.ws.on("connection", (peer) =>
        peer.once("message", () => {
          if (phase === "handshake") {
            peer.send(
              Buffer.concat([Buffer.from([0x20, 9]), Buffer.alloc(8), Buffer.from([reason])])
            );
          } else if (phase === "early-disconnect") {
            peer.send(Buffer.from([0x90, 3, reason, 0, 0]));
          } else {
            peer.send(handshake());
          }
        })
      );
      const code = `IM_${phase === "handshake" ? "CONNECT_REJECTED" : "SERVER_DISCONNECTED"}_${reason}`;
      if (phase !== "disconnect") {
        await assert.rejects(client.connect(s.registration), { message: code, retryable });
      } else {
        await client.connect(s.registration);
        for (const peer of s.ws.clients) peer.send(Buffer.from([0x90, 3, reason, 0, 0]));
        const error = await disconnected;
        assert.equal(error.message, code);
        assert.equal(error.retryable, retryable);
      }
      assert.equal(client.connected, false);
    });
  }
}

test("real handshake rejection preserves reason even without optional success fields", async (t) => {
  const s = await server(t);
  s.ws.on("connection", (peer) =>
    peer.once("message", () =>
      peer.send(Buffer.concat([Buffer.from([0x20, 9]), Buffer.alloc(8), Buffer.from([2])]))
    )
  );
  const client = new WukongConnection(() => {});
  t.after(() => client.close());
  await assert.rejects(client.connect(s.registration), {
    message: "IM_CONNECT_REJECTED_2",
    retryable: false
  });
});

test("missing heartbeat packets reports a retryable timeout and releases pending sends", async (t) => {
  const s = await server(t);
  s.ws.on("connection", (peer) => peer.once("message", () => peer.send(handshake())));
  let disconnected;
  const closed = new Promise((resolve) => {
    disconnected = resolve;
  });
  const client = new WukongConnection(() => {}, disconnected);
  t.after(() => client.close());
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
  await client.connect(s.registration);
  const pending = assert.rejects(client.sendText("qa", 1, "test"), { message: "IM_DISCONNECTED" });
  t.mock.timers.tick(100000);
  const error = await closed;
  await pending;
  assert.equal(error.message, "IM_HEARTBEAT_TIMEOUT");
  assert.equal(error.retryable, true);
  assert.equal(client.connected, false);
});

test("a success and reconnectable disconnect in the same WS packet cannot resolve a healthy connection", async (t) => {
  const s = await server(t);
  s.ws.on("connection", (peer) =>
    peer.once("message", () => {
      peer.send(Buffer.concat([handshake(), Buffer.from([0x90, 3, 12, 0, 0])]));
    })
  );
  const client = new WukongConnection(() => {});
  t.after(() => client.close());
  await assert.rejects(client.connect(s.registration), {
    message: "IM_SERVER_DISCONNECTED_12",
    retryable: true
  });
  assert.equal(client.connected, false);
});

test("HTTP failures keep status and retry classification without exposing response bodies", async (t) => {
  const s = await server(t);
  const token = `bf_${randomUUID()}`;
  for (const [status, retryable] of [
    [302, false],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [405, false],
    [408, true],
    [409, true],
    [410, false],
    [415, false],
    [421, true],
    [422, false],
    [423, true],
    [425, true],
    [426, false],
    [429, true],
    [451, false],
    [499, true],
    [500, true],
    [502, true],
    [503, true],
    [504, true],
    [599, true]
  ]) {
    s.status(status);
    await assert.rejects(registerBot(s.url, token), (error) => {
      assert.equal(error.message, `IM_REGISTER_HTTP_${status}`);
      assert.equal(error.retryable, retryable);
      assert.equal(JSON.stringify(error).includes(token), false);
      assert.doesNotMatch(JSON.stringify(error), /private response/);
      return true;
    });
    await assert.rejects(verifyBotIdentity(s.url, token, AbortSignal.timeout(1000)), {
      message: `IM_AUTH_HTTP_${status}`,
      retryable
    });
  }
});

test("authentication and registration redirects stay terminal without forwarding credentials", async (t) => {
  let forwarded = 0;
  const target = createServer((_req, res) => {
    forwarded++;
    res.end("{}");
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const source = createServer((_req, res) => {
    res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/redirected` });
    res.end();
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  t.after(async () => {
    for (const server of [source, target]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  const url = `http://127.0.0.1:${source.address().port}`;
  const token = `bf_${randomUUID()}`;
  await assert.rejects(registerBot(url, token), {
    message: "IM_REGISTER_HTTP_307",
    retryable: false
  });
  await assert.rejects(verifyBotIdentity(url, token, AbortSignal.timeout(1000)), {
    message: "IM_AUTH_HTTP_307",
    retryable: false
  });
  assert.equal(forwarded, 0);
});

test("HTTP body interruptions remain retryable while malformed JSON is terminal", async (t) => {
  let malformed = false;
  const http = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (malformed) res.end("invalid JSON");
    else {
      res.write("{");
      setTimeout(() => res.destroy(), 10);
    }
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => {
    http.closeAllConnections();
    return new Promise((resolve) => http.close(resolve));
  });
  const url = `http://127.0.0.1:${http.address().port}`;
  for (const invalid of [false, true]) {
    malformed = invalid;
    await assert.rejects(registerBot(url, `bf_${randomUUID()}`), {
      message: invalid ? "IM_REGISTRATION_INVALID" : "IM_REGISTER_NETWORK_ERROR",
      retryable: !invalid
    });
    await assert.rejects(verifyBotIdentity(url, `bf_${randomUUID()}`, AbortSignal.timeout(1000)), {
      message: invalid ? "IM_AUTH_IDENTITY_INVALID" : "IM_AUTH_NETWORK_ERROR",
      retryable: !invalid
    });
  }
});
