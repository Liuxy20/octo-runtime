import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { nativeHost } from "../test/native-host-fixture.js";
import { createRetryAdapters } from "../test-support/im-retry-live-host.mjs";
import { ImTask } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/task.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { verifyBotIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/auth.js";

// im-test 认证合同实测和本地真实 Provider 故障恢复分别记录；不冒充真实 IM 收发验收。
const endpoint = "https://im-test.deepminer.com.cn";
assert.equal((await fetch(endpoint, { signal: AbortSignal.timeout(15000) })).status, 200);
await assert.rejects(
  verifyBotIdentity(
    `${endpoint}/api`,
    "bf_invalid_im_retry_verification",
    AbortSignal.timeout(15000)
  ),
  /IM_AUTH_HTTP_401/
);
let faultRequests = 0;
const server = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* 不记录 Provider 请求正文或头部。 */
  }
  faultRequests++;
  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ error: { message: "Temporary service unavailable", type: "server_error" } })
  );
});
server.on("upgrade", (_req, socket) => {
  faultRequests++;
  socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const directory = await mkdtemp(join(tmpdir(), "octo-im-retry-live-"));
let native;
const marker = `IM_RETRY_${randomUUID().slice(0, 8)}`;
const config = {
  bot_id: "live-retry-proof",
  api_url: `${endpoint}/api`,
  adapter: { adapter_type: "codex", workdir: directory },
  codex_retry: { max_consecutive_retries: 10, recovery_timeout_ms: 120000 }
};
let task;
let failure;
try {
  native = await nativeHost(createRetryAdapters(`http://127.0.0.1:${server.address().port}/v1`));
  const rpc = native.kernel.client;
  await rpc.list();
  const { request } = createImInvocation(
    config,
    {
      messageId: marker,
      senderId: "proof",
      conversationId: "local-proof",
      text: `Reply exactly ${marker}. Do not call tools, change files, or send messages.`
    },
    { schema: "octo.context-envelope/v3", items: [] },
    "local-proof",
    { id: `as_${randomUUID()}`, generation: 1 },
    AbortSignal.timeout(180000)
  );
  assert.equal(request.runtimeLimits.runTimeoutMs, 86400000);
  let firstFailure;
  const host = {
    async *invoke(input, environment) {
      for await (const event of rpc.invoke(input, environment)) {
        if (event.type === "run.failed") firstFailure ??= event.payload.message;
        yield event;
      }
    },
    cancelInvocation: (id, reason) => rpc.cancelInvocation(id, reason)
  };
  task = new ImTask(host, request, "codex", config, {}, () => {});
  let terminal,
    answer = "",
    retryNotices = 0;
  for await (const event of task.events()) {
    if (event.type === "run.notice" && event.payload.code === "retry_scheduled") retryNotices++;
    if (event.type === "message.update" && event.payload.channel === "final")
      answer = event.payload.text ?? answer;
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) terminal = event;
  }
  console.log(
    JSON.stringify({
      endpoint,
      siteStatus: 200,
      invalidBotStatus: 401,
      realCodex: true,
      injectedFaultStatus: 503,
      faultRequests,
      attempts: task.attempts,
      retryNotices,
      terminal: terminal?.type,
      stopReason: task.stopReason,
      markerSeen: answer.trim() === marker,
      imMessagesSent: false,
      ...(faultRequests ? {} : { firstFailure })
    })
  );
  assert.ok(faultRequests > 0);
  assert.equal(task.attempts.length, 2);
  assert.equal(terminal?.type, "run.completed");
  assert.equal(answer.trim(), marker);
} catch (error) {
  failure = error;
} finally {
  // 各资源分别收尾；保留原始失败与清理错误，Kernel 未确认回收时保留工作目录。
  const errors = failure ? [failure] : [];
  const cleanup = async (operation) => {
    try {
      await operation();
      return true;
    } catch (error) {
      errors.push(error);
      return false;
    }
  };
  await cleanup(() => task?.cancel("live verification cleanup"));
  const released = await cleanup(() => native?.close());
  server.closeAllConnections();
  await cleanup(
    () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  );
  if (released) await cleanup(() => rm(directory, { recursive: true, force: true }));
  if (errors.length) throw new AggregateError(errors, "IM retry verification or cleanup failed");
}
