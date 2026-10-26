import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  symlink,
  unlink,
  rename,
  mkdir
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import net from "node:net";
import WebSocket from "ws";
import { recoveryLiveFaults } from "../test-support/recovery-live-faults.mjs";
import {
  waitFor,
  inspectStatus,
  historyMessages,
  childEnvironment,
  octoEnvironment
} from "../test-support/recovery-live-probes.mjs";

const options = { interval: 10 };
const eventsAt = async (file) =>
  (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);

test("live fault preload records only the main thread when workers inherit NODE_OPTIONS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-preload-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  try {
    await writeFile(controlFile, JSON.stringify({ blocked: true, drop: 1 }), { mode: 0o600 });
    await writeFile(eventsFile, "");
    const preload = new URL("../test-support/recovery-live-faults.mjs", import.meta.url).href;
    const probes = new URL("../test-support/recovery-live-probes.mjs", import.meta.url).href;
    await promisify(execFile)(
      process.execPath,
      [
        "--eval",
        `const { Worker } = require("node:worker_threads");
(async () => {
  const { waitFor } = await import(${JSON.stringify(probes)});
  const { readFile } = require("node:fs/promises");
  const auth = "https://im-test.deepminer.com.cn/api/v1/auth/verify-bot";
  const result = await fetch(auth, { signal: AbortSignal.abort(new Error("QA_ALREADY_ABORTED")) })
    .then(() => "unexpected", (error) => error.message);
  if (result !== "RECOVERY_QA_LOCAL_NETWORK_FAULT") throw new Error("QA_MAIN_NOT_PATCHED");
  const worker = new Worker(\`const { parentPort } = require("node:worker_threads");
    fetch(\${JSON.stringify(auth)}, { signal: AbortSignal.abort(new Error("QA_ALREADY_ABORTED")) })
      .then(() => parentPort.postMessage("unexpected"), (error) => parentPort.postMessage(error.message));\`, { eval: true });
  const reply = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
  });
  if (reply !== "QA_ALREADY_ABORTED") throw new Error("QA_WORKER_PATCHED");
  await waitFor(async () => (await readFile(process.env.OCTO_RECOVERY_QA_EVENTS, "utf8"))
    .trim().split("\\n").filter(Boolean).map(JSON.parse).some(e => e.event === "drop"), "QA_DROP_MISSING", 3000);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });`
      ],
      {
        env: {
          ...childEnvironment(process.env),
          NODE_OPTIONS: `--import=${preload}`,
          OCTO_RECOVERY_QA_CONTROL: controlFile,
          OCTO_RECOVERY_QA_EVENTS: eventsFile
        },
        timeout: 10_000,
        killSignal: "SIGKILL",
        maxBuffer: 32 * 1024
      }
    );
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    const drops = events.filter((event) => event.event === "drop");
    assert.equal(drops.length, 1, "the inherited preload must not record a worker drop");
    assert.equal(drops[0].sockets, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("live fault harness isolates test auth, drops once and restores global hooks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-probe-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  const originalFetch = globalThis.fetch,
    originalSend = WebSocket.prototype.send;
  const forwarded = [];
  globalThis.fetch = async (url) => {
    forwarded.push(String(url));
    return { ok: true };
  };
  WebSocket.prototype.send = function () {
    return "sent";
  };
  const stubFetch = globalThis.fetch,
    stubSend = WebSocket.prototype.send;
  let restore;
  try {
    await writeFile(controlFile, JSON.stringify({ blocked: true, drop: 0 }), { mode: 0o600 });
    restore = recoveryLiveFaults({ controlFile, eventsFile });
    await assert.rejects(
      globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot"),
      /RECOVERY_QA_LOCAL_NETWORK_FAULT/
    );
    await globalThis.fetch("https://im.deepminer.com.cn/api/v1/auth/verify-bot");
    await globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/bot/register");
    assert.equal(forwarded.length, 2);
    const socket = new EventEmitter();
    let drops = 0;
    socket.terminate = () => {
      drops++;
      socket.emit("close");
    };
    assert.equal(WebSocket.prototype.send.call(socket), "sent");
    await writeFile(controlFile, JSON.stringify({ blocked: false, drop: 1 }));
    await waitFor(() => drops === 1, "QA_DROP_MISSING", 3000, options);
    assert.equal(drops, 1);
    await globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot");
    assert.equal(forwarded.length, 3);
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      events.map((event) => event.event),
      ["blocked_auth", "drop"]
    );
    assert.equal(events[1].sockets, 1);
    restore();
    restore = undefined;
    assert.equal(globalThis.fetch, stubFetch);
    assert.equal(WebSocket.prototype.send, stubSend);
  } finally {
    restore?.();
    globalThis.fetch = originalFetch;
    WebSocket.prototype.send = originalSend;
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only waits retry transient errors but preserve fatal and owner failures", async () => {
  let attempts = 0;
  const result = await waitFor(
    () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error("temporary"), { code: "ECONNRESET" });
      if (attempts === 2) return false;
      return "ready";
    },
    "QA_NOT_READY",
    3000,
    options
  );
  assert.equal(result, "ready");
  assert.equal(attempts, 3);
  const fatal = new Error("FORBIDDEN");
  await assert.rejects(
    waitFor(
      () => {
        throw fatal;
      },
      "QA_NOT_READY",
      3000,
      options
    ),
    (e) => e === fatal
  );
  const owner = Object.assign(new Error("QA_CHILD_EXITED"), { retryable: true });
  await assert.rejects(
    waitFor(() => assert.fail("predicate must not run"), "QA_NOT_READY", 3000, {
      ...options,
      beforeAttempt: () => {
        throw owner;
      }
    }),
    (e) => e === owner
  );
});

test("read-only waits retain the last transient cause at their deadline", async () => {
  const transient = Object.assign(new Error("rate limited"), { retryable: true });
  await assert.rejects(
    waitFor(
      () => {
        throw transient;
      },
      "QA_DEADLINE",
      30,
      options
    ),
    (e) => e.message === "QA_DEADLINE" && e.cause === transient
  );
});

async function withStatusServer(action, inspect) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => action(socket));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return await inspect({ host: "127.0.0.1", port: server.address().port });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("status probe succeeds when the peer closes after a complete response", async () => {
  await withStatusServer(
    (socket) => {
      socket.write('{"jsonrpc":"2.0","id":"qa",');
      setImmediate(() => socket.end('"result":{"ready":true}}\n'));
    },
    async (endpoint) => assert.deepEqual(await inspectStatus(endpoint), { ready: true })
  );
});

test("status probe rejects a close before the complete response", async () => {
  await withStatusServer(
    (socket) => socket.end('{"jsonrpc":"2.0"'),
    (endpoint) => assert.rejects(inspectStatus(endpoint), /QA_STATUS_CLOSED/)
  );
});

test("status probe rejects invalid protocol responses and times out silent peers", async () => {
  for (const frame of [
    "bad-json\n",
    '{"jsonrpc":"2.0","id":"wrong","result":{}}\n',
    '{"jsonrpc":"2.0","id":"qa","error":{"code":-1}}\n'
  ]) {
    await withStatusServer(
      (socket) => socket.end(frame),
      (endpoint) => assert.rejects(inspectStatus(endpoint), /QA_STATUS_RESPONSE_INVALID/)
    );
  }
  await withStatusServer(
    () => {},
    (endpoint) => assert.rejects(inspectStatus(endpoint, 50), /QA_STATUS_TIMEOUT/)
  );
});

test("history readback skips malformed payloads without losing valid messages", () => {
  const messages = [
    null,
    { payload: "not-json" },
    { payload: "bnVsbA==" },
    { payload: { type: 1, content: 123 } },
    { message_idstr: "id-1", from_uid: "sender", payload: { type: 1, content: "marker" } },
    {
      message_id: 2,
      from_uid: "sender",
      payload: Buffer.from(JSON.stringify({ type: 1, content: "marker2" })).toString("base64")
    }
  ];
  const actual = historyMessages(messages);
  assert.deepEqual(
    actual.map((m) => [m.id, m.payload.content, m.from_uid]),
    [
      ["id-1", "marker", "sender"],
      ["2", "marker2", "sender"]
    ]
  );
});

test("child environments exclude unrelated credentials, profiles and inherited Node hooks", () => {
  const source = {
    PATH: "/tools",
    HOME: "/test-home",
    HTTPS_PROXY: "http://127.0.0.1:1",
    OPENAI_API_KEY: randomUUID(),
    CODEX_HOME: "/codex-home",
    OCTO_TASK_TOKEN: randomUUID(),
    OCTO_TOKEN: randomUUID(),
    OCTO_PROFILE: "other",
    AWS_SECRET_ACCESS_KEY: randomUUID(),
    NODE_OPTIONS: "--inspect",
    NODE_PATH: "/unexpected"
  };
  assert.deepEqual(childEnvironment(source), {
    PATH: source.PATH,
    HOME: source.HOME,
    HTTPS_PROXY: source.HTTPS_PROXY
  });
  assert.deepEqual(childEnvironment(source, { provider: true }), {
    PATH: source.PATH,
    HOME: source.HOME,
    HTTPS_PROXY: source.HTTPS_PROXY,
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    CODEX_HOME: source.CODEX_HOME
  });
});

test("CLI credentials always select the trial store instead of operator profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-cli-env-"));
  const configDirectory = join(directory, "trial");
  try {
    await mkdir(configDirectory, { mode: 0o700 });
    for (const count of [0, 1, 2]) {
      const operator = join(directory, `operator-${count}`);
      await mkdir(operator);
      const metadata = JSON.stringify({
        profiles: Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`profile-${i}`, { bot_kind: "user_bot" }])
        )
      });
      await writeFile(join(operator, "config.json"), metadata);
      for (const prefix of ["bf_", "uk_"]) {
        const token = prefix + randomUUID();
        const env = octoEnvironment(
          {
            ...process.env,
            HOME: directory,
            OCTO_CONFIG_DIR: operator,
            OCTO_PROFILE: "profile-0",
            OCTO_BOT_TOKEN: randomUUID(),
            OCTO_TOKEN: randomUUID()
          },
          { token, configDirectory }
        );
        assert.equal(env.OCTO_TOKEN, token);
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `
            import { readdir } from "node:fs/promises";
            process.stdout.write(JSON.stringify({
              directory: process.env.OCTO_CONFIG_DIR,
              entries: await readdir(process.env.OCTO_CONFIG_DIR),
              selected: process.env.OCTO_TOKEN.startsWith(process.argv[1]),
              profile: process.env.OCTO_PROFILE,
              otherToken: process.env.OCTO_BOT_TOKEN
            }));
          `,
            prefix
          ],
          { env, timeout: 5000 }
        );
        assert.deepEqual(JSON.parse(stdout), {
          directory: configDirectory,
          entries: [],
          selected: true
        });
      }
      assert.equal(await readFile(join(operator, "config.json"), "utf8"), metadata);
    }
    for (const configDirectory of [undefined, "", "relative"]) {
      assert.throws(
        () => octoEnvironment({}, { token: randomUUID(), configDirectory }),
        /QA_CLI_CONFIG_DIRECTORY_REQUIRED/
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fault controls reject unsafe files, invalid schema and oversized inputs before patching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-control-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  const fetch = globalThis.fetch,
    send = WebSocket.prototype.send;
  try {
    for (const content of [
      "{",
      JSON.stringify({ blocked: "yes", drop: 0 }),
      JSON.stringify({ blocked: false, drop: -1 }),
      " ".repeat(4097)
    ]) {
      await writeFile(controlFile, content, { mode: 0o600 });
      assert.throws(() => recoveryLiveFaults({ controlFile, eventsFile }));
      assert.equal(globalThis.fetch, fetch);
      assert.equal(WebSocket.prototype.send, send);
    }
    await unlink(controlFile);
    await mkdir(controlFile);
    assert.throws(() => recoveryLiveFaults({ controlFile, eventsFile }), /QA_FAULT_CONTROL_UNSAFE/);
    await rm(controlFile, { recursive: true });
    await writeFile(controlFile, JSON.stringify({ blocked: false, drop: 0 }), { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(controlFile, 0o620);
      assert.throws(
        () => recoveryLiveFaults({ controlFile, eventsFile }),
        /QA_FAULT_CONTROL_UNSAFE/
      );
      await chmod(controlFile, 0o600);
      const link = join(directory, "link");
      await symlink(controlFile, link);
      assert.throws(
        () => recoveryLiveFaults({ controlFile: link, eventsFile }),
        /QA_FAULT_CONTROL_UNSAFE/
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid control updates preserve the last auth state, skip drops and recover after atomic replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recovery-control-update-"));
  const controlFile = join(directory, "fault.json"),
    eventsFile = join(directory, "events");
  const originalFetch = globalThis.fetch,
    originalSend = WebSocket.prototype.send;
  let restore;
  try {
    await writeFile(controlFile, JSON.stringify({ blocked: true, drop: 0 }), { mode: 0o600 });
    await writeFile(eventsFile, "");
    globalThis.fetch = async () => ({ ok: true });
    WebSocket.prototype.send = () => {};
    restore = recoveryLiveFaults({ controlFile, eventsFile });
    const socket = new EventEmitter();
    let drops = 0;
    socket.terminate = () => {
      drops++;
      socket.emit("close");
    };
    WebSocket.prototype.send.call(socket);
    await writeFile(controlFile, "{");
    await waitFor(
      async () => (await eventsAt(eventsFile)).some((e) => e.event === "control_error"),
      "QA_ERROR_NOT_RECORDED",
      3000,
      options
    );
    await assert.rejects(
      globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot"),
      /RECOVERY_QA_LOCAL_NETWORK_FAULT/
    );
    assert.equal(drops, 0);
    assert.equal((await eventsAt(eventsFile)).filter((e) => e.event === "control_error").length, 1);
    await writeFile(`${controlFile}.tmp`, JSON.stringify({ blocked: false, drop: 1 }), {
      mode: 0o600
    });
    await rename(`${controlFile}.tmp`, controlFile);
    await waitFor(() => drops === 1, "QA_CONTROL_NOT_RECOVERED", 3000, options);
    assert.equal(
      (await globalThis.fetch("https://im-test.deepminer.com.cn/api/v1/auth/verify-bot")).ok,
      true
    );
  } finally {
    restore?.();
    globalThis.fetch = originalFetch;
    WebSocket.prototype.send = originalSend;
    await rm(directory, { recursive: true, force: true });
  }
});
