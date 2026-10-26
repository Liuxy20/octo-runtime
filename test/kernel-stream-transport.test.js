import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Duplex } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { HOST_RPC_MAX_LINE_BYTES } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture, kernelInput } from "./kernel-fixture.js";
import { kernelRelay } from "./kernel-relay.js";

async function peer(t, respond) {
  const directory = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "ks-"));
  const endpoint =
    process.platform === "win32" ? componentEndpoint(directory) : join(directory, "s");
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setEncoding("utf8");
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk;
      if (input.includes("\n")) {
        socket.removeAllListeners("data");
        void respond(JSON.parse(input), socket);
      }
    });
  });
  let client, cleanup;
  const close = () =>
    (cleanup ??= (async () => {
      client?.close();
      const closed = [...sockets].map(
        (socket) => new Promise((resolve) => socket.once("close", resolve))
      );
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      await Promise.all(closed);
      await rm(directory, { recursive: true, force: true });
    })());
  t.after(close);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Transport peer initialization cleanup failed",
        {
          cause: error
        }
      );
    }
    throw error;
  }
  client = attachKernel({ endpoint });
  return client;
}

const collect = async (source) => {
  const values = [];
  for await (const value of source) values.push(value);
  return values;
};

for (const transport of ["direct", "relay"])
  test(`Kernel ${transport} retains large UTF-8 output, one terminal and a concurrent sibling`, async (t) => {
    const fixture = await kernelFixture(t);
    const client = transport === "relay" ? (await kernelRelay(t, fixture)).client : fixture.client;
    const text = "大".repeat(476_921) + "xy";
    assert.equal(Buffer.byteLength(text), 1_430_765);
    const [large, sibling] = await Promise.all([
      collect(client.invoke(kernelInput(text))),
      collect(client.invoke(kernelInput("sibling")))
    ]);
    assert.ok(
      large.find((event) => event.type === "message.update").payload.text === `Handled: ${text}`,
      "large UTF-8 output must match the complete source text"
    );
    assert.equal(large.filter((event) => event.type === "run.completed").length, 1);
    assert.equal(
      sibling.find((event) => event.type === "message.update").payload.text,
      "Handled: sibling"
    );
    assert.equal(sibling.filter((event) => event.type === "run.completed").length, 1);
  });

test("Kernel client decodes a UTF-8 character split across native IPC writes", async (t) => {
  const text = "大".repeat(476_921) + "xy";
  const client = await peer(t, async ({ id }, socket) => {
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result: { text } }) + "\n");
    const offset = bytes.indexOf(Buffer.from("大")) + 1;
    socket.write(bytes.subarray(0, offset));
    await tick();
    socket.end(bytes.subarray(offset));
  });
  // 合成响应仅验证接收解码；业务协议与终态由上面的真实 Kernel/worker 测试验证。
  assert.equal((await client.status()).text, text);
});

test("Kernel client rejects unterminated UTF-8 by bytes and keeps the next connection usable", async (t) => {
  const text = "大".repeat(Math.floor(HOST_RPC_MAX_LINE_BYTES / 3) + 1);
  assert.ok(text.length < HOST_RPC_MAX_LINE_BYTES);
  assert.ok(Buffer.byteLength(text) > HOST_RPC_MAX_LINE_BYTES);
  const client = await peer(t, ({ id }, socket) => {
    socket.end(JSON.stringify({ jsonrpc: "2.0", id, result: { execution_ready: true } }) + "\n");
  });
  // 容量判断使用受控分块，避免把约 40 MiB 的 OS 分片/拷贝耗时计入查询预算。
  // 下一次查询恢复真实 IPC；大文本与 UTF-8 拆包仍由上面的原生传输测试验证。
  const bytes = Buffer.from(text);
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      this.push(bytes.subarray(0, bytes.length - 3));
      setImmediate(() => {
        if (!this.destroyed) this.push(bytes.subarray(bytes.length - 3));
      });
      callback();
    }
  });
  t.after(() => socket.destroy());
  const connection = t.mock.method(net, "createConnection", () => {
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  await assert.rejects(client.status(), (error) => error.code === "HOST_FRAME_TOO_LARGE");
  assert.equal(socket.destroyed, true);
  connection.mock.restore();
  assert.equal((await client.status()).execution_ready, true);
});
