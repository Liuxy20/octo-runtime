import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../apps/cli/dist/main.js";
import { runForegroundService } from "../apps/cli/dist/foreground.js";
import {
  describeError,
  recordStartupFailure,
  readStartupFailure
} from "../apps/cli/dist/output.js";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";

const deferred = () => Promise.withResolvers();
async function fixture(t) {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc-race-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "sockets"), { recursive: true });
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(componentEndpoint(home, "channel-gateway"), resolve);
    });
  const respond = (socket, bytes) =>
    socket.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: JSON.parse(bytes.toString()).id,
        result: { name: "channel-gateway", pid: 123, status: {} }
      }) + "\n"
    );
  const call = async (action, backend, extra = {}) => {
    const output = [];
    const code = await runCli(["--home", home, "channel-gateway", action, "--json"], {
      backend,
      output: (line) => output.push(JSON.parse(line)),
      errorOutput() {},
      ...extra
    });
    return { code, output };
  };
  return { home, server, listen, respond, call };
}

test("component lock covers startup readiness and final status against every lifecycle mutation", async (t) => {
  const { server, listen, respond, call } = await fixture(t);
  const queried = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  let block = true;
  server.on("connection", (socket) =>
    socket.once("data", async (bytes) => {
      if (block) {
        block = false;
        queried.resolve();
        await release.promise;
      }
      respond(socket, bytes);
    })
  );
  await listen();
  const calls = [];
  const backend = {
    kind: "fixture",
    inspect: async () => {
      calls.push("inspect");
      return { manager: "fixture", state: "running", enabled: true, drift: [] };
    },
    ...Object.fromEntries(
      ["install", "start", "stop", "restart", "uninstall"].map((action) => [
        action,
        async () => calls.push(action)
      ])
    )
  };
  const starting = call("start", backend);
  await queried.promise;
  const before = [...calls];
  for (const action of ["install", "start", "stop", "restart", "uninstall"]) {
    const competing = await call(action, backend);
    assert.equal(competing.code, 1);
    assert.equal(competing.output[0].error.code, "SETUP_IN_PROGRESS");
    assert.deepEqual(calls, before, `${action} must not inspect or mutate during startup`);
  }
  release.resolve();
  assert.equal((await starting).code, 0);
  assert.equal((await call("restart", backend)).code, 0, "lock released after confirmed status");
  assert.equal((await call("uninstall", backend)).code, 0);
});

for (const action of ["start", "restart"]) {
  test(`${action} retains readiness budget when the manager still exposes a previous failure`, async (t) => {
    const { server, listen, respond, call } = await fixture(t);
    server.on("connection", (socket) => socket.once("data", (bytes) => respond(socket, bytes)));
    let launched = false;
    let polls = 0;
    const backend = {
      kind: "fixture",
      inspect: async () => ({
        manager: "fixture",
        state: launched ? "running" : "failed",
        lastExitCode: 17,
        enabled: true,
        drift: []
      }),
      [action]: async () => {}
    };
    const result = await call(action, backend, {
      sleep: async () => {
        polls++;
        if (polls === 2) {
          await listen();
          launched = true;
        }
      }
    });
    assert.equal(result.code, 0);
    assert.equal(polls, 2);
    assert.equal(result.output[0].runtime.pid, 123);
  });
}

for (const mode of ["closed", "rejected", "initialize-rejected", "initialize-and-close-rejected"]) {
  test(`foreground ${mode} reports one terminal diagnostic and detaches signal listeners`, async (t) => {
    const { home } = await fixture(t);
    const closed = deferred();
    const initialized = deferred();
    const failures = [];
    const counts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    let closes = 0;
    const handle = {
      initialize: async () => {
        if (mode.startsWith("initialize")) throw new Error("STARTUP_FAILED");
      },
      close: async () => {
        closes++;
        if (mode === "initialize-and-close-rejected") throw new Error("DISPOSAL_FAILED");
        closed.resolve({ complete: true, unresolved: [] });
        return { complete: true, unresolved: [] };
      },
      closed: closed.promise
    };
    const result = runForegroundService(
      handle,
      () => initialized.resolve(),
      async (error) => {
        failures.push(describeError(error));
        await recordStartupFailure(join(home, "logs"), "channel-gateway", error);
      }
    );
    if (!mode.startsWith("initialize")) {
      await initialized.promise;
      if (mode === "rejected") closed.reject(new Error("WORKER_LOST"));
      else closed.resolve({ complete: true, unresolved: [] });
    }
    assert.equal(await result, mode === "initialize-and-close-rejected" ? 5 : 1);
    assert.equal(failures.length, 1);
    assert.equal(
      failures[0].code,
      mode.startsWith("initialize") ? "STARTUP_FAILED" : "SERVICE_PROCESS_EXITED"
    );
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], counts);
    const logged = await readStartupFailure(join(home, "logs"), "channel-gateway", 0);
    assert.equal(logged.message, failures[0].code);
    if (mode === "rejected") assert.equal(failures[0].cause_code, "WORKER_LOST");
    assert.equal(closes, mode === "closed" ? 0 : 1);
  });
}
