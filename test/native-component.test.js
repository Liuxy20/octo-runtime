import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startNativeComponent } from "@mininglamp-oss/octo-runtime-host-sdk";
import { waitFor } from "./runtime-fixture.js";
test("native Go fixture preserves spaces and metacharacters as argv and confirms independent shutdown", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "native component "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, process.platform === "win32" ? "fixture.exe" : "fixture");
  execFileSync("go", ["build", "-o", executable, resolve("test/fixtures/native-component.go")], {
    env: { ...process.env, CGO_ENABLED: "0" }
  });
  const configPath = join(directory, "component config.json");
  await writeFile(configPath, "{}");
  const options = {
    executable,
    argv: ["--label", "literal value; $(literal)"],
    cwd: directory,
    configPath,
    endpoint: "fixture-endpoint",
    stop: "stdin-json",
    readiness: "process"
  };
  const component = await startNativeComponent(options);
  t.after(() => component.stop());
  let observed;
  await waitFor(async () => {
    try {
      observed = JSON.parse(await readFile(`${configPath}.observed`, "utf8"));
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(observed, {
    config: configPath,
    endpoint: "fixture-endpoint",
    label: "literal value; $(literal)",
    cwd: await import("node:fs/promises").then((fs) => fs.realpath(directory)),
    pid: component.pid
  });
  assert.equal((await component.stop()).complete, true);
  const incomplete = await startNativeComponent({ ...options, argv: ["--label", "incomplete"] });
  t.after(() => incomplete.stop());
  assert.equal((await incomplete.stop()).complete, false);
  await assert.rejects(
    startNativeComponent({ ...options, argv: ["--config=override"] }),
    /RESERVED_ARGUMENT/
  );
});
