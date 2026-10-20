import net from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const config = JSON.parse(await readFile(argument("--config"), "utf8"));
let server;
if (config.listen) {
  server = net.createServer((socket) => {
    socket.once("data", (data) => {
      const request = JSON.parse(data);
      socket.end(
        `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { pid: process.pid } })}\n`
      );
    });
  });
  await new Promise((resolve) => server.listen(argument("--endpoint"), resolve));
}
const input = createInterface({ input: process.stdin });
input.once("line", async (line) => {
  const request = JSON.parse(line);
  await writeFile(config.report, JSON.stringify({ pid: process.pid, request }));
  if (server) await new Promise((resolve) => server.close(resolve));
  process.stdout.write(
    `${JSON.stringify({ type: "component.stopped", request_id: request.request_id, complete: config.complete })}\n`,
    () => process.exit(0)
  );
});
