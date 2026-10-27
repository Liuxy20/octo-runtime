// 仓外安装验收：只写独占临时 prefix/home，不安装系统服务、不访问真实 Extra 业务。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const archive = process.argv[2] && resolve(process.argv[2]);
const pnpmPath = process.argv[3] ?? process.env.npm_execpath;
const pnpmCli = pnpmPath && resolve(pnpmPath);
if (!archive || !pnpmCli)
  throw new Error(
    "Usage: node scripts/verify-global-extra-installations.mjs <runtime.tgz> <pnpm.cjs>"
  );
const root = await realpath(await mkdtemp(join(tmpdir(), "octo-global-install-")));
const npmCli = join(
  dirname(process.execPath),
  process.platform === "win32"
    ? "node_modules/npm/bin/npm-cli.js"
    : "../lib/node_modules/npm/bin/npm-cli.js"
);
const runtime = "@mininglamp-oss/octo-runtime";
const env = {
  ...process.env,
  PNPM_HOME: join(root, "pnpm"),
  XDG_CONFIG_HOME: join(root, "config"),
  NPM_CONFIG_USERCONFIG: join(root, "empty-npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(root, "empty-global-npmrc"),
  COREPACK_ENABLE_PROJECT_SPEC: "0",
  PATH: [join(root, "pnpm/bin"), process.env.PATH].join(process.platform === "win32" ? ";" : ":")
};
await writeFile(env.NPM_CONFIG_USERCONFIG, "");
await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "");
function command(cli, args, options = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  });
}
async function packExtra(name, suffix) {
  const directory = join(root, suffix);
  await mkdir(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: { ".": { import: "./entry.js", require: "./never.cjs" } }
    })
  );
  await writeFile(
    join(directory, "entry.js"),
    `import {writeFileSync} from 'node:fs';
export const name=${JSON.stringify(suffix)};
export default function extra(ctx, config) { return () => {
  writeFileSync(config.marker, JSON.stringify({ name, origin: import.meta.url, cliEntry: process.argv[1] }));
  throw new Error('FIXTURE_COMPLETE');
}; }
`
  );
  await writeFile(join(directory, "never.cjs"), "throw new Error('WRONG_EXPORT_CONDITION');");
  const packed = JSON.parse(
    command(npmCli, ["pack", "--json", "--ignore-scripts"], { cwd: directory })
  );
  return join(directory, packed[0].filename);
}
async function exercise(entry, label, name, launcher) {
  const home = join(root, `${label}-home`),
    marker = join(root, `${label}-${name}.json`);
  command(entry, ["extraset", name, "--home", home], {
    input: JSON.stringify({ config: { marker } })
  });
  let output;
  try {
    const args = [name, "run", "--json", "--home", home];
    if (launcher)
      execFileSync(launcher, args, {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"]
      });
    else command(entry, args, { stdio: ["pipe", "pipe", "pipe"] });
    assert.fail("fixture must finish with a controlled initialization failure");
  } catch (error) {
    assert.equal(error.status, 1, String(error.stderr));
    output = String(error.stderr);
  }
  const loaded = JSON.parse(await readFile(marker, "utf8"));
  assert.equal(loaded.name, name);
  assert.match(output, new RegExp(`Discovered global Extra "${name}"`));
  assert.ok(loaded.origin.includes("entry.js"));
  const expectedOrigin = join(root, label.startsWith("npm") ? "npm-custom" : "pnpm-store");
  assert.ok(fileURLToPath(loaded.origin).startsWith(expectedOrigin), loaded.origin);
  // 名称和工厂都通过正式 CLI 验证，fixture 随后主动失败，避免管理器或后台进程副作用。
  console.log(`${label}: ${name} discovered, ESM imported and initializer reached`);
  return loaded.cliEntry;
}
try {
  const scoped = await packExtra(
    "@enterprise-fixture/octo-runtime-extra-loop-daemon",
    "loop-daemon"
  );
  const plain = await packExtra("octo-runtime-extra-plain", "plain");
  const prefix = join(root, "npm-custom");
  const npmInstall = (file) =>
    command(npmCli, [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      file
    ]);
  npmInstall(archive);
  npmInstall(scoped);
  npmInstall(plain);
  const npmModules = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules");
  const npmEntry = join(npmModules, runtime, "apps/cli/dist/index.js");
  await exercise(npmEntry, "npm", "loop-daemon");
  await exercise(npmEntry, "npm", "plain");
  if (process.platform !== "win32")
    await exercise(npmEntry, "npm-shim", "loop-daemon", join(prefix, "bin/octo-runtime"));

  const pnpmInstall = (file) =>
    command(pnpmCli, [
      "add",
      "--global",
      "--ignore-scripts",
      "--offline",
      "--store-dir",
      join(root, "pnpm-store"),
      file
    ]);
  pnpmInstall(archive);
  pnpmInstall(scoped);
  const global = join(env.PNPM_HOME, "global/v11");
  let pnpmEntry;
  for (const item of await readdir(global, { withFileTypes: true })) {
    if (!item.isSymbolicLink()) continue;
    const group = join(global, item.name);
    const metadata = JSON.parse(await readFile(join(group, "package.json"), "utf8"));
    if (metadata.dependencies?.[runtime])
      pnpmEntry = join(group, "node_modules", runtime, "apps/cli/dist/index.js");
  }
  assert.ok(pnpmEntry, "the actual pnpm install must have an active Runtime group");
  assert.notEqual(pnpmEntry, await realpath(pnpmEntry), "pnpm fixture must exercise symlinks");
  if (process.platform !== "win32")
    pnpmEntry = await exercise(
      pnpmEntry,
      "pnpm-shim",
      "loop-daemon",
      join(env.PNPM_HOME, "bin/octo-runtime")
    );
  const serviceModule = pathToFileURL(join(dirname(pnpmEntry), "service-control.js")).href;
  const deployedEntry = JSON.parse(
    command("--input-type=module", [
      "-e",
      `import {resolveServiceControl} from ${JSON.stringify(serviceModule)}; console.log(JSON.stringify(resolveServiceControl().spec(${JSON.stringify(join(root, "service-home"))}, 'loop-daemon').args[0]));`,
      pnpmEntry
    ])
  );
  assert.equal(
    deployedEntry,
    pnpmEntry,
    "service deployment must retain the verified global group entry"
  );
  await exercise(deployedEntry, "pnpm", "loop-daemon");
  pnpmInstall(plain);
  await exercise(pnpmEntry, "pnpm", "plain");
  // npm 与 pnpm 均已安装；PATH 上 pnpm 优先也不能改变 npm 来源。
  await exercise(npmEntry, "npm-mixed", "loop-daemon");
  const removed = command(pnpmCli, ["remove", "--global", "octo-runtime-extra-plain"]);
  assert.ok(typeof removed === "string");
  try {
    command(pnpmEntry, ["plain", "run", "--json", "--home", join(root, "pnpm-home")], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    assert.fail("removed Extra must fail");
  } catch (error) {
    assert.match(String(error.stdout), /EXTRA_MANIFEST_DECLARATION_REQUIRED/);
  }
  console.log(
    "PASS: isolated npm + pnpm v11 package installations, independent groups, mixed environments, next-invocation install/removal"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
