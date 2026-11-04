// 显式手动专项，不进入默认 selector/CI；平台计算不冒充 Unix 真机 bind。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  componentEndpoint,
  hostHomePaths,
  createExtraService
} from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  attachKernel,
  createKernelService,
  inspectOrphanCleanup,
  acknowledgeOrphanCleanup
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { runtimePaths, assertProfileName } from "../../apps/cli/dist/state.js";
import { runCli } from "../../apps/cli/dist/main.js";

const missing = (path) => assert.rejects(lstat(path), { code: "ENOENT" });
const quietModule = {
  name: "endpoint-303",
  default(ctx) {
    return async () => {
      const status = await ctx.kernel.status();
      ctx.onStatus(() => ({ instance: status.kernel_instance_id, pid: status.pid }));
    };
  }
};

async function fixture(t) {
  const home = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "k303-"));
  const endpoint = join(home, "executor-kernel.sock");
  const resources = [];
  const own = (resource) => {
    resources.push(resource);
    return resource;
  };
  t.after(async () => {
    const errors = [];
    for (const resource of resources.reverse()) {
      try {
        const cleanup = await resource.close();
        if (cleanup && cleanup.complete !== undefined) assert.equal(cleanup.complete, true);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, `Fixture cleanup failed; preserved ${home}`);
    await rm(home, { recursive: true, force: true });
  });
  return { home, endpoint, own };
}

test("canonical derivation, UTF-8 savings, transport identity and Extra control contract", () => {
  for (const platform of ["darwin", "linux"]) {
    for (const home of [
      "/tmp/runtime",
      "/tmp/中文 space",
      "/Users/alice/Library/Application Support/octobuddy/octo-runtime"
    ]) {
      const endpoint = componentEndpoint(home, "executor-kernel", platform);
      assert.equal(endpoint, posix.join(home, "executor-kernel.sock"));
      assert.equal(
        Buffer.byteLength(posix.join(home, "sockets", "octo-runtime-executor-kernel.sock")) -
          Buffer.byteLength(endpoint),
        21
      );
      const extraEndpoint = posix.join(home, "sockets", "octo-runtime-channel-gateway.sock");
      // Kernel 缩短不授予 Extra 更大的传输预算；整合 #306 后保留其独立拒绝。
      if (Buffer.byteLength(extraEndpoint) > (platform === "darwin" ? 103 : 107))
        assert.throws(() => componentEndpoint(home, "channel-gateway", platform), {
          code: "IPC_ENDPOINT_TOO_LONG"
        });
      else assert.equal(componentEndpoint(home, "channel-gateway", platform), extraEndpoint);
    }
    for (const limit of [platform === "darwin" ? 103 : 107]) {
      const suffix = "/executor-kernel.sock";
      const home = "/" + "h".repeat(limit - Buffer.byteLength(suffix) - 1);
      assert.equal(Buffer.byteLength(componentEndpoint(home, "executor-kernel", platform)), limit);
      assert.equal(Buffer.byteLength(posix.join(home + "中", "executor-kernel.sock")), limit + 3);
    }
  }
  assert.equal(
    componentEndpoint("C:/Users/tester/runtime", "executor-kernel", "win32"),
    "\\\\.\\pipe\\octo-runtime-kernel-d36734f1d02ec17f"
  );
});

test("direct endpoint rejects UTF-8 excess without relocating Home", () => {
  for (const platform of ["darwin", "linux"]) {
    const limit = platform === "darwin" ? 103 : 107;
    const home = "/" + "h".repeat(limit - Buffer.byteLength("/executor-kernel.sock") - 1);
    assert.doesNotThrow(() => componentEndpoint(home, "executor-kernel", platform));
    assert.throws(
      () => componentEndpoint(home + "中", "executor-kernel", platform),
      (error) => {
        assert.equal(error.code, "IPC_ENDPOINT_TOO_LONG");
        assert.equal(error.diagnostic.measured, limit + 3);
        assert.equal(error.diagnostic.limit, limit);
        assert.equal(error.diagnostic.unit, "utf8-bytes");
        assert.equal(error.diagnostic.endpoint, posix.join(home + "中", "executor-kernel.sock"));
        return true;
      }
    );
  }
});

test("Home consumers agree and socket names cannot become CLI profiles", async (t) => {
  const { home } = await fixture(t);
  const endpoint = componentEndpoint(home);
  assert.equal(hostHomePaths(home).socket, endpoint);
  assert.equal(runtimePaths(home, "default").home, home);
  for (const name of [
    "executor-kernel.sock",
    "executor-kernel.sock.owner",
    "executor-kernel.sock.owner.recovery",
    "executor-kernel.sock.runs"
  ])
    assert.throws(() => assertProfileName(name), /conflicts/);
});

test("native IPC: independent Extra, attach, status, repeated close, Home state and sibling isolation", async (t) => {
  const { home, own } = await fixture(t);
  const custom = join(home, "中文 space");
  await mkdir(custom);
  const sentinels = ["machine.json", "config.json", "identity.json"];
  for (const file of sentinels) await writeFile(join(custom, file), randomUUID());
  const before = await Promise.all(sentinels.map((file) => readFile(join(custom, file), "utf8")));
  const endpoint = componentEndpoint(custom);
  const kernel = createKernelService({
    home: custom,
    endpoint,
    adapters: [],
    stateDirectory: join(custom, "run")
  });
  own(kernel);
  await kernel.initialize();
  const status = await kernel.client.status();
  assert.equal(status.pid, process.pid);
  const duplicate = own(
    createKernelService({
      home: custom,
      endpoint,
      adapters: [],
      stateDirectory: join(custom, "run")
    })
  );
  await assert.rejects(duplicate.initialize(), (error) => error.cleanup.complete);
  assert.equal((await kernel.client.status()).kernel_instance_id, status.kernel_instance_id);
  const client = attachKernel({ endpoint });
  own(client);
  assert.deepEqual(await client.status(), status);
  const extra = createExtraService({
    home: custom,
    endpoint,
    module: quietModule,
    config: {},
    dependencies: {},
    controlEndpoint: componentEndpoint(custom, "endpoint-303")
  });
  own(extra);
  await extra.initialize();
  assert.equal((await extra.status()).plugin.instance, status.kernel_instance_id);
  assert.equal((await extra.status()).kernel_available, true);
  const siblingHome = join(home, "sibling");
  await mkdir(siblingHome);
  const sibling = createKernelService({
    home: siblingHome,
    endpoint: componentEndpoint(siblingHome),
    adapters: []
  });
  own(sibling);
  await sibling.initialize();
  assert.equal((await extra.close()).complete, true);
  assert.equal((await client.status()).kernel_instance_id, status.kernel_instance_id);
  const closing = kernel.close();
  assert.equal(kernel.close(), closing);
  assert.equal((await closing).complete, true);
  assert.equal((await sibling.client.status()).execution_ready, true);
  assert.deepEqual(
    await Promise.all(sentinels.map((file) => readFile(join(custom, file), "utf8"))),
    before
  );
  if (process.platform === "win32") await missing(join(custom, "executor-kernel.sock"));
  else {
    await missing(endpoint);
  }
});

test("native IPC: explicit recovery keeps the canonical address and unrelated data", async (t) => {
  const { home, own } = await fixture(t);
  const endpoint = componentEndpoint(home);
  const path = join(home, "run", "kernel-invocations.json");
  await mkdir(join(home, "run"));
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true });
  await once(child, "exit");
  const record = {
    schemaVersion: 1,
    kernelPid: child.pid,
    updatedAt: new Date().toISOString(),
    cleanupIncomplete: true,
    nativeOwner: true,
    invocations: []
  };
  await writeFile(path, JSON.stringify(record));
  const options = { home, endpoint, adapters: [], stateDirectory: join(home, "run") };
  const first = own(createKernelService(options));
  await assert.rejects(
    first.initialize(),
    (error) => error.cause.code === "ORPHAN_CLEANUP_INCOMPLETE" && error.cleanup.complete
  );
  assert.equal((await inspectOrphanCleanup(path)).state, "cleanup_incomplete");
  const recovered = await acknowledgeOrphanCleanup(path);
  assert.deepEqual(JSON.parse(await readFile(recovered.archivePath, "utf8")), record);
  const next = createKernelService(options);
  own(next);
  await next.initialize();
  assert.equal((await next.status()).endpoint, endpoint);
  assert.equal((await next.close()).complete, true);
  await missing(path);
  assert.deepEqual(JSON.parse(await readFile(recovered.archivePath, "utf8")), record);
});

test("native IPC: CLI status and doctor observe the same Kernel; recover uses the same state path", async (t) => {
  const { home, own } = await fixture(t);
  const endpoint = componentEndpoint(home);
  const stateDirectory = join(home, "run");
  const kernel = createKernelService({ home, endpoint, stateDirectory, adapters: [] });
  own(kernel);
  await kernel.initialize();
  const expected = await kernel.client.status();
  const backend = {
    kind: "fixture",
    inspect: async () => ({ manager: "fixture", state: "running", enabled: true, drift: [] }),
    probe: async () => ({ manager: "fixture", supported: true })
  };
  async function cli(args) {
    let output;
    const code = await runCli([...args, "--home", home, "--json"], {
      backend,
      output: (line) => {
        output = line;
      }
    });
    assert.equal(code, 0, output);
    return JSON.parse(output);
  }
  assert.equal(
    (await cli(["executor-kernel", "status"])).runtime.kernel_instance_id,
    expected.kernel_instance_id
  );
  const doctor = await cli(["doctor"]);
  assert.equal(
    doctor.checks.find((check) => check.component === "executor-kernel").runtime.kernel_instance_id,
    expected.kernel_instance_id
  );
  assert.equal(doctor.recovery.manifestPath, join(stateDirectory, "kernel-invocations.json"));
  assert.equal(doctor.recovery.state, "available");
  assert.equal((await kernel.close()).complete, true);
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true });
  await once(child, "exit");
  const path = join(stateDirectory, "kernel-invocations.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      kernelPid: child.pid,
      updatedAt: new Date().toISOString(),
      cleanupIncomplete: true,
      nativeOwner: true,
      invocations: []
    })
  );
  const recovered = await cli(["executor-kernel", "recover", "--acknowledge-orphan-cleanup"]);
  assert.equal(recovered.manifestPath, path);
  assert.equal((await inspectOrphanCleanup(path)).state, "acknowledged");
});

test(
  "POSIX real bind: direct canonical address at the platform byte boundary",
  { skip: process.platform === "win32" ? "Actual macOS/Linux bind required" : false },
  async (t) => {
    const { home: base, own } = await fixture(t);
    const limit = process.platform === "darwin" ? 103 : 107;
    const suffix = "/executor-kernel.sock";
    const home = join(base, "中" + "h".repeat(limit - Buffer.byteLength(base + suffix) - 4));
    await mkdir(home);
    const endpoint = componentEndpoint(home);
    assert.equal(Buffer.byteLength(endpoint), limit);
    const service = createKernelService({ home, endpoint, adapters: [] });
    own(service);
    await service.initialize();
    assert.equal((await service.client.status()).execution_ready, true);
    assert.equal((await service.close()).complete, true);
  }
);
