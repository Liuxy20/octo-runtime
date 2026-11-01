import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CodexStdinWriter } from "../../packages/octo-runtime-adapter-codex/dist/stdin-writer.js";
import { until } from "./codex-approval-fixture.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(t, { writeResult = true, limits, write } = {}) {
  const output = new EventEmitter();
  const writes = [],
    failures = [],
    errors = [],
    written = [];
  output.write =
    write ??
    ((line, callback) => {
      writes.push({ line, callback });
      return writeResult;
    });
  const writer = new CodexStdinWriter(output, (error) => failures.push(error), limits);
  t.after(() => writer.stop(new Error("test end")));
  const send = (id, options) =>
    writer.write(
      { id },
      (error) => errors.push({ id, error }),
      () => written.push(id),
      options
    );
  return { output, writes, failures, errors, written, writer, send };
}
for (const callbackFirst of [true, false])
  test(`write false waits for callback and drain, callbackFirst=${callbackFirst}`, async (t) => {
    const f = setup(t, { writeResult: false });
    f.send(1);
    f.send(2);
    await tick();
    if (callbackFirst) f.writes[0].callback();
    else f.output.emit("drain");
    await tick();
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.written, callbackFirst ? [1] : []);
    if (callbackFirst) f.output.emit("drain");
    else f.writes[0].callback();
    await tick();
    assert.equal(f.writes.length, 2);
    f.writes[1].callback();
    f.output.emit("drain");
    await tick();
    assert.deepEqual(f.written, [1, 2]);
  });
test("synchronous callback/drain cannot cause reentrant writes or lost wakeups", async (t) => {
  let depth = 0,
    count = 0;
  const f = setup(t, {
    write: (_line, callback) => {
      assert.equal(++depth, 1);
      count++;
      callback();
      f.output.emit("drain");
      depth--;
      return false;
    }
  });
  for (let i = 0; i < 256; i++) f.send(i);
  await until(() => f.written.length === 256);
  assert.equal(count, 256);
});
test("true still waits for write callback", async (t) => {
  const f = setup(t);
  f.send(1);
  f.send(2);
  await tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.written.length, 0);
  f.writes[0].callback();
  await tick();
  assert.equal(f.writes.length, 2);
});
for (const source of ["callback", "throw", "error", "close"])
  test(`write ${source} fails and settles every entry once`, async (t) => {
    const f = setup(
      t,
      source === "throw"
        ? {
            write: () => {
              throw new Error("first");
            }
          }
        : {}
    );
    f.send(1);
    f.send(2);
    await tick();
    if (source === "callback") f.writes[0].callback(new Error("first"));
    if (source === "error") f.output.emit("error", new Error("first"));
    if (source === "close") f.output.emit("close");
    await tick();
    assert.equal(f.failures.length, 1);
    assert.equal(f.errors.length, 2);
    assert.equal(f.written.length, 0);
    f.writes[0]?.callback();
    assert.equal(f.written.length, 0);
    assert.equal(f.output.listenerCount("drain"), 0);
  });
test("normal item limit counts active writes and control reserve is independent", async (t) => {
  const f = setup(t, { limits: { maxItems: 2, controlItems: 1 } });
  f.send(1);
  await tick();
  f.send(2);
  f.send(3, { control: true });
  assert.equal(f.failures.length, 0);
  f.writes[0].callback();
  await tick();
  assert.equal(JSON.parse(f.writes[1].line).id, 3);
  f.writes[1].callback();
  await tick();
  assert.equal(JSON.parse(f.writes[2].line).id, 2);
  f.send(4);
  f.send(5);
  assert.equal(f.failures[0].code, "CODEX_STDIN_QUEUE_ITEMS_EXCEEDED");
});
test("control reserve is bounded", async (t) => {
  const f = setup(t, { limits: { controlItems: 1 } });
  f.send(1, { control: true });
  f.send(2, { control: true });
  assert.equal(f.failures[0].code, "CODEX_STDIN_QUEUE_ITEMS_EXCEEDED");
});
test("UTF-8 and LF bytes: exact boundary accepted, next byte rejected", async (t) => {
  const payload = { text: "中文" };
  const exact = Buffer.byteLength(`${JSON.stringify(payload)}\n`);
  const f = setup(t, { limits: { maxBytes: exact } });
  f.writer.write(
    payload,
    () => {},
    () => {}
  );
  await tick();
  assert.equal(f.failures.length, 0);
  f.send(1);
  assert.equal(f.failures[0].code, "CODEX_STDIN_QUEUE_BYTES_EXCEEDED");
});
test("large ordinary RPC does not inherit tiny approval response limits", async (t) => {
  const f = setup(t);
  f.writer.write(
    { method: "turn/start", params: { text: "a".repeat(32 * 1024 * 1024) } },
    () => {}
  );
  await tick();
  assert.equal(f.failures.length, 0);
  assert.equal(f.writes.length, 1);
});
for (const delivery of [false, true])
  test(`bounded ${delivery ? "delivery" : "stall"} timeout settles blocked writes`, async (t) => {
    const f = setup(t, {
      limits: { stallMs: delivery ? 200 : 25, deliveryMs: delivery ? 25 : 200 }
    });
    f.send(1);
    f.send(2);
    await until(() => f.failures.length > 0);
    assert.equal(
      f.failures[0].code,
      delivery ? "CODEX_STDIN_DELIVERY_TIMEOUT" : "CODEX_STDIN_STALLED"
    );
    assert.equal(f.errors.length, 2);
  });
test("RPC cancellation removes unsent frame; terminal cancellation prevents late approvals", async (t) => {
  const f = setup(t, { writeResult: false });
  f.send(1);
  const cancel = f.send(2);
  cancel();
  await tick();
  f.writer.cancelPending(new Error("cancelled"));
  f.send(3);
  f.send(4, { control: true });
  f.writes[0].callback();
  f.output.emit("drain");
  await tick();
  assert.deepEqual(
    f.writes.map((entry) => JSON.parse(entry.line).id),
    [1, 4]
  );
  assert.deepEqual(f.written, []);
  f.writer.stop(new Error("closed"));
  f.writes[1].callback();
  assert.equal(f.errors.length, 3);
  assert.equal(f.output.listenerCount("drain"), 0);
});
test("completed callback still has a bounded wait for missing drain", async (t) => {
  const f = setup(t, { writeResult: false, limits: { stallMs: 25 } });
  f.send(1);
  await tick();
  f.writes[0].callback();
  await until(() => f.failures.length > 0);
  assert.deepEqual(f.written, [1]);
  assert.equal(f.errors.length, 0);
});
