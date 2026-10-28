import test from "node:test";
import assert from "node:assert/strict";
import fs, { cp, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";
import { resolveDshLaunch } from "../packages/octo-runtime-adapter-dsh/dist/launch.js";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { kernelFixture } from "./kernel-fixture.js";
import { invokeRequest } from "./runtime-fixture.js";

const fixture = fileURLToPath(new URL("./fixtures/dsh-runtime.mjs", import.meta.url));

test("DSH requires host configuration regardless of PATH", async () => {
  await assert.rejects(resolveDshLaunch({}, { PATH: process.env.PATH }), {
    code: "DSH_CONFIG_INVALID"
  });
  assert.equal((await dshAdapter.probe()).reason, "DSH_CONFIG_INVALID");
});

test("DSH rejects a symlink into Desktop instead of launching the embedded module", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const desktop = join(directory, "Fixture.app", "Contents", "lib");
  await mkdir(desktop, { recursive: true });
  await cp(fixture, join(desktop, "bin.mjs"));
  const alias = join(directory, "selected-npm");
  await symlink(desktop, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(resolveDshLaunch({ dshBin: join(alias, "bin.mjs") }, process.env), {
    code: "DSH_CONFIG_INVALID"
  });
});

test("DSH pins the validated npm target when the host link changes before launch", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-swap-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const npm = join(directory, "npm");
  const desktop = join(directory, "Fixture.app", "Contents", "lib");
  await mkdir(npm);
  await mkdir(desktop, { recursive: true });
  await cp(fixture, join(npm, "bin.mjs"));
  await writeFile(join(desktop, "bin.mjs"), 'throw new Error("Desktop must never launch");');
  const alias = join(directory, "selected");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(npm, alias, linkType);
  const physicalPath = await realpath(join(npm, "bin.mjs"));
  const originalStat = fs.stat;
  let swapped = false;
  t.mock.method(fs, "stat", async (path, ...args) => {
    const result = await originalStat(path, ...args);
    if (path === physicalPath && !swapped) {
      swapped = true;
      await unlink(alias);
      await symlink(desktop, alias, linkType);
    }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const launch = await resolveDshLaunch({ dshBin: join(alias, "bin.mjs") }, process.env);
  assert.equal(swapped, true);
  assert.equal(await realpath(join(alias, "bin.mjs")), await realpath(join(desktop, "bin.mjs")));
  assert.deepEqual(launch.args, [physicalPath]);
  assert.equal(launch.dshBin, physicalPath);
});

test("DSH launches the exact host module with spaces and Unicode, without mutating its environment", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh host 空格 "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dshBin = join(directory, "entry 空格.mjs");
  await cp(fixture, dshBin);
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "0" };
  const before = { ...env };
  const launch = await resolveDshLaunch({ dshBin }, env);
  const physicalPath = await realpath(dshBin);
  assert.equal(launch.command, process.execPath);
  assert.deepEqual(launch.args, [physicalPath]);
  assert.equal(launch.dshBin, physicalPath);
  assert.deepEqual(env, before);
  assert.notEqual(launch.env, env);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, process.versions.electron ? "1" : "0");
  await mkdir(join(directory, "directory.mjs"));
  await assert.rejects(resolveDshLaunch({ dshBin: join(directory, "directory.mjs") }, env), {
    code: "DSH_EXECUTABLE_NOT_FOUND"
  });
  await assert.rejects(resolveDshLaunch({ dshBin: join(directory, "missing.mjs") }, env), {
    code: "DSH_EXECUTABLE_NOT_FOUND"
  });
});

for (const [mode, reason] of [
  ["success", null],
  ["version", "DSH_VERSION_UNSUPPORTED"],
  ["version-exit", "DSH_START_FAILED"]
])
  test(`DSH Kernel list and invocation share host configuration: ${mode}`, async (t) => {
    const { client, directory } = await kernelFixture(t, {
      workerEntrypoint: fileURLToPath(new URL("./fixtures/dsh-worker.mjs", import.meta.url)),
      manifest: undefined,
      adapterConfigurations: { dsh: { providerOptions: { dshBin: fixture } } },
      env: { ...process.env, OCTO_DSH_FIXTURE: mode }
    });
    const discovered = (await client.list()).find((entry) => entry.type === "dsh");
    assert.equal(discovered.available, reason === null);
    assert.equal(discovered.unavailableReason, reason);
    const events = await Array.fromAsync(
      client.invoke(
        invocationInput(
          invokeRequest({ workdir: directory, approvalMode: "full_access", modelInput: "hello" }),
          "canonical",
          "dsh"
        )
      )
    );
    assert.equal(events.at(-1).type, reason === null ? "run.completed" : "run.failed");
    if (reason) assert.equal(events.at(-1).payload.failure.reasonCode, reason);
  });
