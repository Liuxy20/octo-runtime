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

// 实际子进程验证选择路径和版本门禁，不安装或替换宿主 Provider。
async function executable(t, body) {
  const directory = await mkdtemp(join(tmpdir(), "octo-opencode-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, "opencode");
  await writeFile(command, `#!${process.execPath}\n${body}`);
  await chmod(command, 0o700);
  return { directory, command };
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
test("executable probing uses platform PATH, extension and cwd semantics", async (t) => {
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
      const probe = await probeOpenCode(command, env, directory);
      // PATHEXT 的大小写可与目录项不同；比较文件系统解析后的路径，仍校验目录选择。
      assert.equal(await realpath(probe.command), await realpath(expected));
      assert.equal(probe.version, process.versions.node);
      // Windows 使用原生 exe，POSIX 保持 Node 安装位置；两者都必须明确拒绝 Node 版本。
      assert.equal(probe.available, false);
      assert.match(probe.reason, /OPENCODE_VERSION_UNSUPPORTED/);
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
    const probe = await probeOpenCode("opencode", { ...env, PATH: bin, Pathext: "" }, directory);
    assert.equal(probe.available, false);
    assert.equal(probe.reason, "command_not_found");
  }
});
for (const version of ["1.18.30", "2.0.0", "2.1.2", "2.1.3-beta", "3.0.0", "unparseable"]) {
  test(
    `OpenCode ${version} is rejected during probe and direct invocation on both transports`,
    posix,
    async (t) => {
      const fixture = await executable(
        t,
        `if(process.argv[2]==="--version"){console.log(${JSON.stringify(version)});process.exit(0)} throw Error("must not start transport");`
      );
      const adapter = createOpenCodeAdapter({ command: fixture.command });
      const probe = await adapter.probe();
      assert.equal(probe.available, false);
      assert.match(
        probe.reason,
        version === "unparseable"
          ? /OPENCODE_VERSION_DETECTION_FAILED/
          : /OPENCODE_VERSION_UNSUPPORTED/
      );
      if (version.startsWith("1.")) assert.match(probe.reason, /OpenCode 1 is no longer supported/);
      for (const approvalMode of ["ask", "full_access"]) {
        await assert.rejects(async () => {
          for await (const _ of adapter.invoke(invokeRequest({ approvalMode }))) {
            /* drain */
          }
        }, /OPENCODE_VERSION_/);
      }
    }
  );
}
test("version detection failure and timeout fail closed", posix, async (t) => {
  for (const body of ["process.exit(1)", "setTimeout(()=>{},10000)"]) {
    const fixture = await executable(t, body);
    const started = Date.now();
    assert.match(
      (await probeOpenCode(fixture.command)).reason,
      /OPENCODE_VERSION_DETECTION_FAILED/
    );
    assert.ok(Date.now() - started < 5000);
  }
});
test(
  "invocation uses its PATH/cwd and keeps the selected executable through execution",
  posix,
  async (t) => {
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
      const events = [];
      for await (const event of createOpenCodeAdapter({ command }).invoke(
        invokeRequest({
          approvalMode: "full_access",
          workdir: fixture.directory,
          agentConfig: { effort: "high" },
          modelInput: 'exact\n"quoted"  spacing',
          executionEnvOverrides: { env_variables: [{ key: "PATH", value: fixture.directory }] }
        })
      ))
        events.push(event);
      assert.equal(
        events.find((e) => e.type === "message.delta").payload.text,
        'exact\n"quoted"  spacing'
      );
      assert.deepEqual(
        events
          .filter((e) => e.type.startsWith("run.") && e.type !== "run.notice")
          .map((e) => e.type),
        ["run.completed"]
      );
      assert.equal(
        events.find((e) => e.type === "run.notice").payload.params.warningCode,
        "REASONING_EFFORT_NOT_APPLIED"
      );
    }
  }
);
test("a step stop followed by process failure cannot become successful", posix, async (t) => {
  const fixture = await executable(
    t,
    `if(process.argv[2]==="--version"){console.log("2.1.3");process.exit(0)}
console.log(JSON.stringify({type:"text",part:{type:"text",text:"partial"}}));
console.log(JSON.stringify({type:"step_finish",part:{reason:"stop"}}));process.exitCode=7;`
  );
  const events = [];
  for await (const event of createOpenCodeAdapter({ command: fixture.command }).invoke(
    invokeRequest({ approvalMode: "full_access" })
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
      `if(process.argv[2]==="--version"){console.log("1.18.30");process.exit(0)}throw Error("must not execute V1");`
    );
    for (const entries of [
      [selected.directory, "."],
      [relative(cwd.directory, selected.directory), "."],
      [".", selected.directory],
      ["", selected.directory]
    ]) {
      const PATH = entries.join(delimiter);
      const expected = entries[0] === "." || entries[0] === "" ? cwd : selected;
      const probe = await probeOpenCode("opencode", { ...process.env, PATH }, cwd.directory);
      assert.equal(probe.command, expected.command);
      assert.equal(probe.available, expected === selected);
      const request = invokeRequest({
        approvalMode: "full_access",
        workdir: cwd.directory,
        executionEnvOverrides: { env_variables: [{ key: "PATH", value: PATH }] }
      });
      const adapter = createOpenCodeAdapter();
      if (expected === cwd) {
        assert.match(probe.reason, /OPENCODE_VERSION_UNSUPPORTED/);
        await assert.rejects(async () => {
          for await (const _ of adapter.invoke(request)) {
            /* drain */
          }
        }, /OPENCODE_VERSION_UNSUPPORTED/);
      } else {
        const events = await Array.fromAsync(adapter.invoke(request));
        assert.equal(
          events.find((event) => event.type === "message.delta").payload.text,
          probe.command
        );
        assert.equal(events.at(-1).type, "run.completed");
      }
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
        createOpenCodeAdapter({ command: fixture.command }).invoke(
          invokeRequest({ approvalMode: "full_access" })
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
 require("node:fs").writeFileSync(require("node:path").join(process.cwd(),"instructions-path"),config.instructions.at(-1));
});`
    );
    const core = new AgentExecutor();
    core.register(createOpenCodeAdapter({ command: fixture.command }));
    t.after(() => core.shutdown());
    const events = await Array.fromAsync(
      core.invoke(
        invocationInput(
          invokeRequest({ approvalMode: "full_access", workdir: fixture.directory }),
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
    assert.equal((await core.shutdown()).cleanup, "complete");
    const instructions = await readFile(join(fixture.directory, "instructions-path"), "utf8");
    await assert.rejects(readFile(instructions), { code: "ENOENT" });
  }
);
test("OpenCode V2 preserves native config and overlays MCP under servers with execution timeout", async () => {
  const original = {
    instructions: ["existing.md"],
    providers: { custom: {} },
    mcp: { timeout: { catalog: 123 }, servers: { existing: { disabled: true } } }
  };
  const request = invokeRequest({
    approvalMode: "full_access",
    controlInstructions: "CONTROL",
    executionEnvOverrides: {
      env_variables: [{ key: "OPENCODE_CONFIG_CONTENT", value: JSON.stringify(original) }]
    },
    context: {
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
    }
  });
  const spec = await buildOpenCodeCommand(request);
  const config = JSON.parse(spec.env.OPENCODE_CONFIG_CONTENT);
  try {
    assert.deepEqual(config.mcp.servers.existing, { disabled: true });
    assert.deepEqual(config.mcp.timeout, { catalog: 123 });
    assert.deepEqual(config.mcp.servers.live.timeout, { execution: 5000 });
    assert.equal(config.mcp.servers.live.disabled, false);
    assert.deepEqual(config.providers, original.providers);
    assert.equal(await readFile(config.instructions[1], "utf8"), "CONTROL");
  } finally {
    await spec.cleanup();
  }
  await assert.rejects(readFile(config.instructions[1]), { code: "ENOENT" });
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
          for await (const _ of adapter.invoke(invokeRequest({ approvalMode: "ask" }))) {
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
      for await (const _ of adapter.invoke(invokeRequest({ approvalMode: "ask" }))) {
        /* drain */
      }
    },
    (error) => error === structured
  );
});

test("OpenCode accepts a version banner after extracting its stable version", posix, async (t) => {
  const fixture = await executable(t, 'console.log("opencode v2.1.3");');
  const probe = await probeOpenCode(fixture.command);
  assert.equal(probe.available, true);
  assert.equal(probe.version, "2.1.3");
});
