import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { WorkerRpcClient } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  HOST_RPC_MAX_LINE_BYTES,
  MAX_STREAM_LIMIT_POLICY,
  invocationInput
} from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest } from "./runtime-fixture.js";

function receipt(input) {
  return {
    run_id: input.runId,
    invocation_id: input.invocationId,
    stream_id: "fixture:stream",
    agent_session_id: input.sessionId,
    session_generation: input.sessionGeneration ?? 0,
    protocol_mode: "canonical",
    protocol: "fixture.canonical"
  };
}

test("Host RPC accepts a hard-maximum HostFrame plus its envelope without failing sibling requests", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent = [];
  output.on("data", (chunk) => sent.push(JSON.parse(chunk.toString())));
  const client = new WorkerRpcClient({ input, output });
  try {
    const request = invocationInput(invokeRequest(), "canonical", "fixture");
    const frame = {
      ...receipt(request),
      seq: 1,
      kind: "canonical",
      event: {
        protocolVersion: 2,
        type: "message.delta",
        payload: { channel: "final", text: "" }
      }
    };
    const emptyBytes = Buffer.byteLength(JSON.stringify(frame));
    frame.event.payload.text = "x".repeat(MAX_STREAM_LIMIT_POLICY.hostFrameMaxBytes - emptyBytes);
    assert.equal(
      Buffer.byteLength(JSON.stringify(frame)),
      MAX_STREAM_LIMIT_POLICY.hostFrameMaxBytes
    );
    const large = client.request("fixture.large");
    const sibling = client.request("fixture.sibling");
    const line = JSON.stringify({ jsonrpc: "2.0", id: sent[0].id, result: frame });
    assert.ok(Buffer.byteLength(line) > MAX_STREAM_LIMIT_POLICY.hostFrameMaxBytes);
    input.write(line + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: sent[1].id, result: "ready" }) + "\n");
    assert.equal((await large).event.payload.text.length, frame.event.payload.text.length);
    assert.equal(await sibling, "ready");
  } finally {
    client.close();
    input.destroy();
    output.destroy();
  }
});

test("Worker RPC rejects an unterminated UTF-8 line by bytes with precise capacity evidence", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new WorkerRpcClient({ input, output });
  const text = "大".repeat(Math.floor(HOST_RPC_MAX_LINE_BYTES / 3) + 1);
  const measuredBytes = Buffer.byteLength(text);
  assert.ok(text.length < HOST_RPC_MAX_LINE_BYTES);
  assert.ok(measuredBytes > HOST_RPC_MAX_LINE_BYTES);
  try {
    const rejected = assert.rejects(client.request("fixture.too-large"), (error) => {
      assert.equal(error.code, "HOST_FRAME_TOO_LARGE");
      assert.equal(error.boundary, "host.rpc_transport");
      assert.equal(error.limitBytes, HOST_RPC_MAX_LINE_BYTES);
      assert.equal(error.measuredBytes, measuredBytes);
      return true;
    });
    input.write(Buffer.from(text));
    await rejected;
  } finally {
    client.close();
    input.destroy();
    output.destroy();
  }
});
