import assert from "node:assert/strict";

/** 查询既有设备；先保留 CLI 失败事实，再校验供后续在线断言使用的状态。 */
export async function readStatelessComponentStatus(home, runCli) {
  const output = [];
  const errors = [];
  const code = await runCli(["--home", home, "status", "--json"], {
    output: (line) => output.push(line),
    errorOutput: (line) => errors.push(line)
  });
  assert.equal(
    code,
    0,
    `Runtime status failed (exit ${code})\n${[...output, ...errors].join("\n")}`
  );
  assert.ok(output.length > 0, "Runtime status produced no JSON output");
  const status = JSON.parse(output.join("\n"));
  assert.ok(
    status && typeof status === "object" && !Array.isArray(status) && !status.error,
    "Runtime status must be a component status object"
  );
  assert.ok(
    Array.isArray(status["channel-gateway"]?.runtime?.status?.bots),
    "Runtime status must include channel-gateway bot status"
  );
  return status;
}
