import net from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";

/** A real IPC relay with deterministic request/response barriers. False drops a line. */
export async function kernelRelay(t, fixture, hooks = {}) {
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\octo-relay-${randomUUID()}`
      : join(fixture.directory, `${randomUUID()}.sock`);
  const requests = [],
    sockets = new Set();
  const server = net.createServer((downstream) => {
    const upstream = net.createConnection(fixture.endpoint);
    sockets.add(downstream);
    sockets.add(upstream);
    for (const socket of [downstream, upstream]) {
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
    }
    downstream.once("close", () => upstream.destroy());
    const connection = {
      request: undefined,
      disconnect: () => {
        downstream.destroy();
        upstream.destroy();
      }
    };
    const forward = (source, destination, hook) => {
      let pending = "",
        chain = Promise.resolve();
      source.on("data", (chunk) => {
        pending += chunk;
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const value = JSON.parse(pending.slice(0, end));
          pending = pending.slice(end + 1);
          chain = chain
            .then(async () => {
              const result = await hook(value);
              if (result !== false && !destination.destroyed)
                destination.write(`${JSON.stringify(result ?? value)}\n`);
            })
            .catch(() => connection.disconnect());
        }
      });
      return () => chain;
    };
    forward(downstream, upstream, async (request) => {
      connection.request = request;
      requests.push(request);
      return hooks.request?.(request, connection);
    });
    const responses = forward(upstream, downstream, (value) => hooks.response?.(value, connection));
    upstream.once("end", () => {
      void responses().then(() => downstream.end());
    });
  });
  await new Promise((resolve) => server.listen(endpoint, resolve));
  const client = attachKernel({ endpoint });
  t.after(async () => {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    client,
    requests,
    count: (method) => requests.filter((r) => r.method === method).length
  };
}
