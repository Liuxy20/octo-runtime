// Issue 306 显式专项；不加入默认 selector / CI。运行时 state 必须在 checkout 外。
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, win32, posix } from "node:path";
import {
  createKernelService,
  createExtraService,
  componentEndpoint,
  normalizedHome,
  validateRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint,
  RuntimeHomeError,
  ServiceInitializationError
} from "../../dist/public/host.js";
import {
  attachKernel,
  acquireEndpoint
} from "../../packages/octo-runtime-executor-kernel/dist/index.js";
import {
  hostHomePaths,
  ensureHostHome,
  accountPaths,
  profilePaths,
  ensureAccount,
  ensureLocalRuntime
} from "../../packages/octo-runtime-host-sdk/dist/index.js";
import {
  defaultRuntimeHome,
  selectRuntimeHome,
  prepareRuntimeHome
} from "../../apps/cli/dist/state.js";
import { describeError, recordStartupFailure } from "../../apps/cli/dist/output.js";
import { runCli } from "../../apps/cli/dist/main.js";

function fixture(t) {
  const directory = fs.mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "h306-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const module = {
  name: "home-validation",
  default: () => () => {
    throw new Error("PLUGIN_MUST_NOT_START");
  }
};
async function failsBeforeResources(t, input, code, root) {
  const endpoint = componentEndpoint(root, "home-test");
  for (const service of [
    createKernelService({
      home: input,
      endpoint,
      adapters: [],
      logging: { directory: join(root, "logs") },
      stateDirectory: join(root, "run")
    }),
    createExtraService({
      home: input,
      endpoint,
      controlEndpoint: componentEndpoint(root, "extra-test"),
      module,
      config: {},
      dependencies: {},
      logging: { directory: join(root, "logs") }
    })
  ]) {
    const before = fs.readdirSync(root).sort();
    await assert.rejects(service.initialize(), (error) => {
      assert.ok(error instanceof ServiceInitializationError);
      assert.ok(error.cause instanceof RuntimeHomeError);
      assert.equal(error.cause.code, code);
      assert.equal(error.cause.diagnostic.domain, "startup");
      assert.ok(error.cause.diagnostic.action.includes("host"));
      assert.equal(error.cleanup.complete, true);
      const publicError = describeError(error);
      assert.equal(publicError.startup.code, code);
      assert.equal(publicError.cleanup.complete, true);
      return true;
    });
    assert.equal((await service.close()).complete, true);
    assert.deepEqual(
      fs.readdirSync(root).sort(),
      before,
      "no identity, logs, lease or substitute Home"
    );
  }
  const client = attachKernel({ endpoint });
  await assert.rejects(client.status(), /KERNEL_UNAVAILABLE/);
  client.close();
}

for (const [name, input] of [
  ["missing", undefined],
  ["empty", ""],
  ["blank", " "],
  ["relative", "relative"],
  ["tilde", "~/runtime"]
]) {
  test(`public services reject ${name} before startup resources`, async (t) => {
    const root = fixture(t);
    await failsBeforeResources(t, input, "HOME_INVALID", root);
    assert.throws(() => componentEndpoint(input), { code: "HOME_INVALID" });
  });
}

test("nonexistent and non-directory Homes remain distinct and untouched", async (t) => {
  const root = fixture(t),
    missing = join(root, "missing"),
    file = join(root, "file");
  fs.writeFileSync(file, "preserve-host-data");
  await failsBeforeResources(t, missing, "HOME_NOT_FOUND", root);
  assert.equal(fs.existsSync(missing), false);
  assert.throws(() => hostHomePaths(missing), { code: "HOME_NOT_FOUND" });
  await failsBeforeResources(t, file, "HOME_NOT_DIRECTORY", root);
  assert.equal(fs.readFileSync(file, "utf8"), "preserve-host-data");
  // JS 调用方不能伪造 paths 来让 ensureHostHome 恢复旧的根 mkdir。
  assert.throws(
    () =>
      ensureHostHome({
        home: missing,
        run: join(missing, "run"),
        machineFile: join(missing, "machine.json")
      }),
    { code: "HOME_NOT_FOUND" }
  );
  assert.equal(fs.existsSync(missing), false);
});

test("host-supplied Chinese/space directory starts native Kernel and closes real IPC", async (t) => {
  const root = fixture(t),
    home = join(root, "中文 空间");
  fs.mkdirSync(home);
  const endpoint = componentEndpoint(home);
  const kernel = createKernelService({
    home,
    endpoint,
    adapters: [],
    stateDirectory: join(home, "run")
  });
  t.after(() => kernel.close());
  await kernel.initialize();
  assert.equal((await kernel.client.status()).pid, process.pid);
  assert.deepEqual(fs.readdirSync(root), ["中文 空间"]);
  assert.equal((await kernel.close()).complete, true);
  assert.equal(fs.existsSync(join(home, "run", "kernel-invocations.json")), false);
  const observer = attachKernel({ endpoint });
  await assert.rejects(observer.status(), /KERNEL_UNAVAILABLE/);
  observer.close();
});

test("identity helpers never recreate an unavailable Home from cached paths", (t) => {
  const root = fixture(t),
    home = join(root, "host-owned");
  fs.mkdirSync(home);
  const paths = hostHomePaths(home),
    account = accountPaths(paths, "host-account"),
    profile = profilePaths(account, "default");
  fs.rmdirSync(home);
  assert.throws(() => ensureHostHome(paths), { code: "HOME_NOT_FOUND" });
  assert.throws(() => ensureAccount(account, ["default"]), { code: "HOME_NOT_FOUND" });
  assert.throws(() => ensureLocalRuntime(profile, { id: "tenant" }), { code: "HOME_NOT_FOUND" });
  assert.equal(fs.existsSync(home), false);
});

test("Home policy helpers are retired and CLI uses one default without env override", async (t) => {
  const sdk = await import("../../packages/octo-runtime-host-sdk/dist/index.js");
  assert.equal(sdk.resolveHostHome, undefined);
  const root = fixture(t);
  for (const platform of ["win32", "darwin", "linux"]) {
    assert.equal(
      defaultRuntimeHome(
        {
          HOME: root,
          OCTO_RUNTIME_HOME: join(root, "override"),
          LOCALAPPDATA: join(root, "appdata"),
          XDG_STATE_HOME: join(root, "xdg")
        },
        platform
      ),
      resolve(root, ".octo-runtime")
    );
  }
  assert.throws(() => selectRuntimeHome(""), { code: "HOME_INVALID" });
  assert.throws(() => defaultRuntimeHome({ HOME: "relative-user-home" }), { code: "HOME_INVALID" });
  assert.throws(() => selectRuntimeHome("~/runtime"), { code: "HOME_INVALID" });
  const home = join(root, "cli-prepared");
  assert.equal(fs.existsSync(home), false);
  const lines = [];
  let sdkReady = false;
  // runCli 在本进程原生构造实际 SDK；捕获 ready 后定向向自己的前台 handler 发 SIGINT。
  const manifest = join(root, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, adapters: [], extras: [] }));
  const result = await runCli(
    ["executor-kernel", "run", "--home", home, "--manifest", manifest, "--json"],
    {
      output(line) {
        lines.push(line);
        if (line.includes('"state": "ready"')) {
          sdkReady = true;
          setImmediate(() => process.emit("SIGINT"));
        }
      }
    }
  );
  assert.equal(result, 0, lines.join("\n"));
  assert.equal(sdkReady, true);
  assert.equal(
    validateRuntimeHome(home),
    home,
    "CLI prepared the previously absent root before SDK startup"
  );
  assert.equal(fs.existsSync(join(root, "override")), false);
});

test("over-limit Home fails at both public startup boundaries without creating it", async (t) => {
  const root = fixture(t),
    home = join(root, "x".repeat(256));
  await failsBeforeResources(t, home, "HOME_PATH_TOO_LONG", root);
  assert.equal(fs.existsSync(home), false);
});

test("public services reject an over-limit explicit IPC address before logs or listeners", async (t) => {
  const home = fixture(t);
  const endpoint =
    process.platform === "win32" ? "\\\\.\\pipe\\" + "p".repeat(249) : "/tmp/" + "p".repeat(104);
  for (const service of [
    createKernelService({
      home,
      endpoint,
      adapters: [],
      logging: { directory: join(home, "logs") }
    }),
    createExtraService({
      home,
      endpoint: componentEndpoint(home),
      controlEndpoint: endpoint,
      module,
      config: {},
      dependencies: {},
      logging: { directory: join(home, "logs") }
    })
  ]) {
    await assert.rejects(
      service.initialize(),
      (error) =>
        error.cause?.code === "IPC_ENDPOINT_TOO_LONG" &&
        error.cause.diagnostic.endpoint === endpoint &&
        error.cleanup.complete
    );
    assert.deepEqual(fs.readdirSync(home), []);
    assert.equal((await service.close()).complete, true);
  }
});

test("CLI invalid explicit Home never selects its default or creates diagnostics there", async (t) => {
  const root = fixture(t),
    file = join(root, "file");
  fs.writeFileSync(file, "host-data");
  const rows = [];
  for (const input of ["", "~/literal", file]) {
    const code = await runCli(["executor-kernel", "run", "--home", input, "--json"], {
      env: { ...process.env, HOME: root },
      output: (line) => rows.push(JSON.parse(line))
    });
    assert.notEqual(code, 0);
    if (input === "")
      assert.equal(
        rows.at(-1).error.code,
        "INVALID_ARGUMENTS",
        "CLI parser rejects the missing option value"
      );
    else assert.equal(rows.at(-1).error.startup.domain, "startup");
    assert.equal(fs.existsSync(join(root, ".octo-runtime")), false);
    assert.equal(fs.readFileSync(file, "utf8"), "host-data");
  }
  await assert.rejects(prepareRuntimeHome(file), { code: "HOME_NOT_DIRECTORY" });
});

test("CLI prepares its unified default and ignores retired implicit branches", async (t) => {
  const root = fixture(t),
    manifest = join(root, "empty-manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, adapters: [], extras: [] }));
  const selected = join(root, ".octo-runtime");
  const forbidden = join(root, "retired-override");
  let ready = false;
  const rows = [];
  const code = await runCli(["executor-kernel", "run", "--manifest", manifest, "--json"], {
    env: {
      ...process.env,
      HOME: root,
      OCTO_RUNTIME_HOME: forbidden,
      LOCALAPPDATA: forbidden,
      XDG_STATE_HOME: forbidden
    },
    output(line) {
      rows.push(line);
      if (line.includes('"state": "ready"')) {
        ready = true;
        setImmediate(() => process.emit("SIGINT"));
      }
    }
  });
  assert.equal(code, 0, rows.join("\n"));
  assert.equal(ready, true);
  assert.equal(validateRuntimeHome(selected), selected);
  assert.equal(fs.existsSync(forbidden), false);
});

test("unsupported Windows syntax is rejected before normalization (calculation only)", () => {
  for (const input of [
    "\\root-relative",
    "C:relative",
    "\\\\server\\share\\runtime",
    "\\\\?\\C:\\runtime",
    "C:\\",
    "C:\\foo:stream",
    "C:\\NUL",
    "C:\\trailing.",
    "C:\\trailing "
  ]) {
    assert.throws(() => normalizedHome(input, "win32"), RuntimeHomeError);
  }
  assert.equal(normalizedHome("C:/Host/中文 space", "win32"), "c:\\host\\中文 space");
  assert.equal(normalizedHome("/tmp/中文 space", "linux"), "/tmp/中文 space");
});

test("Unix IPC budget uses UTF-8 and each actual platform limit (calculation only on Windows)", () => {
  for (const [platform, limit] of [
    ["darwin", 103],
    ["linux", 107]
  ]) {
    for (const prefix of ["/tmp/", "/tmp/中文 "]) {
      const endpoint = prefix + "s".repeat(limit - Buffer.byteLength(prefix));
      assert.doesNotThrow(() => assertIpcEndpoint(endpoint, platform));
      assert.throws(
        () => assertIpcEndpoint(endpoint + "s", platform),
        (error) =>
          error.code === "IPC_ENDPOINT_TOO_LONG" &&
          error.diagnostic.measured === limit + 1 &&
          error.diagnostic.limit === limit &&
          error.diagnostic.endpoint === endpoint + "s"
      );
    }
  }
});

test("filesystem budget includes complete appended names and the relevant encoding", () => {
  assert.doesNotThrow(() => assertRuntimePath("C:\\" + "中".repeat(255), "state", "win32"));
  assert.throws(
    () => assertRuntimePath("C:\\" + "中".repeat(256), "state", "win32"),
    (error) => error.diagnostic.measured === 256 && error.diagnostic.unit === "utf16-units"
  );
  assert.throws(
    () => assertRuntimePath("/tmp/" + "中".repeat(86), "state", "linux"),
    (error) => error.diagnostic.measured === 258 && error.diagnostic.limit === 255
  );
  const home = "C:\\" + Array(170).fill("p".repeat(190)).join("\\");
  assert.doesNotThrow(() => assertRuntimePath(home, "home", "win32"));
  assert.throws(
    () =>
      assertRuntimePath(
        win32.join(home, "x".repeat(240), "y".repeat(200)),
        "kernel-state",
        "win32"
      ),
    (error) => error.code === "HOME_PATH_TOO_LONG" && error.diagnostic.operation === "path-budget"
  );
});

test("endpoint-only attach and ownership cannot bypass IPC validation", async () => {
  for (const endpoint of ["", "relative", "\0abstract"]) {
    assert.throws(() => attachKernel({ endpoint }), { code: "IPC_ENDPOINT_INVALID" });
    await assert.rejects(acquireEndpoint(endpoint), { code: "IPC_ENDPOINT_INVALID" });
  }
});

test("startup projection preserves Home detail and incomplete cleanup through aggregates", async (t) => {
  const root = fixture(t);
  const reason = new RuntimeHomeError({
    code: "HOME_NOT_FOUND",
    path: join(root, "absent"),
    resource: "home",
    operation: "stat",
    action: "The host must prepare this directory."
  });
  const cleanup = {
    complete: false,
    errors: [{ resource: "kernel", code: "KERNEL_CLEANUP_INCOMPLETE" }],
    pendingResources: ["kernel"]
  };
  const error = new ServiceInitializationError(
    new AggregateError(
      [reason, new Error("private cleanup text")],
      "KERNEL_START_CLEANUP_INCOMPLETE",
      { cause: new Error("private cleanup text") }
    ),
    cleanup
  );
  const projected = describeError(error);
  assert.equal(projected.startup.path, reason.diagnostic.path);
  assert.deepEqual(projected.cleanup, cleanup);
  assert.doesNotMatch(JSON.stringify(projected), /private cleanup text/);
  const invalidLogs = join(root, "absent", "logs");
  await recordStartupFailure(invalidLogs, "executor-kernel", error);
  assert.equal(fs.existsSync(join(root, "absent")), false);
});

test("injected permission error retains safe errno without leaking original error text", async (t) => {
  const root = fixture(t);
  const original = fs.accessSync;
  fs.accessSync = () => {
    throw Object.assign(new Error("private configuration must not appear"), { code: "EACCES" });
  };
  syncBuiltinESMExports();
  try {
    await failsBeforeResources(t, root, "HOME_PERMISSION_DENIED", root);
    assert.throws(
      () => validateRuntimeHome(root),
      (error) => {
        assert.equal(error.diagnostic.systemCode, "EACCES");
        assert.doesNotMatch(JSON.stringify(describeError(error)), /private configuration/);
        return true;
      }
    );
  } finally {
    fs.accessSync = original;
    syncBuiltinESMExports();
  }
});

test("native permission denial is a Home failure", async (t) => {
  const root = fixture(t),
    denied = join(root, "denied");
  fs.mkdirSync(denied);
  if (process.platform === "win32") {
    const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true
    }).match(/S-1-[\d-]+/)[0];
    execFileSync("icacls.exe", [denied, "/deny", `*${sid}:(OI)(CI)(W)`], {
      stdio: "ignore",
      windowsHide: true
    });
    try {
      await failsBeforeResources(t, denied, "HOME_PERMISSION_DENIED", root);
    } finally {
      execFileSync("icacls.exe", [denied, "/remove:d", `*${sid}`], {
        stdio: "ignore",
        windowsHide: true
      });
    }
  } else {
    if (process.getuid?.() === 0) {
      t.skip("root can bypass mode bits; native permission assertion not exercised");
      return;
    }
    fs.chmodSync(denied, 0o500);
    try {
      await failsBeforeResources(t, denied, "HOME_PERMISSION_DENIED", root);
    } finally {
      fs.chmodSync(denied, 0o700);
    }
  }
});

test(
  "Windows native long filesystem paths and named-pipe boundary",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = fixture(t),
      home = join(root, "long".repeat(35), "中".repeat(60));
    assert.ok(home.length > 260);
    fs.mkdirSync(home, { recursive: true });
    assert.equal(validateRuntimeHome(home), home);
    const kernel = createKernelService({
      home,
      endpoint: componentEndpoint(home),
      adapters: [],
      stateDirectory: join(home, "run")
    });
    await kernel.initialize();
    assert.equal((await kernel.close()).complete, true);
    for (const prefix of ["\\\\.\\pipe\\h306-", "\\\\.\\pipe\\中文-"]) {
      const endpoint = prefix + "p".repeat(256 - Buffer.byteLength(prefix, "utf16le") / 2);
      assertIpcEndpoint(endpoint);
      const server = net.createServer();
      try {
        await new Promise((accept, reject) => {
          server.once("error", reject);
          server.listen(endpoint, accept);
        });
      } finally {
        if (server.listening)
          await new Promise((accept, reject) =>
            server.close((error) => (error ? reject(error) : accept()))
          );
      }
      assert.throws(
        () => assertIpcEndpoint(endpoint + "p"),
        (error) => error.diagnostic.measured === 257 && error.diagnostic.limit === 256
      );
    }
  }
);

test(
  "native Unix bind at boundary is separate from simulated calculation",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = fixture(t),
      limit = process.platform === "darwin" ? 103 : 107;
    const endpoint = posix.join(root, "p".repeat(limit - Buffer.byteLength(root) - 1));
    assertIpcEndpoint(endpoint);
    const server = net.createServer();
    try {
      await new Promise((accept, reject) => {
        server.once("error", reject);
        server.listen(endpoint, accept);
      });
    } finally {
      if (server.listening)
        await new Promise((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept()))
        );
    }
  }
);
