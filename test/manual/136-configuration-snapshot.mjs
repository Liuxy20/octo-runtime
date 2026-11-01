// 显式运行：node test/manual/136-configuration-snapshot.mjs，不纳入默认 CI。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { kernelFixture, frames } from "../kernel-fixture.js";
import { WorkerRpcClient } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  DEFAULT_STREAM_LIMIT_POLICY,
  INVOKE_REQUEST_MAX_BYTES
} from "@mininglamp-oss/octo-runtime-protocol";

const manifest = resolve("test/manual/136-configuration-adapters.json");
const config = (revision) => ({
  providerOptions: { revision: String(revision), shared: "host" },
  streamLimits: { hostFrameMaxBytes: revision === 1 ? 5120 : 6144 }
});
const input = (prompt = "report", fields = {}) => ({
  inputs: [{ type: "text", text: prompt }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "snapshot" } }]
  },
  protocol_mode: "canonical",
  approvalMode: "full_access",
  runId: randomUUID(),
  invocationId: randomUUID(),
  ...fields
});
const report = (events) =>
  events
    .filter((f) => f.kind === "canonical" && f.event.type === "message.delta")
    .map((f) => f.event.payload.text)
    .filter((text) => text.startsWith("{"))
    .map((text) => JSON.parse(text));
const outcome = (events) => ({
  state: events.at(-1).control.state,
  errors: events
    .filter((f) => f.kind === "control" && f.control.type === "error")
    .map((f) => f.control.code)
});
async function run(client, value = input()) {
  const { ref } = await client.submit(value);
  return frames(client, ref);
}
async function waitForStart(path, count = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")).trim().split("\n").length >= count) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await setTimeout(10);
  }
  throw new Error("fixture did not start");
}

test("A1/A2: changing resolver matches one fixed revision for options, limits and output", async (t) => {
  for (const selected of [1, 2]) {
    let calls = 0;
    const changing = await kernelFixture(t, {
      manifest,
      configurations: () => ({ snapshot: config(calls++ === 0 ? selected : 3 - selected) })
    });
    const fixed = await kernelFixture(t, {
      manifest,
      adapterConfigurations: { snapshot: config(selected) }
    });
    const actual = await run(changing.client, input("large"));
    const control = await run(fixed.client, input("large"));
    assert.equal(calls, 1);
    assert.deepEqual(report(actual)[0], report(control)[0]);
    assert.equal(report(actual)[0].options.revision, String(selected));
    assert.equal(report(actual)[0].limit, selected === 1 ? 5120 : 6144);
    assert.deepEqual(outcome(actual), outcome(control));
    if (selected === 1) {
      assert.notEqual(outcome(actual).state, "completed");
      assert.ok(outcome(actual).errors.includes("HOST_FRAME_TOO_LARGE"));
    } else {
      assert.equal(outcome(actual).state, "completed");
      const large = actual.find(
        (f) => f.kind === "canonical" && f.event.payload.text?.length === 5000
      );
      const bytes = Buffer.byteLength(JSON.stringify(large));
      assert.ok(bytes > 5120 && bytes <= 6144, `complete frame: ${bytes}`);
      t.diagnostic(`complete output frame: ${bytes} bytes`);
    }
    // 保持专项的 worker 数量有界；fixture after 仍确认同一个幂等 close 的结果。
    assert.equal((await changing.server.close()).complete, true);
    assert.equal((await fixed.server.close()).complete, true);
  }
});

test("A3/A4/A7: active runs keep copies while subsequent/concurrent runs and list use new config", async (t) => {
  const original = config(1);
  let calls = 0;
  const runtimes = [];
  const f = await kernelFixture(t, {
    manifest,
    configurations: (runtimeId) => {
      calls++;
      runtimes.push(runtimeId);
      return { snapshot: original };
    }
  });
  const startsFile = join(f.directory, "starts");
  const gateFile = join(f.directory, "gate");
  const value = input("wait", { runMetadata: { startsFile, gateFile, runtimeId: "first" } });
  const { ref } = await f.client.submit(value);
  await waitForStart(startsFile);
  assert.equal(calls, 1);
  assert.equal(Object.isFrozen(original), false);
  assert.equal(Object.isFrozen(original.providerOptions), false);
  assert.equal(Object.isFrozen(original.streamLimits), false);
  original.providerOptions.revision = "2";
  original.streamLimits.hostFrameMaxBytes = 6144;
  const second = await run(f.client, input("report", { runMetadata: { runtimeId: "second" } }));
  assert.equal(report(second)[0].options.revision, "2");
  assert.equal(report(second)[0].limit, 6144);
  assert.equal(calls, 2);
  const listed = await f.client.list();
  assert.equal(listed.find((item) => item.type === "snapshot").providerVersion, "2");
  assert.equal(calls, 3);
  assert.deepEqual(runtimes, ["first", "second", undefined]);
  await writeFile(gateFile, "release");
  const first = await frames(f.client, ref);
  assert.equal(first.at(-1).control.state, "completed");
  assert.equal(report(first).length, 2);
  for (const observed of report(first)) {
    assert.equal(observed.options.revision, "1");
    assert.equal(observed.limit, 5120);
  }
  await frames(f.client, ref);
  assert.equal(calls, 3, "subscription/replay must not resolve again");
  const waiting = await f.client.submit(
    input("wait", {
      runMetadata: { startsFile, gateFile: join(f.directory, "never") }
    })
  );
  await waitForStart(startsFile, 2);
  const beforeCancel = calls;
  await f.client.cancel(waiting.ref);
  assert.equal((await frames(f.client, waiting.ref)).at(-1).control.state, "cancelled");
  assert.equal(calls, beforeCancel);
});

test("A5: static/default/missing configuration and option precedence preserve caller objects", async (t) => {
  const staticConfig = { snapshot: config(2) };
  for (const [extra, expectedRevision] of [
    [{ adapterConfigurations: staticConfig }, "2"],
    [{ adapterConfigurations: staticConfig, configurations: () => undefined }, "2"],
    [{ adapterConfigurations: staticConfig, configurations: () => ({}) }, undefined],
    [{}, undefined]
  ]) {
    const f = await kernelFixture(t, { manifest, ...extra });
    const value = input("report", {
      agentConfig: { providerOptions: { shared: "input", keep: "yes" } }
    });
    const before = structuredClone(value);
    const observed = report(await run(f.client, value))[0];
    assert.equal(observed.options.revision, expectedRevision);
    assert.equal(observed.options.shared, expectedRevision ? "host" : "input");
    assert.equal(observed.options.keep, "yes");
    assert.equal(
      observed.limit,
      expectedRevision ? 6144 : DEFAULT_STREAM_LIMIT_POLICY.hostFrameMaxBytes
    );
    assert.deepEqual(value, before);
    assert.deepEqual(staticConfig, { snapshot: config(2) });
    assert.equal((await f.server.close()).complete, true);
  }
});

test("A6: invalid/throwing configurations fail before worker invoke, without disturbing another run", async (t) => {
  let submissions = 0;
  const invokeFrames = WorkerRpcClient.prototype.invokeFrames;
  t.mock.method(WorkerRpcClient.prototype, "invokeFrames", function (...args) {
    submissions++;
    return invokeFrames.apply(this, args);
  });
  let current = config(2);
  const f = await kernelFixture(t, {
    manifest,
    configurations: () => {
      if (current instanceof Error) throw current;
      return { snapshot: current };
    }
  });
  const startsFile = join(f.directory, "starts");
  const gateFile = join(f.directory, "gate");
  const active = await f.client.submit(input("wait", { runMetadata: { startsFile, gateFile } }));
  await waitForStart(startsFile);
  assert.equal(submissions, 1);
  for (const invalid of [
    new Error("resolver failed"),
    null,
    { providerOptions: { revision: 7 } },
    { providerOptions: [] },
    { streamLimits: { hostFrameMaxBytes: 0 } },
    { providerOptions: { padding: "x".repeat(INVOKE_REQUEST_MAX_BYTES) } }
  ]) {
    current = invalid;
    await assert.rejects(
      f.client.submit(input("report", { runMetadata: { startsFile } })),
      invalid?.providerOptions?.padding ? /INVOKE_REQUEST_TOO_LARGE/ : undefined
    );
    assert.equal(submissions, 1, "invalid configurations must not reach worker invoke");
    assert.equal(await readFile(startsFile, "utf8"), "start\n");
  }
  current = config(2);
  assert.equal(outcome(await run(f.client)).state, "completed");
  await writeFile(gateFile, "release");
  assert.equal((await frames(f.client, active.ref)).at(-1).control.state, "completed");
});

test("A5: omitted Adapter selects codex configuration using this invocation's runtimeId", async (t) => {
  const runtimes = [];
  const f = await kernelFixture(t, {
    manifest,
    configurations: (runtimeId) => {
      runtimes.push(runtimeId);
      return { codex: config(runtimeId === "first" ? 1 : 2), snapshot: config(2) };
    }
  });
  for (const [runtimeId, revision, limit] of [
    ["first", "1", 5120],
    ["second", "2", 6144]
  ]) {
    const events = await run(
      f.client,
      input("report", {
        contexts: { schema: "octo.context-envelope/v3", items: [] },
        runMetadata: { runtimeId }
      })
    );
    assert.equal(outcome(events).state, "completed");
    assert.equal(report(events)[0].options.revision, revision);
    assert.equal(report(events)[0].limit, limit);
  }
  assert.deepEqual(runtimes, ["first", "second"]);
});
