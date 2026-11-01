import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gatewayFixture, finalResult } from "../../test-support/openclaw-invalid-frames.mjs";

const cleanup = [];
const canary = randomUUID();
const f = await gatewayFixture({ after: (fn) => cleanup.push(fn) }, (_frame, reply, socket) => {
  socket.send("null");
  socket.send(JSON.stringify({ type: canary, payload: canary }));
  reply(finalResult());
});
try {
  const client = f.client({ log: undefined });
  await client.connect();
  assert.equal((await client.request("agent", {})).status, "ok");
  // canary 的值只由父进程读取 stdout 后核对，不进入 stderr 诊断。
  process.stdout.write(JSON.stringify({ ok: true, canary }));
} finally {
  for (const close of cleanup) await close();
}
