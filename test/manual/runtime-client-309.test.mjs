import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import net from "node:net";
import test from "node:test";
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const version = process.env.OCTO_CLIENT_TEST_VERSION ?? "0.0.309";
const archive = (suffix = "") =>
  join(root, `dist/release/mininglamp-oss-octo-runtime${suffix}-${version}.tgz`);
const npm = join(
  dirname(process.execPath),
  process.platform === "win32"
    ? "node_modules/npm/bin/npm-cli.js"
    : "../lib/node_modules/npm/bin/npm-cli.js"
);
const pnpm = process.env.npm_execpath?.includes("pnpm")
  ? process.env.npm_execpath
  : join(dirname(process.execPath), "pnpm");
const run = (command, args, cwd) =>
  execute(command, args, {
    cwd,
    env: { ...process.env, NODE_PATH: "" },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  });

async function directory(t) {
  const path = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc309-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, "package.json"), '{"private":true,"type":"module"}\n');
  return path;
}

async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(target)));
    else if (entry.isFile()) result.push(target);
    else assert.fail(`Unexpected link in artifact: ${target}`);
  }
  return result;
}

test("client artifact contains only its implementation/protocol, without server declaration dependencies", async (t) => {
  const path = await directory(t);
  await run("tar", ["-xzf", archive("-client"), "-C", path], path);
  const content = await files(join(path, "package"));
  const manifest = JSON.parse(await readFile(join(path, "package/package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies), ["@mininglamp-oss/octo-runtime-protocol"]);
  assert.deepEqual(manifest.bundleDependencies, ["@mininglamp-oss/octo-runtime-protocol"]);
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.bin, undefined);
  assert.equal(manifest.version, version);
  const targets = (value) =>
    typeof value === "string" ? [value] : Object.values(value).flatMap(targets);
  for (const target of targets(manifest.exports))
    assert.ok((await stat(join(path, "package", target))).isFile(), target);
  for (const name of ["protocol.schema.json", "kernel-ipc.schema.json"]) {
    assert.deepEqual(
      await readFile(join(path, "package/schema", name)),
      await readFile(join(root, "packages/octo-runtime-protocol/schema", name))
    );
  }
  assert.deepEqual(
    await readFile(join(path, "package/fixtures/kernel-ipc-fixtures.json")),
    await readFile(
      join(root, "packages/octo-runtime-protocol/test/fixtures/kernel-ipc-fixtures.json")
    )
  );
  const fullMetadata = await run(
    "tar",
    ["-xOf", archive(), "package/apps/cli/dist/build-info.json"],
    path
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(path, "package/build-info.json"), "utf8")),
    JSON.parse(fullMetadata.stdout)
  );
  for (const file of content) {
    assert.doesNotMatch(file, /octo-runtime-(?:executor|host-sdk|adapter|extra)|\/apps\//);
    if (/\.(?:js|ts)$/.test(file)) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(
        source,
        /@mininglamp-oss\/octo-runtime(?:-executor|-host-sdk|-adapter|-extra|["/])/
      );
    }
  }
  let unpackedBytes = 0;
  for (const file of content) unpackedBytes += (await stat(file)).size;
  console.log(
    JSON.stringify({
      artifact: "client",
      compressedBytes: (await stat(archive("-client"))).size,
      unpackedBytes,
      files: content.length,
      dependencies: manifest.dependencies
    })
  );
});

for (const manager of ["npm", "pnpm"]) {
  test(
    `${manager}: client-only offline install, then dual install with public types and native services`,
    { timeout: 180_000 },
    async (t) => {
      const path = await directory(t);
      const install = async (archives) => {
        const args =
          manager === "npm"
            ? [
                npm,
                "install",
                ...archives,
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--cache",
                join(path, "empty-cache")
              ]
            : [
                pnpm,
                "add",
                ...archives,
                "--offline",
                "--ignore-scripts",
                "--store-dir",
                join(path, "empty-store"),
                "--config.manage-package-manager-versions=false"
              ];
        await run(process.execPath, args, path);
      };
      await install([archive("-client")]);
      await assert.rejects(stat(join(path, "node_modules/@mininglamp-oss/octo-runtime")), {
        code: "ENOENT"
      });
      await cp(
        join(import.meta.dirname, "fixtures/client-consumer-309.mjs"),
        join(path, "consumer.mjs")
      );
      const { endpoint } = await kernelFixture(t);
      const input = join(path, "input.json");
      await writeFile(input, JSON.stringify(kernelInput("external client")));
      await run(process.execPath, ["consumer.mjs", endpoint, input], path);
      await cp(
        join(import.meta.dirname, "fixtures/client-types-309.mts"),
        join(path, "client.mts")
      );
      const typecheck = (file) =>
        run(
          process.execPath,
          [
            join(root, "node_modules/typescript/bin/tsc"),
            file,
            "--noEmit",
            "--strict",
            "--skipLibCheck",
            "false",
            "--module",
            "NodeNext",
            "--target",
            "ES2022",
            "--types",
            "node",
            "--typeRoots",
            join(root, "node_modules/@types")
          ],
          path
        );
      await typecheck("client.mts");
      await install([archive()]);
      await cp(join(root, "test/fixtures/invoke-adapter.js"), join(path, "adapter.mjs"));
      await cp(
        join(import.meta.dirname, "fixtures/client-paired-types-309.mts"),
        join(path, "paired.mts")
      );
      await typecheck("paired.mts");
      await run(process.execPath, ["consumer.mjs", endpoint, input, "--paired"], path);
    }
  );
}

test(
  "standalone artifact rejects the pre-IPC-v2 de3ff37a Kernel without execution",
  { timeout: 180_000 },
  async (t) => {
    const path = await mkdtemp(
      join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc309-base-")
    );
    let service;
    t.after(async () => {
      if (service)
        assert.equal(
          (await service.close()).complete,
          true,
          `Cleanup incomplete; preserved ${path}`
        );
      await rm(path, { recursive: true, force: true });
    });
    const baseline = "de3ff37a86ee3cb8f6ab66148ceca817f6ae5240";
    const names = ["protocol", "adapter-sdk", "executor-core", "executor-kernel"];
    const source = join(path, "baseline");
    await mkdir(source);
    await run(
      "git",
      [
        "archive",
        "--format=tar",
        "--output",
        join(path, "baseline.tar"),
        baseline,
        "tsconfig.base.json",
        "test/fixtures/test-adapter.js",
        ...names.map((name) => `packages/octo-runtime-${name}`)
      ],
      root
    );
    await run("tar", ["-xf", join(path, "baseline.tar"), "-C", source], path);
    await mkdir(join(source, "node_modules/@mininglamp-oss"), { recursive: true });
    await writeFile(join(source, "package.json"), '{"type":"module"}');
    await symlink(join(root, "node_modules/@types"), join(source, "node_modules/@types"), "dir");
    await symlink(
      await realpath(
        join(root, "packages/octo-runtime-adapter-sdk/node_modules/import-meta-resolve")
      ),
      join(source, "node_modules/import-meta-resolve"),
      "dir"
    );
    for (const name of names)
      await symlink(
        join(source, `packages/octo-runtime-${name}`),
        join(source, `node_modules/@mininglamp-oss/octo-runtime-${name}`),
        "dir"
      );
    for (const name of names)
      await run(
        process.execPath,
        [
          join(root, "node_modules/typescript/bin/tsc"),
          "-p",
          join(source, `packages/octo-runtime-${name}/tsconfig.json`)
        ],
        source
      );
    const { createKernelService } = await import(
      pathToFileURL(join(source, "packages/octo-runtime-executor-kernel/dist/index.js"))
    );
    const { testAdapter } = await import(
      pathToFileURL(join(source, "test/fixtures/test-adapter.js"))
    );
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\oc309-baseline-${process.pid}`
        : join(path, "baseline.sock");
    let invocations = 0;
    service = createKernelService({
      home: path,
      endpoint,
      adapters: [
        {
          ...testAdapter,
          invoke: (...args) => {
            invocations += 1;
            return testAdapter.invoke(...args);
          }
        }
      ]
    });
    await service.initialize();
    await run(
      process.execPath,
      [
        npm,
        "install",
        archive("-client"),
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--cache",
        join(path, "empty-cache")
      ],
      path
    );
    await cp(
      join(import.meta.dirname, "fixtures/client-consumer-309.mjs"),
      join(path, "consumer.mjs")
    );
    await writeFile(join(path, "input.json"), JSON.stringify(kernelInput("baseline server")));
    await run(
      process.execPath,
      ["consumer.mjs", endpoint, join(path, "input.json"), "--expect-unsupported-ipc"],
      path
    );
    const oldStatus = await service.client.status();
    assert.equal(oldStatus.ipc_version, 1);
    assert.equal(oldStatus.execution_ready, true);
    assert.equal(invocations, 0);
  }
);

const serviceProcess = {
  scope_id: "fixture-scope",
  service_id: "fixture-service",
  incarnation: 1,
  provider: "codex",
  owner_pid: process.pid,
  pid: process.pid,
  state: "ready",
  observation: "alive",
  ownership: "owned"
};
const statusCases = [
  {
    name: "unsupported IPC version",
    status: { ipc_version: 1 },
    code: "KERNEL_IPC_VERSION_UNSUPPORTED"
  },
  { name: "missing IPC version", status: { ipc_version: undefined }, code: "INVALID_RESPONSE" },
  { name: "legacy status without service snapshots", status: {} },
  { name: "valid service snapshots", status: { service_processes: [serviceProcess] } },
  {
    name: "service snapshot with unapproved fields",
    status: { service_processes: [{ ...serviceProcess, argv: ["unexpected"] }] },
    code: "INVALID_RESPONSE"
  },
  {
    name: "invalid service snapshot owner PID",
    status: { service_processes: [{ ...serviceProcess, owner_pid: 0 }] },
    code: "INVALID_RESPONSE"
  },
  {
    name: "too many service snapshots",
    status: { service_processes: Array(257).fill(serviceProcess) },
    code: "INVALID_RESPONSE"
  }
];
for (const [index, scenario] of statusCases.entries()) {
  test(`client status: ${scenario.name}`, async (t) => {
    const path = await directory(t);
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\oc309-${process.pid}-${index}`
        : join(path, "k.sock");
    const status = {
      ipc_version: 2,
      kernel_instance_id: "fixture",
      pid: process.pid,
      execution_ready: true,
      ...scenario.status
    };
    const methods = [];
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let pending = "";
      socket.on("data", (chunk) => {
        pending += chunk;
        if (!pending.includes("\n")) return;
        const request = JSON.parse(pending.split("\n")[0]);
        methods.push(request.method);
        socket.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: status
          }) + "\n"
        );
      });
    });
    await new Promise((resolveListen, reject) =>
      server.once("error", reject).listen(endpoint, resolveListen)
    );
    const client = attachKernel({ endpoint });
    t.after(async () => {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((close) => server.close(close));
    });
    if (scenario.code) await assert.rejects(client.submit(kernelInput()), { code: scenario.code });
    else assert.deepEqual(await client.status(), status);
    assert.deepEqual(methods, ["status"]);
  });
}
