import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  truncateSync,
  symlinkSync
} from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HourlyLogWriter,
  HOURLY_LOG_MAX_BYTES
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { resolveServiceControl } from "../apps/cli/dist/service-control.js";

const hour = 3600000;
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "octo-hourly-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const files = (path) => readdirSync(path).filter((name) => name.endsWith(".log"));
async function wait(predicate) {
  const end = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() >= end) throw new Error("hourly log verification timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("F31 retains three actual files across idle days, restart and clock reversal", (t) => {
  const root = directory(t);
  let now = Date.UTC(2026, 9, 16);
  let writer = new HourlyLogWriter(root, "test", { now: () => now, cleanupIntervalMs: 10 });
  t.after(() => writer.close());
  for (let i = 0; i < 24; i++) {
    assert.equal(writer.write("row\n"), true);
    assert.ok(files(root).length <= 3);
    now += hour;
  }
  const beforeIdle = files(root).sort();
  now += 48 * hour;
  writer.cleanup();
  assert.deepEqual(files(root).sort(), beforeIdle);
  writer.close();
  writer = new HourlyLogWriter(root, "test", { now: () => now });
  assert.deepEqual(files(root).sort(), beforeIdle);
  assert.equal(writer.write("after restart\n"), true);
  assert.equal(files(root).length, 3);
  assert.equal(files(root).includes(beforeIdle[0]), false);
  now -= 12 * hour;
  assert.equal(writer.write("clock reversed\n"), true);
  assert.equal(files(root).length, 3);
  const stamp = new Date(now).toISOString().slice(0, 13).replace(/[-:]/g, "");
  assert.ok(files(root).includes(`test-${stamp}.log`));
});

test("F31 retention is per category and never ages out an otherwise retained file", (t) => {
  const root = directory(t);
  let now = Date.UTC(2026, 9, 16);
  const writers = ["kernel", "channel-gateway"].map(
    (category) => new HourlyLogWriter(root, category, { now: () => now })
  );
  t.after(() => writers.forEach((writer) => writer.close()));
  for (let i = 0; i < 5; i++) {
    for (const writer of writers) assert.equal(writer.write("metadata\n"), true);
    now += 24 * hour;
  }
  for (const writer of writers) {
    writer.cleanup();
    assert.equal(files(root).filter((name) => name.startsWith(writer.category + "-")).length, 3);
  }
  assert.equal(files(root).length, 6);
});

test("actual 100 MiB boundary is inherited after restart and never creates overflow shards", (t) => {
  const root = directory(t);
  let now = Date.UTC(2026, 9, 16, 7);
  let writer = new HourlyLogWriter(root, "test", { now: () => now });
  writer.write("a");
  const path = join(root, files(root)[0]);
  truncateSync(path, HOURLY_LOG_MAX_BYTES - 1);
  writer.close();
  writer = new HourlyLogWriter(root, "test", { now: () => now });
  t.after(() => writer.close());
  assert.equal(writer.write("b"), true);
  assert.equal(writer.write("c"), false);
  for (let i = 0; i < 10000; i++) writer.write("discarded");
  assert.equal(statSync(path).size, 100 * 1024 * 1024);
  assert.equal(files(root).length, 1);
  now += hour;
  assert.equal(writer.write("next hour\n"), true);
  assert.equal(files(root).length, 2);
});

test("cleanup preserves legacy files, other categories, user files and symlink targets", (t) => {
  const root = directory(t),
    target = join(root, "user.txt");
  for (const name of [
    "adapter-host.log",
    "embedded-runtime.log",
    "service.out.log",
    "other-20260101T00.log",
    "user.txt"
  ])
    writeFileSync(join(root, name), "keep");
  symlinkSync(target, join(root, "test-20260101T00.log"));
  const writer = new HourlyLogWriter(root, "test", { now: () => Date.UTC(2026, 9, 16, 7) });
  t.after(() => writer.close());
  assert.equal(readFileSync(target, "utf8"), "keep");
  assert.equal(readdirSync(root).length, 6);
  symlinkSync(target, join(root, "test-20261016T07.log"));
  assert.equal(writer.write("must not reach user file"), false);
  assert.equal(readFileSync(target, "utf8"), "keep");
});

test("write failures remain bounded and recover; a stale lock disables only its hour", (t) => {
  const root = directory(t),
    blocked = join(root, "blocked");
  writeFileSync(blocked, "not a directory");
  let warnings = 0,
    now = Date.UTC(2026, 9, 16, 7);
  const writer = new HourlyLogWriter(blocked, "test", {
    now: () => now,
    onError: () => warnings++
  });
  t.after(() => writer.close());
  for (let i = 0; i < 100; i++) assert.equal(writer.write("x"), false);
  assert.equal(warnings, 1);
  rmSync(blocked);
  assert.equal(writer.write("recovered"), true);
  writeFileSync(join(blocked, "test-20261016T07.log.lock"), "");
  assert.equal(writer.write("locked"), false);
  now += hour;
  assert.equal(writer.write("next"), true);
  now += 3 * hour;
  writer.cleanup();
  assert.equal(files(blocked).length, 2);
  assert.equal(writer.write("third file"), true);
  now += hour;
  assert.equal(writer.write("fourth file"), true);
  assert.equal(files(blocked).length, 3);
  assert.equal(
    readdirSync(blocked).some((name) => name.endsWith(".lock")),
    false
  );
});

test("a symlinked log directory is neither cleaned nor written", (t) => {
  const root = directory(t),
    target = directory(t),
    link = join(root, "logs");
  writeFileSync(join(target, "test-20260101T00.log"), "keep");
  symlinkSync(target, link, "dir");
  const writer = new HourlyLogWriter(link, "test");
  t.after(() => writer.close());
  assert.equal(writer.write("must not append"), false);
  assert.deepEqual(readdirSync(target), ["test-20260101T00.log"]);
  assert.equal(readFileSync(join(target, "test-20260101T00.log"), "utf8"), "keep");
});

test("concurrent processes cannot jointly exceed the same hourly file budget", async (t) => {
  const root = directory(t);
  const module = new URL("../packages/octo-runtime-adapter-sdk/dist/index.js", import.meta.url)
    .href;
  const code = `const { HourlyLogWriter } = await import(process.argv[1]); const w = new HourlyLogWriter(process.argv[2], 'test', { maxBytes: 4096 }); for(let i=0;i<2000;i++) w.write('x'.repeat(64)); w.close();`;
  await Promise.all(
    Array.from({ length: 3 }, () =>
      promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, module, root])
    )
  );
  assert.equal(files(root).length, 1);
  assert.ok(statSync(join(root, files(root)[0])).size <= 4096);
});

test("native service specs use explicit structured logging rather than implicit output capture", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const spec = resolveServiceControl({ platform, backend: {} }).spec(
      "/tmp/runtime",
      "executor-kernel"
    );
    assert.equal(spec.args.includes("--managed-logs"), false);
    assert.equal(spec.stdoutPath, undefined);
    assert.equal(spec.stderrPath, undefined);
  }
});
