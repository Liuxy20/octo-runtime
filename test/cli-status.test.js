import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { runCli } from "../apps/cli/dist/main.js";
import { waitFor } from "./runtime-fixture.js";

test("Extra configuration belongs to Home even when the default profile changes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "extra-device-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const legacyDirectory = join(home, "default", "extra", "example");
  await mkdir(legacyDirectory, { recursive: true });
  const legacyFile = join(legacyDirectory, "config.json");
  const legacy = JSON.stringify({ module: "legacy-extra", config: { legacy: true } });
  await writeFile(legacyFile, legacy, { mode: 0o600 });
  const warnings = [];
  const errorOutput = (value) => warnings.push(value);
  assert.equal(
    await runCli(["--home", home, "extraget", "example"], { output() {}, errorOutput }),
    1
  );
  assert.deepEqual(warnings, []);
  const stored = { module: "device-extra", config: { shared: true } };
  await runCli(["--home", home, "extraset", "example"], {
    input: Readable.from([JSON.stringify(stored)]),
    output() {},
    errorOutput
  });
  for (const profile of ["personal", "team"]) {
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({ schema_version: 1, default_profile: profile, channel: "stable" })
    );
    let result;
    await runCli(["--home", home, "extraget", "example"], {
      output: (value) => {
        result = JSON.parse(value);
      },
      errorOutput() {}
    });
    assert.deepEqual(result, stored);
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(home, "extras", "example", "config.json"), "utf8")),
    stored
  );
  assert.equal(await readFile(legacyFile, "utf8"), legacy);
  for (const command of ["extraset", "extraget"]) {
    assert.equal(
      await runCli(["--home", home, "--profile", "team", command, "example"], { output() {} }),
      2
    );
  }
  assert.notEqual(
    await runCli(["--home", home, "--profile", "extras", "adapter", "list"], { output() {} }),
    0
  );
});

test("extraget round trips the entire stored declaration without importing its module", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "extra-get-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const enabled of [undefined, false, true]) {
    const original = {
      module: "not-installed-example",
      ...(enabled === undefined ? {} : { enabled }),
      config: { nested: [true, null, { value: "fixture-secret" }] }
    };
    await runCli(["--home", home, "extraset", "example"], {
      input: Readable.from([JSON.stringify(original)]),
      output() {}
    });
    const output = [];
    const diagnostics = [];
    await runCli(["--home", home, "extraget", "example"], {
      output: (value) => output.push(value),
      errorOutput: (value) => diagnostics.push(value)
    });
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]), original);
    assert.deepEqual(diagnostics, [`Config file: ${join(home, "extras/example/config.json")}`]);
  }
  assert.equal(await runCli(["--home", home, "extraget", "missing"], { output() {} }), 1);
  assert.notEqual(await runCli(["--home", home, "extraget", ".."], { output() {} }), 0);
  if (process.platform !== "win32") {
    await chmod(join(home, "extras/example/config.json"), 0o644);
    assert.equal(await runCli(["--home", home, "extraget", "example"], { output() {} }), 2);
  }
});
