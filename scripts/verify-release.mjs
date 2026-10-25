import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readReleaseBuildInfo } from "./read-release-build-info.mjs";
import {
  runReleaseCommand as execute,
  stopReleaseProcess,
  withReleaseDirectory
} from "./release-process.mjs";

export async function verifyRelease(archiveInput, { expectedCommit, requireClean = false } = {}) {
  if (expectedCommit !== undefined && !/^[a-f0-9]{40,64}$/.test(expectedCommit))
    throw new Error("Invalid expected commit");
  const archive = resolve(archiveInput);
  // Windows 外层验收须覆盖 40 秒身份查询、后续 15 秒就绪与资源关闭，不能提前杀掉 owner。
  const runtimeCheckTimeout = process.platform === "win32" ? 60_000 : 30_000;
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
        "--engine-strict",
        "--cache",
        join(directory, "empty-cache"),
        "--no-audit",
        "--no-fund"
      ],
      { cwd: directory, timeout: 60_000, label: `Offline npm ${args[0]}` }
    );
  await withReleaseDirectory(directory, async () => {
    await npmRun(["install", archive]);
    const consumer = process.platform === "win32" ? directory : join(directory, "lib");
    const installed = join(consumer, "node_modules/@mininglamp-oss/octo-runtime");
    const metadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    assert.equal(
      await readFile(join(installed, "README.md"), "utf8"),
      await readFile(join(root, "README.md"), "utf8"),
      "The package must reuse the root README"
    );
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
        if (dependency.engines?.node !== undefined)
          assert.equal(dependency.engines.node, metadata.engines.node, name);
      }
    }
    const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.deepEqual(metadata.exports, source.exports);
    assert.deepEqual(metadata.engines, { node: source.engines.node });
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
    const moduleManifest = JSON.parse(
      await readFile(join(installed, "apps/cli/dist/manifest.json"), "utf8")
    );
    assert.equal(moduleManifest.adapters.length, 13);
    const grokEntry = moduleManifest.adapters.find((entry) => entry.type === "grok-build");
    assert.equal(grokEntry?.module, "@mininglamp-oss/octo-runtime-adapter-grok-build");
    const grokModule = await import(
      pathToFileURL(join(installed, "node_modules", grokEntry.module, "dist/index.js")).href
    );
    assert.equal(grokModule[grokEntry.export].metadata.type, "grok-build");
    assert.deepEqual(grokModule[grokEntry.export].metadata.protocolSupport.modes, ["canonical"]);
    assert.deepEqual(
      moduleManifest.extras.map((entry) => entry.name),
      ["channel-gateway", "channel-wecom", "webui"]
    );
    await assert.rejects(access(join(installed, "apps/cli/dist/default_adapters.json")), {
      code: "ENOENT"
    });
    const home = join(directory, "home");
    const run = (args) =>
      execute(process.execPath, [cli, ...args, "--home", home], {
        cwd: consumer,
        // Windows service inspection can issue two sequential 30-second native queries.
        timeout: process.platform === "win32" ? 75_000 : 10_000,
        label: `CLI ${args.join(" ") || "help"}`
      });
    const version = `${metadata.version}\ncommit:${build.commit.slice(0, 12)}${build.dirty ? " (dirty)" : ""}\nbuild:${build.buildTime}`;
    for (const args of [["--version"], ["-v"], ["version"]])
      assert.equal((await run(args)).stdout.trim(), version);
    for (const args of [[], ["--help"], ["-h"], ["help"]])
      assert.match((await run(args)).stdout, /executor-kernel|channel-gateway/);
    await assert.rejects(
      run(["daemon"]),
      (error) => error.code === 2 && /INVALID_ARGUMENTS/.test(error.stderr)
    );
    for (const component of ["executor-kernel", "channel-gateway"]) {
      assert.match((await run([component])).stdout, /Usage:.*<command>/);
      await assert.rejects(
        run([component, "restart", "--json"]),
        (error) =>
          error.code === 3 && JSON.parse(error.stdout).error.code === "SERVICE_NOT_INSTALLED"
      );
    }
    assert.match((await run(["status"])).stdout, /executor-kernel\s+service:/);
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
    await cp(join(root, "docs/examples"), join(consumer, "docs-examples"), { recursive: true });
    await execute(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        "docs-examples/tsconfig.json",
        "--typeRoots",
        join(root, "node_modules/@types")
      ],
      { cwd: consumer, timeout: 30_000, label: "Compile documentation examples" }
    );
    await cp(join(root, "test/fixtures/invoke-adapter.js"), join(consumer, "docs-adapter.mjs"));
    await writeFile(
      join(consumer, "docs-worker.mjs"),
      'import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";\n' +
        'import { testAdapter } from "./docs-adapter.mjs";\nserveWorker([testAdapter]);\n'
    );
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { resolve } from "node:path";
      import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
      import { runOwnedInvocation } from "./docs-examples/service.mts";
      let completed = false;
      await runOwnedInvocation({
        endpoint: componentEndpoint(resolve("docs-home")),
        workerEntrypoint: resolve("docs-worker.mjs")
      }, {
        inputs: [{type: "text", text: "documentation package example"}],
        contexts: {schema: "octo.context-envelope/v3", items: [
          {namespace: "octo.execution", name: "adapter", payload: {type: "test"}}
        ]}
      }, event => { if (event.type === "run.completed") completed = true; });
      assert.equal(completed, true);
    `
      ],
      { cwd: consumer, timeout: runtimeCheckTimeout, label: "Run documentation service example" }
    );
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
    for (const name of ["recovery-kernel-probe", "recovery-native-host"])
      await cp(join(root, `test-support/${name}.mts`), join(consumer, `${name}.mts`));
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
        "recovery-kernel-probe.mts",
        "recovery-native-host.mts",
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
      { cwd: consumer, timeout: 30_000, label: "Compile public SDK fixtures" }
    );
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await (await import("./compiled/executor.mjs")).verifyExecutorCore(); await import("./compiled/host.mjs");'
      ],
      { cwd: consumer, timeout: runtimeCheckTimeout, label: "Run public SDK component integration" }
    );
    const child = spawn(
      process.execPath,
      [cli, "executor-kernel", "run", "--json", "--home", home],
      {
        cwd: consumer,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32"
      }
    );
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
      const end = Date.now() + runtimeCheckTimeout;
      while (!/"state"\s*:\s*"ready"/.test(stdout)) {
        if (child.exitCode !== null || child.signalCode !== null || Date.now() >= end)
          throw new Error(`Kernel CLI failed: ${stdout} ${stderr}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      const status = JSON.parse((await run(["status", "--json"])).stdout);
      assert.equal(status["executor-kernel"].runtime.execution_ready, true);
      assert.equal(status["executor-kernel"].runtime.pid, child.pid);
      assert.equal(status["channel-gateway"].runtime.available, false);
      const adapters = JSON.parse((await run(["adapter", "list", "--json"])).stdout);
      assert.deepEqual(
        adapters.map((adapter) => adapter.type).sort(),
        moduleManifest.adapters.map((adapter) => adapter.type).sort()
      );
      // Windows 的 SIGTERM 会直接杀掉 leader，之后无法再沿原 PID 找到 worker 树。
      if (process.platform === "win32") await stopReleaseProcess(child);
      else child.kill("SIGTERM");
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
        await stopReleaseProcess(child, { termGraceMs: 0 });
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
        extraStatusSink: true,
        sdkRecoveryProbe: true,
        cliKernel: true,
        uninstallPreservedHome: true,
        version: metadata.version
      })
    );
  });
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
