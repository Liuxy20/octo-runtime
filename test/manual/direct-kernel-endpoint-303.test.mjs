// 显式手动专项，不进入默认 selector/CI。Windows 文件租约模拟与真实 IPC 分开记录。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import net from "node:net";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, open, chmod } from "node:fs/promises";
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
import {
  acquireKernelTransition,
  acquireEndpoint
} from "../../packages/octo-runtime-executor-kernel/dist/endpoint.js";
import { runtimePaths, assertProfileName } from "../../apps/cli/dist/state.js";
import { describeError } from "../../apps/cli/dist/output.js";
import { runCli } from "../../apps/cli/dist/main.js";
import * as kernelApi from "@mininglamp-oss/octo-runtime-executor-kernel";

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
  const legacy = join(home, "sockets", "octo-runtime-executor-kernel.sock");
  await mkdir(join(home, "sockets"));
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
  return { home, endpoint, legacy, own };
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
      if (
        typeof kernelApi.assertIpcEndpoint === "function" &&
        Buffer.byteLength(extraEndpoint) > (platform === "darwin" ? 103 : 107)
      )
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

test(
  "306 integration: direct endpoint budget rejects UTF-8 excess without relocating Home",
  {
    skip:
      typeof kernelApi.assertIpcEndpoint !== "function"
        ? "Requires the merged #306 validation boundary; not copied into #303"
        : false
  },
  () => {
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
  }
);

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

test("joint 306 budget includes legacy ownership files without treating them as IPC addresses (calculation only)", () => {
  for (const platform of ["darwin", "linux"]) {
    const script = `
      import assert from 'node:assert/strict';
      import {kernelStartupPaths,assertRuntimePath,assertIpcEndpoint} from '@mininglamp-oss/octo-runtime-executor-kernel';
      const original=Object.getOwnPropertyDescriptor(process,'platform');
      try {
        Object.defineProperty(process,'platform',{value:process.argv[1],configurable:true});
        const limit=process.platform==='darwin'?103:107;
        const endpoint='/'+'h'.repeat(40)+'/'+'h'.repeat(limit-21-42)+'/executor-kernel.sock';
        assert.equal(Buffer.byteLength(endpoint),limit);
        assertIpcEndpoint(endpoint);
        const paths=kernelStartupPaths(endpoint);
        const legacy=paths.find(item=>item.resource==='kernel-transition-ownership');
        assert.ok(legacy);
        assert.match(legacy.path,/sockets\\/octo-runtime-executor-kernel.sock.owner.recovery$/);
        assertRuntimePath(legacy.path,legacy.resource,process.platform);
        assert.throws(()=>assertIpcEndpoint(legacy.path,process.platform),{code:'IPC_ENDPOINT_TOO_LONG'});
        assertRuntimePath(endpoint+'.owner.recovery','endpoint-ownership',process.platform,{path:4095,name:47});
        assert.throws(()=>assertRuntimePath(legacy.path,legacy.resource,process.platform,{path:4095,name:47}),{code:'HOME_PATH_TOO_LONG'});
        assert.ok(paths.some(item=>item.resource==='legacy-kernel-state'));
        console.log(JSON.stringify({platform:process.platform,legacyFileBudgetChecked:true}));
      } finally {Object.defineProperty(process,'platform',original);}
    `;
    const result = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", script, platform], {
        encoding: "utf8",
        windowsHide: true
      })
    );
    assert.equal(result.legacyFileBudgetChecked, true);
  }
});

for (const suffix of ["", ".runs", ".owner"]) {
  test(`filesystem-only transition rejects and preserves old artifact ${suffix || "socket path"}`, async (t) => {
    const { endpoint, legacy } = await fixture(t);
    const path = legacy + suffix;
    const content =
      suffix === ".owner"
        ? JSON.stringify({ pid: process.pid, nonce: randomUUID() })
        : "owned-user-data";
    await writeFile(path, content);
    await assert.rejects(acquireKernelTransition(endpoint), (error) => {
      assert.equal(error.code, "KERNEL_ENDPOINT_UPGRADE_REQUIRED");
      assert.equal(error.diagnostic.path, path);
      assert.equal(error.diagnostic.endpoint, legacy);
      assert.match(error.diagnostic.action, /old version/);
      const output = describeError(new Error("SERVICE_INITIALIZATION_FAILED", { cause: error }));
      assert.equal(output.cause_code, error.code);
      assert.equal(output.diagnostic.path, path);
      return true;
    });
    assert.equal(await readFile(path, "utf8"), content);
    if (suffix !== ".owner") await missing(`${legacy}.owner`);
    await missing(endpoint);
  });
}

test("filesystem-only transition reserves the old PID/nonce protocol and releases only itself", async (t) => {
  const { endpoint, legacy } = await fixture(t);
  const release = await acquireKernelTransition(endpoint);
  const owner = JSON.parse(await readFile(`${legacy}.owner`, "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.transitionEndpoint, endpoint);
  await missing(legacy);
  await assert.rejects(acquireKernelTransition(endpoint), /ENDPOINT_IN_USE/);
  await writeFile(
    `${legacy}.owner`,
    JSON.stringify({ pid: process.pid, nonce: randomUUID(), transitionEndpoint: endpoint })
  );
  await assert.rejects(release(), /ENDPOINT_OWNER_CHANGED/);
  assert.notEqual(JSON.parse(await readFile(`${legacy}.owner`, "utf8")).nonce, owner.nonce);
});

test("filesystem-only transition reclaims only its own dead matching owner", async (t) => {
  const { endpoint, legacy } = await fixture(t);
  const child = spawn(process.execPath, ["-e", ""], { windowsHide: true });
  await once(child, "exit");
  const owner = { pid: child.pid, nonce: randomUUID(), transitionEndpoint: endpoint };
  await writeFile(
    `${legacy}.owner`,
    JSON.stringify({ ...owner, transitionEndpoint: `${endpoint}-other` })
  );
  await assert.rejects(acquireKernelTransition(endpoint), {
    code: "KERNEL_ENDPOINT_UPGRADE_REQUIRED"
  });
  await writeFile(`${legacy}.owner`, JSON.stringify(owner));
  const release = await acquireKernelTransition(endpoint);
  await release();
  await missing(`${legacy}.owner`);
  await missing(`${legacy}.owner.recovery`);
});

test("filesystem-only concurrent transition acquisition admits exactly one owner", async (t) => {
  const { endpoint, legacy } = await fixture(t);
  const results = await Promise.allSettled([
    acquireKernelTransition(endpoint),
    acquireKernelTransition(endpoint)
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  for (const value of results) if (value.status === "fulfilled") await value.value();
  await missing(`${legacy}.owner`);
});

for (const content of ["null", "[]", "x".repeat(5000)]) {
  test(`filesystem-only transition preserves unsupported owner content (${content.length} bytes)`, async (t) => {
    const { endpoint, legacy } = await fixture(t);
    const file = `${legacy}.owner`;
    await writeFile(file, content);
    await assert.rejects(acquireKernelTransition(endpoint), {
      code: "KERNEL_ENDPOINT_UPGRADE_REQUIRED"
    });
    assert.equal(await readFile(file, "utf8"), content);
    await missing(`${file}.recovery`);
  });
}

test("filesystem-only transition rolls back its own partial owner write failure", async (t) => {
  const { home, endpoint, legacy } = await fixture(t);
  const probe = await open(join(home, "handle-probe"), "wx");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const write = prototype.writeFile;
  const denied = Object.assign(new Error("TEST_303_WRITE_DENIED"), { code: "EPERM" });
  let injected = false;
  t.mock.method(prototype, "writeFile", async function (source, ...args) {
    if (
      !injected &&
      typeof source === "string" &&
      JSON.parse(source).transitionEndpoint === endpoint
    ) {
      injected = true;
      await Reflect.apply(write, this, ["{"]);
      throw denied;
    }
    return Reflect.apply(write, this, [source, ...args]);
  });
  await assert.rejects(acquireKernelTransition(endpoint), (error) => error.cause === denied);
  assert.equal(injected, true);
  await missing(`${legacy}.owner`);
  t.mock.restoreAll();
  const release = await acquireKernelTransition(endpoint);
  await release();
});

test("filesystem-only transition preserves both rejection and failed rollback evidence", async (t) => {
  const { home, endpoint, legacy } = await fixture(t);
  await writeFile(legacy, "fixture-owned-old-path");
  const probe = await open(join(home, "read-probe"), "wx");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const read = prototype.read;
  let injected = false;
  t.mock.method(prototype, "read", async function (buffer, ...args) {
    const result = await Reflect.apply(read, this, [buffer, ...args]);
    const source = buffer.subarray(0, result.bytesRead).toString("utf8");
    if (!injected && source.includes('"transitionEndpoint"')) {
      const owner = JSON.parse(source);
      if (owner.transitionEndpoint === endpoint) {
        injected = true;
        const changed = JSON.stringify({ ...owner, nonce: randomUUID() });
        buffer.write(changed);
        return { ...result, bytesRead: Buffer.byteLength(changed) };
      }
    }
    return result;
  });
  await assert.rejects(acquireKernelTransition(endpoint), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, "ENDPOINT_ACQUISITION_CLEANUP_INCOMPLETE");
    assert.equal(error.errors[0].code, "KERNEL_ENDPOINT_UPGRADE_REQUIRED");
    assert.equal(error.errors[0].diagnostic.path, legacy);
    assert.equal(error.errors[1].message, "ENDPOINT_OWNER_CHANGED");
    assert.equal(error.cause, error.errors[1]);
    return true;
  });
  assert.equal(injected, true);
  t.mock.restoreAll();
  assert.equal(await readFile(legacy, "utf8"), "fixture-owned-old-path");
  assert.equal(JSON.parse(await readFile(`${legacy}.owner`, "utf8")).pid, process.pid);
  await assert.rejects(acquireKernelTransition(endpoint), /ENDPOINT_IN_USE/);
});

test("filesystem-only transition retains the owner when descriptor close is unconfirmed", async (t) => {
  const { endpoint, legacy } = await fixture(t);
  const originalOpen = fsPromises.open;
  const denied = Object.assign(new Error("TEST_303_OWNER_CLOSE_FAILED"), { code: "EIO" });
  let injected = false;
  t.mock.method(fsPromises, "open", async (...args) => {
    const handle = await Reflect.apply(originalOpen, fsPromises, args);
    if (args[0] === `${legacy}.owner` && args[1] === "wx") {
      const close = handle.close;
      t.mock.method(handle, "close", async function (...closeArgs) {
        await Reflect.apply(close, this, closeArgs);
        injected = true;
        throw denied;
      });
    }
    return handle;
  });
  // FileHandle.close 是实例方法；通过 builtin 活绑定只注入本次 owner 的句柄，随后恢复。
  syncBuiltinESMExports();
  try {
    await assert.rejects(acquireKernelTransition(endpoint), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, "ENDPOINT_ACQUISITION_CLEANUP_INCOMPLETE");
      assert.equal(error.errors[0].cause, denied);
      return true;
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(injected, true);
  assert.equal(JSON.parse(await readFile(`${legacy}.owner`, "utf8")).transitionEndpoint, endpoint);
  await assert.rejects(acquireKernelTransition(endpoint), /ENDPOINT_IN_USE/);
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
    await missing(join(custom, "sockets", "octo-runtime-executor-kernel.sock.owner"));
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

test("native IPC: a server close callback error remains incomplete and preserves the state record", async (t) => {
  const { home, own } = await fixture(t);
  const endpoint = componentEndpoint(home);
  const stateDirectory = join(home, "run");
  const kernel = createKernelService({ home, endpoint, stateDirectory, adapters: [] });
  await kernel.initialize();
  const close = net.Server.prototype.close;
  const denied = Object.assign(new Error("TEST_303_CLOSE_FAILED"), { code: "EIO" });
  t.mock.method(net.Server.prototype, "close", function (callback) {
    const target = this.address() === endpoint;
    // 实际监听先关闭，再注入回调失败；不以退出宿主或强退资源掩盖 incomplete。
    return Reflect.apply(close, this, [
      (error) => callback(error ?? (target ? denied : undefined))
    ]);
  });
  const result = await kernel.close();
  assert.equal(result.complete, false);
  assert.equal(await kernel.closed, result);
  assert.equal(
    (await inspectOrphanCleanup(join(stateDirectory, "kernel-invocations.json"))).state,
    "cleanup_incomplete"
  );
  t.mock.restoreAll();
  const client = own(attachKernel({ endpoint }));
  await assert.rejects(client.status());
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
  "Windows native IPC accepts a Home longer than 260 UTF-16 units without relocation",
  { skip: process.platform !== "win32" ? "Windows path/pipe check" : false },
  async (t) => {
    const { home, own } = await fixture(t);
    const longHome = join(home, ...Array.from({ length: 4 }, (_, i) => `${i}-` + "h".repeat(60)));
    await mkdir(longHome, { recursive: true });
    assert.ok(longHome.length > 260);
    const endpoint = componentEndpoint(longHome);
    const kernel = createKernelService({
      home: longHome,
      endpoint,
      adapters: [],
      stateDirectory: join(longHome, "run")
    });
    own(kernel);
    await kernel.initialize();
    assert.equal((await kernel.status()).endpoint, endpoint);
    assert.equal((await kernel.client.status()).execution_ready, true);
    assert.equal((await kernel.close()).complete, true);
    await missing(join(longHome, "executor-kernel.sock"));
  }
);

test(
  "POSIX real bind: old live Kernel blocks new; stop then upgrade; old cannot restart beside new",
  { skip: process.platform === "win32" ? "No POSIX socket transport on this Windows host" : false },
  async (t) => {
    const { home, endpoint, legacy, own } = await fixture(t);
    const old = createKernelService({ home, endpoint: legacy, adapters: [] });
    own(old);
    await old.initialize();
    const next = own(createKernelService({ home, endpoint, adapters: [] }));
    await assert.rejects(
      next.initialize(),
      (error) => error.cause.code === "KERNEL_ENDPOINT_UPGRADE_REQUIRED"
    );
    assert.equal((await old.client.status()).execution_ready, true);
    assert.equal((await old.close()).complete, true);
    const upgraded = createKernelService({ home, endpoint, adapters: [] });
    own(upgraded);
    await upgraded.initialize();
    await missing(legacy);
    await assert.rejects(acquireEndpoint(legacy), /ENDPOINT_IN_USE/);
    assert.equal((await upgraded.close()).complete, true);
  }
);

// 平台测量在上一项覆盖；下面真实长度 bind 只能由实际 Unix 执行环境证明。
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

for (const matchingOwner of [false, true]) {
  test(
    `POSIX real stale socket: requires matching canonical ownership (${matchingOwner})`,
    {
      skip: process.platform === "win32" ? "Actual POSIX pathname socket required" : false
    },
    async (t) => {
      const { home, endpoint, own } = await fixture(t);
      const child = spawn(
        process.execPath,
        [
          "-e",
          'require("node:net").createServer().listen(process.argv[1], () => process.exit(0))',
          endpoint
        ],
        { windowsHide: true, stdio: "ignore" }
      );
      const [code] = await once(child, "exit");
      assert.equal(code, 0);
      const original = await lstat(endpoint);
      assert.equal(original.isSocket(), true);
      if (matchingOwner)
        await writeFile(
          `${endpoint}.owner`,
          JSON.stringify({ pid: child.pid, nonce: randomUUID(), kernelEndpoint: endpoint })
        );
      const service = own(createKernelService({ home, endpoint, adapters: [] }));
      if (matchingOwner) {
        await service.initialize();
        assert.equal((await service.client.status()).execution_ready, true);
        assert.equal((await service.close()).complete, true);
      } else {
        await assert.rejects(
          service.initialize(),
          (error) => error.cause.message === "ENDPOINT_OWNER_MISSING" && error.cleanup.complete
        );
        assert.equal((await lstat(endpoint)).ino, original.ino);
        await missing(`${endpoint}.owner`);
      }
    }
  );
}

test(
  "POSIX real close preserves a replacement file created after the socket was closed",
  {
    skip: process.platform === "win32" ? "Actual POSIX pathname socket required" : false
  },
  async (t) => {
    const { home, endpoint, own } = await fixture(t);
    const service = own(createKernelService({ home, endpoint, adapters: [] }));
    await service.initialize();
    const close = net.Server.prototype.close;
    t.mock.method(net.Server.prototype, "close", function (callback) {
      const target = this.address() === endpoint;
      return Reflect.apply(close, this, [
        (error) => {
          if (!target || error) return callback(error);
          void writeFile(endpoint, "fixture-owned-replacement", { flag: "wx" }).then(
            () => callback(),
            callback
          );
        }
      ]);
    });
    assert.equal((await service.close()).complete, true);
    assert.equal(await readFile(endpoint, "utf8"), "fixture-owned-replacement");
  }
);

test(
  "POSIX real unlink denial reports incomplete even when server close callback succeeds",
  {
    skip:
      process.platform === "win32"
        ? "Actual POSIX pathname socket required"
        : process.getuid?.() === 0
          ? "Requires an ordinary POSIX user"
          : false
  },
  async (t) => {
    const home = await mkdtemp("/tmp/k303-denied-");
    const endpoint = componentEndpoint(home);
    let service;
    t.after(async () => {
      await chmod(home, 0o700);
      await service?.close();
      // 先确认真实监听已关闭；只在此之后清理测试自己留下的 socket/租约证据。
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(endpoint);
        socket.once("connect", () => {
          socket.destroy();
          reject(new Error("FIXTURE_ENDPOINT_STILL_LISTENING"));
        });
        socket.once("error", (error) => {
          socket.destroy();
          if (["ENOENT", "ECONNREFUSED"].includes(error.code)) resolve();
          else reject(error);
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error("FIXTURE_ENDPOINT_UNVERIFIABLE"));
        });
      });
      await rm(home, { recursive: true, force: true });
    });
    service = createKernelService({
      home,
      endpoint,
      adapters: [],
      stateDirectory: join(home, "run")
    });
    await service.initialize();
    await chmod(home, 0o500);
    try {
      await writeFile(join(home, "permission-probe"), "fixture", { flag: "wx" });
      t.skip("Filesystem did not deny directory writes; permission precondition unavailable");
      return;
    } catch (error) {
      if (error.code !== "EACCES") throw error;
    }
    const cleanup = await service.close();
    assert.equal(cleanup.complete, false);
    assert.equal((await lstat(endpoint)).isSocket(), true);
    assert.equal(
      (await inspectOrphanCleanup(join(home, "run", "kernel-invocations.json"))).state,
      "cleanup_incomplete"
    );
  }
);
