import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startNativeComponent } from "@mininglamp-oss/octo-runtime-host-sdk";

async function fixture(t, complete, listen = false) {
  const directory = await mkdtemp(join(tmpdir(), "ons-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\octo-native-startup-${process.pid}-${directory.split(/[\\/]/).pop()}`
      : join(directory, "component.sock");
  const configPath = join(directory, "config.json");
  const report = join(directory, "report.json");
  await writeFile(configPath, JSON.stringify({ complete, report, listen }));
  return {
    report,
    options: {
      executable: process.execPath,
      argv: [resolve("test/fixtures/native-startup.mjs")],
      cwd: directory,
      configPath,
      endpoint,
      stop: "stdin-json",
      readiness: "ipc"
    }
  };
}

for (const complete of [true, false]) {
  test(`native startup rejects another endpoint owner and preserves cleanup complete=${complete}`, async (t) => {
    const { options, report } = await fixture(t, complete);
    const server = net.createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data);
        socket.end(
          `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { pid: process.pid } })}\n`
        );
      });
    });
    await new Promise((resolve) => server.listen(options.endpoint, resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await assert.rejects(startNativeComponent(options), (error) => {
      assert.equal(error.name, "ComponentStartError");
      assert.equal(error.message, "COMPONENT_IDENTITY_MISMATCH");
      assert.equal(error.cause.message, "COMPONENT_IDENTITY_MISMATCH");
      assert.equal(error.cleanup.complete, complete);
      assert.equal(error.cleanup.processExited, true);
      if (!complete) assert.ok(error.cleanup.errors.length > 0);
      return true;
    });
    const stopped = JSON.parse(await readFile(report, "utf8"));
    assert.equal(stopped.request.type, "component.stop");
    assert.notEqual(stopped.pid, process.pid);
    assert.throws(() => process.kill(stopped.pid, 0), { code: "ESRCH" });
    assert.equal(server.listening, true);
  });
}

test("native IPC readiness accepts the new process and confirms its stop", async (t) => {
  const { options, report } = await fixture(t, true, true);
  const component = await startNativeComponent(options);
  t.after(() => component.stop());
  assert.equal((await component.stop()).complete, true);
  assert.equal(JSON.parse(await readFile(report, "utf8")).pid, component.pid);
});
