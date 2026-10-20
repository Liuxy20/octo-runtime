import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../apps/cli/dist/main.js";
test("CLI help and version are local and removed daemon commands cannot create a service", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oc-help-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "absent");
  for (const command of [
    [],
    ["--help"],
    ["executor-kernel", "--help"],
    ["channel-gateway", "--help"],
    ["--version"]
  ]) {
    let text = "";
    assert.equal(
      await runCli([...command, "--home", home], { output: (line) => (text += line) }),
      0
    );
    assert.ok(text.length);
  }
  for (const command of [
    ["daemon", "start"],
    ["executor-kernel", "reload"],
    ["channel-gateway", "enable"],
    ["--force"]
  ]) {
    assert.equal(await runCli([...command, "--home", home], { output() {} }), 2);
  }
  await assert.rejects(access(home));
});
