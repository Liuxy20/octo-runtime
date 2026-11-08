import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { runCli } from "../apps/cli/dist/main.js";
import { componentEndpoint } from "../packages/octo-runtime-host-sdk/dist/index.js";
import { readStatelessComponentStatus } from "../test-support/stateless-live-probes.mjs";

const status = {
  "executor-kernel": { runtime: { execution_ready: true } }
};

test("stateless status requests JSON and buffers the complete response before parsing", async () => {
  const home = join(tmpdir(), "stateless status");
  const actual = await readStatelessComponentStatus(home, async (args, io) => {
    assert.deepEqual(args, ["--home", home, "status", "--json"]);
    for (const line of JSON.stringify(status, null, 2).split("\n")) io.output(line);
    io.errorOutput("nonfatal status diagnostic");
    return 0;
  });
  assert.deepEqual(actual, status);
});

test("stateless status stops on CLI failure and retains stdout, stderr and exit code", async () => {
  let continued = false;
  await assert.rejects(
    async () => {
      await readStatelessComponentStatus("unused", async (_args, io) => {
        io.output("not JSON: original stdout");
        io.errorOutput("original stderr: MANAGER_UNAVAILABLE");
        return 3;
      });
      continued = true;
    },
    (error) => {
      assert.match(error.message, /Runtime status failed \(exit 3\)/);
      assert.match(error.message, /not JSON: original stdout/);
      assert.match(error.message, /original stderr: MANAGER_UNAVAILABLE/);
      return true;
    }
  );
  assert.equal(continued, false);
  const failure = new Error("native CLI failure");
  await assert.rejects(
    readStatelessComponentStatus("unused", async () => {
      throw failure;
    }),
    (error) => error === failure
  );
});

test("stateless status rejects missing, malformed and unusable successful responses", async (t) => {
  for (const [name, output, expected] of [
    ["no output", undefined, /no JSON output/],
    ["empty output", "", SyntaxError],
    ["human text", "executor-kernel: running", SyntaxError],
    ["null", "null", /component status object/],
    ["array", "[]", /component status object/],
    ["scalar", "42", /component status object/],
    ["error response", '{"error":{"code":"CLI_FAILED"}}', /component status object/],
    ["empty object", "{}", /execution readiness/],
    ["missing readiness", '{"executor-kernel":{"runtime":{}}}', /execution readiness/],
    [
      "invalid readiness",
      '{"executor-kernel":{"runtime":{"execution_ready":{}}}}',
      /execution readiness/
    ]
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        readStatelessComponentStatus("unused", async (_args, io) => {
          if (output !== undefined) io.output(output);
          return 0;
        }),
        expected
      );
    });
  }
});

test("stateless status preserves an unready Kernel for the readiness assertion", async () => {
  for (const execution_ready of [false]) {
    const actual = await readStatelessComponentStatus("unused", async (_args, io) => {
      io.output(JSON.stringify({ "executor-kernel": { runtime: { execution_ready } } }));
      return 0;
    });
    assert.equal(actual["executor-kernel"].runtime.execution_ready, false);
  }
});

test("stateless status consumes actual runCli JSON through controlled native and IPC backends", async (t) => {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc160-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "sockets"));
  const server = net.createServer((socket) => {
    socket.once("data", (bytes) => {
      const request = JSON.parse(bytes.toString());
      assert.equal(request.method, "status");
      socket.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            ipc_version: 2,
            kernel_instance_id: "stateless-probe",
            pid: process.pid,
            execution_ready: true
          }
        }) + "\n"
      );
    });
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(componentEndpoint(home), resolve);
  });
  const backend = {
    kind: "fixture",
    inspect: async () => ({ state: "running", enabled: false, drift: [] })
  };
  const actual = await readStatelessComponentStatus(home, (args, io) =>
    runCli(args, { ...io, backend })
  );
  assert.equal(actual["executor-kernel"].runtime.execution_ready, true);
  assert.equal(actual["executor-kernel"].service.state, "running");

  // 真实 CLI 的 --json 失败也走 stdout；返回码必须阻止把 error 对象当作状态。
  await writeFile(join(home, "config.json"), "{", { mode: 0o600 });
  let originalOutput;
  const failingCli = (args, io) =>
    runCli(args, {
      ...io,
      backend,
      output: (line) => {
        originalOutput = line;
        io.output(line);
      }
    });
  await assert.rejects(readStatelessComponentStatus(home, failingCli), (error) => {
    assert.match(error.message, /Runtime status failed \(exit [1-9]/);
    assert.ok(error.message.includes(originalOutput));
    assert.ok(JSON.parse(originalOutput).error.code);
    return true;
  });
});
