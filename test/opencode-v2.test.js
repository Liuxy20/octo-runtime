import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { resolveHostProviderLaunch } from "../packages/octo-runtime-adapter-sdk/dist/process-launch.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  chmod,
  rm,
  readFile,
  mkdir,
  link,
  copyFile,
  realpath
} from "node:fs/promises";
import { delimiter, join, parse, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  createOpenCodeAdapter,
  buildOpenCodeCommand,
  probeOpenCode,
  normalizeOpenCodeEvent
} from "@mininglamp-oss/octo-runtime-adapter-opencode";
import {
  AcpInvocationError,
  createAcpAdapter,
  normalizeAcpUpdate
} from "@mininglamp-oss/octo-runtime-adapter-acp";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest } from "./runtime-fixture.js";
// 实际子进程验证宿主选择、协议与可选版本展示，不安装或替换宿主 Provider。
async function executable(t, body) {
  const directory = await mkdtemp(join(tmpdir(), "octo-opencode-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, "opencode");
  await writeFile(command, `#!${process.execPath}\n${body}`);
  await chmod(command, 0o700);
  // fixture 宿主显式绑定 Node 与入口；协议测试不依赖 OS shebang 启动延迟。
  return {
    directory,
    command,
    options: { command: process.execPath, commandArgsPrefix: [command], env: { ...process.env } }
  };
}
const posix = { skip: process.platform === "win32" };
test("OpenCode only maps explicitly recognized tool terminal states", () => {
  for (const [status, expected] of [
    ["completed", "completed"],
    ["error", "failed"],
    ["pending", undefined],
    ["running", undefined],
    ["unknown-terminal", undefined],
    ["failed", undefined],
    [undefined, undefined]
  ]) {
    const events = normalizeOpenCodeEvent({
      type: "tool_use",
      part: { type: "tool", callID: "tool-status", tool: "shell", state: { status } }
    });
    const terminals = events.filter(
      (event) =>
        event.type === "tool_call.update" && ["completed", "failed"].includes(event.payload.status)
    );
    assert.deepEqual(
      terminals.map((event) => event.payload.status),
      expected ? [expected] : []
    );
  }
});
test("host selection uses platform PATH, extension and cwd before executable probing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-opencode-native-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  const filename = process.platform === "win32" ? "opencode.exe" : "opencode";
  const rootCommand = join(directory, filename);
  const binCommand = join(bin, filename);
  for (const target of [rootCommand, binCommand]) {
    if (process.platform === "win32") {
      try {
        await link(process.execPath, target);
      } catch (error) {
        if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
        await copyFile(process.execPath, target);
      }
    } else {
      // POSIX Node 可能依赖安装目录的动态库，保持原位置，由 fixture 的 shebang 调用。
      await writeFile(target, `#!${process.execPath}\nconsole.log(process.versions.node);\n`);
      await chmod(target, 0o700);
    }
  }
  const scenarios = [
    { entries: [bin], command: "opencode", expected: binCommand },
    { entries: ["bin"], command: "opencode", expected: binCommand },
    { entries: [""], command: "opencode", expected: rootCommand },
    { entries: [".", bin], command: "opencode", expected: rootCommand },
    { entries: [bin, "."], command: "opencode", expected: binCommand },
    { entries: [directory], command: join("bin", filename), expected: binCommand },
    { entries: [directory], command: binCommand, expected: binCommand }
  ];
  if (process.platform === "win32") {
    const root = parse(directory).root;
    scenarios.push(
      { entries: [bin.slice(root.length - 1)], command: "opencode", expected: binCommand },
      { entries: [bin], command: rootCommand.slice(root.length - 1), expected: rootCommand }
    );
    if (/^[A-Za-z]:\\$/.test(root))
      scenarios.push({
        entries: [bin],
        command: `${root.slice(0, 2)}${filename}`,
        expected: rootCommand
      });
  }
  for (const { entries, command, expected } of scenarios) {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !["PATH", "PATHEXT"].includes(key.toUpperCase())
      )
    );
    const variants = [{ ...inherited, PATH: entries.join(delimiter), PATHEXT: ".EXE" }];
    if (process.platform === "win32")
      variants.push(
        { ...inherited, Path: entries.join(delimiter), Pathext: ".EXE" },
        { ...inherited, pAtH: entries.join(delimiter), pAtHeXt: ".EXE" },
        {
          ...inherited,
          Path: join(directory, "missing"),
          PATH: entries.join(delimiter),
          Pathext: "",
          PATHEXT: ".EXE"
        }
      );
    for (const env of variants) {
      const original = Object.entries(env).filter(([key]) =>
        ["PATH", "PATHEXT"].includes(key.toUpperCase())
      );
      const launch = resolveHostProviderLaunch(command, { env, cwd: directory });
      const probe = await probeOpenCode(launch.command, launch.env, directory, launch.args);
      // PATHEXT 的大小写可与目录项不同；比较文件系统解析后的路径，仍校验目录选择。
      assert.equal(
        await realpath(process.platform === "win32" ? probe.command : launch.args[0]),
        await realpath(expected)
      );
      if (process.platform !== "win32") assert.equal(probe.command, process.execPath);
      assert.equal(probe.version, process.versions.node);
      // 探测只描述已选程序；版本号不证明协议兼容，也不作为准入名单。
      assert.equal(probe.available, true);
      assert.deepEqual(
        Object.entries(env).filter(([key]) => ["PATH", "PATHEXT"].includes(key.toUpperCase())),
        original
      );
    }
  }
  if (process.platform === "win32") {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !["PATH", "PATHEXT"].includes(key.toUpperCase())
      )
    );
    assert.throws(
      () =>
        resolveHostProviderLaunch("opencode", {
          env: { ...env, PATH: bin, Pathext: "" },
          cwd: directory
        }),
      { code: "ENOENT" }
    );
  }
});
for (const version of ["1.18.30", "2.0.0", "2.1.2", "2.1.3-beta", "3.0.0", "unparseable"]) {
  test(
    `OpenCode ${version} remains executable on both transports without invocation version checks`,
    posix,
    async (t) => {
      const fixture = await executable(
        t,
        `const fs=require('node:fs');
if(process.argv[2]==="--version"){
 fs.appendFileSync(require('node:path').join(__dirname,'version-calls'),'probe\\n');
 console.log(${JSON.stringify(version)});process.exit(0);
}
const send=value=>console.log(JSON.stringify(value));
if(process.argv.includes('run')) {
 process.stdin.resume();process.stdin.on('end',()=>{
  send({type:'text',part:{type:'text',text:'VERSION_INDEPENDENT'}});
 });
} else require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined||!m.method)return;
 if(m.method==='session/prompt'){
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'version-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'VERSION_INDEPENDENT'}}}});
  send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}});
 } else send({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:1,agentCapabilities:{}}:m.method==='session/new'?{sessionId:'version-test'}:{}});
});`
      );
      const adapter = createOpenCodeAdapter(fixture.options);
      const probe = await adapter.probe();
      assert.equal(probe.available, true);
      assert.equal(probe.version, version === "unparseable" ? null : version);
      for (const approvalMode of ["ask", "full_access"]) {
        const events = await Array.fromAsync(
          adapter.invoke(
            invokeRequest({
              agentEnv: withAgentEnvItems(undefined, [
                {
                  namespace: "octo.security",
                  name: "approval_policy",
                  payload: { mode: approvalMode }
                }
              ])
            })
          )
        );
        assert.equal(events.at(-1).type, "run.completed");
        assert.match(JSON.stringify(events), /VERSION_INDEPENDENT/);
      }
      assert.equal(await readFile(join(fixture.directory, "version-calls"), "utf8"), "probe\n");
    }
  );
}
test(
  "version detection failure and timeout leave the selected executable available",
  posix,
  async (t) => {
    for (const body of ["process.exit(1)", "setTimeout(()=>{},10000)"]) {
      const fixture = await executable(t, body);
      const started = Date.now();
      const probe = await createOpenCodeAdapter(fixture.options).probe();
      assert.equal(probe.available, true);
      assert.equal(probe.version, null);
      assert.ok(Date.now() - started < 5000);
    }
  }
);
test("invocation consumes the host selection and keeps it through execution", posix, async (t) => {
  const fixture = await executable(
    t,
    `
if(process.argv[2]==="--version"){console.log("opencode v2.1.3");process.exit(0)}
let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{
 console.log(JSON.stringify({type:"text",sessionID:"ses_v2",part:{type:"text",id:"text",text:input}}));
 console.log(JSON.stringify({type:"step_finish",part:{type:"step-finish",reason:"stop",tokens:{input:3,output:2}}}));
});`
  );
  for (const command of ["opencode", "./opencode"]) {
    const launch = resolveHostProviderLaunch(command, {
      env: { ...process.env, PATH: fixture.directory },
      cwd: fixture.directory
    });
    const events = [];
    for await (const event of createOpenCodeAdapter({
      env: launch.env,
      command: launch.command,
      commandArgsPrefix: launch.args
    }).invoke(
      invokeRequest({
        modelInput: 'exact\n"quoted"  spacing',
        executionEnvOverrides: { env_variables: [{ key: "PATH", value: fixture.directory }] },
        agentEnv: withAgentEnvItems(undefined, [
          {
            namespace: "octo.execution",
            name: "workspace",
            payload: { path: fixture.directory }
          },
          {
            namespace: "octo.security",
            name: "approval_policy",
            payload: { mode: "full_access" }
          },
          {
            namespace: "octo.execution",
            name: "model",
            payload: { reasoning: { effort: "high" } }
          }
        ])
      })
    ))
      events.push(event);
    assert.equal(
      events.find((e) => e.type === "message.delta").payload.text,
      'exact\n"quoted"  spacing'
    );
    assert.deepEqual(
      events.filter((e) => e.type.startsWith("run.") && e.type !== "run.notice").map((e) => e.type),
      ["run.completed"]
    );
    assert.equal(
      events.find((e) => e.type === "run.notice").payload.params.warningCode,
      "REASONING_EFFORT_NOT_APPLIED"
    );
  }
});
test("a step stop followed by process failure cannot become successful", posix, async (t) => {
  const fixture = await executable(
    t,
    `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
console.log(JSON.stringify({type:"text",part:{type:"text",text:"partial"}}));
console.log(JSON.stringify({type:"step_finish",part:{reason:"stop"}}));process.exitCode=7;`
  );
  const events = [];
  for await (const event of createOpenCodeAdapter(fixture.options).invoke(
    invokeRequest({
      agentEnv: withAgentEnvItems(undefined, [
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
      ])
    })
  ))
    events.push(event);
  assert.equal(
    events.some((e) => e.type === "run.completed"),
    false
  );
  assert.equal(events.at(-1).type, "run.failed");
});
test(
  "probe and execution preserve absolute, relative and empty PATH entry precedence",
  posix,
  async (t) => {
    const selected = await executable(
      t,
      `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"text",part:{text:process.argv[1]}})));`
    );
    const cwd = await executable(
      t,
      `if(process.argv[2]==="--version"){console.log("1.18.30");process.exit(0)}
process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({type:"text",part:{text:process.argv[1]}})));`
    );
    for (const entries of [
      [selected.directory, "."],
      [relative(cwd.directory, selected.directory), "."],
      [".", selected.directory],
      ["", selected.directory]
    ]) {
      const PATH = entries.join(delimiter);
      const expected = entries[0] === "." || entries[0] === "" ? cwd : selected;
      const launch = resolveHostProviderLaunch("opencode", {
        env: { ...process.env, PATH },
        cwd: cwd.directory
      });
      const probe = await probeOpenCode(launch.command, launch.env, cwd.directory, launch.args);
      assert.equal(await realpath(launch.args[0]), await realpath(expected.command));
      assert.equal(probe.command, process.execPath);
      assert.equal(probe.available, true);
      assert.equal(probe.version, expected === selected ? "2.1.3" : "1.18.30");
      const request = invokeRequest({
        executionEnvOverrides: { env_variables: [{ key: "PATH", value: PATH }] },
        agentEnv: withAgentEnvItems(undefined, [
          { namespace: "octo.execution", name: "workspace", payload: { path: cwd.directory } },
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ])
      });
      const adapter = createOpenCodeAdapter({
        command: launch.command,
        commandArgsPrefix: launch.args,
        env: launch.env
      });
      const events = await Array.fromAsync(adapter.invoke(request));
      assert.equal(
        events.find((event) => event.type === "message.delta").payload.text,
        launch.args[0]
      );
      assert.equal(events.at(-1).type, "run.completed");
    }
  }
);
for (const { name, frames, terminal } of [
  { name: "no events", frames: [], terminal: "run.failed" },
  {
    name: "reasoning only",
    frames: [{ type: "reasoning", part: { text: "thinking" } }],
    terminal: "run.failed"
  },
  {
    name: "missing text",
    frames: [{ type: "text", part: { type: "text" } }],
    terminal: "run.failed"
  },
  {
    name: "non-string text",
    frames: [{ type: "text", part: { text: 42 } }],
    terminal: "run.failed"
  },
  { name: "empty text", frames: [{ type: "text", part: { text: "" } }], terminal: "run.completed" },
  {
    name: "part-wrapped text",
    frames: [{ type: "update", part: { type: "text", text: "answer" } }],
    terminal: "run.completed"
  },
  {
    name: "new step without answer",
    frames: [
      { type: "text", part: { text: "old answer" } },
      { type: "step_start", part: { messageID: "next" } }
    ],
    terminal: "run.failed"
  },
  {
    name: "part-wrapped new step without answer",
    frames: [
      { type: "text", part: { text: "old answer" } },
      { type: "update", part: { type: "step-start", messageID: "next" } }
    ],
    terminal: "run.failed"
  }
]) {
  test(
    `zero-exit CLI with ${name} emits exactly one ${terminal} without throwing`,
    posix,
    async (t) => {
      const fixture = await executable(
        t,
        `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
process.stdin.resume();process.stdin.on("end",()=>{for(const frame of ${JSON.stringify(frames)})console.log(JSON.stringify(frame));});`
      );
      const events = await Array.fromAsync(
        createOpenCodeAdapter(fixture.options).invoke(
          invokeRequest({
            agentEnv: withAgentEnvItems(undefined, [
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: "full_access" }
              }
            ])
          })
        )
      );
      const terminals = events.filter((event) =>
        ["run.completed", "run.failed", "run.cancelled"].includes(event.type)
      );
      assert.equal(terminals.length, 1);
      assert.equal(terminals[0].type, terminal);
      if (terminal === "run.failed")
        assert.equal(terminals[0].payload.code, "OPENCODE_INCOMPLETE_OUTPUT");
    }
  );
}
test(
  "Core reports missing CLI output as failed with complete resource cleanup",
  posix,
  async (t) => {
    const fixture = await executable(
      t,
      `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
process.stdin.resume();process.stdin.on("end",()=>{
 const config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
 require("node:fs").writeFileSync(require("node:path").join(process.cwd(),"received-config"),JSON.stringify(config));
});`
    );
    const core = new AgentExecutor();
    core.register(createOpenCodeAdapter(fixture.options));
    t.after(() => core.shutdown());
    const events = await Array.fromAsync(
      core.invoke(
        invocationInput(
          invokeRequest({
            agentEnv: withAgentEnvItems(undefined, [
              {
                namespace: "octo.execution",
                name: "workspace",
                payload: { path: fixture.directory }
              },
              {
                namespace: "octo.security",
                name: "approval_policy",
                payload: { mode: "full_access" }
              }
            ])
          }),
          "canonical",
          "opencode"
        )
      )
    );
    assert.deepEqual(
      events
        .filter((event) => ["run.completed", "run.failed", "run.cancelled"].includes(event.type))
        .map((event) => event.type),
      ["run.failed"]
    );
    assert.equal(
      events.find((event) => event.type === "run.failed").payload.code,
      "OPENCODE_INCOMPLETE_OUTPUT"
    );
    assert.equal((await core.shutdown()).cleanup, "complete");
    const config = JSON.parse(await readFile(join(fixture.directory, "received-config"), "utf8"));
    assert.equal(config.instructions, undefined);
  }
);
test("OpenCode V2 preserves native config and overlays MCP under servers with execution timeout", async () => {
  const original = {
    instructions: ["existing.md"],
    providers: { custom: {} },
    mcp: { timeout: { catalog: 123 }, servers: { existing: { disabled: true } } }
  };
  const request = invokeRequest({
    executionEnvOverrides: {
      env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: JSON.stringify(original) }]
    },
    agentEnv: withAgentEnvItems(
      {
        schema: "octo.context-envelope/v3",
        items: [
          {
            namespace: "octo.execution",
            name: "mcp",
            payload: {
              mcpServers: {
                live: { type: "stdio", command: "node", args: ["server.js"], toolTimeoutMs: 5000 }
              }
            }
          }
        ]
      },
      [{ namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }]
    )
  });
  const spec = await buildOpenCodeCommand(request);
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  try {
    assert.deepEqual(config.mcp.servers.existing, { disabled: true });
    assert.deepEqual(config.mcp.timeout, { catalog: 123 });
    assert.deepEqual(config.mcp.servers.live.timeout, { execution: 5000 });
    assert.equal(config.mcp.servers.live.disabled, false);
    assert.deepEqual(config.providers, original.providers);
    assert.deepEqual(config.instructions, original.instructions);
  } finally {
    await spec.cleanup();
  }
  assert.deepEqual(original.instructions, ["existing.md"]);
  for (const invalid of ["{", "[]", "null", "42"]) {
    await assert.rejects(
      buildOpenCodeCommand({
        ...request,
        executionEnvOverrides: {
          env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: invalid }]
        }
      }),
      /OPENCODE_CONFIG_INVALID/
    );
  }
});
test("V2 ACP usage retains context size and cost", () => {
  assert.deepEqual(
    normalizeAcpUpdate(
      {
        sessionUpdate: "usage_update",
        used: 100,
        size: 128000,
        cost: { amount: 0.1, currency: "USD" }
      },
      "opencode"
    )[0].payload,
    { used: 100, size: 128000, cost: { amount: 0.1, currency: "USD" } }
  );
});
test("ACP only qualifies ordinary invocation errors after successful transport cleanup", async () => {
  for (const providerError of [
    new Error("provider rejected the request"),
    new TypeError("invalid provider object"),
    new SyntaxError("invalid provider response"),
    new RangeError("invalid provider range"),
    Object.assign(new TypeError("no structured code"), { code: undefined })
  ])
    for (const closeFails of [false, true]) {
      const cleanupError = new Error("cleanup could not finish");
      const adapter = createAcpAdapter(
        { type: "fixture", provider: "fixture", command: "unused" },
        {
          acpClientFactory: () => ({
            initialize: async () => {
              throw providerError;
            },
            close: async () => {
              if (closeFails) throw cleanupError;
            }
          })
        }
      );
      await assert.rejects(
        async () => {
          for await (const _ of adapter.invoke(
            invokeRequest({
              agentEnv: withAgentEnvItems(undefined, [
                { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
              ])
            })
          )) {
            /* drain */
          }
        },
        (error) =>
          closeFails
            ? error === cleanupError
            : error instanceof AcpInvocationError && error.cause === providerError
      );
    }
  const structured = Object.assign(new Error("capacity exceeded"), {
    code: "STREAM_RAW_MESSAGE_TOO_LARGE",
    limitBytes: 100
  });
  const adapter = createAcpAdapter(
    { type: "fixture", provider: "fixture", command: "unused" },
    {
      acpClientFactory: () => ({
        initialize: async () => {
          throw structured;
        },
        close: async () => {}
      })
    }
  );
  await assert.rejects(
    async () => {
      for await (const _ of adapter.invoke(
        invokeRequest({
          agentEnv: withAgentEnvItems(undefined, [
            { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
          ])
        })
      )) {
        /* drain */
      }
    },
    (error) => error === structured
  );
});
test("OpenCode accepts a version banner after extracting its stable version", posix, async (t) => {
  const fixture = await executable(t, 'console.log("opencode v2.1.3");');
  const probe = await createOpenCodeAdapter(fixture.options).probe();
  assert.equal(probe.available, true);
  assert.equal(probe.version, "2.1.3");
});
