import { withAgentEnvItems } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
// 显式手动运行：node --experimental-test-module-mocks --test test/manual/claude-preparation-334.test.mjs
import assert from "node:assert/strict";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { contextEnvelope, invokeRequest } from "../runtime-fixture.js";
const directory = join(tmpdir(), "claude-preparation-fixture");
let writeError;
let cleanupError;
let calls;
mock.module("node:fs/promises", {
  namedExports: {
    ...filesystem,
    mkdtemp(path) {
      calls.push(["mkdtemp", path]);
      return Promise.resolve(directory);
    },
    writeFile(path, content, options) {
      calls.push(["writeFile", path, content, options]);
      return writeError ? Promise.reject(writeError) : Promise.resolve();
    },
    rm(path, options) {
      calls.push(["rm", path, options]);
      return cleanupError ? Promise.reject(cleanupError) : Promise.resolve();
    }
  }
});
const { buildClaudeCommand } =
  await import("../../packages/octo-runtime-adapter-claude-code/dist/index.js");
function request(withMcp = true) {
  return invokeRequest({
    agentEnv: withAgentEnvItems(
      contextEnvelope(
        withMcp
          ? [
              {
                namespace: "octo.execution",
                name: "mcp",
                payload: { mcpServers: { fixture: { type: "stdio", command: process.execPath } } }
              }
            ]
          : []
      ),
      [{ namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }]
    )
  });
}
function reset() {
  calls = [];
  writeError = undefined;
  cleanupError = undefined;
}
test("MCP write failure retains its original cause after successful cleanup", async () => {
  reset();
  writeError = Object.assign(new Error("fixture write failure"), { code: "EIO" });
  await assert.rejects(buildClaudeCommand(request()), (error) => error === writeError);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["mkdtemp", "writeFile", "rm"]
  );
  assert.deepEqual(calls.at(-1), ["rm", directory, { recursive: true, force: true }]);
});
test("MCP write and cleanup failures both survive, with the write failure as cause", async () => {
  reset();
  writeError = Object.assign(new Error("fixture write failure"), { code: "EIO" });
  cleanupError = Object.assign(new Error("fixture cleanup failure"), { code: "EPERM" });
  await assert.rejects(buildClaudeCommand(request()), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, writeError);
    assert.deepEqual(error.errors, [writeError, cleanupError]);
    assert.match(error.message, /preparation and cleanup failed/);
    return true;
  });
});
test("successful preparation writes only MCP settings and cleanup owns that directory", async () => {
  reset();
  const command = await buildClaudeCommand(request());
  assert.deepEqual(
    calls.map((call) => call[0]),
    ["mkdtemp", "writeFile"]
  );
  assert.equal(calls[1][1], join(directory, "mcp.json"));
  assert.deepEqual(JSON.parse(calls[1][2]), {
    mcpServers: { fixture: { type: "stdio", command: process.execPath, args: [], env: {} } }
  });
  assert.deepEqual(calls[1][3], { mode: 0o600 });
  assert.equal(command.args.includes("--append-system-prompt-file"), false);
  await command.cleanup();
  assert.deepEqual(calls.at(-1), ["rm", directory, { recursive: true, force: true }]);
});
test("a request without MCP owns no temporary directory", async () => {
  reset();
  const command = await buildClaudeCommand(request(false));
  await command.cleanup();
  assert.deepEqual(calls, []);
});
