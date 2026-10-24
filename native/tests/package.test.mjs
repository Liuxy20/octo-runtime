import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { kernelFixture, kernelInput } from "../../test/kernel-fixture.js";
const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
const root = resolve(".");
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || `${command}: exit ${result.status}`
  );
  return result.stdout;
}
function consume(command, args, { input, ...options }) {
  // The Kernel runs on the test event loop; do not block it with spawnSync while clients run.
  return new Promise((yes, no) => {
    const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      no(Error("packaged client timeout"));
    }, 30_000);
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.once("error", (e) => {
      clearTimeout(timer);
      no(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) yes(stdout);
      else no(Error(stderr || `exit ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
test(`${language} archive consumer runs outside the repository without Node on PATH`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-native-package-"));
  t.after(async () => {
    // Go module-cache directories are read-only; let Go clean this test's isolated cache.
    if (language === "go")
      execute("go", ["clean", "-modcache"], {
        env: { ...process.env, GOMODCACHE: join(directory, "module-cache") }
      });
    await rm(directory, { recursive: true, force: true });
  });
  const consumer = join(directory, "consumer");
  await mkdir(consumer);
  const suffix = process.platform === "win32" ? ".exe" : "";
  let binary,
    prefix = [];
  if (language === "go") {
    const proxy = join(directory, "proxy");
    execute("go", ["run", ".", resolve("native/go"), proxy], {
      cwd: resolve("native/tests/go-package")
    });
    await copyFile("native/go/examples/demo_playboard.go", join(consumer, "main.go"));
    await writeFile(
      join(consumer, "go.mod"),
      "module isolated-native-consumer\n\ngo 1.25.0\n\nrequire github.com/Mininglamp-OSS/octo-runtime/native/go v0.0.0-native.test\n"
    );
    const upstream = execute("go", ["env", "GOPROXY"]).trim();
    const env = {
      ...process.env,
      GOWORK: "off",
      CGO_ENABLED: "0",
      GOMODCACHE: join(directory, "module-cache"),
      GOPROXY: `${pathToFileURL(proxy).href},${upstream}`,
      GONOPROXY: "",
      GONOSUMDB: "github.com/Mininglamp-OSS/octo-runtime/native/go"
    };
    execute("go", ["mod", "tidy"], { cwd: consumer, env });
    binary = join(consumer, "playboard-demo" + suffix);
    execute("go", ["build", "-o", binary, "."], { cwd: consumer, env });
  } else if (language === "python") {
    const packages = join(directory, "packages");
    execute("uv", ["build", "--project", resolve("native/python"), "--out-dir", packages]);
    const venv = join(consumer, "venv");
    const sourcePython = resolve(
      process.env.OCTO_NATIVE_PYTHON ||
        (process.platform === "win32"
          ? "native/python/.venv/Scripts/python.exe"
          : "native/python/.venv/bin/python")
    );
    execute("uv", ["venv", "--python", sourcePython, venv]);
    binary = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const wheel = (await readdir(packages)).find((x) => x.endsWith(".whl"));
    execute("uv", ["pip", "install", "--python", binary, join(packages, wheel)]);
    const script = join(consumer, "demo_playboard.py");
    await copyFile("native/python/demo_playboard.py", script);
    prefix = ["-I", script];
    const location = execute(binary, [
      "-I",
      "-c",
      "import octo_runtime;from octo_runtime.client import Client;from pathlib import Path;assert octo_runtime.Client is Client;assert sorted(p.name for p in Path(octo_runtime.__file__).parent.glob('*.py')) == ['__init__.py', 'client.py', 'octo_runtime_generated.py'];print(octo_runtime.__file__)"
    ]).trim();
    assert.ok(location.startsWith(venv), location);
  } else throw Error("Unknown language");
  const fixture = await kernelFixture(t, { manifest: join(root, "native/tests/adapters.json") });
  const env = { ...process.env, PATH: "", PYTHONPATH: "" };
  const listing = JSON.parse(
    await consume(binary, [...prefix, "list", "--endpoint", fixture.endpoint], {
      cwd: consumer,
      env
    })
  );
  assert.equal(listing.length, 2);
  for (const mode of ["native", "canonical"]) {
    const receipt = join(consumer, `${mode}-ref.json`);
    const events = (
      await consume(
        binary,
        [...prefix, "playboard", "--endpoint", fixture.endpoint, "--receipt", receipt],
        { cwd: consumer, env, input: JSON.stringify({ ...kernelInput(), protocol_mode: mode }) }
      )
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(
      mode === "native" ? events.at(-1).control.state : events.at(-1).type,
      mode === "native" ? "completed" : "run.completed"
    );
    const reference = JSON.parse(await readFile(receipt, "utf8"));
    const snapshot = JSON.parse(
      await consume(binary, [...prefix, "get", "--endpoint", fixture.endpoint, "--ref", receipt], {
        cwd: consumer,
        env
      })
    );
    assert.deepEqual(snapshot.ref, reference);
  }
});
