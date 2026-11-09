import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseCliCommand } from "../../apps/cli/dist/command-tree.js";
import { runCli } from "../../apps/cli/dist/main.js";

test("CLI rejects missing values even with help", async () => {
  for (const flag of ["--home", "--manifest", "--profile", "--lines", "--autostart"]) {
    for (const args of [[flag], [flag, "start"], [flag, "--help"], ["start", flag, "--help"]])
      await assert.rejects(parseCliCommand(args, {}), /INVALID_ARGUMENTS/);
  }
  assert.deepEqual((await parseCliCommand(["--home", "./start", "start"], {})).positional, [
    "start"
  ]);
});

test("Removed Extra service commands cannot run or expose help", async () => {
  for (const component of ["octo-runtime-extra", "channel-gateway", "channel-wecom", "webui"]) {
    for (const action of [
      "install",
      "uninstall",
      "start",
      "stop",
      "restart",
      "run",
      "status",
      "logs",
      "recover"
    ]) {
      for (const tail of [[], ["--help"]])
        await assert.rejects(
          parseCliCommand([component, action, ...tail], {}),
          /INVALID_ARGUMENTS/
        );
    }
  }
});

test("Service snapshots use selected profile and manifest", async (t) => {
  const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc331-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const manifest = join(home, "adapters.json");
  const inspections = [];
  const backend = {
    kind: "fixture",
    async probe() {
      return { manager: "fixture", supported: true };
    },
    async inspect(spec) {
      inspections.push(spec.args);
      return { manager: "fixture", state: "stopped", enabled: true, drift: [] };
    },
    async install(spec) {
      assert.deepEqual(spec.args.slice(-4), ["--profile", "work", "--manifest", manifest]);
    }
  };
  for (const action of ["install", "status", "doctor"]) {
    const before = inspections.length;
    const output = [];
    await runCli([action, "--home", home, "--profile", "work", "--manifest", manifest, "--json"], {
      backend,
      output: (line) => output.push(line),
      errorOutput() {}
    });
    assert.ok(output.length);
    assert.ok(!output.join("\n").includes("definition_content"));
    if (action !== "install") assert.ok(inspections.length > before);
  }
  assert.ok(inspections.length >= 4);
  for (const args of inspections)
    assert.deepEqual(args.slice(-4), ["--profile", "work", "--manifest", manifest]);
});
