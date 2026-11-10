import { resolveHostProviderLaunch } from "@mininglamp-oss/octo-runtime-adapter-sdk/process-launch";
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeCommand, withAgentEnvItems } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import { createManagedCodexEngine } from "@mininglamp-oss/octo-runtime-adapter-codex";
import {
  createCliOpenCodeAdapter,
  createCliClaudeCodeAdapter
} from "../../apps/cli/dist/providers.js";
import { cliProviderLaunch } from "../../apps/cli/dist/provider-launch.js";
import { loadCliAdapters } from "../../apps/cli/dist/adapters.js";
import { invokeRequest, preparedFrames } from "../runtime-fixture.js";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { assertCanonicalEvent, canonicalEvents } from "@mininglamp-oss/octo-runtime-protocol";

// 显式手动专项：隔离安装、轨迹和请求环境，不修改宿主 PATH 或默认测试选择范围。
const posix = { skip: process.platform === "win32" };
const fixture = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const send = value => console.log(JSON.stringify(value));
appendFileSync(process.env.TRACE, JSON.stringify({argv:process.argv.slice(2), marker:process.env.MARKER, path:process.env.PATH, config:process.env.OPENCODE_CONFIG_CONTENT})+'\\n');
if(process.argv.includes('--version')) { console.log('2.1.3'); process.exit(0); }
if(process.argv.includes('run')) {
 process.stdin.resume(); process.stdin.on('end', () => {
  send({type:'text', sessionID:'bound',part:{type:'text',id:'text',text:'BOUND_A'}});
  send({type:'step_finish',part:{type:'step-finish',reason:'stop',tokens:{input:1,output:1}}});
 });
} else createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.method || m.id===undefined) return;
 if(m.method==='session/prompt') {
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'bound',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'BOUND_A'}}}});
  send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}});
 } else send({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:1,agentCapabilities:{}}:m.method==='session/new'?{sessionId:'bound'}:{}});
});
`;
async function installation(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "octo346-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, "A"),
    b = join(root, "B");
  await mkdir(a);
  await mkdir(b);
  const entry = join(a, "provider.mjs"),
    trace = join(root, "trace.ndjson");
  await writeFile(entry, fixture);
  await chmod(entry, 0o700);
  await symlink(entry, join(a, "opencode"));
  await writeFile(join(b, "opencode"), "#!/bin/sh\nexit 99\n");
  await chmod(join(b, "opencode"), 0o700);
  const env = { ...process.env, PATH: [a, b].join(delimiter), TRACE: trace, MARKER: "HOST" };
  return { root, a, b, entry, trace, env };
}
function request(root, mode, b) {
  return invokeRequest({
    modelInput: "BOUND_A",
    executionEnvOverrides: {
      env_variables: [
        { key: "PATH", value: b },
        { key: "MARKER", value: "OVERRIDE" }
      ]
    },
    agentEnv: withAgentEnvItems(undefined, [
      { namespace: "octo.execution", name: "workspace", payload: { path: root } },
      { namespace: "octo.security", name: "approval_policy", payload: { mode } },
      {
        namespace: "octo.execution",
        name: "envs",
        payload: { env_variables: [{ key: "MARKER", value: "RUN" }] }
      }
    ])
  });
}

test("local SDK constructors reject absent, relative, bare and malformed bindings", async () => {
  for (const [pkg, name] of [
    ["opencode", "createOpenCodeAdapter"],
    ["claude-code", "createClaudeCodeAdapter"],
    ["codebuddy", "createCodeBuddyAdapter"],
    ["antigravity", "createAntigravityAdapter"],
    ["grok-build", "createGrokBuildAdapter"],
    ["hermes", "createHermesAdapter"],
    ["kimi-code", "createKimiCodeAdapter"],
    ["mcode", "createMcodeAdapter"],
    ["qodercli", "createQoderCliAdapter"],
    ["qoderclicn", "createQoderCliCnAdapter"]
  ]) {
    const factory = (await import(`@mininglamp-oss/octo-runtime-adapter-${pkg}`))[name];
    for (const command of [undefined, "", "provider", "./provider", "/bad\0path"])
      assert.throws(() => factory({ command }), /PROVIDER_LAUNCH_(REQUIRED|INVALID)/, name);
    assert.throws(
      () => factory({ command: process.execPath, commandArgsPrefix: ["bad\0arg"] }),
      /PROVIDER_LAUNCH_INVALID/
    );
  }
  assert.throws(
    () => createManagedCodexEngine({ codexHome: process.cwd() }),
    /PROVIDER_LAUNCH_REQUIRED/
  );
});

for (const mode of ["full_access", "ask"])
  test(
    `OpenCode ${mode} pins Node, entry and prefix across mutation and request PATH/cwd`,
    posix,
    async (t) => {
      const f = await installation(t);
      const launch = resolveHostProviderLaunch("opencode", {
        env: f.env,
        cwd: f.root,
        args: ["space 中文 ; $()"]
      });
      assert.equal(launch.command, process.execPath);
      assert.deepEqual(launch.args, [f.entry, "space 中文 ; $()"]);
      const options = {
        command: launch.command,
        commandArgsPrefix: [...launch.args],
        env: { ...launch.env }
      };
      const adapter = createOpenCodeAdapter(options);
      options.commandArgsPrefix[0] = "/missing";
      options.env.TRACE = "/missing";
      f.env.PATH = f.b;
      assert.equal((await adapter.probe()).version, "2.1.3");
      const events = await Array.fromAsync(
        adapter.invoke({ ...request(f.b, mode, f.b), sessionName: "bound session" })
      );
      events.forEach(assertCanonicalEvent);
      assert.equal(events.at(-1).type, "run.completed");
      assert.equal(events.find((e) => e.type === "message.delta").payload.text, "BOUND_A");
      const trace = (await readFile(f.trace, "utf8")).trim().split("\n").map(JSON.parse);
      assert.ok(trace.every((row) => row.argv[0] === "space 中文 ; $()"));
      const run = trace.find((row) => !row.argv.includes("--version"));
      assert.equal(run.marker, "OVERRIDE");
      assert.equal(run.path, f.b);
      assert.equal(typeof JSON.parse(run.config), "object");
      assert.ok(
        trace.filter((row) => row.argv.includes("--version")).every((row) => row.marker === "HOST")
      );
    }
  );

test(
  "selected installation removal, permission denial and invalid configuration never fall through",
  posix,
  async (t) => {
    const f = await installation(t);
    const launch = resolveHostProviderLaunch("opencode", { env: f.env, cwd: f.root });
    await chmod(f.entry, 0o600);
    assert.throws(() => resolveHostProviderLaunch("opencode", { env: f.env, cwd: f.root }), {
      code: "EACCES"
    });
    assert.equal((await probeCommand(f.entry, { env: f.env })).reason, "permission_denied");
    const denied = createCliOpenCodeAdapter({}, { env: f.env });
    assert.equal((await denied.probe()).command, join(f.a, "opencode"));
    await assert.rejects(Array.fromAsync(denied.invoke(request(f.root, "full_access", f.b))), {
      code: "EACCES"
    });
    await rm(f.entry);
    assert.throws(() => resolveHostProviderLaunch("opencode", { env: f.env, cwd: f.root }), {
      code: "ENOENT"
    });
    const adapter = createOpenCodeAdapter({
      command: launch.command,
      commandArgsPrefix: launch.args,
      env: launch.env
    });
    assert.equal((await adapter.probe()).available, true);
    // 通用探针不猜测 argv 中的 Node 入口；缺入口由实际执行结果报告。
    assert.deepEqual(await probeCommand(launch.command, { args: launch.args, env: launch.env }), {
      available: true,
      command: launch.command,
      version: null
    });
    const events = await Array.fromAsync(adapter.invoke(request(f.root, "full_access", f.b)));
    assert.equal(events.at(-1).type, "run.failed");
    assert.match(JSON.stringify(events), /Cannot find module/);
    for (const options of [
      { command: "" },
      { command: 42 },
      { commandArgsPrefix: [null] },
      { commandArgsPrefix: "bad" }
    ])
      assert.throws(() => cliProviderLaunch(options, f.env, "opencode"), /PROVIDER_LAUNCH_INVALID/);
    await assert.rejects(readFile(f.trace), { code: "ENOENT" });
  }
);

test("probe keeps real spawn system failures unavailable", posix, async () => {
  const probe = await probeCommand(process.execPath, { args: ["x".repeat(1024 * 1024)] });
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "command_launch_failed");
});

for (const [name, versionCode] of [
  ["nonzero exit", "process.exit(23)"],
  ["timeout", "setInterval(() => {}, 1000); await new Promise(() => {})"]
])
  test(
    `optional version ${name} preserves ACP availability and protocol execution`,
    posix,
    async (t) => {
      const f = await installation(t);
      await writeFile(
        f.entry,
        fixture.replace("console.log('2.1.3'); process.exit(0);", versionCode)
      );
      const launch = resolveHostProviderLaunch("opencode", { env: f.env, cwd: f.root });
      const adapter = createAcpAdapter(
        {
          type: "optional-version",
          provider: "fixture",
          command: launch.command,
          metadata: {
            type: "optional-version",

            protocolSupport: {
              protocol: "fixture.canonical",
              modes: ["canonical"],
              nativeMethods: []
            }
          }
        },
        { commandArgsPrefix: launch.args, env: launch.env }
      );
      const core = new AgentExecutor();
      core.register(adapter);
      try {
        const [description] = await core.describe();
        assert.equal(description.available, true);
        assert.equal(description.providerVersion, null);
        const events = await Array.fromAsync(
          canonicalEvents(
            preparedFrames(core, "optional-version", request(f.root, "full_access", f.b), {
              protocolMode: "canonical"
            })
          )
        );
        assert.ok(events.some((event) => event.type === "run.completed"));
        assert.match(JSON.stringify(events), /BOUND_A/);
      } finally {
        assert.equal((await core.shutdown()).cleanup, "complete");
      }
    }
  );

test("actmode verification startup uses factories and closes host-owned resources", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("../../scripts/verify-actmode-live.mjs", import.meta.url)),
      "--check-startup"
    ],
    { env: { ...process.env, PATH: "" }, timeout: 15_000 }
  );
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.cleanup, "complete");
  assert.deepEqual(receipt.adapters, [
    "claude-code",
    "codex",
    "grok-build",
    "kimi-code",
    "mcode",
    "opencode"
  ]);
});

test(
  "host pins extensionless Node scripts and accepts execute-only native binaries",
  posix,
  async (t) => {
    const f = await installation(t);
    const script = join(f.a, "no-extension");
    await writeFile(script, fixture);
    await chmod(script, 0o700);
    const launch = resolveHostProviderLaunch(script, { env: f.env, cwd: f.root });
    assert.equal(launch.command, process.execPath);
    assert.deepEqual(launch.args, [script]);
    assert.equal(
      (await probeCommand(launch.command, { args: launch.args, env: { ...launch.env, PATH: f.b } }))
        .version,
      "2.1.3"
    );
    const binary = join(f.a, "native");
    await copyFile("/bin/echo", binary);
    await chmod(binary, 0o111);
    const native = resolveHostProviderLaunch(binary, { env: f.env, cwd: f.root });
    assert.equal(native.command, binary);
    assert.deepEqual(native.args, []);
    await writeFile(script, "#!/usr/bin/env -S node --no-warnings\nconsole.log('ok')\n");
    assert.throws(
      () => resolveHostProviderLaunch(script, { env: f.env, cwd: f.root }),
      /inject Node and shebang arguments explicitly/
    );
  }
);

test("CLI resolves once and reuses static metadata when a provider is absent", posix, async (t) => {
  const f = await installation(t);
  const adapter = createCliOpenCodeAdapter({}, { env: f.env });
  f.env.PATH = f.b;
  assert.equal((await adapter.probe()).available, true);
  const missing = createCliOpenCodeAdapter({ command: join(f.root, "missing") }, { env: f.env });
  assert.equal(missing.metadata.type, adapter.metadata.type);
  assert.deepEqual(missing.metadata.protocolSupport, adapter.metadata.protocolSupport);
  assert.equal((await missing.probe()).reason, "command_not_found");
  assert.equal((await missing.probe()).command, join(f.root, "missing"));
  await assert.rejects(
    Array.fromAsync(missing.invoke(request(f.root, "full_access", f.b))),
    /command_not_found/
  );
  const manifest = JSON.parse(
    await readFile(new URL("../../apps/cli/dist/manifest.json", import.meta.url), "utf8")
  );
  const declarations = manifest.adapters
    .filter((row) => !["dsh", "openclaw"].includes(row.type))
    .map((row) => ({
      ...row,
      options: { command: join(f.root, "missing") },
      sourceManifest: fileURLToPath(new URL("../../apps/cli/dist/manifest.json", import.meta.url))
    }));
  const assembly = await loadCliAdapters(declarations);
  try {
    assert.equal(assembly.adapters.length, 11);
    for (const item of assembly.adapters) assert.equal((await item.probe()).available, false);
  } finally {
    assert.equal((await assembly.close(performance.now() + 2000)).complete, true);
  }
});

test("remote ACP factory uses opaque location and never performs a local probe", async () => {
  let created = 0,
    closed = 0;
  const adapter = createAcpAdapter(
    { type: "remote", provider: "remote", command: "container://chosen" },
    {
      acpClientFactory() {
        created++;
        return {
          initialize: () => Promise.resolve({ protocolVersion: 1 }),
          reserveRequestId: () => 1,
          request: () => Promise.resolve({ sessionId: "remote" }),
          async *prompt() {
            yield {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "REMOTE" }
            };
            yield { type: "prompt_result", stopReason: "end_turn" };
          },
          close: () => {
            if (!closed) closed++;
            return Promise.resolve();
          }
        };
      }
    }
  );
  assert.equal((await adapter.probe()).reason, "probe_missing");
  assert.equal(created, 0);
  const events = await Array.fromAsync(
    adapter.invoke(request(process.cwd(), "full_access", "/missing"))
  );
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(created, 1);
  assert.equal(closed, 1);
});

for (const protocolMode of ["canonical", "native"])
  for (const mode of ["ask", "full_access"])
    test(`missing CLI provider fails with complete Core cleanup: ${protocolMode}/${mode}`, async () => {
      const core = new AgentExecutor();
      const native = protocolMode === "native";
      core.register(
        (native ? createCliClaudeCodeAdapter : createCliOpenCodeAdapter)(
          { command: join(tmpdir(), "missing-346-provider") },
          { env: process.env }
        )
      );
      const frames = await Array.fromAsync(
        preparedFrames(
          core,
          native ? "claude-code" : "opencode",
          request(process.cwd(), mode, "/missing"),
          { protocolMode }
        )
      );
      assert.match(JSON.stringify(frames), native ? /command_not_found/ : /OH-ADP-3002/);
      assert.doesNotMatch(JSON.stringify(frames), /APPROVAL_MODE_UNSUPPORTED/);
      assert.equal((await core.shutdown({ timeoutMs: 1000 })).cleanup, "complete");
    });

test("Codex owner pins prefix and environment for probe and a shared process", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo346-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const wrapper = join(root, "codex.mjs"),
    log = join(root, "rpc.ndjson");
  const native = new URL("./fixtures/codex-single-343.mjs", import.meta.url).href;
  await writeFile(
    wrapper,
    `if(process.argv.includes('--version')) console.log('1.2.3'); else await import(${JSON.stringify(native)});`
  );
  const args = [wrapper],
    env = { ...process.env };
  const owner = createManagedCodexEngine({
    command: process.execPath,
    commandArgsPrefix: args,
    env,
    codexHome: root,
    appServerArgs: [log, "1"]
  });
  t.after(async () =>
    assert.equal((await owner.close({ deadline: performance.now() + 2000 })).complete, true)
  );
  args[0] = "/missing";
  env.PATH = "/missing";
  assert.equal((await owner.provider.probe()).version, "1.2.3");
  const first = await owner.provider.acquire(request(root, "full_access", "/missing"));
  const pid = owner.processes()[0].pid;
  await first.channel.close();
  const second = await owner.provider.acquire(request(root, "full_access", "/another"));
  assert.equal(owner.processes()[0].pid, pid);
  await second.channel.close();
});
