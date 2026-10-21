import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { readReleaseBuildInfo } from "./read-release-build-info.mjs";

const execute = promisify(execFile);
export async function verifyRelease(archiveInput, { expectedCommit, requireClean = false } = {}) {
  if (expectedCommit !== undefined && !/^[a-f0-9]{40,64}$/.test(expectedCommit))
    throw new Error("Invalid expected commit");
  const archive = resolve(archiveInput);
  const root = resolve(import.meta.dirname, "..");
  const directory = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "orc-"));
  const npm = join(
    dirname(process.execPath),
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "../lib/node_modules/npm/bin/npm-cli.js"
  );
  const npmRun = (args) =>
    execute(
      process.execPath,
      [
        npm,
        ...args,
        "--global",
        "--prefix",
        directory,
        "--offline",
        "--cache",
        join(directory, "empty-cache"),
        "--no-audit",
        "--no-fund"
      ],
      { cwd: directory, timeout: 60_000 }
    );
  try {
    await npmRun(["install", archive]);
    const consumer = process.platform === "win32" ? directory : join(directory, "lib");
    const installed = join(consumer, "node_modules/@mininglamp-oss/octo-runtime");
    const metadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    assert.equal(metadata.license, "Apache-2.0");
    assert.equal(
      await readFile(join(installed, "LICENSE"), "utf8"),
      await readFile(join(root, "LICENSE"), "utf8")
    );
    assert.deepEqual(await readdir(join(installed, "apps")), ["cli"]);
    assert.deepEqual(Object.keys(metadata.bin), ["octo-runtime"]);
    assert.equal(metadata.scripts, undefined);
    for (const [name, version] of Object.entries(metadata.dependencies)) {
      assert.doesNotMatch(version, /workspace:|link:|file:/);
      assert.doesNotMatch(name, /runtime-daemon|runtime-adapter-host/);
      const dependency = JSON.parse(
        await readFile(join(installed, "node_modules", name, "package.json"), "utf8")
      );
      if (name.startsWith("@mininglamp-oss/")) {
        assert.equal(dependency.version, metadata.version);
        assert.equal(dependency.private, true);
      }
    }
    const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.deepEqual(metadata.exports, source.exports);
    for (const file of ["host", "executor-kernel", "extra"]) {
      const declaration = await readFile(join(installed, `dist/public/${file}.d.ts`), "utf8");
      assert.doesNotMatch(
        declaration,
        /startOwnedKernel|OwnedKernel|startExtra|OwnedExtra|ExtraAdapterHost/
      );
    }
    for (const [name, file] of [
      ["host-sdk", "kernel.js"],
      ["host-sdk", "extra-entry.js"],
      ["host-sdk", "extra-port.js"],
      ["executor-kernel", "entry.js"]
    ])
      await assert.rejects(
        access(join(installed, `node_modules/@mininglamp-oss/octo-runtime-${name}/dist/${file}`)),
        { code: "ENOENT" }
      );
    for (const target of Object.values(metadata.exports))
      if (typeof target === "string") await access(join(installed, target));
    const build = JSON.parse(
      await readFile(join(installed, "apps/cli/dist/build-info.json"), "utf8")
    );
    assert.deepEqual(build, readReleaseBuildInfo(archive));
    if (expectedCommit) assert.equal(build.commit, expectedCommit);
    if (requireClean) assert.equal(build.dirty, false);
    assert.equal(new Date(build.buildTime).toISOString(), build.buildTime);
    const cli = join(installed, "apps/cli/dist/index.js");
    const home = join(directory, "home");
    const run = (args) =>
      execute(process.execPath, [cli, ...args, "--home", home], { cwd: consumer, timeout: 10_000 });
    const version = `${metadata.version}\ncommit:${build.commit.slice(0, 12)}${build.dirty ? " (dirty)" : ""}\nbuild:${build.buildTime}`;
    for (const args of [["--version"], ["-v"], ["version"]])
      assert.equal((await run(args)).stdout.trim(), version);
    for (const args of [[], ["--help"], ["-h"], ["help"]])
      assert.match((await run(args)).stdout, /executor-kernel|channel-gateway/);
    await assert.rejects(
      run(["daemon"]),
      (error) => error.code === 2 && /INVALID_ARGUMENTS/.test(error.stdout)
    );
    for (const component of ["executor-kernel", "channel-gateway"])
      for (const action of ["start", "restart"])
        await assert.rejects(
          run([component, action]),
          (error) => error.code === 3 && /SERVICE_NOT_INSTALLED/.test(error.stdout)
        );
    const command = join(
      directory,
      process.platform === "win32" ? "octo-runtime.cmd" : "bin/octo-runtime"
    );
    assert.match(
      (await execute(command, ["--help"], { cwd: consumer, shell: process.platform === "win32" }))
        .stdout,
      /Octo Runtime CLI/
    );
    await assert.rejects(
      access(
        join(
          directory,
          process.platform === "win32" ? "octo-runtime-daemon.cmd" : "bin/octo-runtime-daemon"
        )
      ),
      { code: "ENOENT" }
    );
    await writeFile(join(consumer, "package.json"), '{"type":"module"}\n');
    for (const name of [
      "plugin",
      "executor",
      "worker",
      "host",
      "kernel-invoke",
      "builtin-extras",
      "gateway-store"
    ])
      await cp(join(root, `test-support/public-extra/${name}.mts`), join(consumer, `${name}.mts`));
    await execute(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "plugin.mts",
        "executor.mts",
        "worker.mts",
        "host.mts",
        "kernel-invoke.mts",
        "builtin-extras.mts",
        "gateway-store.mts",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "--strict",
        "--skipLibCheck",
        "false",
        "--types",
        "node",
        "--typeRoots",
        join(root, "node_modules/@types"),
        "--outDir",
        "compiled"
      ],
      { cwd: consumer, timeout: 30_000 }
    );
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await (await import("./compiled/executor.mjs")).verifyExecutorCore(); await import("./compiled/host.mjs");'
      ],
      { cwd: consumer, timeout: 30_000 }
    );
    const child = spawn(process.execPath, [cli, "executor-kernel", "run", "--home", home], {
      cwd: consumer,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-4096);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    const exited = new Promise((resolveExit, reject) => {
      child.once("exit", (code) => resolveExit(code));
      child.once("error", reject);
    });
    try {
      const end = Date.now() + 30_000;
      while (!stdout.includes('"state":"ready"')) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= end)
          throw new Error(`Kernel CLI failed: ${stdout} ${stderr}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      const status = JSON.parse((await run(["status"])).stdout);
      assert.equal(status["executor-kernel"].runtime.execution_ready, true);
      assert.equal(status["executor-kernel"].runtime.pid, child.pid);
      assert.equal(status["channel-gateway"].runtime.available, false);
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error("CLI shutdown timeout")), 10_000);
          timer.unref();
        })
      ]);
      if (process.platform !== "win32") assert.equal(child.exitCode, 0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32")
          await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            timeout: 5000,
            windowsHide: true
          });
        else child.kill("SIGKILL");
        await exited;
      }
    }
    await npmRun(["uninstall", metadata.name]);
    await assert.rejects(access(command), { code: "ENOENT" });
    await access(home);
    console.log(
      JSON.stringify({
        offlineInstall: true,
        publicTypes: true,
        builtinExtras: true,
        webuiAssets: true,
        nativeKernel: true,
        independentExtra: true,
        gatewayHostStore: true,
        cliKernel: true,
        uninstallPreservedHome: true,
        version: metadata.version
      })
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--live"))
    throw new Error("Live IM validation uses the dedicated verify-channel scripts");
  const index = process.argv.indexOf("--expected-commit");
  await verifyRelease(process.argv[2], {
    expectedCommit: index < 0 ? undefined : process.argv[index + 1],
    requireClean: process.argv.includes("--require-clean")
  });
}
