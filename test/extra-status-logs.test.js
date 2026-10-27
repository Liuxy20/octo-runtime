import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  appendFile,
  symlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { setImmediate as immediate } from "node:timers/promises";
import {
  RuntimeLogging,
  extraStatusRecord,
  kernelStatusRecord,
  HourlyLogWriter
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";
import { StatusOutput } from "../apps/cli/dist/status-output.js";
import { waitFor } from "./runtime-fixture.js";

const extra = "channel-gateway";
const status = (event = "service.ready", data = {}, time = "2026-10-22T01:00:00.000Z") =>
  extraStatusRecord(extra, "info", event, data, time);
const line = (event, data, time) => `${JSON.stringify(status(event, data, time))}\n`;
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "os-"));
  t.after(() => rm(home, { force: true, recursive: true }));
  const directory = join(home, "logs", "extras");
  await mkdir(directory, { recursive: true });
  return { home, directory };
}

test("status rotation retains the latest three files independently of ordinary logs", async (t) => {
  const { directory } = await fixture(t);
  let now = Date.parse("2026-10-22T00:00:00Z");
  const writer = new HourlyLogWriter(directory, `${extra}-status`, { now: () => now });
  t.after(() => writer.close());
  const ordinary = `${extra}-20261021T01.log`;
  await writeFile(join(directory, ordinary), "ordinary metadata");
  for (let hour = 0; hour < 5; hour++) {
    now = Date.parse(`2026-10-22T0${hour}:00:00Z`);
    assert.equal(writer.write(line("service.ready")), true);
    assert.ok((await readdir(directory)).filter((name) => name.includes("-status-")).length <= 3);
  }
  assert.deepEqual(
    (await readdir(directory)).sort(),
    [ordinary, ...[2, 3, 4].map((hour) => `${extra}-status-20261022T0${hour}.log`)].sort()
  );
  assert.equal(await readFile(join(directory, ordinary), "utf8"), "ordinary metadata");
});

test("service status has a separate immutable stdout/mirror whitelist and survives disk failure", async (t) => {
  const { home, directory } = await fixture(t);
  const output = [];
  const logging = new RuntimeLogging({
    directory: join(home, "logs"),
    statusOutput(record) {
      output.push(record);
      assert.throws(() => {
        record.data.run_id = "forged";
      });
    }
  });
  const log = logging.extra(extra);
  log("info", "agent_run.finished", { run_id: "SECRET_RUN", session_id: "SECRET_SESSION" });
  log("warn", "channel.diagnostic", { code: "IM_EXECUTION_RESULT_UNKNOWN", run_id: "SECRET_RUN" });
  log("info", "channel.retry_scheduled", {
    state: "retrying",
    delay_ms: 15000,
    attempt: 3,
    endpoint_id: "a".repeat(64),
    run_id: "SECRET_RUN",
    session_id: "SECRET_SESSION",
    token: "bf_SECRET",
    text: "SECRET_TEXT",
    code: "Bearer_SECRET"
  });
  log("info", "channel.connected", { state: "online" });
  await logging.close();
  assert.equal(output.length, 2);
  assert.deepEqual(output[0].data, {
    state: "retrying",
    endpoint_id: "a".repeat(64),
    attempt: 3,
    delay_ms: 15000
  });
  const names = (await readdir(directory)).filter((name) => name.includes("-status-"));
  assert.equal(names.length, 1);
  const mirror = await readFile(join(directory, names[0]), "utf8");
  assert.deepEqual(mirror.trim().split("\n").map(JSON.parse), output);
  assert.doesNotMatch(mirror, /SECRET|session|run_id|text|token/);
  const blocked = join(home, "blocked");
  await writeFile(blocked, "file");
  const failed = new RuntimeLogging({
    directory: blocked,
    statusOutput: (record) => output.push(record)
  });
  failed.extra(extra)("info", "service.ready");
  await failed.close();
  assert.equal(output.length, 3);
});

test("slow stdout remains bounded and reports dropped status records after drain", async () => {
  const chunks = [];
  let release;
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      release = done;
    }
  });
  const sink = new StatusOutput(stream);
  for (let i = 0; i < 10000; i++) sink.write(status("channel.retry_started", { attempt: i }));
  for (let i = 0; i < 140 && release; i++) {
    const done = release;
    release = undefined;
    done();
    await immediate();
  }
  const rows = chunks.map(JSON.parse);
  assert.ok(rows.length <= 130);
  assert.equal(rows.at(-1).event, "service.output_dropped");
  assert.equal(rows.at(-1).data.dropped_count, 9871);
  sink.close();
  assert.equal(stream.listenerCount("drain"), 0);
  stream.end();
});

test("CLI logs reads status only with broken config and no manager or Kernel", async (t) => {
  const { home, directory } = await fixture(t);
  await writeFile(join(home, "config.json"), "broken");
  await writeFile(join(directory, `${extra}-20261022T01.log`), '{"text":"SECRET_CHAT"}\n');
  await writeFile(join(directory, `${extra}-status-20261022T00.log`), line("service.initializing"));
  await writeFile(
    join(directory, `${extra}-status-20261022T01.log`),
    `${JSON.stringify({ ...status("channel.connected"), text: "SECRET_CHAT", data: { state: "online", session_id: "SECRET_SESSION" } })}\n` +
      line("channel.retry_scheduled", { delay_ms: 15000 })
  );
  const output = [],
    errors = [];
  const code = await runCli([extra, "logs", "--home", home, "--lines", "2", "--json"], {
    output: (value) => output.push(value),
    errorOutput: (value) => errors.push(value),
    backend: new Proxy(
      {},
      {
        get() {
          assert.fail("logs must not access native manager");
        }
      }
    )
  });
  assert.equal(code, 0);
  assert.equal(output.length, 2);
  assert.deepEqual(
    output.map(JSON.parse).map((row) => row.event),
    ["channel.connected", "channel.retry_scheduled"]
  );
  assert.doesNotMatch(output.join(""), /SECRET|session|text/);
  assert.deepEqual(errors, []);
  for (const args of [
    ["--lines", "0"],
    ["--lines", "10001"],
    ["--lines", "1.5"]
  ]) {
    assert.equal(
      await runCli([extra, "logs", "--home", home, ...args], { output() {}, errorOutput() {} }),
      2
    );
  }
  assert.notEqual(
    await runCli(["unknown-extra", "logs", "--home", home], { output() {}, errorOutput() {} }),
    0
  );
});

for (const component of [extra, "executor-kernel"])
  test(`${component} follow consumes partial lines and rotation once and exits cleanly on cancellation`, async (t) => {
    const { home, directory } = await fixture(t);
    const kernel = component === "executor-kernel";
    const logDirectory = kernel ? join(home, "logs") : directory;
    const prefix = kernel ? "kernel" : extra;
    const events = kernel
      ? ["worker.lost", "worker.retry_scheduled", "worker.ready"]
      : ["service.ready", "channel.retry_scheduled", "channel.connected"];
    const row = (event, data) =>
      kernel ? `${JSON.stringify(kernelStatusRecord("info", event, data))}\n` : line(event, data);
    const first = join(logDirectory, `${prefix}-status-20261022T01.log`);
    await writeFile(first, row(events[0]));
    const controller = new AbortController(),
      output = [];
    const before = process.listenerCount("SIGINT");
    const following = runCli([component, "logs", "--home", home, "--follow", "--json"], {
      output: (value) => output.push(JSON.parse(value)),
      errorOutput() {},
      logsSignal: controller.signal
    });
    t.after(() => controller.abort());
    await waitFor(() => output.length === 1);
    const next = row(events[1], { delay_ms: 15000 });
    await appendFile(first, next.slice(0, 40));
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(output.length, 1);
    await appendFile(first, next.slice(40));
    await waitFor(() => output.length === 2);
    await writeFile(join(logDirectory, `${prefix}-status-20261022T02.log`), row(events[2]));
    await waitFor(() => output.length === 3);
    controller.abort();
    assert.equal(await following, 0);
    assert.deepEqual(
      output.map((row) => row.event),
      events
    );
    assert.equal(process.listenerCount("SIGINT"), before);
  });

test("empty logs succeed; non-regular log paths and oversized records cannot expose content", async (t) => {
  const { home, directory } = await fixture(t);
  const output = [],
    errors = [];
  const deps = {
    output: (value) => output.push(value),
    errorOutput: (value) => errors.push(value)
  };
  assert.equal(await runCli([extra, "logs", "--home", home], deps), 0);
  assert.equal(output.length, 0);
  assert.equal(errors.length, 1);
  const outside = join(home, "outside");
  await writeFile(outside, "SECRET_OUTSIDE");
  await symlink(outside, join(directory, `${extra}-status-20261022T00.log`));
  await writeFile(
    join(directory, `${extra}-status-20261022T01.log`),
    "SECRET".repeat(900000) + "\n" + line("service.ready")
  );
  assert.equal(await runCli([extra, "logs", "--home", home, "--json"], deps), 0);
  assert.equal(output.length, 1);
  assert.equal(JSON.parse(output[0]).event, "service.ready");
  assert.doesNotMatch(output.join(""), /SECRET/);
});
