import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  discoverGlobalExtras,
  installationLayout,
  mergeGlobalExtras
} from "../apps/cli/dist/global-extras.js";
import { cliEntrypoint } from "../apps/cli/dist/cli-entrypoint.js";
import { readExtra, setExtra } from "../apps/cli/dist/extras.js";
import { runtimePaths } from "../apps/cli/dist/state.js";
import { loadCliManifest } from "../apps/cli/dist/module-manifest.js";
import {
  parseModuleManifest,
  resolveAdapterModules
} from "../packages/octo-runtime-adapter-sdk/dist/module-manifest.js";

const runtimeName = "@mininglamp-oss/octo-runtime";
const empty = () => ({ version: 1, adapters: [], extras: [] });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "octo-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function json(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
async function runtime(modules) {
  const root = join(modules, runtimeName);
  await json(join(root, "package.json"), { name: runtimeName });
  const entry = join(root, "apps/cli/dist/index.js");
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, "");
  return entry;
}
async function npm(root) {
  const modules = join(root, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules");
  const entry = await runtime(modules);
  if (process.platform === "win32")
    await writeFile(
      join(root, "octo-runtime.cmd"),
      '@"%~dp0\\node_modules\\@mininglamp-oss\\octo-runtime\\apps\\cli\\dist\\index.js"'
    );
  else {
    await mkdir(join(root, "bin"));
    await symlink(entry, join(root, "bin/octo-runtime"));
  }
  return { modules, entry };
}
async function extra(
  modules,
  module,
  { name = module.split("octo-runtime-extra-")[1], body, metadata = {} } = {}
) {
  const root = join(modules, module);
  await json(join(root, "package.json"), {
    name: module,
    type: "module",
    exports: { ".": { import: "./import.js", require: "./bad.cjs" } },
    ...metadata
  });
  await writeFile(
    join(root, "import.js"),
    body ??
      `export const name=${JSON.stringify(name)}; export default () => () => {}; export const origin=${JSON.stringify(root)};`
  );
  await writeFile(join(root, "bad.cjs"), 'throw new Error("require must not execute")');
  return root;
}
const linkDir = (target, link) =>
  symlink(target, link, process.platform === "win32" ? "junction" : "dir");
async function selected(home, entry, enabled = true) {
  const paths = runtimePaths(home, "default");
  await setExtra(paths, entry.name, Readable.from([JSON.stringify({ enabled, config: {} })]));
  return readExtra(paths, entry.name, { ...empty(), extras: [entry] });
}

test("installation layouts include custom prefixes and Windows paths without consulting PATH", () => {
  for (const [platform, entry, kind, root] of [
    [
      "linux",
      "/custom/npm/lib/node_modules/@mininglamp-oss/octo-runtime/apps/cli/dist/index.js",
      "npm",
      "/custom/npm"
    ],
    [
      "win32",
      "D:\\Tools 用户\\node_modules\\@mininglamp-oss\\octo-runtime\\apps\\cli\\dist\\index.js",
      "npm",
      "D:\\Tools 用户"
    ],
    [
      "win32",
      "D:\\pnpm\\global\\v11\\active\\node_modules\\@mininglamp-oss\\octo-runtime\\apps\\cli\\dist\\index.js",
      "pnpm-isolated",
      "D:\\pnpm\\global\\v11"
    ],
    [
      "linux",
      "/custom/5/node_modules/@mininglamp-oss/octo-runtime/apps/cli/dist/index.js",
      "pnpm",
      "/custom/5"
    ],
    [
      "linux",
      "/custom/v11/active/node_modules/@mininglamp-oss/octo-runtime/apps/cli/dist/index.js",
      "pnpm-isolated",
      "/custom/v11"
    ]
  ])
    assert.deepEqual(
      {
        kind: installationLayout(entry, platform).kind,
        root: installationLayout(entry, platform).root
      },
      { kind, root }
    );
  assert.equal(installationLayout("/project/apps/cli/dist/index.js", "linux"), undefined);
  assert.equal(
    installationLayout(
      "/project/node_modules/@mininglamp-oss/octo-runtime/apps/cli/dist/index.js",
      "linux"
    ),
    undefined
  );
});

test("npm discovers only the running installation, follows scoped links and loads ESM exports lazily", async (t) => {
  const root = await fixture(t);
  const a = await npm(join(root, "npm-a"));
  const b = await npm(join(root, "npm-b"));
  await extra(b.modules, "octo-runtime-extra-unrelated");
  await extra(a.modules, "octo-runtime-extra-plain");
  const source = await extra(join(root, "external"), "@enterprise/octo-runtime-extra-loop-daemon");
  await mkdir(join(a.modules, "@enterprise"));
  await linkDir(source, join(a.modules, "@enterprise/octo-runtime-extra-loop-daemon"));
  const marker = join(root, "imported");
  await extra(a.modules, "octo-runtime-extra-unused", {
    body: `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'bad'); throw new Error('unused');`
  });
  const reports = [];
  const found = await discoverGlobalExtras((message) => reports.push(message), a.entry);
  assert.deepEqual(
    found.map((x) => x.name),
    ["loop-daemon", "plain", "unused"]
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  const registration = await selected(join(root, "home"), found[0]);
  assert.equal((await registration.load()).origin, source);
  assert.equal((await selected(join(root, "home"), found[2], false)).enabled, false);
  assert.deepEqual(resolveAdapterModules(mergeGlobalExtras(empty(), found, () => {})), []);
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("pnpm v11 discovers active isolated groups, excludes stale targets, and preserves its lexical CLI entry", async (t) => {
  const root = await fixture(t),
    global = join(root, "custom", "v11");
  const group = join(global, "runtime-target"),
    modules = join(group, "node_modules");
  const realEntry = await runtime(join(root, "shared-store", "node_modules"));
  await mkdir(join(modules, "@mininglamp-oss"), { recursive: true });
  await linkDir(
    join(root, "shared-store", "node_modules", runtimeName),
    join(modules, runtimeName)
  );
  await json(join(group, "package.json"), { dependencies: { [runtimeName]: "1.0.0" } });
  await linkDir(group, join(global, "runtime-active"));
  const lexicalEntry = join(
    global,
    "runtime-active/node_modules",
    runtimeName,
    "apps/cli/dist/index.js"
  );
  assert.equal(cliEntrypoint(lexicalEntry, realEntry), lexicalEntry);
  assert.equal(cliEntrypoint(join(root, "not-this-cli"), realEntry), realEntry);
  for (const [target, module] of [
    ["extra-target", "@any-scope/octo-runtime-extra-loop-daemon"],
    ["old-target", "octo-runtime-extra-stale"]
  ]) {
    await extra(join(global, target, "node_modules"), module);
    await json(join(global, target, "package.json"), { dependencies: { [module]: "1.0.0" } });
  }
  await linkDir(join(global, "extra-target"), join(global, "extra-active"));
  const found = await discoverGlobalExtras(() => {}, lexicalEntry);
  assert.deepEqual(
    found.map((x) => x.name),
    ["loop-daemon"]
  );
  assert.equal((await (await selected(join(root, "home"), found[0])).load()).name, "loop-daemon");
  assert.deepEqual(
    await discoverGlobalExtras(() => {}, realEntry),
    [],
    "shared store alone cannot identify an environment"
  );
  await rm(join(global, "extra-active"));
  assert.deepEqual(await discoverGlobalExtras(() => {}, lexicalEntry), []);
});

test("legacy pnpm links and invalid/missing metadata are handled without importing candidates", async (t) => {
  const root = await fixture(t),
    global = join(root, "custom", "5"),
    modules = join(global, "node_modules");
  const entry = await runtime(modules);
  await json(join(global, "package.json"), { dependencies: { [runtimeName]: "1" } });
  await writeFile(join(modules, ".modules.yaml"), "layoutVersion: 5\n");
  await extra(modules, "octo-runtime-extra-valid");
  const bad = await extra(modules, "octo-runtime-extra-broken");
  await writeFile(join(bad, "package.json"), "{");
  await extra(modules, "octo-runtime-extra-wrong", {
    metadata: { name: "not-the-installed-name" }
  });
  await extra(modules, "octo-runtime-extra-Invalid");
  await linkDir(join(root, "missing"), join(modules, "octo-runtime-extra-missing"));
  await json(join(global, "package.json"), {
    dependencies: Object.fromEntries(
      [
        runtimeName,
        "octo-runtime-extra-valid",
        "octo-runtime-extra-broken",
        "octo-runtime-extra-wrong",
        "octo-runtime-extra-Invalid",
        "octo-runtime-extra-missing"
      ].map((name) => [name, "1"])
    )
  });
  await extra(modules, "octo-runtime-extra-hoisted-transitive");
  const reports = [];
  assert.deepEqual(
    (await discoverGlobalExtras((m) => reports.push(m), entry)).map((x) => x.name),
    ["valid"]
  );
  assert.equal(reports.length, 4);
  assert.ok(reports.every((m) => m.includes("Ignoring global Extra")));
  assert.deepEqual(
    await discoverGlobalExtras((m) => reports.push(m), join(root, "missing-cli")),
    []
  );
  assert.match(reports.at(-1), /ENOENT/);
});

test("all name collisions choose deterministically before import and retain both origins in diagnostics", async (t) => {
  const root = await fixture(t),
    { modules, entry } = await npm(join(root, "npm"));
  // 创建顺序与排序相反，所有被覆盖模块一旦执行必失败。
  for (const module of [
    "octo-runtime-extra-shared",
    "@z/octo-runtime-extra-shared",
    "@a/octo-runtime-extra-shared"
  ])
    await extra(modules, module, { body: 'throw new Error("must not import")' });
  const found = await discoverGlobalExtras(() => {}, entry),
    reports = [];
  const merged = mergeGlobalExtras(empty(), found, (m) => reports.push(m));
  assert.equal(merged.extras.length, 1);
  assert.equal(merged.extras[0].module, "@a/octo-runtime-extra-shared");
  assert.match(reports[1], /selected.*@a.*ignored.*@z/);
  const home = parseModuleManifest(
    { ...empty(), extras: [{ name: "shared", module: "./explicit.js" }] },
    join(root, "manifest.json")
  );
  assert.equal(mergeGlobalExtras(home, found, (m) => reports.push(m)).extras[0], home.extras[0]);
  assert.match(reports.at(-1), /manifest.json.*ignored.*octo-runtime-extra-shared/);
});

test("selected invalid exports/name and removed packages fail; discovery remains fresh", async (t) => {
  const root = await fixture(t),
    { modules, entry } = await npm(join(root, "npm")),
    home = join(root, "home");
  const module = "octo-runtime-extra-selected";
  const directory = await extra(modules, module, { name: "wrong" });
  let found = await discoverGlobalExtras(() => {}, entry);
  await assert.rejects((await selected(home, found[0])).load(), /EXTRA_NAME_MISMATCH/);
  await rm(directory, { recursive: true });
  // 同名祖先包必须不能成为隐式回退。
  await extra(join(root, "node_modules"), module);
  await assert.rejects((await selected(home, found[0])).load(), /EXTRA_MODULE_LOAD_FAILED/);
  assert.deepEqual(await discoverGlobalExtras(() => {}, entry), []);
  await extra(modules, "octo-runtime-extra-invalid-exports", {
    metadata: { exports: { "./private": "./import.js" } }
  });
  found = await discoverGlobalExtras(() => {}, entry);
  await assert.rejects(
    (await selected(home, found[0])).load(),
    (error) =>
      error.message === "EXTRA_MODULE_LOAD_FAILED" &&
      error.cause.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
  );
});

test("unreadable optional scope does not block other candidates; explicit manifests bypass discovery", async (t) => {
  const root = await fixture(t),
    { modules, entry } = await npm(join(root, "npm"));
  await extra(modules, "octo-runtime-extra-good");
  const denied = join(modules, "@denied");
  await mkdir(denied);
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    await chmod(denied, 0);
    try {
      const reports = [];
      assert.equal((await discoverGlobalExtras((m) => reports.push(m), entry)).length, 1);
      assert.ok(reports.some((m) => m.includes("EACCES")));
    } finally {
      await chmod(denied, 0o700);
    }
  }
  const file = join(root, "explicit.json");
  await json(file, empty());
  assert.deepEqual(
    await loadCliManifest(join(root, "missing-home"), file, () =>
      assert.fail("explicit manifest must not discover")
    ),
    empty()
  );
});
