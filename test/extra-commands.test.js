import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import { runCli } from "../apps/cli/dist/main.js";
import { commandConfig } from "../apps/cli/dist/extra-command-config.js";
import { runtimePaths, withSetupLock } from "../apps/cli/dist/state.js";
import { setExtra, readExtra } from "../apps/cli/dist/extras.js";
import { loadCliManifest } from "../apps/cli/dist/module-manifest.js";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "octo-commands-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
async function cli(home, args, input = "", dependencies = {}) {
  return rawCli(["--home", home, ...args], input, dependencies);
}
async function rawCli(args, input = "", dependencies = {}) {
  const output = [],
    errors = [];
  const code = await runCli(args, {
    input: Readable.from([input]),
    output: (line) => output.push(line),
    errorOutput: (line) => errors.push(line),
    ...dependencies
  });
  return { code, output: output.join("\n"), errors: errors.join("\n") };
}
const configPath = (home, name) => join(home, "extras", name, "config.json");
const stored = async (home, name) => JSON.parse(await readFile(configPath(home, name), "utf8"));

test("Home options work before, between and after custom command arguments", async (t) => {
  const home = await fixture(t),
    sessions = join(home, "extras", "webui", "sessions.json");
  for (const args of [
    ["--home", home, "webui", "configure"],
    ["webui", "--home", home, "configure"],
    ["webui", "configure", "--home", home],
    ["webui", "configure", "--port", "13889", `--home=${home}`]
  ]) {
    const result = await rawCli(args);
    assert.equal(result.code, 0, result.errors);
    assert.equal((await stored(home, "webui")).config.sessionStorePath, sessions);
  }
  for (const args of [
    ["webui", "--home", home, "extraget"],
    ["webui", "extraget", "--home", home]
  ]) {
    const result = await rawCli(args);
    assert.equal(result.code, 0, result.errors);
    assert.equal(JSON.parse(result.output).config.port, 13889);
  }
});

test("Trailing selection flags preserve duplicate and missing business value errors", async (t) => {
  const home = await fixture(t),
    other = join(home, "other");
  for (const args of [
    ["--home", home, "webui", "configure", "--home", other],
    ["webui", "configure", "--home", home, "--home", other],
    ["webui", "configure", "--home"],
    ["webui", "configure", "--port", "--home", home, "13888"],
    ["--manifest", "unused", "webui", "configure", "--manifest", "also-unused"]
  ]) {
    const result = await rawCli(args);
    assert.equal(result.code, 2, result.errors);
  }
  await assert.rejects(access(join(home, "extras")));
  await assert.rejects(access(other));
});

test("Legacy host boolean equals syntax works before and after lifecycle commands", async (t) => {
  const home = await fixture(t);
  for (const args of [
    ["--json=true", "version"],
    ["--help=true"],
    ["--json=true", "webui", "status", "--help"],
    ["webui", "--json=true", "status", "--help"],
    ["webui", "status", "--json=true", "--help"],
    ["--json=false", "version"],
    ["--profile", "-legacy", "version"],
    ["--help=legacy-value"],
    ["webui", "configure", "--help=true"]
  ]) {
    const result = await cli(home, args);
    assert.equal(result.code, 0, `${args.join(" ")}: ${result.errors}`);
    assert.ok(result.output.length > 0);
  }
  // 兼容宿主参数不放宽 Extra 自己声明的 boolean 选项。
  const custom = await external(
    t,
    'export default {apiVersion:1,commands:[{name:"check",description:"Check",options:[{name:"force",type:"boolean",description:"Force"}],async run(){}}]};'
  );
  const result = await cli(custom, ["loop-daemon", "check", "--force=true"]);
  assert.equal(result.code, 2);
  await assert.rejects(access(join(home, "extras")));
});

async function lockProcess(home, hook = "", onChild = () => {}) {
  const state = new URL("../apps/cli/dist/state.js", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    ${hook}
    syncBuiltinESMExports();
    const { withSetupLock, runtimePaths } = await import(${JSON.stringify(state)});
    await withSetupLock(runtimePaths(${JSON.stringify(home)}, 'default'), async () => {});
  `
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  onChild(child);
  return { code: (await once(child, "exit"))[0], errors };
}

test("A process dying immediately after publishing a reclaim lock does not block future writers", async (t) => {
  const home = await fixture(t),
    paths = runtimePaths(home, "default");
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(dead, "exit");
  await mkdir(join(home, "run"), { recursive: true });
  await writeFile(paths.setupLock, JSON.stringify({ pid: dead.pid }), { mode: 0o600 });
  const crash = await lockProcess(
    home,
    `
    const mkdir = fs.mkdir, link = fs.link;
    fs.mkdir = async (...args) => {
      const result = await mkdir(...args);
      if (String(args[0]).endsWith('.reclaim')) process.exit(42);
      return result;
    };
    fs.link = async (...args) => {
      const result = await link(...args);
      if (String(args[1]).includes('reclaim')) process.exit(42);
      return result;
    };
  `
  );
  assert.equal(crash.code, 42, crash.errors);
  // 第二位和第三位回收者也在发布后立即退出，验证回收锁本身的恢复路径。
  for (let attempt = 0; attempt < 2; attempt++) {
    const again = await lockProcess(
      home,
      `
      const link = fs.link;
      fs.link = async (...args) => {
        const result = await link(...args);
        if (String(args[1]).includes('reclaim')) process.exit(42);
        return result;
      };
    `
    );
    assert.equal(again.code, 42, again.errors);
  }
  // 三个新进程必须都能进入，不删除锁、不等待超时、不手动修复。
  for (let attempt = 0; attempt < 3; attempt++) {
    const recovered = await lockProcess(home);
    assert.equal(recovered.code, 0, recovered.errors);
  }
});

for (const stage of ["before", "after"]) {
  test(`A process dying ${stage} primary-lock publication leaves future configuration writable`, async (t) => {
    const home = await fixture(t);
    const crash = await lockProcess(
      home,
      `
      const link = fs.link;
      fs.link = async (...args) => {
        if (${JSON.stringify(stage)} === 'before') process.exit(42);
        const result = await link(...args);
        process.exit(42);
        return result;
      };
    `
    );
    assert.equal(crash.code, 42, crash.errors);
    const result = await cli(home, ["webui", "configure", "--port", "13888"]);
    assert.equal(result.code, 0, result.errors);
    assert.equal(
      (await stored(home, "webui")).config.sessionStorePath,
      join(home, "extras", "webui", "sessions.json")
    );
  });
}

test("A live reclaimer excludes other processes and its death releases future recovery", async (t) => {
  const home = await fixture(t),
    paths = runtimePaths(home, "default");
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(dead, "exit");
  await mkdir(join(home, "run"), { recursive: true });
  const original = JSON.stringify({ pid: dead.pid });
  await writeFile(paths.setupLock, original, { mode: 0o600 });
  let child, ready;
  const barrier = new Promise((resolve) => {
    ready = resolve;
  });
  const completion = lockProcess(
    home,
    `
    const link = fs.link;
    fs.link = async (...args) => {
      const result = await link(...args);
      if (String(args[1]).includes('reclaim')) {
        process.stdin.resume();
        process.stdout.write('ready');
        await new Promise(() => {});
      }
      return result;
    };
  `,
    (process) => {
      child = process;
      child.stdout.once("data", ready);
    }
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await Promise.race([barrier, completion.then((result) => assert.fail(result.errors))]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const blocked = await lockProcess(home);
    assert.equal(blocked.code, 1);
    assert.match(blocked.errors, /SETUP_IN_PROGRESS/);
    assert.equal(await readFile(paths.setupLock, "utf8"), original);
  }
  child.kill();
  await completion;
  const recovered = await lockProcess(home);
  assert.equal(recovered.code, 0, recovered.errors);
});

for (const name of ["channel-gateway", "channel-wecom", "webui"]) {
  test(`${name}: all help levels are offline and do not create configuration`, async (t) => {
    const home = await fixture(t);
    for (const flag of ["-h", "--help"]) {
      for (const path of [[], ["extraset"], ["extraget"], ["configure"]]) {
        const result = await cli(home, [name, ...path, flag]);
        assert.equal(result.code, 0, result.errors);
        assert.match(result.output, /Usage:/);
      }
    }
    assert.match((await cli(home, [name, "--help"])).output, /configure/);
    assert.match((await cli(home, [name, "extraget", "-h"])).output, /INCLUDING CREDENTIALS/);
    await assert.rejects(access(join(home, "extras")));
  });
}

for (const name of ["channel-gateway", "channel-wecom"]) {
  test(`${name}: schema-named options accept raw credentials without reading stdin`, async (t) => {
    const home = await fixture(t),
      input = new PassThrough();
    t.after(() => input.destroy());
    const field = name === "channel-gateway" ? "bf_token" : "app_secret";
    const address =
      name === "channel-gateway"
        ? ["--api_url", "https://im.example.com/api"]
        : ["--ws_url", "wss://wecom.example.com/ws"];
    const args = [
      name,
      "configure",
      "--bot_id",
      "raw",
      ...address,
      "--adapter_type",
      "openclaw",
      "--provider_agent_id",
      "main",
      "--model",
      "model-id",
      "--effort",
      "high"
    ];
    for (const raw of [
      `  原文 ${randomBytes(16).toString("hex")} =\r\n `,
      `--home=${randomBytes(16).toString("hex")}`
    ]) {
      const result = await cli(home, [...args, `--${field}=${raw}`, "--json"], "", { input });
      assert.equal(result.code, 0, result.errors);
      assert.ok(!result.output.includes(raw));
      assert.ok(!result.errors.includes(raw));
      const data = await stored(home, name);
      assert.equal(data.config.bots.length, 1);
      assert.equal(data.config.bots[0][field], raw);
      assert.deepEqual(data.config.bots[0].adapter, {
        adapter_type: "openclaw",
        provider_agent_id: "main",
        model: "model-id",
        effort: "high"
      });
    }
    assert.equal(input.listenerCount("data"), 0);
    const before = await readFile(configPath(home, name), "utf8");
    for (const flags of [
      [`--${field}`, "   "],
      [`--${field}`],
      [`--${field}=`],
      [`--${field}`, "first", `--${field}`, "second"],
      ["--credential-stdin"]
    ]) {
      assert.equal((await cli(home, [...args, ...flags])).code, 2);
      assert.equal(await readFile(configPath(home, name), "utf8"), before);
    }
    const help = await cli(home, [name, "configure", "--help"]);
    assert.match(help.output, new RegExp(`--${field}`));
    assert.ok(!help.output.includes("credential-stdin"));
  });

  test(`${name}: core configure upserts by business identity and preserves host fields`, async (t) => {
    const home = await fixture(t);
    const token = randomBytes(24).toString("hex");
    const address = name === "channel-gateway" ? ["--api_url", "https://im.example.com/api/"] : [];
    const required = ["configure", "--bot_id", "机器人", ...address, "--workdir", home];
    const credentialField = name === "channel-gateway" ? "bf_token" : "app_secret";
    const first = await cli(home, [
      name,
      ...required,
      "--adapter_type",
      "codex",
      `--${credentialField}`,
      token,
      "--json"
    ]);
    assert.equal(first.code, 0, first.errors);
    assert.equal(JSON.parse(first.output).reload_required, true);
    assert.ok(!first.output.includes(token));
    const initial = await stored(home, name);
    initial.enabled = false;
    initial.module = `@mininglamp-oss/octo-runtime-extra-${name}`;
    initial.config.bots[0].bot_name = "保留名称";
    initial.config.bots[0].allowed_sender_ids = [];
    await setExtra(runtimePaths(home, "default"), name, Readable.from([JSON.stringify(initial)]));
    const updated = await cli(home, [name, ...required, "--model", "some-model"]);
    assert.equal(updated.code, 0, updated.errors);
    assert.match(updated.output, /Restart this Extra/);
    assert.ok(!updated.output.includes(token));
    const data = await stored(home, name);
    assert.equal(data.config.bots.length, 1);
    assert.equal(data.enabled, false);
    assert.equal(data.module, initial.module);
    assert.equal(data.config.bots[0].bot_name, "保留名称");
    assert.deepEqual(data.config.bots[0].allowed_sender_ids, []);
    assert.equal(data.config.bots[0].adapter.model, "some-model");
    assert.equal(data.config.bots[0].adapter.adapter_type, "codex");
    assert.equal(
      data.config.bots[0][name === "channel-gateway" ? "bf_token" : "app_secret"],
      token
    );
    if (process.platform !== "win32")
      assert.equal((await stat(configPath(home, name))).mode & 0o777, 0o600);
    const other = required.map((value) => (value === "机器人" ? "second" : value));
    assert.equal((await cli(home, [name, ...other])).code, 0);
    assert.equal((await stored(home, name)).config.bots.length, 2);
    const manifest = await loadCliManifest(home);
    const registration = await readExtra(runtimePaths(home, "default"), name, manifest);
    assert.deepEqual(registration.config, (await stored(home, name)).config);
    assert.equal(registration.enabled, false);
  });
}

test("Legacy business aliases and WebUI path flags are rejected; advanced JSON keeps its field names", async (t) => {
  const home = await fixture(t);
  for (const [name, flags] of [
    ["channel-gateway", ["bot-id", "api-url", "adapter", "provider-agent-id", "bf-token"]],
    ["channel-wecom", ["bot-id", "ws-url", "adapter", "provider-agent-id", "app-secret"]],
    ["webui", ["session-store-path", "project-path", "sessionStorePath", "defaultProjectPath"]]
  ]) {
    for (const flag of flags)
      assert.equal((await cli(home, [name, "configure", `--${flag}`, "unused"])).code, 2);
  }
  await assert.rejects(access(join(home, "extras")));
  const result = await cli(home, ["webui", "configure", "--port", "13890"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual((await stored(home, "webui")).config, {
    sessionStorePath: join(home, "extras", "webui", "sessions.json"),
    port: 13890
  });
  const advanced = {
    sessionStorePath: join(home, "custom.json"),
    defaultProjectPath: home,
    port: 13890
  };
  assert.equal(
    (await cli(home, ["webui", "extraset"], JSON.stringify({ config: advanced }))).code,
    0
  );
  assert.equal((await cli(home, ["webui", "configure", "--port", "13891"])).code, 0);
  assert.deepEqual((await stored(home, "webui")).config, { ...advanced, port: 13891 });
  const help = await cli(home, ["webui", "configure", "-h"]);
  assert.match(help.output, /--port/);
  assert.doesNotMatch(help.output, /--sessionStorePath|--defaultProjectPath/);
});

for (const name of ["channel-gateway", "channel-wecom"]) {
  test(`${name} configure upserts by bot_id across endpoints and preserves other Bots`, async (t) => {
    const endpointField = name === "channel-gateway" ? "api_url" : "ws_url";
    const credentialField = name === "channel-gateway" ? "bf_token" : "app_secret";
    const scheme = name === "channel-gateway" ? "https" : "wss";
    const home = await fixture(t);
    const configure = (id, api, extra = []) =>
      cli(home, [
        name,
        "configure",
        "--bot_id",
        id,
        `--${endpointField}`,
        api,
        "--workdir",
        home,
        ...extra
      ]);
    assert.equal(
      (
        await configure("one", `${scheme}://im.example.com/api`, [
          `--${credentialField}`,
          "original",
          "--model",
          "model-one"
        ])
      ).code,
      0
    );
    assert.equal(
      (await configure("two", `${scheme}://im.example.com/api`, [`--${credentialField}`, "other"]))
        .code,
      0
    );
    const before = (await stored(home, name)).config.bots;
    const updated = await configure("one", `${scheme}://other.example.com/api`, [
      `--${credentialField}`,
      "replacement"
    ]);
    assert.equal(updated.code, 0, updated.errors);
    const after = (await stored(home, name)).config.bots;
    assert.equal(after.length, 2);
    assert.deepEqual(after[0], {
      ...before[0],
      [endpointField]: `${scheme}://other.example.com/api`,
      [credentialField]: "replacement"
    });
    assert.deepEqual(after[1], before[1]);
    assert.equal((await configure("one", "invalid")).code, 2);
    assert.deepEqual((await stored(home, name)).config.bots, after);
    const legacy = {
      bots: [
        after[0],
        after[1],
        { ...after[0], [endpointField]: `${scheme}://legacy.example.com/api` }
      ]
    };
    assert.equal((await cli(home, [name, "extraset"], JSON.stringify({ config: legacy }))).code, 0);
    assert.equal((await configure("one", `${scheme}://final.example.com/api`)).code, 0);
    const final = (await stored(home, name)).config.bots;
    assert.equal(final.length, 2);
    assert.deepEqual(final[0], {
      ...after[0],
      [endpointField]: `${scheme}://final.example.com/api`
    });
    assert.deepEqual(final[1], before[1]);
    if (name === "channel-wecom") {
      assert.equal(
        (await cli(home, [name, "configure", "--bot_id", "one", "--model", "updated"])).code,
        0
      );
      const updated = (await stored(home, name)).config.bots;
      assert.equal(updated[0].ws_url, final[0].ws_url);
      assert.equal(updated[0].app_secret, final[0].app_secret);
      assert.equal(updated.length, 2);
    }
  });
}

test("WebUI keeps one configuration and supports JSON replacement/get and legacy envelope", async (t) => {
  const home = await fixture(t);
  const args = ["webui", "configure"];
  assert.equal((await cli(home, args)).code, 0);
  assert.equal((await cli(home, ["webui", "configure", "--port", "14444"])).code, 0);
  assert.equal((await stored(home, "webui")).config.port, 14444);
  const envelope = await cli(home, ["extraget", "webui"]);
  assert.deepEqual(JSON.parse(envelope.output), await stored(home, "webui"));
  const business = { sessionStorePath: join(home, "second.json"), port: 15555 };
  assert.equal(
    (await cli(home, ["webui", "extraset"], JSON.stringify({ config: business }))).code,
    0
  );
  assert.deepEqual(JSON.parse((await cli(home, ["webui", "extraget"])).output), {
    config: business
  });
  assert.equal((await cli(home, ["webui", "configure", "--port", "65536"])).code, 2);
  assert.deepEqual((await stored(home, "webui")).config, business);
});

test("Invalid input, duplicates, profile, oversized input and credentials never replace valid config", async (t) => {
  const home = await fixture(t);
  const token = randomBytes(24).toString("hex");
  const bot = {
    bot_id: "one",
    api_url: "https://im.example.com/api",
    adapter: {},
    bf_token: token
  };
  assert.equal(
    (await cli(home, ["channel-gateway", "extraset"], JSON.stringify({ config: { bots: [bot] } })))
      .code,
    0
  );
  const before = await readFile(configPath(home, "channel-gateway"), "utf8");
  for (const body of [
    JSON.stringify({ bots: [bot] }),
    JSON.stringify({ config: [], enabled: true }),
    JSON.stringify({ config: {}, enabled: token }),
    token,
    "x".repeat(1024 * 1024 + 1)
  ]) {
    const result = await cli(home, ["channel-gateway", "extraset", "--json"], body);
    assert.notEqual(result.code, 0);
    assert.ok(!result.output.includes(token));
    assert.ok(!result.errors.includes(token));
    assert.equal(await readFile(configPath(home, "channel-gateway"), "utf8"), before);
  }
  for (const args of [
    ["--profile", "work", "channel-gateway", "extraset"],
    ["channel-gateway", "extraset", "--profile", "work"],
    [
      "channel-gateway",
      "configure",
      "--bot_id",
      "one",
      "--api_url",
      "https://im.example.com/api",
      "--bf-token",
      token
    ]
  ])
    assert.equal((await cli(home, args, "{}")).code, 2);
});

test("CAS preserves concurrent extraset updates; cancellation preserves config; blank locks cannot be stolen", async (t) => {
  const home = await fixture(t);
  const paths = runtimePaths(home, "default");
  const api = commandConfig(paths, "webui", "example", new AbortController().signal);
  const first = await api.readConfig();
  await setExtra(
    paths,
    "webui",
    Readable.from([JSON.stringify({ enabled: false, config: { newer: true } })])
  );
  await assert.rejects(api.saveConfig({ stale: true }, first.revision), /EXTRA_CONFIG_CONFLICT/);
  const current = await api.readConfig();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    commandConfig(paths, "webui", "example", controller.signal).saveConfig({}, current.revision)
  );
  assert.deepEqual(await stored(home, "webui"), { enabled: false, config: { newer: true } });
  await mkdir(join(home, "run"), { recursive: true });
  await writeFile(paths.setupLock, "", { mode: 0o600 });
  await assert.rejects(
    withSetupLock(paths, async () => assert.fail("lock was stolen")),
    /SETUP_IN_PROGRESS/
  );
  assert.equal(await readFile(paths.setupLock, "utf8"), "");
});

test("Cancellation while waiting on custom command stdin releases it without saving", async (t) => {
  const home = await external(
    t,
    'export default {apiVersion:1,commands:[{name:"read",description:"Read input",async run(ctx){await ctx.readStdin();}}]};'
  );
  const input = new PassThrough(),
    controller = new AbortController();
  t.after(() => input.destroy());
  const pending = cli(home, ["loop-daemon", "read"], "", {
    input,
    commandSignal: controller.signal
  });
  const timer = setTimeout(() => controller.abort(), 30);
  t.after(() => clearTimeout(timer));
  assert.equal((await pending).code, 130);
  await assert.rejects(access(configPath(home, "channel-gateway")));
  assert.equal(input.listenerCount("data"), 0);
});

async function external(
  t,
  source,
  exports = { ".": "./service.js", "./commands": "./commands.js" }
) {
  const home = await fixture(t);
  const directory = join(home, "node_modules", "outside-extra");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "outside-extra", type: "module", exports })
  );
  await writeFile(
    join(directory, "service.js"),
    'throw new Error("service must never be imported by commands");'
  );
  await writeFile(join(directory, "commands.js"), source);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "loop-daemon", module: "outside-extra" }]
    })
  );
  return home;
}
const externalSource = `export default { apiVersion: 1, commands: [{ name: "login", description: "Offline test login", options: [{name:"endpoint",type:"string",description:"Endpoint",required:true}], arguments:[{name:"literal"}], async run(ctx, input) { const old = await ctx.readConfig(); return {value:{...await ctx.saveConfig({...old.config,endpoint:input.options.endpoint,literal:input.arguments[0]??null},old.revision)}} } } ] };`;

test("Trailing Home and manifest select the command source before loading; literal values stay intact", async (t) => {
  const home = await external(t, externalSource),
    fallback = await fixture(t);
  await writeFile(join(fallback, "manifest.json"), "broken fallback must not be read");
  const result = await rawCli(
    ["loop-daemon", "login", "--home", home, "--endpoint=--home=literal", "--", "--manifest"],
    "",
    { env: { OCTO_RUNTIME_HOME: fallback } }
  );
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual((await stored(home, "loop-daemon")).config, {
    endpoint: "--home=literal",
    literal: "--manifest"
  });
  const explicit = join(home, "selected.json");
  await writeFile(explicit, await readFile(join(home, "manifest.json")));
  await writeFile(join(home, "manifest.json"), "broken Home manifest must not be read");
  const selected = await rawCli([
    "loop-daemon",
    "login",
    "--endpoint",
    "selected",
    "--home",
    home,
    `--manifest=${explicit}`
  ]);
  assert.equal(selected.code, 0, selected.errors);
  assert.equal((await stored(home, "loop-daemon")).config.endpoint, "selected");
  await assert.rejects(access(join(fallback, "extras")));
});

test("External package adds direct command, lazy root/help and literal -- values", async (t) => {
  const home = await external(t, externalSource);
  const root = await cli(home, ["-h"]);
  assert.equal(root.code, 0, root.errors);
  assert.match(root.output, /loop-daemon/);
  assert.equal((await cli(home, ["loop-daemon", "login", "-h"])).code, 0);
  await assert.rejects(access(join(home, "extras")));
  const result = await cli(home, ["loop-daemon", "login", "--endpoint=--json", "--", "--home"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual((await stored(home, "loop-daemon")).config, {
    endpoint: "--json",
    literal: "--home"
  });
  for (const args of [
    ["login"],
    ["login", "--endpoint", "a", "--endpoint", "b"],
    ["login", "--endpoint", "a", "extra", "extra"],
    ["login", "--endpoint", "a", "--manifest"]
  ])
    assert.equal((await cli(home, ["loop-daemon", ...args])).code, 2);
});

for (const [label, source, expected] of [
  ["broken import", 'import "dependency-that-does-not-exist";', "EXTRA_COMMAND_LOAD_FAILED"],
  [
    "unsupported API",
    "export default {apiVersion:2,commands:[]};",
    "EXTRA_COMMAND_API_UNSUPPORTED"
  ],
  [
    "reserved lifecycle",
    'export default {apiVersion:1,commands:[{name:"start",description:"bad",async run(){}}]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ],
  [
    "duplicates",
    'const c={name:"login",description:"bad",async run(){}};export default {apiVersion:1,commands:[c,c]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ],
  [
    "host flag conflict",
    'export default {apiVersion:1,commands:[{name:"login",description:"bad",options:[{name:"home",type:"string",description:"bad"}],async run(){}}]};',
    "EXTRA_COMMAND_DEFINITION_INVALID"
  ]
]) {
  test(`${label} is isolated from root help, other Extras and offline lifecycle`, async (t) => {
    const home = await external(t, source);
    assert.equal((await cli(home, ["-h"])).code, 0);
    const result = await cli(home, ["loop-daemon", "-h", "--json"]);
    assert.notEqual(result.code, 0);
    assert.equal(JSON.parse(result.output).error.code, expected);
    assert.equal((await cli(home, ["webui", "-h"])).code, 0);
    assert.equal((await cli(home, ["loop-daemon", "status", "--help"])).code, 0);
  });
}

test("No optional commands export retains lifecycle help", async (t) => {
  const home = await external(t, 'throw new Error("not exported");', { ".": "./service.js" });
  assert.equal((await cli(home, ["loop-daemon", "-h"])).code, 0);
  assert.equal((await cli(home, ["loop-daemon", "login"])).code, 2);
});

test("Explicit file command declaration supports nested commands and exit results", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "commands.mjs"),
    'export default {apiVersion:1,commands:[{name:"account",description:"Accounts",commands:[{name:"check",description:"Check",async run(){return {value:{checked:true},exitCode:7}}}]}]};'
  );
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "custom", module: "./never-import.mjs", commands: "./commands.mjs" }]
    })
  );
  for (const flag of ["-h", "--help"]) {
    assert.equal((await cli(home, ["custom", "account", flag])).code, 0);
    assert.equal((await cli(home, ["custom", "account", "check", flag])).code, 0);
  }
  const result = await cli(home, ["custom", "account", "check", "--json"]);
  assert.equal(result.code, 7);
  assert.deepEqual(JSON.parse(result.output), { checked: true });
});

test("Third-party handler failure never prints arbitrary credential-shaped errors or saves partial config", async (t) => {
  const token = randomBytes(24).toString("hex").toUpperCase();
  const home = await external(
    t,
    `export default {apiVersion:1,commands:[{name:"login",description:"Login",async run(ctx){await ctx.readConfig(); throw new Error(${JSON.stringify(token)});}}]};`
  );
  const result = await cli(home, ["loop-daemon", "login", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.output).error.code, "EXTRA_COMMAND_FAILED");
  assert.ok(!result.output.includes(token));
  await assert.rejects(access(configPath(home, "loop-daemon")));
});

test("Same-name ignored manifest entry is not imported", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "webui", module: "./bad-service.mjs", commands: "./bad-commands.mjs" }]
    })
  );
  const result = await cli(home, ["webui", "configure", "--port", "13888"]);
  assert.equal(result.code, 0, result.errors);
  assert.match(result.errors, /built-in declaration takes precedence/);
  assert.equal(
    (await stored(home, "webui")).config.sessionStorePath,
    join(home, "extras", "webui", "sessions.json")
  );
});

test("Malformed stored config is not treated as first setup", async (t) => {
  const home = await fixture(t);
  const file = configPath(home, "webui");
  await mkdir(join(home, "extras", "webui"), { recursive: true });
  await writeFile(file, "{", { mode: 0o600 });
  const result = await cli(home, ["webui", "configure", "--port", "13888"]);
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(file, "utf8"), "{");
});

test("Reserved Runtime namespace is rejected without importing it", async (t) => {
  const home = await fixture(t);
  await writeFile(
    join(home, "manifest.json"),
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [{ name: "doctor", module: "./unused.mjs" }]
    })
  );
  const result = await cli(home, ["--help", "--json"]);
  assert.equal(JSON.parse(result.output).error.code, "EXTRA_COMMAND_NAMESPACE_CONFLICT");
});

test("Legacy package without an exports map has no optional extension", async (t) => {
  const home = await external(t, 'throw new Error("unexported commands are not loaded");', null);
  const directory = join(home, "node_modules", "outside-extra");
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "outside-extra", type: "module", main: "./service.js" })
  );
  assert.equal((await cli(home, ["loop-daemon", "-h"])).code, 0);
});

test(
  "Two real CLI processes detect a conflicting snapshot after unlocked interaction",
  { timeout: 10000 },
  async (t) => {
    const home = await external(
      t,
      `export default {apiVersion:1,commands:[{name:"login",description:"Barrier login",async run(ctx){const old=await ctx.readConfig();ctx.output("ready");const value=await ctx.readStdin();return {value:{...await ctx.saveConfig({value},old.revision)}}}}]};`
    );
    const entry = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
    const processes = [1, 2].map(() =>
      spawn(process.execPath, [entry, "--home", home, "loop-daemon", "login", "--json"], {
        stdio: ["pipe", "pipe", "pipe"]
      })
    );
    t.after(() => {
      for (const process of processes) if (process.exitCode === null) process.kill();
    });
    const outputs = ["", ""];
    const completions = processes.map((process) => once(process, "close"));
    await Promise.all(
      processes.map(
        (process, index) =>
          new Promise((resolve, reject) => {
            process.on("error", reject);
            process.stdout.on("data", (chunk) => {
              outputs[index] += chunk.toString();
              if (outputs[index].includes("ready\n")) resolve();
            });
            process.stderr.resume();
            process.on("exit", (code) => {
              if (!outputs[index].includes("ready\n"))
                reject(new Error(`exited before barrier: ${code}`));
            });
          })
      )
    );
    processes[0].stdin.end("first");
    assert.equal((await completions[0])[0], 0);
    processes[1].stdin.end("second");
    assert.notEqual((await completions[1])[0], 0);
    assert.match(outputs[1], /EXTRA_CONFIG_CONFLICT/);
    assert.deepEqual((await stored(home, "loop-daemon")).config, { value: "first" });
  }
);

test("A custom command named json is not mistaken for a host flag", async (t) => {
  const home = await external(
    t,
    'export default {apiVersion:1,commands:[{name:"json",description:"A valid operation name",async run(){return {value:{ok:true}}}}]};'
  );
  const result = await cli(home, ["loop-daemon", "json"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(JSON.parse(result.output), { ok: true });
});

test("extraget returns the full declaration even when business JSON contains a saved field", async (t) => {
  const home = await fixture(t);
  const config = { sessionStorePath: join(home, "sessions.json"), saved: true };
  assert.equal((await cli(home, ["webui", "extraset"], JSON.stringify({ config }))).code, 0);
  const result = await cli(home, ["webui", "extraget"]);
  assert.deepEqual(JSON.parse(result.output), { config });
});

test("Concurrent stale-lock recovery cannot delete a newly acquired writer lock", async (t) => {
  const home = await fixture(t),
    paths = runtimePaths(home, "default");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  await mkdir(join(home, "run"), { recursive: true });
  await writeFile(paths.setupLock, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let entered = 0;
  let rejected = 0;
  const actions = Array.from({ length: 8 }, () =>
    withSetupLock(paths, async () => {
      entered++;
      if (entered > 1) release();
      await gate;
    }).catch((error) => {
      if (++rejected === 7) release();
      throw error;
    })
  );
  t.after(release);
  const outcomes = await Promise.allSettled(actions);
  assert.equal(entered, 1);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of outcomes)
    if (result.status === "rejected") assert.match(result.reason.message, /SETUP_IN_PROGRESS/);
});
