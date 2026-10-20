import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { waitFor } from "./runtime-fixture.js";

async function fixture(t, mode, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), "oes-"));
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\oes-${randomUUID()}`
      : join(directory, "extra.sock");
  const file = join(directory, "config.json");
  const started = join(directory, "started"),
    disposed = join(directory, "disposed");
  await writeFile(
    file,
    JSON.stringify({
      endpoint: join(directory, "missing-kernel.sock"),
      controlEndpoint: endpoint,
      instance: "fixture",
      epoch: "fixture",
      declaration: {
        name: "startup",
        module: resolve("test/fixtures/extra-startup-plugin.mjs"),
        config: { started, disposed, ...config }
      }
    })
  );
  const child = fork(
    resolve("packages/octo-runtime-host-sdk/dist/extra-entry.js"),
    ["--config", file],
    {
      execArgv: [
        "--import",
        pathToFileURL(resolve("test/fixtures/extra-startup-preload.mjs")).href
      ],
      env: {
        ...process.env,
        OCTO_EXTRA_STARTUP_FIXTURE: mode,
        OCTO_EXTRA_STARTUP_CONFIG: file,
        OCTO_EXTRA_STARTUP_ENDPOINT: endpoint
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    }
  );
  const messages = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("message", (message) => messages.push(message));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  const until = (type, stage, timeoutMs) =>
    waitFor(
      () =>
        messages.find((message) => message.type === type && (!stage || message.stage === stage)),
      timeoutMs
    ).catch((error) => {
      throw new Error(`${error.message}: ${stderr}; ${JSON.stringify(messages)}`);
    });
  return { child, messages, endpoint, started, disposed, exited, until, stderr: () => stderr };
}

for (const mode of ["config", "import", "lease"]) {
  test(
    `Extra stop waits for pending ${mode} and does not create a late endpoint`,
    { timeout: 8000, skip: process.platform === "win32" && mode === "lease" },
    async (t) => {
      const state = await fixture(t, mode);
      await state.until("fixture.stage", mode);
      state.child.send({ type: "component.stop", request_id: "stop" });
      await state.until("component.stopped");
      const stopped = state.messages.find((message) => message.type === "component.stopped");
      assert.equal(stopped.request_id, "stop");
      assert.equal(stopped.complete, true, state.stderr());
      assert.ok(
        state.messages.findIndex((message) => message.type === "fixture.stage.finished") <
          state.messages.findIndex((message) => message.type === "component.stopped")
      );
      assert.equal(
        state.messages.some((message) => message.type === "component.ready"),
        false
      );
      assert.equal(await state.exited, 0, state.stderr());
      await assert.rejects(stat(state.endpoint), { code: "ENOENT" });
      if (process.platform !== "win32")
        await assert.rejects(stat(`${state.endpoint}.owner`), { code: "ENOENT" });
      if (mode !== "lease") await assert.rejects(stat(state.started), { code: "ENOENT" });
    }
  );
}

test(
  "Extra startup exceeding the shared cleanup deadline reports incomplete and cannot bind later",
  { timeout: 10000, skip: process.platform === "win32" },
  async (t) => {
    const state = await fixture(t, "lease-late");
    await state.until("fixture.stage", "lease");
    const started = Date.now();
    state.child.send({ type: "component.stop", request_id: "stop" });
    await state.until("component.stopped", undefined, 6000);
    assert.equal(
      state.messages.find((message) => message.type === "component.stopped").complete,
      false
    );
    assert.ok(Date.now() - started < 5500);
    assert.equal(await state.exited, 1, state.stderr());
    assert.equal(
      state.messages.some((message) => message.type === "component.ready"),
      false
    );
    await assert.rejects(stat(state.endpoint), { code: "ENOENT" });
  }
);

test(
  "Extra parent disconnect during module import prevents later initialization",
  { timeout: 8000 },
  async (t) => {
    const state = await fixture(t, "import");
    await state.until("fixture.stage", "import");
    state.child.disconnect();
    assert.equal(await state.exited, 0, state.stderr());
    await assert.rejects(stat(state.started), { code: "ENOENT" });
    await assert.rejects(stat(state.endpoint), { code: "ENOENT" });
  }
);

test(
  "Extra startup cancellation aborts an initializer and runs disposal",
  { timeout: 8000 },
  async (t) => {
    const state = await fixture(t, "initialize", { waitForAbort: true });
    await state.until("fixture.stage", "initialize");
    state.child.send({ type: "component.stop", request_id: "stop" });
    await state.until("component.stopped");
    assert.equal(
      state.messages.find((message) => message.type === "component.stopped").complete,
      true
    );
    assert.equal(await readFile(state.disposed, "utf8"), "disposed");
    assert.equal(await state.exited, 0, state.stderr());
    await assert.rejects(stat(state.endpoint), { code: "ENOENT" });
  }
);

for (const mode of ["unlink", "lease-release", "dispose", "logs-close"]) {
  test(
    `Extra ${mode} failure attempts logging cleanup and retains failed ownership`,
    {
      timeout: 8000,
      skip: process.platform === "win32" && ["unlink", "lease-release"].includes(mode)
    },
    async (t) => {
      const state = await fixture(t, mode, { failDispose: mode === "dispose" });
      await state.until("component.ready");
      if (mode === "lease-release")
        await writeFile(`${state.endpoint}.owner`, '{"nonce":"changed"}');
      state.child.send({ type: "component.stop", request_id: "stop" });
      await state.until("component.stopped");
      assert.equal(
        state.messages.find((message) => message.type === "component.stopped").complete,
        false
      );
      assert.ok(state.messages.some((message) => message.type === "fixture.logs.closed"));
      assert.equal(await readFile(state.disposed, "utf8"), "disposed");
      assert.equal(await state.exited, 1, state.stderr());
      if (process.platform !== "win32") await stat(`${state.endpoint}.owner`);
    }
  );
}
