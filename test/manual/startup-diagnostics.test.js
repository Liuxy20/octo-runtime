import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  STARTUP_CATALOG,
  ServiceInitializationError,
  RuntimeHomeError,
  StartupError,
  createKernelService,
  describeStartupError,
  formatStartupDiagnostic,
  restoreStartupDiagnostic,
  safeStartupValue
} from "../../packages/octo-runtime-executor-kernel/dist/index.js";
import {
  createExtraService,
  createContextLoader,
  readJson,
  extraRegistration
} from "../../packages/octo-runtime-host-sdk/dist/index.js";
import {
  describeError,
  formatErrorDetails,
  recordStartupFailure,
  readStartupFailure
} from "../../apps/cli/dist/output.js";
import { runCli } from "../../apps/cli/dist/main.js";
import { runtimePaths } from "../../apps/cli/dist/state.js";
import { ServiceError } from "../../packages/octo-runtime-cross-service/dist/index.js";

const endpoint = () =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\octo-startup-${randomUUID()}`
    : join(tmpdir(), `s304-${randomUUID()}.sock`);
const cleanup = {
  complete: false,
  errors: [{ resource: "kernel", code: "KERNEL_CLEANUP_INCOMPLETE" }],
  pendingResources: ["kernel"]
};
const location = { component: "executor-kernel", phase: "initializing" };
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "startup304-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function missing(path) {
  try {
    await readFile(path);
    assert.fail("Expected missing file");
  } catch (error) {
    assert.equal(error.code, "ENOENT");
    return error;
  }
}

test("real missing file survives SDK wrapper, aggregate, CLI text and JSON without a Run", async (t) => {
  const path = join(await temporary(t), "不存在 file.json");
  const primary = new StartupError(
    "LOCAL_STATE_INVALID",
    {
      ...location,
      context: { path, resource: "configuration", operation: "read", configKey: "manifest" }
    },
    await missing(path)
  );
  const wrapper = new ServiceInitializationError(
    new AggregateError(
      [primary, new Error("KERNEL_CLEANUP_INCOMPLETE")],
      "KERNEL_START_CLEANUP_INCOMPLETE"
    ),
    cleanup,
    location
  );
  const diagnostic = wrapper.diagnostic;
  assert.equal(diagnostic.code, "SERVICE_INITIALIZATION_FAILED");
  assert.equal(diagnostic.rootCode, "ENOENT");
  assert.equal(diagnostic.component, location.component);
  assert.equal(diagnostic.phase, location.phase);
  assert.equal(diagnostic.context.path, path);
  assert.equal(diagnostic.context.resource, "configuration");
  assert.equal(diagnostic.context.systemCode, "ENOENT");
  assert.deepEqual(diagnostic.cleanup, cleanup);
  assert(diagnostic.causes.some((cause) => cause.code === "KERNEL_CLEANUP_INCOMPLETE"));
  const cli = describeError(wrapper);
  assert.deepEqual(JSON.parse(JSON.stringify(cli)).diagnostic, diagnostic);
  assert.equal(JSON.stringify(cli.diagnostic), JSON.stringify(diagnostic));
  assert(formatErrorDetails(cli).includes(JSON.stringify(path)));
  assert(formatErrorDetails(cli).includes("Action:"));
  assert(!JSON.stringify(cli).includes("run_id"));
  const grouped = describeError(new AggregateError([wrapper], "KERNEL_START_CLEANUP_INCOMPLETE"));
  assert.equal(grouped.diagnostic.rootCode, "ENOENT");
  assert.equal(grouped.diagnostic.context.path, path);
});

test("nested cleanup facts remain visible when the outer service cleanup is complete", async (t) => {
  const path = join(await temporary(t), "nested-missing.json");
  const inner = new ServiceInitializationError(
    await missing(path),
    {
      complete: false,
      errors: [{ resource: "nested-socket", code: "KERNEL_CLEANUP_INCOMPLETE" }],
      pendingResources: ["nested-socket"]
    },
    { component: "nested-kernel", phase: "initializing" }
  );
  const outer = new ServiceInitializationError(
    inner,
    { complete: true, errors: [], pendingResources: [] },
    { component: "outer-extra", phase: "initializing" }
  );
  const diagnostic = outer.diagnostic;
  assert.equal(diagnostic.cleanup.complete, true);
  assert(
    diagnostic.causes.some((cause) => cause.cleanup?.pendingResources.includes("nested-socket"))
  );
  assert(formatStartupDiagnostic(diagnostic).includes("nested-socket"));
  assert(formatStartupDiagnostic(diagnostic).includes("incomplete"));
  assert.deepEqual(describeError(outer).diagnostic, diagnostic);
});

test("actual Extra initialize failure is returned before its control endpoint exists", async (t) => {
  const path = join(await temporary(t), "missing-config.json");
  const service = createExtraService({
    home: await temporary(t),
    endpoint: endpoint(),
    controlEndpoint: endpoint(),
    dependencies: {},
    config: {},
    module: {
      name: "startup-example",
      default: () => async () => {
        await readFile(path);
      }
    }
  });
  await assert.rejects(service.initialize(), (error) => {
    assert(error instanceof ServiceInitializationError);
    assert.equal(error.diagnostic.rootCode, "ENOENT");
    assert.equal(error.diagnostic.component, "startup-example");
    assert.equal(error.diagnostic.context.path, path);
    assert.equal(error.diagnostic.cleanup.complete, true);
    return true;
  });
  assert.equal((await service.status()).phase, "closed");
});

test("actual Extra rollback failure preserves the original diagnosis and pending resources", async (t) => {
  const path = join(await temporary(t), "missing-extra-rollback.json");
  const service = createExtraService({
    home: await temporary(t),
    endpoint: endpoint(),
    dependencies: {},
    config: {},
    module: {
      name: "failed-rollback",
      default: (context) => {
        context.onDispose(() => {
          throw new Error("EXTRA_DISPOSE_FAILED");
        });
        return async () => {
          await readFile(path);
        };
      }
    }
  });
  await assert.rejects(service.initialize(), (error) => {
    assert.equal(error.diagnostic.rootCode, "ENOENT");
    assert.equal(error.diagnostic.context.path, path);
    assert.equal(error.diagnostic.cleanup.complete, false);
    assert(error.diagnostic.cleanup.pendingResources.length > 0);
    assert(error.diagnostic.causes.some((cause) => cause.code === "EXTRA_DISPOSE_FAILED"));
    assert.equal(error.cleanup.complete, false);
    return true;
  });
});

test("missing selected module has equivalent SDK and CLI root/context/actions", async (t) => {
  const home = await temporary(t),
    module = join(home, "missing-extra.mjs");
  const name = "missing-module",
    registration = extraRegistration({ name, module, config: {} });
  let sdk;
  await assert.rejects(registration.load(), (error) => {
    sdk = describeStartupError(error);
    return true;
  });
  assert.equal(sdk.rootCode, "ERR_MODULE_NOT_FOUND");
  assert.equal(sdk.context.module, module);
  await mkdir(join(home, "extras", name), { recursive: true });
  await writeFile(join(home, "extras", name, "config.json"), JSON.stringify({ config: {} }), {
    mode: 0o600
  });
  const manifest = join(home, "selected-manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({ version: 1, adapters: [], extras: [{ name, module }] })
  );
  const output = [];
  const code = await runCli([name, "run", "--home", home, "--manifest", manifest, "--json"], {
    output: (line) => output.push(line),
    errorOutput() {}
  });
  assert.equal(code, 1);
  const cli = JSON.parse(output.at(-1)).error.diagnostic;
  assert.equal(cli.rootCode, sdk.rootCode);
  assert.equal(cli.component, sdk.component);
  assert.equal(cli.context.module, sdk.context.module);
  assert.deepEqual(cli.actions, sdk.actions);
});

test("real wrong file type and invalid Extra configuration remain distinct", async (t) => {
  const directory = await temporary(t);
  const path = join(directory, "directory-instead-of-file");
  await mkdir(path);
  let error;
  try {
    await readFile(path);
  } catch (failure) {
    error = failure;
  }
  assert.equal(error?.code, "EISDIR");
  try {
    readJson(path);
  } catch (failure) {
    error = failure;
  }
  const typed = describeStartupError(error, location);
  assert.equal(typed.rootCode, "EISDIR");
  assert.equal(typed.context.path, path);
  const extra = createExtraService({
    home: await temporary(t),
    endpoint: endpoint(),
    config: {},
    dependencies: {},
    module: {
      name: "invalid-config",
      default: (context) => () => createContextLoader(undefined, { timeout_ms: 0 }, context.signal)
    }
  });
  await assert.rejects(extra.initialize(), (failure) => {
    assert.equal(failure.diagnostic.rootCode, "IM_CONTEXT_LOADING_CONFIG_INVALID");
    assert.equal(failure.diagnostic.context.configKey, "context_loading");
    assert(failure.diagnostic.actions[0].includes("30000"));
    return true;
  });
});

test("real CLI text/JSON preserve missing selected manifest and legacy exit code", async (t) => {
  const home = await temporary(t),
    path = join(home, "missing-manifest.json");
  const output = [],
    errors = [];
  const args = ["executor-kernel", "run", "--home", home, "--manifest", path];
  assert.equal(
    await runCli([...args, "--json"], {
      output: (line) => output.push(line),
      errorOutput: (line) => errors.push(line)
    }),
    1
  );
  const failure = JSON.parse(output.join("\n")).error;
  assert.equal(failure.code, "ENOENT");
  assert.equal(failure.diagnostic.rootCode, "ENOENT");
  assert.equal(failure.diagnostic.context.path, path);
  assert.equal(failure.diagnostic.context.resource, "module-manifest");
  output.length = 0;
  errors.length = 0;
  assert.equal(
    await runCli(args, {
      output: (line) => output.push(line),
      errorOutput: (line) => errors.push(line)
    }),
    1
  );
  assert.equal(output.length, 0);
  assert(errors.join("\n").includes(JSON.stringify(path)));
  assert(errors.join("\n").includes(failure.diagnostic.actions[0]));
});

test("invalid JSON uses the same SDK and CLI root classification while retaining CLI fallback/exit", async (t) => {
  const home = await temporary(t),
    path = runtimePaths(home, "default").rootConfig;
  await writeFile(path, "{");
  let sdk;
  try {
    readJson(path);
  } catch (error) {
    sdk = describeStartupError(error);
  }
  assert.equal(sdk.rootCode, "LOCAL_STATE_INVALID");
  const output = [];
  assert.equal(
    await runCli(["executor-kernel", "run", "--home", home, "--json"], {
      output: (line) => output.push(line),
      errorOutput() {}
    }),
    1
  );
  const error = JSON.parse(output.join("\n")).error;
  assert.equal(error.code, "COMMAND_FAILED");
  assert.equal(error.diagnostic.rootCode, sdk.rootCode);
  assert.equal(error.diagnostic.context.path, path);
  assert.deepEqual(error.diagnostic.actions, sdk.actions);
});

test("CLI failure metadata uses the same sanitizer as its startup diagnostic", async (t) => {
  const credential = randomUUID().replaceAll("-", "");
  const home = join(await temporary(t), `password=${credential}`);
  const path = join(home, "absent-manifest.json");
  for (const json of [false, true]) {
    const lines = [];
    const args = ["executor-kernel", "run", "--home", home, "--manifest", path];
    if (json) args.push("--json");
    assert.equal(
      await runCli(args, {
        output: (line) => lines.push(line),
        errorOutput: (line) => lines.push(line)
      }),
      1
    );
    const rendered = lines.join("\n");
    assert(!rendered.includes(credential));
    assert(rendered.includes("[redacted]"));
    if (json) assert.equal(JSON.parse(rendered).error.diagnostic.rootCode, "ENOENT");
  }
});

test("logging validation before IPC preserves the selected path across Kernel and Extra", async (t) => {
  const path = "relative logging 中文";
  const kernel = createKernelService({
    home: await temporary(t),
    endpoint: endpoint(),
    adapters: [],
    logging: { directory: path }
  });
  let kernelDiagnostic;
  await assert.rejects(kernel.initialize(), (error) => {
    kernelDiagnostic = error.diagnostic;
    return true;
  });
  let extraDiagnostic;
  try {
    createExtraService({
      home: await temporary(t),
      endpoint: endpoint(),
      config: {},
      dependencies: {},
      module: { name: "logging-validation", default: () => () => {} },
      logging: { directory: path }
    });
  } catch (error) {
    extraDiagnostic = describeStartupError(error);
  }
  for (const diagnostic of [kernelDiagnostic, extraDiagnostic]) {
    assert.equal(diagnostic.rootCode, "LOG_DIRECTORY_MUST_BE_ABSOLUTE");
    assert.equal(diagnostic.context.path, path);
    assert.equal(diagnostic.context.configKey, "logging.directory");
    assert(formatStartupDiagnostic(diagnostic).includes(JSON.stringify(path)));
  }
  assert.deepEqual(kernelDiagnostic.actions, extraDiagnostic.actions);
});

test("native IPC conflict records endpoint, errno and ready distinction", async (t) => {
  const address = endpoint();
  const owner = net.createServer();
  owner.listen(address);
  await once(owner, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => owner.close((error) => (error ? reject(error) : resolve())))
  );
  const service = createKernelService({
    home: await temporary(t),
    endpoint: address,
    adapters: []
  });
  await assert.rejects(service.initialize(), (error) => {
    assert.equal(
      error.diagnostic.rootCode,
      process.platform === "win32" ? "EADDRINUSE" : "ENDPOINT_IN_USE"
    );
    assert.equal(error.diagnostic.context.endpoint, address);
    assert.equal(error.diagnostic.context.resource, "ipc-endpoint");
    assert.equal(error.diagnostic.retryable, false);
    return true;
  });
});

test("merged Home failures keep canonical JSON, legacy path aliases and no root recreation", async (t) => {
  const parent = await temporary(t);
  const absent = join(parent, "missing home 中文");
  const service = createKernelService({ home: absent, endpoint: endpoint(), adapters: [] });
  let failure;
  await assert.rejects(service.initialize(), (error) => {
    failure = error;
    assert(error.cause instanceof RuntimeHomeError);
    assert.equal(error.cause.code, "HOME_NOT_FOUND");
    assert.equal(error.cause.diagnostic.path, absent);
    assert.equal(error.cause.diagnostic.context.path, absent);
    assert.equal(error.cause.diagnostic.action, error.cause.diagnostic.actions.join(" "));
    assert.equal(error.diagnostic.rootCode, "HOME_NOT_FOUND");
    const projected = describeError(error);
    assert.equal(projected.startup.path, absent);
    assert.equal(projected.startup.code, "HOME_NOT_FOUND");
    assert.deepEqual(projected.cleanup, error.cleanup);
    assert.deepEqual(JSON.parse(JSON.stringify(projected)).diagnostic, error.diagnostic);
    assert.deepEqual(
      JSON.parse(JSON.stringify(error.cause.diagnostic)),
      describeStartupError(error.cause)
    );
    return true;
  });
  await recordStartupFailure(join(absent, "logs"), "executor-kernel", failure);
  await assert.rejects(readFile(absent), { code: "ENOENT" });
});

test("native missing executable has executable guidance and no directory repair", async (t) => {
  const directory = await temporary(t),
    executable = join(directory, "missing-provider.exe");
  const child = spawn(executable, [], { cwd: directory });
  const [error] = await once(child, "error");
  const diagnostic = describeStartupError(error, location);
  assert.equal(diagnostic.rootCode, "ENOENT");
  assert.equal(diagnostic.context.executable, executable);
  assert.equal(diagnostic.context.resource, "executable");
  assert(diagnostic.actions[0].includes("working directory"));
  assert(!diagnostic.actions[0].includes("create it"));
});

test(
  "Windows native ACL denial retains actual file and errno",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporary(t),
      path = join(directory, "denied.json");
    await writeFile(path, "{}");
    const account = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
    execFileSync("icacls.exe", [path, "/deny", `${account}:(R)`], {
      stdio: "pipe",
      windowsHide: true
    });
    try {
      let failure;
      try {
        await readFile(path);
      } catch (error) {
        failure = error;
      }
      assert(failure, "ACL must actually deny the ordinary user's read");
      assert(["EACCES", "EPERM"].includes(failure.code));
      const diagnostic = describeStartupError(failure, location);
      assert.equal(diagnostic.context.path, path);
      assert.equal(diagnostic.context.systemCode, failure.code);
      assert.equal(diagnostic.rootCode, failure.code);
      assert(!diagnostic.explanation.includes("does not exist"));
    } finally {
      execFileSync("icacls.exe", [path, "/remove:d", account], {
        stdio: "pipe",
        windowsHide: true
      });
    }
  }
);

test("typed path failures retain distinct missing/type/permission/length guidance", () => {
  const codes = [
    "HOME_NOT_FOUND",
    "HOME_NOT_DIRECTORY",
    "HOME_PERMISSION_DENIED",
    "HOME_PATH_TOO_LONG",
    "IPC_ENDPOINT_TOO_LONG"
  ];
  const results = codes.map(
    (code) =>
      new StartupError(code, {
        ...location,
        context: {
          path: "C:\\Runtime Home\\中文",
          resource: "home",
          operation: "stat",
          measured: 108,
          limit: 103,
          unit: "utf8-bytes"
        }
      }).diagnostic
  );
  assert.equal(new Set(results.map((result) => result.summary)).size, codes.length);
  for (const result of results) {
    assert.equal(result.rootCode, result.code);
    assert.equal(result.context.path, "C:\\Runtime Home\\中文");
    assert(formatStartupDiagnostic(result).includes(JSON.stringify(result.context.path)));
  }
});

test("verified resource classifications retain priority over their lower-level errno", () => {
  for (const [code, systemCode] of [
    ["HOME_PERMISSION_DENIED", "EACCES"],
    ["HOME_NOT_FOUND", "ENOENT"],
    ["ENDPOINT_IN_USE", "EEXIST"],
    ["ENDPOINT_RECOVERY_IN_PROGRESS", "EEXIST"]
  ]) {
    const cause = Object.assign(new Error(systemCode), { code: systemCode });
    const error = new StartupError(
      code,
      {
        ...location,
        context: { path: "C:\\prepared-home", resource: "home", operation: "validate" }
      },
      cause
    );
    const wrapped = new ServiceInitializationError(error, cleanup, location).diagnostic;
    assert.equal(wrapped.rootCode, code);
    assert.equal(wrapped.context.systemCode, systemCode);
    assert(wrapped.causes.some((item) => item.code === systemCode));
    assert.equal(wrapped.actions[0], STARTUP_CATALOG[code].action);
  }
});

test("unknown, cyclic, aggregate and hostile getter causes stay bounded and private", () => {
  const secret = randomUUID();
  const error = new Error(secret);
  error.cause = error;
  Object.defineProperty(error, "code", {
    get() {
      throw new Error(secret);
    }
  });
  error.env = { secret };
  error.config = { secret };
  error.stderr = secret;
  const wide = new AggregateError(
    Array.from({ length: 1000 }, () => new Error(secret)),
    secret,
    { cause: error }
  );
  const diagnostic = describeStartupError(wide, location);
  assert.equal(diagnostic.rootCode, "STARTUP_UNKNOWN");
  assert.equal(diagnostic.truncated, true);
  assert(diagnostic.causes.length <= 16);
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert(!JSON.stringify(describeError(error, "COMMAND_FAILED", location)).includes(secret));
  assert(diagnostic.actions[0].includes("cause is not yet known"));
});

test("safe dynamic values are identical in text and JSON; arbitrary fields are dropped", () => {
  const credential = `bf_${randomUUID().replaceAll("-", "")}`;
  const diagnostic = new StartupError("ENOENT", {
    ...location,
    context: {
      path: "C:\\safe\\配置.json",
      resource: "configuration",
      operation: "read",
      endpoint: `https://user:${credential}@example.invalid/service?token=${credential}#${credential}`,
      secret: credential,
      config: { credential }
    }
  }).diagnostic;
  const rendered = formatStartupDiagnostic(diagnostic);
  assert(!JSON.stringify(diagnostic).includes(credential));
  assert(!rendered.includes(credential));
  assert.equal(diagnostic.context.endpoint, "https://example.invalid/service");
  assert.equal(diagnostic.context.secret, undefined);
  assert(rendered.includes(JSON.stringify(diagnostic.context.path)));
  const restored = restoreStartupDiagnostic({
    ...diagnostic,
    actions: [credential],
    summary: credential,
    explanation: credential
  });
  assert(!JSON.stringify(restored).includes(credential));
  const native = new ServiceError("COMMAND_FAILED", credential, {
    backend: "windows",
    command: `C:\\safe\\manager.exe\n token=${credential}`,
    detail: credential,
    cause: new Error(credential)
  });
  const manager = describeError(native, "COMMAND_FAILED", location);
  assert.equal(manager.backend, "windows");
  assert.equal(manager.diagnostic.rootCode, "STARTUP_UNKNOWN");
  assert(manager.command.includes("manager.exe"));
  assert(!JSON.stringify(manager).includes(credential));
});

test("long malformed URL prefixes remain fast while later credentials are redacted", () => {
  const credential = randomUUID();
  const input =
    "a-".repeat(15000) + ` https://user:${credential}@example.invalid/path?secret=${credential}`;
  const began = performance.now();
  const rendered = safeStartupValue(input);
  assert(
    performance.now() - began < 1000,
    "bounded formatting must not rescan each long scheme suffix"
  );
  assert(rendered.startsWith("a-a-"));
  assert(rendered.endsWith(" https://example.invalid/path"));
  assert(!rendered.includes(credential));
});

test("safe startup persistence preserves root/context/cleanup and rejects stale records", async (t) => {
  const directory = await temporary(t),
    path = join(directory, "missing.json");
  const error = new ServiceInitializationError(await missing(path), cleanup, location);
  const since = Date.now() - 100;
  await recordStartupFailure(directory, "executor-kernel", error);
  const recorded = await readStartupFailure(directory, "executor-kernel", since);
  assert(recorded);
  const diagnostic = describeError(recorded).diagnostic;
  assert.equal(describeError(recorded).code, describeError(error).code);
  assert.equal(describeError(recorded).cause_code, describeError(error).cause_code);
  assert.equal(diagnostic.rootCode, "ENOENT");
  assert.equal(diagnostic.context.path, path);
  assert.deepEqual(diagnostic.cleanup, cleanup);
  assert.equal(
    await readStartupFailure(directory, "executor-kernel", Date.now() + 1000),
    undefined
  );
  const hostFailure = new StartupError("MANIFEST_INVALID", {
    component: "cli",
    phase: "created",
    context: { path, resource: "module-manifest", operation: "read-manifest" }
  });
  await recordStartupFailure(directory, "executor-kernel", hostFailure);
  const hostRecord = await readStartupFailure(directory, "executor-kernel", since);
  assert.equal(describeError(hostRecord).diagnostic.component, "cli");
  assert.equal(describeError(hostRecord).diagnostic.context.path, path);
  let construction;
  try {
    createKernelService({ endpoint: "", adapters: [] });
  } catch (error) {
    construction = error;
  }
  await recordStartupFailure(directory, "executor-kernel", construction);
  const constructionRecord = await readStartupFailure(directory, "executor-kernel", since);
  assert.equal(describeError(constructionRecord).code, "SERVICE_INITIALIZATION_FAILED");
  assert.equal(
    describeError(constructionRecord).diagnostic.rootCode,
    "KERNEL_CONFIGURATION_INVALID"
  );
});

test("process liveness, Kernel execution readiness and Extra business state remain independent", async (t) => {
  const kernel = createKernelService({
    home: await temporary(t),
    endpoint: endpoint(),
    adapters: []
  });
  await kernel.initialize();
  t.after(() => kernel.close());
  const status = await kernel.status();
  assert.equal(status.pid, process.pid);
  assert.equal(status.phase, "ready");
  assert.equal(status.kernel.execution_ready, true);
  const extra = createExtraService({
    home: await temporary(t),
    endpoint: endpoint(),
    dependencies: {},
    config: {},
    module: {
      name: "offline-business",
      default: (context) => () => context.onStatus(() => ({ connected: false }))
    }
  });
  await extra.initialize();
  t.after(() => extra.close());
  const business = await extra.status();
  assert.equal(business.phase, "ready");
  assert.equal(business.kernel_available, false);
  assert.equal(business.plugin.connected, false);
});

test("catalog and bilingual published tables have the same codes", async () => {
  for (const language of ["en", "zh-CN"]) {
    const text = await readFile(
      new URL(`../../docs/${language}/guides/startup-diagnostics.md`, import.meta.url),
      "utf8"
    );
    const codes = [...text.matchAll(/^\|[ \t]+`([A-Z][A-Z0-9_]+)`[ \t]+\|/gm)].map(
      (match) => match[1]
    );
    assert.deepEqual(codes.sort(), Object.keys(STARTUP_CATALOG).sort());
    for (const value of Object.values(STARTUP_CATALOG)) {
      assert(text.includes(value.action), "Recovery guidance must match the shared catalog");
      if (language === "en") assert(text.includes(value.summary));
    }
  }
});
