import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";
import { testAdapter } from "../fixtures/test-adapter.js";
import { waitFor } from "../runtime-fixture.js";

async function hosting(t, kind, adapter = testAdapter) {
  if (kind === "ipc") {
    const fixture = await kernelFixture(t, { adapters: [adapter] });
    return { execution: { kind: "ipc", endpoint: fixture.endpoint }, home: fixture.directory };
  }
  const executor = new AgentExecutor();
  executor.register(adapter);
  t.after(async () => assert.equal((await executor.shutdown()).cleanup, "complete"));
  return { execution: { kind: "direct", executor } };
}

for (const kind of ["direct", "ipc"])
  for (const channel of ["gateway", "wecom"]) {
    test(`${channel} real Extra over ${kind}: turn, progress, completion and explicit stop`, async (t) => {
      const base = `../../packages/octo-runtime-extra-channel-${channel}/dist/`;
      const module = await import(`${base}extra.js`);
      const transports = await import(`${base}transport/channel.js`);
      const Transport = transports.GatewayTransport ?? transports.WecomTransport;
      let callbacks;
      t.mock.method(Transport.prototype, "start", async function () {
        callbacks = this.callbacks;
      });
      t.mock.method(Transport.prototype, "close", async () => {});
      const invocations = [],
        aborted = [];
      const adapter = {
        ...testAdapter,
        async *invoke(request) {
          invocations.push(request);
          request.signal.addEventListener("abort", () => aborted.push(request.invocationId), {
            once: true
          });
          yield* testAdapter.invoke(request);
        }
      };
      const options = await hosting(t, kind, adapter);
      const extra = createExtraService({
        ...options,
        module,
        dependencies: {},
        config: {
          bots: [
            {
              bot_id: randomUUID(),
              adapter: { adapter_type: "test", workdir: process.cwd() },
              approval_mode: "full_access",
              ...(channel === "gateway" ? { api_url: "https://im-test.deepminer.com.cn/api" } : {})
            }
          ]
        }
      });
      t.after(() => extra.close());
      await extra.initialize();
      const replies = [];
      const send = (text) =>
        callbacks.onMessage({
          messageId: randomUUID(),
          senderId: "sender",
          conversationId: "conversation",
          conversationKind: "direct",
          text,
          buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
          reply: async (text) => {
            replies.push(text);
          }
        });
      send("hello");
      await waitFor(() => replies.length > 0);
      assert.equal(invocations.length, 1);
      assert.ok(replies.some((reply) => reply.includes("Handled:")));
      send("wait-for-cancel");
      await waitFor(() => invocations.length === 2);
      if (channel === "gateway") {
        // 渠道断线只改变连接状态；同一执行继续由 scope/Core 持有，不重新提交。
        callbacks.onDisconnect("fixture disconnected", true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(aborted.includes(invocations[1].invocationId), false);
        assert.equal(invocations.length, 2);
      }
      send("/stop");
      await waitFor(() => aborted.includes(invocations[1].invocationId));
      assert.equal((await extra.close()).complete, true);
    });
  }

for (const kind of ["direct", "ipc"]) {
  test(`WebUI real Extra over ${kind}: Adapter probe, canonical SSE and cancellation`, async (t) => {
    const module = await import("../../packages/octo-runtime-extra-webui/dist/index.js");
    const directory = await mkdtemp(join(tmpdir(), "extra-web-312-"));
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const options = await hosting(t, kind, {
      ...testAdapter,
      probe: () => ({ available: true, command: "fixture-provider" })
    });
    const extra = createExtraService({
      ...options,
      module,
      dependencies: {},
      config: {
        port,
        sessionStorePath: join(directory, "sessions.json"),
        defaultProjectPath: directory
      }
    });
    t.after(async () => {
      await extra.close();
      await rm(directory, { recursive: true, force: true });
    });
    await extra.initialize();
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(origin);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    const boot = await fetch(origin + "/api/bootstrap", { headers: { cookie } }).then((r) =>
      r.json()
    );
    const request = (path, method = "GET", body) =>
      fetch(origin + "/api" + path, {
        method,
        headers: {
          origin,
          cookie,
          "X-Webui-Token": boot.token,
          "content-type": "application/json"
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    const adapters = await request("/adapters").then((r) => r.json());
    assert.equal(adapters[0].available, true);
    const session = await request("/sessions", "POST", { projectPath: directory }).then((r) =>
      r.json()
    );
    const input = kernelInput("webui", { agentSessionId: session.id, workdir: directory });
    const response = await request("/invoke", "POST", input);
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /run.completed/);
    assert.match(output, /Handled: webui/);
    const waiting = kernelInput("wait-for-cancel", {
      agentSessionId: session.id,
      workdir: directory
    });
    const active = await request("/invoke", "POST", waiting);
    assert.equal(active.status, 200);
    const consumed = active.text();
    const stop = await request(`/invocations/${waiting.invocationId}/cancel`, "POST", {});
    assert.equal(stop.status, 200);
    assert.match(await consumed, /run.cancelled/);
    assert.equal((await extra.close()).complete, true);
  });
}
