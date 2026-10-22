import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  parseModuleManifest,
  readModuleManifest,
  mergeModuleManifests,
  resolveAdapterModules,
  resolveModuleSpecifier
} from "../packages/octo-runtime-adapter-sdk/dist/module-manifest.js";
import { createKernelService, spawnWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { runtimePaths } from "../apps/cli/dist/state.js";
import { readExtra, getExtra, setExtra } from "../apps/cli/dist/extras.js";
import { loadCliManifest } from "../apps/cli/dist/module-manifest.js";
import { Readable } from "node:stream";
import { waitFor } from "./runtime-fixture.js";
import { spawn } from "node:child_process";
import { once } from "node:events";

const runner = resolve("packages/octo-runtime-executor-kernel/dist/runner.js");
const adapterFixture = resolve("test/fixtures/test-adapter.js");
const declaration = (module, type = "test") => ({ type, module, export: "testAdapter" });
const manifest = (adapters = [], extras = []) => ({ version: 1, adapters, extras });

for (const mode of ["timeout", "abort"]) {
  test(`blocked Adapter snapshot send respects ${mode} and reclaims the owned worker`, async (t) => {
    const controller = new AbortController();
    let child;
    let timer;
    t.after(() => {
      clearTimeout(timer);
      if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    });
    const started = Date.now();
    await assert.rejects(
      spawnWorker({
        entrypoint: resolve("test/fixtures/ipc-stalled-worker.mjs"),
        adapterModules: [
          {
            ...declaration(adapterFixture),
            factory: false,
            options: { payload: "x".repeat(8 * 1024 * 1024) },
            sourceManifest: resolve("unused-manifest.json")
          }
        ],
        readyTimeoutMs: mode === "timeout" ? 100 : 5000,
        signal: controller.signal,
        onSpawn: async (value) => {
          child = value;
          if (mode === "abort") timer = setTimeout(() => controller.abort(), 100);
        }
      }),
      mode === "timeout" ? /readiness timed out/ : /spawn cancelled/
    );
    assert.ok(child?.pid, "worker ownership must be registered before sending the snapshot");
    assert.ok(Date.now() - started < 3000, "startup must not wait for the stalled worker");
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  });
}

async function fixture(t) {
  const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oml-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function json(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}
async function packageAt(directory, name, tag) {
  const path = join(directory, "node_modules", name);
  await mkdir(path, { recursive: true });
  await json(join(path, "package.json"), {
    name,
    type: "module",
    exports: {
      ".": { import: "./import.mjs", require: "./require.cjs" },
      "./adapter": "./import.mjs"
    }
  });
  await writeFile(join(path, "import.mjs"), `export const origin = ${JSON.stringify(tag)};\n`);
  await writeFile(join(path, "require.cjs"), 'throw new Error("require branch must not load");');
  return path;
}

test("two manifest origins retain ESM anchors, scoped subpaths and import conditions", async (t) => {
  const root = await fixture(t);
  const cli = join(root, "cli"),
    home = join(root, "home");
  await packageAt(cli, "@fixture/provider", "builtin");
  await packageAt(home, "@fixture/provider", "user");
  const a = parseModuleManifest(
    manifest([declaration("@fixture/provider", "builtin")]),
    join(cli, "manifest.json")
  );
  const b = parseModuleManifest(
    manifest([declaration("@fixture/provider/adapter", "user")]),
    join(home, "manifest.json")
  );
  const modules = resolveAdapterModules(mergeModuleManifests(a, b));
  assert.equal((await import(modules[0].module)).origin, "builtin");
  assert.equal((await import(modules[1].module)).origin, "user");
  await assert.rejects(
    async () => resolveModuleSpecifier("@fixture/provider/private", join(home, "manifest.json")),
    { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }
  );
  assert.throws(() => resolveModuleSpecifier("missing-package", join(home, "manifest.json")), {
    code: "ERR_MODULE_NOT_FOUND"
  });
  // 不从此测试所在仓库或 runner 的依赖目录回退。
  assert.throws(
    () =>
      resolveModuleSpecifier(
        "@mininglamp-oss/octo-runtime-adapter-codex",
        join(home, "manifest.json")
      ),
    { code: "ERR_MODULE_NOT_FOUND" }
  );
});

test("merge ignores collisions before resolution and keeps Adapter/Extra keys separate", async (t) => {
  const root = await fixture(t),
    diagnostics = [];
  const a = parseModuleManifest(
    manifest([declaration("./valid.mjs")], [{ name: "test", module: "./extra.mjs" }]),
    join(root, "builtin.json")
  );
  const b = parseModuleManifest(
    manifest(
      [declaration("missing-ignored-adapter")],
      [
        { name: "test", module: "missing-ignored-extra" },
        { name: "other", module: "not-started-extra" }
      ]
    ),
    join(root, "home.json")
  );
  const result = mergeModuleManifests(a, b, (message) => diagnostics.push(message));
  assert.equal(result.adapters.length, 1);
  assert.equal(result.extras.length, 2);
  assert.equal(diagnostics.length, 2);
  assert.equal(
    resolveAdapterModules(result)[0].module,
    pathToFileURL(join(root, "valid.mjs")).href
  );
  for (const value of [
    manifest([declaration("a"), declaration("b")]),
    manifest(
      [],
      [
        { name: "same", module: "a" },
        { name: "same", module: "b" }
      ]
    ),
    { version: 1, adapters: [] },
    manifest([{ module: "a" }]),
    manifest([], [{ name: "../escape", module: "a" }]),
    { ...manifest(), version: 2 }
  ])
    assert.throws(() => parseModuleManifest(value, join(root, "bad.json")));
});

test("Home extension is optional, strict, follows selected Home and override fully replaces defaults", async (t) => {
  const home = await fixture(t);
  const builtin = await loadCliManifest(home);
  assert.equal(builtin.adapters.length, 13);
  assert.deepEqual(
    builtin.extras.map((x) => x.name),
    ["channel-gateway", "channel-wecom", "webui"]
  );
  await json(join(home, "manifest.json"), manifest([declaration("./user.mjs", "user")]));
  assert.equal((await loadCliManifest(home)).adapters.length, 14);
  const override = join(home, "explicit.json");
  await json(override, { version: 1, adapters: [] });
  assert.deepEqual(await loadCliManifest(home, override), manifest());
  await writeFile(join(home, "manifest.json"), "{");
  await assert.rejects(loadCliManifest(home), /Invalid manifest/);
  await assert.rejects(readModuleManifest(join(home, "absent.json")), { code: "ENOENT" });
});

test("Extra modules resolve lazily from manifest; new and legacy configurations have explicit migration", async (t) => {
  const home = await fixture(t),
    paths = runtimePaths(home, "default");
  const file = join(home, "manifest.json");
  const declarations = parseModuleManifest(
    manifest(
      [],
      [
        { name: "example", module: "./plugins/example.mjs" },
        { name: "disabled", module: "missing-disabled-package" }
      ]
    ),
    file
  );
  await mkdir(join(home, "plugins"));
  await writeFile(
    join(home, "plugins/example.mjs"),
    'export const name="example"; export default () => () => {};'
  );
  const save = (name, value) => setExtra(paths, name, Readable.from([JSON.stringify(value)]));
  await save("example", { config: { business: true } });
  const registration = await readExtra(paths, "example", declarations);
  assert.deepEqual(registration.config, { business: true });
  assert.equal((await registration.load()).name, "example");
  await save("disabled", { enabled: false, config: {} });
  assert.equal((await readExtra(paths, "disabled", declarations)).enabled, false);
  const old = { module: "old-package", config: {} };
  await save("example", old);
  await assert.rejects(
    readExtra(paths, "example", declarations),
    /EXTRA_MODULE_MIGRATION_REQUIRED/
  );
  assert.deepEqual(await getExtra(paths, "example"), old);
  await assert.rejects(
    readExtra(paths, "example", manifest()),
    /EXTRA_MANIFEST_DECLARATION_REQUIRED/
  );
  await save("example", { module: "matching-package", config: {} });
  const matching = parseModuleManifest(
    manifest([], [{ name: "example", module: "matching-package" }]),
    file
  );
  assert.equal((await readExtra(paths, "example", matching)).module, "matching-package");
});

test("empty Adapter snapshot starts without resolving Extras; selected type mismatch fails", async (t) => {
  const home = await fixture(t);
  const empty = await spawnWorker({ entrypoint: runner, adapterModules: [] });
  t.after(() => empty.close());
  assert.deepEqual(empty.adapters, []);
  const file = join(home, "adapter.mjs");
  await copyFile(adapterFixture, file);
  const selected = resolveAdapterModules(
    parseModuleManifest(manifest([declaration(file, "wrong")]), join(home, "manifest.json"))
  );
  await assert.rejects(
    spawnWorker({ entrypoint: runner, adapterModules: selected }),
    /does not match adapter test/
  );
});

test(
  "Kernel worker recovery reuses resolved startup snapshot and keeps service in caller PID",
  { timeout: 15000 },
  async (t) => {
    const home = await fixture(t),
      file = join(home, "manifest.json");
    await copyFile(adapterFixture, join(home, "adapter.mjs"));
    await json(file, manifest([declaration("./adapter.mjs")]));
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\octo-snapshot-${Date.now()}`
        : join(home, "k.sock");
    const kernel = createKernelService({ endpoint, workerEntrypoint: runner, manifest: file });
    t.after(() => kernel.close());
    await kernel.initialize();
    assert.equal((await kernel.status()).pid, process.pid);
    const first = await kernel.client.status();
    await json(file, manifest([declaration("must-not-resolve-after-recovery")]));
    process.kill(first.worker.pid, "SIGKILL");
    await waitFor(async () => {
      const current = await kernel.client.status();
      return current.worker.generation > first.worker.generation && current.execution_ready;
    });
    assert.deepEqual(
      (await kernel.client.list()).map((x) => x.type),
      ["test"]
    );
    assert.equal((await kernel.close()).complete, true);
  }
);

test("Core/Kernel/Host SDK production closures contain no concrete Adapter or Extra", async () => {
  const seen = new Set();
  async function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    assert.ok(!name.includes("octo-runtime-extra-"), name);
    assert.ok(!name.includes("octo-runtime-adapter-") || name.endsWith("-sdk"), name);
    if (!name.startsWith("@mininglamp-oss/")) return;
    const pkg = JSON.parse(
      await readFile(join("packages", name.split("/")[1], "package.json"), "utf8")
    );
    for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency);
  }
  for (const name of ["executor-core", "executor-kernel", "host-sdk"])
    await visit("@mininglamp-oss/octo-runtime-" + name);
});

test("CLI untyped selection loads its factory once without importing an unselected Provider helper", async (t) => {
  const directory = await mkdtemp(join(resolve("apps/cli/dist"), "selected-worker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // 此目录只有 worker，没有 openclaw.js；误判 untyped 项为 OpenClaw 会因导入缺失而失败。
  const entrypoint = join(directory, "worker.mjs");
  await copyFile(resolve("apps/cli/dist/worker.js"), entrypoint);
  const module = join(directory, "selected.mjs");
  const calls = join(directory, "calls");
  await writeFile(
    module,
    `import { appendFileSync } from "node:fs";
import { testAdapter } from ${JSON.stringify(pathToFileURL(adapterFixture).href)};
export function selected() {
  appendFileSync(${JSON.stringify(calls)}, "1");
  return testAdapter;
}`
  );
  const worker = await spawnWorker({
    entrypoint,
    adapterModules: [
      {
        module,
        export: "selected",
        factory: true,
        options: {},
        sourceManifest: join(directory, "unused.json")
      }
    ],
    env: { ...process.env, OCTO_RUNTIME_CLI_PROFILE_ROOT: directory }
  });
  t.after(() => worker.close());
  assert.deepEqual(
    worker.adapters.map((adapter) => adapter.type),
    ["test"]
  );
  assert.equal(await readFile(calls, "utf8"), "1");
});

test(
  "CLI Kernel and disabled Extra start independently while unused Extra modules are absent",
  { timeout: 15000 },
  async (t) => {
    const home = await fixture(t),
      file = join(home, "selected.json");
    await json(
      file,
      manifest(
        [],
        [
          { name: "disabled", module: "missing-disabled-package" },
          { name: "unstarted", module: "missing-unstarted-package" }
        ]
      )
    );
    await setExtra(
      runtimePaths(home, "default"),
      "disabled",
      Readable.from([JSON.stringify({ enabled: false, config: {} })])
    );
    for (const component of ["executor-kernel", "disabled"]) {
      const child = spawn(
        process.execPath,
        [
          resolve("apps/cli/dist/index.js"),
          component,
          "run",
          "--json",
          "--home",
          home,
          "--manifest",
          file
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      const exited = once(child, "exit");
      let output = "",
        errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      try {
        await waitFor(() => {
          if (child.exitCode !== null) throw new Error(output + errors);
          return output.includes('"state": "ready"');
        });
        child.kill("SIGTERM");
        assert.equal((await exited)[0], 0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      }
    }
  }
);
