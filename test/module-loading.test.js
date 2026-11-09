import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadCliAdapters } from "../apps/cli/dist/adapters.js";
import {
  mergeModuleManifests,
  parseModuleManifest,
  readModuleManifest,
  resolveAdapterModules,
  resolveModuleSpecifier
} from "../packages/octo-runtime-adapter-sdk/dist/module-manifest.js";
import { fixtureHome } from "./fixtures/service-home.js";
import { nativeHost } from "./native-host-fixture.js";

const runner = resolve("packages/octo-runtime-executor-kernel/dist/runner.js");
const adapterFixture = resolve("test/fixtures/test-adapter.js");
const declaration = (module, type = "test") => ({ type, module, export: "testAdapter" });
const manifest = (adapters = [], extras = []) => ({ version: 1, adapters, extras });

for (const mode of ["timeout", "abort"]) {
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

test("empty Adapter snapshot starts without resolving Extras; selected type mismatch fails", async (t) => {
  const home = await fixture(t);
  const empty = await nativeHost((await loadCliAdapters([])).adapters);
  t.after(() => empty.close());
  assert.deepEqual(empty.adapters, []);
  const file = join(home, "adapter.mjs");
  await copyFile(adapterFixture, file);
  const selected = resolveAdapterModules(
    parseModuleManifest(manifest([declaration(file, "wrong")]), join(home, "manifest.json"))
  );
  await assert.rejects(loadCliAdapters(selected), /does not match adapter test/);
});

test(
  "Kernel uses host-resolved startup instances and keeps service in caller PID",
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
    const kernel = createKernelService({
      home: fixtureHome,
      endpoint,
      adapters: (await loadCliAdapters(resolveAdapterModules(await readModuleManifest(file))))
        .adapters
    });
    t.after(() => kernel.close());
    await kernel.initialize();
    assert.equal((await kernel.status()).pid, process.pid);
    const first = await kernel.client.status();
    await json(file, manifest([declaration("must-not-resolve-after-recovery")]));
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
  // 此目录只有装配器，没有 openclaw.js；未选择的 Provider 不应加载。
  const entrypoint = join(directory, "adapters.mjs");
  await copyFile(resolve("apps/cli/dist/adapters.js"), entrypoint);
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
  const { loadCliAdapters: loadSelected } = await import(pathToFileURL(entrypoint).href);
  const worker = await nativeHost(
    (
      await loadSelected(
        [
          {
            module,
            export: "selected",
            factory: true,
            options: {},
            sourceManifest: join(directory, "unused.json")
          }
        ],
        { profileRoot: directory, syncOpenClawTools: false }
      )
    ).adapters
  );
  t.after(() => worker.close());
  assert.deepEqual(
    worker.adapters.map((adapter) => adapter.type),
    ["test"]
  );
  assert.equal(await readFile(calls, "utf8"), "1");
});
