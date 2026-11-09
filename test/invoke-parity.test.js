import {
  withAgentEnvItems,
  invocationWorkdir
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeClient } from "../test-support/invoke-client.js";
import test from "node:test";
import assert from "node:assert/strict";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { kernelFixture } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";
import { waitFor } from "./runtime-fixture.js";
async function fixture(t, invoke) {
  const adapter = {
    metadata: {
      type: "fixture",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "fixture", modes: ["native", "canonical"], nativeMethods: [] }
    },
    invoke
  };
  const host = new AgentExecutor();
  host.register(adapter);
  t.after(() => host.shutdown());
  const kernel = await kernelFixture(t, { adapters: [adapter] });
  const relay = await kernelRelay(t, kernel);
  return { host, client: relay.client, wire: relay.requests };
}
const input = (mode = "canonical") => ({
  inputs: [{ type: "text", text: "only this turn" }],
  agentEnv: withAgentEnvItems(
    {
      schema: "octo.context-envelope/v3",
      items: [
        { namespace: "octo.execution", name: "adapter", payload: { type: "fixture" } },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ]
    },
    [{ namespace: "octo.execution", name: "workspace", payload: { path: process.cwd() } }]
  ),
  protocol_mode: mode,
  invocationId: "parity-invoke",
  runId: "parity-run",
  sessionId: "parity-session",
  sessionName: "caller-parity-session"
});
for (const mode of ["native", "canonical"])
  test(`${mode} local and RPC invocations share input and Host defaults`, async (t) => {
    const received = [];
    const invoke = async function* (request, context) {
      received.push(request);
      if (context.protocolMode === "native")
        yield { kind: "native", messageKind: "notification", payload: { exact: "native" } };
      else
        yield {
          protocolVersion: 2,
          type: "message.delta",
          payload: { channel: "final", text: "answer" }
        };
      if (context.protocolMode === "native")
        yield { kind: "control", control: { type: "state", state: "completed" } };
      else yield { protocolVersion: 2, type: "run.completed", payload: {} };
    };
    const local = await fixture(t, invoke),
      remote = await fixture(t, invoke),
      value = input(mode),
      before = structuredClone(value);
    const localEvents = [],
      remoteEvents = [];
    for await (const event of local.host.invoke(value)) localEvents.push(event);
    for await (const event of invokeClient(remote.client, value)) remoteEvents.push(event);
    const { signal: _local, ...localRequest } = received[0];
    const { signal: _remote, ...remoteRequest } = received[1];
    assert.deepEqual(remoteRequest, localRequest);
    assert.equal(remoteRequest.sessionName, value.sessionName);
    assert.equal(invocationWorkdir(remoteRequest), process.cwd());
    assert.deepEqual(value, before);
    const call = remote.wire.find((message) => message.method === "agent_run.invoke");
    assert.deepEqual(call.params.input, value);
    assert.ok(localEvents.length > 0 && remoteEvents.length > 0);
    assert.equal(
      mode === "native" ? remoteEvents.at(-1).control.state : remoteEvents.at(-1).type,
      mode === "native" ? "completed" : "run.completed"
    );
  });
test("local and RPC pre-abort never start a Provider or transmit an invocation", async (t) => {
  let calls = 0;
  const { host, client, wire } = await fixture(t, async function* () {
    calls++;
  });
  const controller = new AbortController();
  const reason = new Error("cancelled before execution");
  controller.abort(reason);
  await assert.rejects(
    host.invoke(input(), { signal: controller.signal }).next(),
    (error) => error === reason
  );
  await assert.rejects(
    invokeClient(client, input(), { signal: controller.signal }).next(),
    /INVOCATION_INTERRUPTED_BEFORE_SUBMISSION/
  );
  assert.equal(calls, 0);
  assert.deepEqual(wire, []);
});
test("local and RPC active signal cancellation reaches Provider and closes the stream", async (t) => {
  for (const route of ["host", "client"]) {
    let started = false,
      stopped = false;
    const handles = await fixture(t, async function* (request) {
      started = true;
      await new Promise((resolve) =>
        request.signal.addEventListener("abort", resolve, { once: true })
      );
      stopped = true;
      yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
    });
    const controller = new AbortController();
    const reason = new Error("cancel this invocation");
    const consume = (async () => {
      const events =
        route === "host"
          ? handles.host.invoke(input(), { signal: controller.signal })
          : invokeClient(handles.client, input(), { signal: controller.signal });
      for await (const event of events) void event;
    })();
    const rejected =
      route === "host" ? assert.rejects(consume, (error) => error === reason) : consume;
    await waitFor(() => started);
    controller.abort(reason);
    await rejected;
    await waitFor(() => stopped);
    if (route === "client")
      assert.ok(handles.wire.some((message) => message.method === "agent_run.cancel"));
  }
});
