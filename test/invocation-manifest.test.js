import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  reapOrphanedInvocationManifest
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";

const nativeRecord = () => ({
  schemaVersion: 1,
  kernelPid: 2147483646,
  updatedAt: new Date().toISOString(),
  nativeOwner: true,
  cleanupIncomplete: true,
  invocations: []
});
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "octo-native-record-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "invocations.json");
}

test("native ownership records persist only owner and invocation metadata", async (t) => {
  const path = await fixture(t);
  const { manifest, reap } = await InvocationManifest.open(path);
  assert.deepEqual(reap, { found: false, reaped: false });
  await manifest.begin({ invocationId: "invoke-1", runId: "run-1", adapterType: "codex" });
  const persisted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.kernelPid, process.pid);
  assert.equal(persisted.nativeOwner, true);
  assert.equal(persisted.cleanupIncomplete, true);
  assert.equal(persisted.worker, undefined);
  assert.deepEqual(Object.keys(persisted.invocations[0]).sort(), [
    "adapterType",
    "invocationId",
    "runId",
    "startedAt"
  ]);
  assert.doesNotMatch(JSON.stringify(persisted), /prompt|token|secret|providerOptions/);
  assert.equal((await inspectOrphanCleanup(path)).state, "available");
  await manifest.end("invoke-1");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).invocations, []);
  await manifest.close();
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("legacy and malformed records are rejected without deletion, migration or process signals", async (t) => {
  const path = await fixture(t);
  t.mock.method(process, "kill", () => {
    throw new Error("must reject before process access");
  });
  const invalid = [
    "not-json",
    "null",
    "[]",
    "{}",
    JSON.stringify({
      schemaVersion: 1,
      kernelPid: process.pid,
      worker: { pid: process.pid, started: "old", entrypoint: "old" },
      invocations: []
    }),
    JSON.stringify({ ...nativeRecord(), worker: { pid: process.pid } }),
    ...[
      { schemaVersion: 2 },
      { kernelPid: 0 },
      { kernelPid: 2147483648 },
      { nativeOwner: false },
      { cleanupIncomplete: false },
      { cleanupFailed: "true" },
      { updatedAt: "invalid" },
      { invocations: [null] },
      { invocations: [{ invocationId: "one" }] }
    ].map((changes) => JSON.stringify({ ...nativeRecord(), ...changes }))
  ];
  for (const source of invalid) {
    await writeFile(path, source);
    await writeFile(`${path}.acknowledgement`, "preserve unsupported evidence");
    for (const operation of [
      reapOrphanedInvocationManifest,
      InvocationManifest.open,
      acknowledgeOrphanCleanup
    ])
      await assert.rejects(operation(path), { code: "ORPHAN_RECORD_UNSUPPORTED" });
    assert.equal((await inspectOrphanCleanup(path)).state, "unsupported");
    assert.equal(await readFile(path, "utf8"), source);
    assert.equal(
      await readFile(`${path}.acknowledgement`, "utf8"),
      "preserve unsupported evidence"
    );
  }
});

test("native recovery only checks owner liveness and never claims process cleanup", async (t) => {
  const path = await fixture(t);
  const source = JSON.stringify(nativeRecord());
  await writeFile(path, source);
  let alive = true;
  t.mock.method(process, "kill", (pid, signal) => {
    assert.equal(pid, 2147483646);
    assert.equal(signal, 0, "recovery must not terminate any process");
    if (alive) return true;
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "kernel_alive");
  await assert.rejects(InvocationManifest.open(path), /cannot replace live/);
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  alive = false;
  assert.deepEqual(await reapOrphanedInvocationManifest(path), {
    found: true,
    reaped: false,
    reason: "cleanup_incomplete"
  });
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  assert.equal(await readFile(path, "utf8"), source);
  await acknowledgeOrphanCleanup(path);
  assert.deepEqual(await reapOrphanedInvocationManifest(path), {
    found: true,
    reaped: false,
    reason: "cleanup_acknowledged"
  });
  assert.equal(await readFile(path, "utf8"), source);
});

test("unreadable records and uncertain owner probes are not treated as missing", async (t) => {
  const path = await fixture(t);
  await mkdir(path);
  await assert.rejects(InvocationManifest.open(path));
  assert.equal((await inspectOrphanCleanup(path)).state, "unreadable");
  await rm(path, { recursive: true });
  const source = JSON.stringify(nativeRecord());
  await writeFile(path, source);
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("probe failed"), { code: "EIO" });
  });
  await assert.rejects(InvocationManifest.open(path), { code: "EIO" });
  await assert.rejects(acknowledgeOrphanCleanup(path), { code: "EIO" });
  assert.equal((await inspectOrphanCleanup(path)).state, "unreadable");
  assert.equal(await readFile(path, "utf8"), source);
});
