import assert from "node:assert/strict";
import test from "node:test";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  invocationEnvironment,
  invocationMcpServers,
  processEnvironmentValue,
  probeCommand
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { buildClaudeCommand } from "../packages/octo-runtime-adapter-claude-code/dist/index.js";
import { buildCodexCommand } from "../packages/octo-runtime-adapter-codex/dist/index.js";
import { buildOpenCodeCommand } from "../packages/octo-runtime-adapter-opencode/dist/index.js";
import { buildZcodeCommand } from "../packages/octo-runtime-adapter-zcode-gui/dist/index.js";
import { resolveDshLaunch } from "../packages/octo-runtime-adapter-dsh/dist/launch.js";
import { spawnAcpClient } from "../packages/octo-runtime-acp-client/dist/index.js";
import { spawnGrokBuildAcpClient } from "../packages/octo-runtime-adapter-grok-build/dist/client.js";
import {
  InvocationManifest,
  acknowledgeOrphanCleanup,
  inspectOrphanCleanup,
  reapOrphanedInvocationManifest,
  processStartIdentity
} from "../packages/octo-runtime-executor-kernel/dist/invocation-manifest.js";
import { WindowsUserTaskBackend } from "../packages/octo-runtime-cross-service/dist/index.js";
import { runCli } from "../apps/cli/dist/main.js";
import { invokeRequest } from "./runtime-fixture.js";

const payload = (values) => ({
  env_variables: Object.entries(values).map(([key, value]) => ({ key, value }))
});
const request = (values, items = []) =>
  invokeRequest({
    context: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "envs", payload: payload(values) }, ...items]
    }
  });

test("environment consumers share platform key identity without reading inherited properties", (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  t.after(() => Object.defineProperty(process, "platform", platform));
  const env = Object.assign(Object.create({ inherited: "hidden" }), {
    Path: "native",
    path: "override"
  });
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  assert.equal(processEnvironmentValue(env, "PATH"), "override");
  assert.equal(processEnvironmentValue(env, "inherited"), undefined);
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  assert.equal(processEnvironmentValue(env, "PATH"), undefined);
  assert.equal(processEnvironmentValue(env, "Path"), "native");
});

for (const platform of ["win32", "linux"]) {
  test(`${platform} Codex preserves the selected home without adding Windows aliases`, () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...original, value: platform });
    try {
      const context = join(tmpdir(), "context codex");
      const override = join(tmpdir(), "override codex");
      const req = request({ CODEX_HOME: context });
      req.executionEnvOverrides = payload({ codex_home: override });
      const command = buildCodexCommand(req, process.execPath, [], {});
      assert.equal(command.env.CODEX_HOME, platform === "win32" ? override : context);
      assert.equal(
        Object.keys(command.env).filter((key) => key.toUpperCase() === "CODEX_HOME").length,
        platform === "win32" ? 1 : 2
      );
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  test(`${platform} OpenCode preserves inline configuration across environment aliases`, async (t) => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...original, value: platform });
    t.after(() => Object.defineProperty(process, "platform", original));
    const config = (label) => ({
      instructions: [`${label}.md`],
      provider: { sample: { name: label } },
      mcp: { servers: { sample: { type: "remote", url: `https://example.invalid/${label}` } } }
    });
    const req = request({ OPENCODE_CONFIG_CONTENT: JSON.stringify(config("context")) });
    req.approvalMode = "full_access";
    req.controlInstructions = "Runtime instructions";
    req.executionEnvOverrides = payload({
      opencode_config_content: JSON.stringify(config("override"))
    });
    const before = structuredClone(req);
    const command = await buildOpenCodeCommand(req);
    t.after(() => command.cleanup());
    const actual = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT);
    const expected = config(platform === "win32" ? "override" : "context");
    assert.deepEqual(actual.provider, expected.provider);
    assert.deepEqual(actual.mcp, expected.mcp);
    assert.equal(actual.instructions[0], expected.instructions[0]);
    assert.equal(actual.instructions.length, 2);
    assert.equal(await readFile(actual.instructions[1], "utf8"), "Runtime instructions");
    assert.deepEqual(req, before);

    req.executionEnvOverrides = payload({ opencode_config_content: "invalid-json" });
    if (platform === "win32")
      await assert.rejects(buildOpenCodeCommand(req), /OPENCODE_CONFIG_INVALID/);
    else {
      const exact = await buildOpenCodeCommand(req);
      await exact.cleanup();
    }
  });

  test(`${platform} ZCode preserves explicit desktop selection across environment aliases`, () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { ...original, value: platform });
    try {
      const context = join(tmpdir(), "context desktop", "zcode.cjs");
      const override = join(tmpdir(), "override desktop", "zcode.cjs");
      const req = request({ ZCODE_BIN: context });
      req.executionEnvOverrides = payload({ zcode_bin: override });
      const before = structuredClone(req);
      const command = buildZcodeCommand(req);
      assert.equal(command.command, process.execPath);
      assert.equal(command.args[0], platform === "win32" ? override : context);
      assert.deepEqual(req, before);
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
}

test(
  "native Windows ZCode discovers Desktop through a mixed-case LOCALAPPDATA override",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "octo-zcode-review-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, "Programs", "ZCode", "resources", "glm", "zcode.cjs");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "// fixture\n");
    const req = request({ ZCODE_BIN: "", PATH: "", LOCALAPPDATA: join(directory, "missing") });
    req.executionEnvOverrides = payload({ localappdata: directory });
    const command = buildZcodeCommand(req);
    assert.equal(command.command, process.execPath);
    assert.equal(command.args[0], entry);
  }
);

test(
  "native Windows MCP, Claude, shared probe and DSH consume mixed-case overrides",
  { skip: process.platform !== "win32" },
  async () => {
    const req = request({ OCTO_CASE_URL: "https://example.invalid/mcp" }, [
      {
        namespace: "octo.execution",
        name: "mcp",
        payload: { mcpServers: { sample: { type: "streamable_http", url: "${OCTO_CASE_URL}" } } }
      }
    ]);
    req.executionEnvOverrides = payload({ octo_case_url: "https://example.invalid/mcp" });
    assert.equal(invocationMcpServers(req).sample.url, "https://example.invalid/mcp");
    const command = await buildClaudeCommand(req);
    await command.cleanup();
    const env = invocationEnvironment(
      request({ path: dirname(process.execPath), pathext: ".EXE" }),
      {},
      { PATH: "missing", PATHEXT: ".WRONG" }
    );
    assert.equal((await probeCommand(basename(process.execPath, ".exe"), { env })).available, true);
    const launch = await resolveDshLaunch(
      {
        command: basename(process.execPath, ".exe"),
        args: [fileURLToPath(new URL("./fixtures/dsh-runtime.mjs", import.meta.url))]
      },
      env
    );
    assert.equal(launch.command.toLowerCase(), process.execPath.toLowerCase());
  }
);

for (const [name, spawn] of [
  ["ACP", spawnAcpClient],
  ["Grok", spawnGrokBuildAcpClient]
]) {
  test(
    `native Windows ${name} final spawn preserves mixed-case override precedence`,
    { skip: process.platform !== "win32" },
    async (t) => {
      const key = "OCTO_REVIEW_CASE";
      const before = process.env[key];
      process.env[key] = "inherited";
      t.after(() => {
        if (before === undefined) delete process.env[key];
        else process.env[key] = before;
      });
      const env = invocationEnvironment(request({ octo_review_case: "invocation" }));
      const client = spawn({
        command: process.execPath,
        args: [
          "-e",
          `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id!==undefined) console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{value:process.env.OCTO_REVIEW_CASE}}));})`
        ],
        env
      });
      t.after(() => client.close());
      assert.deepEqual(await client.initialize(), { value: "invocation" });
      await client.close();
    }
  );
}

async function incompleteFixture(t) {
  const home = await mkdtemp(join(tmpdir(), "octo-review-recovery-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "run", "kernel-invocations.json");
  await mkdir(dirname(path));
  const manifest = {
    schemaVersion: 1,
    kernelPid: 2147483646,
    worker: { pid: 2147483645, started: "windows:100", entrypoint: "fixture" },
    invocations: [],
    cleanupIncomplete: true
  };
  await writeFile(path, JSON.stringify(manifest));
  return { home, path, manifest };
}

test("explicit orphan recovery keeps evidence, rejects a live owner and permits the next startup", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  manifest.kernelPid = process.pid;
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  manifest.kernelPid = 2147483646;
  manifest.worker.pid = process.pid;
  manifest.worker.started = await processStartIdentity(process.pid);
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(acknowledgeOrphanCleanup(path), /ORPHAN_CLEANUP_OWNER_ALIVE/);
  manifest.worker.pid = 2147483645;
  manifest.worker.started = "windows:100";
  await writeFile(path, JSON.stringify(manifest));
  const source = await readFile(path, "utf8");
  const recovery = await acknowledgeOrphanCleanup(path);
  assert.equal(await readFile(recovery.archivePath, "utf8"), source);
  assert.equal(await readFile(path, "utf8"), source);
  assert.equal((await inspectOrphanCleanup(path)).state, "acknowledged");
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const { manifest: opened, reap } = await InvocationManifest.open(path);
  assert.equal(reap.reason, "cleanup_acknowledged");
  assert.equal(reap.reaped, false, "operator acknowledgement is not verified tree cleanup");
  await assert.rejects(readFile(`${path}.acknowledgement`), { code: "ENOENT" });
  await writeFile(`${path}.acknowledgement`, "stale confirmation");
  await opened.close();
  await assert.rejects(readFile(`${path}.acknowledgement`), { code: "ENOENT" });
  assert.equal(await readFile(recovery.archivePath, "utf8"), source);
});

test("reaping removes stale confirmation but preserves its original evidence archive", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  const source = await readFile(path, "utf8");
  const { archivePath } = await acknowledgeOrphanCleanup(path);
  delete manifest.cleanupIncomplete;
  await writeFile(path, JSON.stringify(manifest));
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "host_missing");
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await assert.rejects(readFile(`${path}.acknowledgement`), { code: "ENOENT" });
  assert.equal(await readFile(archivePath, "utf8"), source);
});

test("unremovable stale confirmation does not block a new manifest or clean close", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  delete manifest.cleanupIncomplete;
  await writeFile(path, JSON.stringify(manifest));
  await mkdir(`${path}.acknowledgement`);
  const { manifest: opened } = await InvocationManifest.open(path);
  assert.equal((await inspectOrphanCleanup(path)).state, "available");
  await opened.close();
  assert.equal((await inspectOrphanCleanup(path)).state, "missing");
});

test("acknowledgement requires the same manifest and an intact evidence archive", async (t) => {
  const { path, manifest } = await incompleteFixture(t);
  const { archivePath } = await acknowledgeOrphanCleanup(path);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  await writeFile(archivePath, "changed");
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
  await writeFile(archivePath, JSON.stringify(manifest));
  await writeFile(path, JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }));
  await assert.rejects(InvocationManifest.open(path), { code: "ORPHAN_CLEANUP_INCOMPLETE" });
});

test("Windows incomplete evidence does not introduce a POSIX startup latch", async (t) => {
  const { path } = await incompleteFixture(t);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  assert.equal((await reapOrphanedInvocationManifest(path)).reason, "host_missing");
});

test("CLI recover requires acknowledgement and doctor exposes the manifest path", async (t) => {
  const { home, path } = await incompleteFixture(t);
  const modules = join(home, "module-selection.json");
  const moduleSource = await readFile(new URL("../apps/cli/dist/manifest.json", import.meta.url));
  await writeFile(modules, moduleSource);
  let output = "";
  const capture = {
    output: (value) => {
      output = value;
    }
  };
  assert.equal(await runCli(["executor-kernel", "recover", "--home", home, "--json"], capture), 2);
  const backend = {
    kind: "windows-user-task",
    probe: async () => ({ manager: "windows-user-task", supported: true }),
    inspect: async () => ({
      manager: "windows-user-task",
      state: "not_installed",
      enabled: false,
      drift: []
    })
  };
  for (const args of [["--help"], ["executor-kernel", "--help"]]) {
    assert.equal(await runCli(args, capture), 0);
    assert.match(output, /--manifest selects Provider\/Extra modules/);
    assert.match(output, /invocation state stays in --home\/run/);
  }
  assert.equal(
    await runCli(["doctor", "--home", home, "--manifest", modules, "--json"], {
      ...capture,
      backend
    }),
    0
  );
  assert.equal(JSON.parse(output).recovery.manifestPath, path);
  assert.equal(JSON.parse(output).recovery.state, "cleanup_incomplete");
  assert.equal(
    await runCli(
      [
        "executor-kernel",
        "recover",
        "--acknowledge-orphan-cleanup",
        "--home",
        home,
        "--manifest",
        modules,
        "--json"
      ],
      capture
    ),
    0
  );
  const recovery = JSON.parse(output);
  assert.equal(recovery.manifestPath, path);
  assert.equal(JSON.parse(await readFile(recovery.archivePath, "utf8")).cleanupIncomplete, true);
  assert.deepEqual(await readFile(modules), moduleSource);
  await assert.rejects(readFile(`${modules}.acknowledgement`), { code: "ENOENT" });
});

for (const [matches, actual, expectedState] of [
  [null, "alice", "unknown"],
  [null, "DOMAIN\\alice", "stopped"],
  [false, "DOMAIN\\alice", "stopped"]
]) {
  test(`Windows SID result ${matches} with ${actual} distinguishes unknown from mismatch`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "octo-sid-review-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const spec = {
      id: "octo-review-sid",
      command: "C:\\node\\node.exe",
      args: [],
      workingDirectory: "C:\\home",
      enabled: true
    };
    const runner = {
      async run(command, args) {
        return {
          command,
          args,
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify(
            args.at(-1)?.includes("Schedule.Service")
              ? { exists: true }
              : {
                  state: "Ready",
                  enabled: true,
                  execute: spec.command,
                  arguments: "",
                  working_directory: spec.workingDirectory,
                  principal_user_id: actual,
                  principal_user_matches: matches,
                  principal_logon_type: "Interactive",
                  trigger_user_id: actual,
                  trigger_user_matches: matches
                }
          )
        };
      }
    };
    const backend = new WindowsUserTaskBackend({
      platform: "win32",
      runner,
      homeDirectory: directory,
      windowsUserId: "DOMAIN\\alice",
      windowsDefinitionDirectory: directory
    });
    await backend.install(spec);
    const status = await backend.inspect(spec);
    assert.equal(status.state, expectedState);
    assert.equal(status.drift.includes("manager.principal_user"), matches === false);
    if (expectedState === "unknown") {
      assert.match(status.detail, /identity could not be resolved/);
      await assert.rejects(backend.start(spec), { code: "MANAGER_UNAVAILABLE" });
    }
  });
}
