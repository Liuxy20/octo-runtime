import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { runCli } from "../apps/cli/dist/main.js";
import { parseCliCommand } from "../apps/cli/dist/command-tree.js";
import { cliHelpHeader, cliVersionInfo } from "../apps/cli/dist/help.js";

function listedCommands(help) {
  return help
    .split("Available Commands:\n")[1]
    .split("\n\n")[0]
    .split("\n")
    .filter((line) => /^  \S/.test(line))
    .map((line) => line.trim().split(/\s+/)[0]);
}

async function fixture(t, source = 'throw new Error("commands must not be imported");') {
  const home = await mkdtemp(join(tmpdir(), "octo-help-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const manifest = join(home, "selected.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: [
        {
          name: "custom-service",
          description: "Run custom workflows",
          module: "./service.mjs",
          commands: "./commands.mjs"
        }
      ]
    })
  );
  await writeFile(join(home, "service.mjs"), 'throw new Error("service must not be imported");');
  await writeFile(join(home, "commands.mjs"), source);
  const cli = async (args, input = "") => {
    const output = [],
      errors = [];
    const code = await runCli(["--home", home, "--manifest", manifest, ...args], {
      input: Readable.from([input]),
      output: (line) => output.push(line),
      errorOutput: (line) => errors.push(line)
    });
    return { code, output: output.join("\n"), errors: errors.join("\n") };
  };
  return { home, manifest, cli };
}

test("Root help lists the effective directory once without importing modules or exposing legacy commands", async (t) => {
  const { home, cli } = await fixture(t);
  const root = await cli(["--help"]);
  assert.equal(root.code, 0, root.errors);
  assert.match(root.output, /custom-service\s+Run custom workflows/);
  assert.doesNotMatch(
    root.output,
    /channel-gateway|channel-wecom|webui|<extra-name>|namespaces|Components:|Extra commands:|extraset|extraget/
  );
  assert.ok(root.output.startsWith(cliHelpHeader));
  for (const title of ["commit:", "build:", "Usage:", "Examples:", "Available Commands:", "Flags:"])
    assert.equal(root.output.split(title).length, 2);
  assert.ok(root.output.indexOf("Examples:") < root.output.indexOf("Available Commands:"));
  for (const args of [[], ["help"], ["-h"]]) assert.deepEqual(await cli(args), root);
  await assert.rejects(access(join(home, "extras")));
});

test("Root command priorities apply to the effective catalog without importing reordered Extras", async (t) => {
  const { cli, manifest } = await fixture(t);
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [],
      extras: ["z-service", "webui", "channel-wecom", "a-service", "channel-gateway"].map(
        (name) => ({
          name,
          module: "./service.mjs",
          commands: "./commands.mjs"
        })
      )
    })
  );
  const root = await cli(["-h"]);
  assert.equal(root.code, 0, root.errors);
  const names = listedCommands(root.output);
  assert.deepEqual(names.slice(0, 4), [
    "executor-kernel",
    "channel-gateway",
    "channel-wecom",
    "webui"
  ]);
  assert.deepEqual(names.slice(4), [...names.slice(4)].sort());
  for (const name of ["channel-gateway", "channel-wecom", "webui"])
    assert.match(
      root.output.split("Examples:\n")[1].split("\n\n")[0],
      new RegExp(`octo-runtime ${name} --help`)
    );
});

test("Global version flags print artifact metadata from every command without loading a catalog or extension", async (t) => {
  const { cli, manifest } = await fixture(t);
  await writeFile(manifest, "broken catalog must not block version information");
  for (const flag of ["--version", "-v"]) {
    for (const name of [
      "executor-kernel",
      "channel-gateway",
      "channel-wecom",
      "webui",
      "custom-service"
    ]) {
      for (const args of [
        [flag, name],
        [name, flag],
        [name, "configure", flag]
      ]) {
        assert.deepEqual(
          await cli(args),
          { code: 0, output: cliVersionInfo, errors: "" },
          args.join(" ")
        );
      }
    }
  }
});

test("Service help lists public actions before extension commands in declaration order", async (t) => {
  const { cli } = await fixture(
    t,
    `export default {apiVersion:1,commands:[
    {name:"zeta",description:"First declared command",async run(){}},
    {name:"alpha",description:"Second declared command",async run(){}}
  ]};`
  );
  const help = await cli(["custom-service", "-h"]);
  assert.equal(help.code, 0, help.errors);
  assert.deepEqual(listedCommands(help.output), [
    "install",
    "uninstall",
    "start",
    "stop",
    "restart",
    "run",
    "status",
    "logs",
    "extraset",
    "extraget",
    "zeta",
    "alpha"
  ]);
  const examples = help.output.split("Examples:\n")[1].split("\n\n")[0];
  assert.match(examples, /octo-runtime custom-service start/);
  assert.match(examples, /octo-runtime custom-service extraset <<< '/);
  assert.match(examples, /octo-runtime custom-service zeta --help/);
});

test("Dynamic nested commands share help and parsing with native commands", async (t) => {
  const { home, cli } = await fixture(
    t,
    `export default {apiVersion:1,commands:[{
    name:"account",description:"Manage accounts",commands:[{
      name:"show",description:"Show an account",options:[{name:"display-name",type:"string",required:true,description:"Display name"}],
      arguments:[{name:"literal"}],examples:["octo-runtime custom-service account show --display-name demo"],
      async run(ctx,input){return {value:input};}
    }]
  }]};`
  );
  const parent = await cli(["custom-service", "-h"]);
  assert.equal(parent.code, 0, parent.errors);
  for (const name of [
    "account",
    "extraset",
    "extraget",
    "install",
    "uninstall",
    "run",
    "start",
    "restart",
    "stop"
  ])
    assert.match(parent.output, new RegExp(`^  ${name}\\s+\\S`, "m"));
  assert.equal(parent.output.split("Usage:").length, 2);
  assert.equal(parent.output.split("Available Commands:").length, 2);
  assert.doesNotMatch(parent.output, /^  config\s/m);
  for (const path of [
    ["adapter"],
    ["adapter", "probe"],
    ["executor-kernel", "install"],
    ["custom-service"],
    ["custom-service", "account"],
    ["custom-service", "account", "show"]
  ]) {
    const regular = await cli([...path, "--help"]);
    assert.equal(regular.code, 0, regular.errors);
    assert.deepEqual(await cli(["help", ...path]), regular);
  }
  const detail = await cli(["custom-service", "account", "show", "--help"]);
  assert.match(detail.output, /--display-name <value>/);
  assert.match(detail.output, /Examples:/);
  assert.equal(detail.output.split("Examples:").length, 2);
  assert.ok(detail.output.indexOf("Examples:") < detail.output.indexOf("Flags:"));
  assert.match(detail.output.split("Examples:\n")[1].split("\n\n")[0], /--display-name demo/);
  assert.match(detail.output, /Global Flags:/);
  assert.doesNotMatch(detail.output, /--profile/);
  const run = await cli([
    "custom-service",
    "account",
    "show",
    "--display-name=--json",
    "--",
    "--home"
  ]);
  assert.equal(run.code, 0, run.errors);
  assert.deepEqual(JSON.parse(run.output), {
    options: { "display-name": "--json" },
    arguments: ["--home"]
  });
  const literalVersion = await cli([
    "custom-service",
    "account",
    "show",
    "--display-name",
    "demo",
    "--",
    "--version"
  ]);
  assert.equal(literalVersion.code, 0, literalVersion.errors);
  assert.deepEqual(JSON.parse(literalVersion.output), {
    options: { "display-name": "demo" },
    arguments: ["--version"]
  });
  for (const args of [
    ["custom-service", "account", "show"],
    ["custom-service", "account", "show", "--display-name", "--home", home, "value"],
    ["custom-service", "account", "show", "--display-name", "one", "--display-name", "two"],
    ["custom-service", "account", "missing"]
  ])
    assert.equal((await cli(args)).code, 2, args.join(" "));
  await assert.rejects(access(join(home, "extras")));
});

test("Full declaration commands work offline and legacy aliases share storage and canonical help", async (t) => {
  const { cli, home, manifest } = await fixture(t);
  await writeFile(manifest, "broken metadata must not block offline config repair");
  const first = { enabled: false, module: join(home, "service.mjs"), config: { message: "first" } };
  assert.equal((await cli(["custom-service", "extraset"], JSON.stringify(first))).code, 0);
  assert.deepEqual(JSON.parse((await cli(["extraget", "custom-service"])).output), first);
  const second = { config: { message: "replacement" } };
  assert.equal((await cli(["extraset", "custom-service"], JSON.stringify(second))).code, 0);
  assert.deepEqual(JSON.parse((await cli(["custom-service", "extraget"])).output), second);
  assert.deepEqual(
    JSON.parse(await readFile(join(home, "extras/custom-service/config.json"), "utf8")),
    second
  );
  for (const action of ["extraset", "extraget"]) {
    const help = await cli(["custom-service", action, "--help"]);
    assert.equal(help.code, 0, help.errors);
    assert.match(help.output, new RegExp(`octo-runtime custom-service ${action}`));
    assert.deepEqual(await cli([action, "custom-service", "--help"]), help);
  }
});

test(
  "Here-string examples round-trip plugin metadata through a real shell without importing commands",
  { skip: process.platform === "win32" },
  async (t) => {
    const { home, manifest, cli } = await fixture(t);
    const metadata = JSON.parse(await readFile(manifest, "utf8"));
    const config = { label: "Agent's $HOME `false` $(false)", bots: [] };
    metadata.extras[0].configExample = config;
    await writeFile(manifest, JSON.stringify(metadata));
    const help = await cli(["custom-service", "extraset", "-h"]);
    assert.equal(help.code, 0, help.errors);
    const example = help.output.split("Examples:\n")[1].split("\n\n")[0];
    const script = example.replace(
      "octo-runtime",
      '"$EXAMPLE_NODE" "$EXAMPLE_CLI" --home "$EXAMPLE_HOME" --manifest "$EXAMPLE_MANIFEST"'
    );
    const saved = spawnSync("bash", ["-c", script], {
      env: {
        ...process.env,
        EXAMPLE_NODE: process.execPath,
        EXAMPLE_CLI: fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url)),
        EXAMPLE_HOME: home,
        EXAMPLE_MANIFEST: manifest
      },
      encoding: "utf8",
      timeout: 10000
    });
    assert.equal(saved.status, 0, saved.stderr);
    assert.deepEqual(JSON.parse((await cli(["custom-service", "extraget"])).output), {
      enabled: true,
      config
    });
  }
);

test("Built-in extraset examples contain complete schema-valid declarations", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-example-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const ajv = new Ajv({ strict: false, validateFormats: false });
  for (const name of ["channel-gateway", "channel-wecom", "webui"]) {
    const { help } = await parseCliCommand(["--home", home, name, "extraset", "--help"], {});
    const json = help.match(/<<< '([\s\S]*?)'\n/)[1].replace(/^  /gm, "");
    const declaration = JSON.parse(json);
    assert.equal(declaration.module, `@mininglamp-oss/octo-runtime-extra-${name}`);
    if (name !== "webui") {
      const bot = declaration.config.bots[0];
      assert.ok(bot.adapter.model);
      assert.equal(bot.adapter.effort, "medium");
      if (name === "channel-gateway") bot.bf_token = `bf_${randomUUID()}`;
      else bot.app_secret = randomUUID();
    }
    const schema = JSON.parse(
      await readFile(
        new URL(`../packages/octo-runtime-extra-${name}/config-schema.json`, import.meta.url),
        "utf8"
      )
    );
    const validate = ajv.compile(schema);
    assert.ok(validate(declaration), `${name}: ${ajv.errorsText(validate.errors)}`);
  }
  await assert.rejects(access(join(home, "extras")));
});

test("Extra boolean options preserve literal names without injecting negation defaults", async (t) => {
  const { cli } = await fixture(
    t,
    `export default {apiVersion:1,commands:[{
    name:"check",description:"Check flags",options:[
      {name:"no-cache",type:"boolean",description:"Bypass cache"},
      {name:"dry-run",type:"boolean",description:"Inspect only"}
    ],async run(ctx,input){return {value:input.options};}
  }]};`
  );
  const omitted = await cli(["custom-service", "check"]);
  assert.equal(omitted.code, 0, omitted.errors);
  assert.deepEqual(JSON.parse(omitted.output), {});
  const present = await cli(["custom-service", "check", "--no-cache", "--dry-run"]);
  assert.equal(present.code, 0, present.errors);
  assert.deepEqual(JSON.parse(present.output), { "no-cache": true, "dry-run": true });
  assert.equal((await cli(["custom-service", "check", "--no-cache", "--no-cache"])).code, 2);
});

test("Sibling Extra commands validate only their own options and global flags", async (t) => {
  for (const reversed of [false, true]) {
    const definitions = [
      `{name:"check",description:"Check flags",options:[{name:"mode",type:"boolean",description:"Check mode"}],async run(ctx,input){return {value:input.options};}}`,
      `{name:"configure",description:"Set mode",options:[{name:"mode",type:"string",required:true,description:"Mode value"},{name:"label",type:"string",description:"Configuration label"}],async run(ctx,input){return {value:input.options};}}`
    ];
    if (reversed) definitions.reverse();
    const commands = definitions.join(",");
    const { home, cli } = await fixture(
      t,
      `export default {apiVersion:1,commands:[${commands},{name:"account",description:"Nested commands",commands:[${commands}]}]};`
    );
    for (const path of [["custom-service"], ["custom-service", "account"]]) {
      for (const args of [
        [...path, "check", "--mode"],
        [...path, "check", "--mode", "--json"],
        [...path, "--json", "check", "--mode"],
        ["--json", ...path, "check", "--mode"]
      ]) {
        const result = await cli(args);
        assert.equal(result.code, 0, `${args.join(" ")}: ${result.errors}`);
        assert.deepEqual(JSON.parse(result.output), { mode: true });
      }
      for (const args of [
        [...path, "check", "--mode", "--help"],
        ["help", ...path, "check", "--mode"]
      ]) {
        const result = await cli(args);
        assert.equal(result.code, 0, `${args.join(" ")}: ${result.errors}`);
        assert.match(result.output, /--mode\s+Check mode/);
        assert.doesNotMatch(result.output, /--mode <value>/);
        assert.doesNotMatch(result.output, /--label/);
      }
      assert.equal((await cli([...path, "check", "--label", "other-command"])).code, 2);
      const configured = await cli([...path, "configure", "--mode", "fast"]);
      assert.equal(configured.code, 0, configured.errors);
      assert.deepEqual(JSON.parse(configured.output), { mode: "fast" });
      for (const args of [
        [...path, "configure"],
        [...path, "configure", "--mode"],
        [...path, "configure", "--mode", "--json", "fast"],
        [...path, "configure", "--mode", "fast", "--mode", "slow"]
      ])
        assert.equal((await cli(args)).code, 2, args.join(" "));
    }
    await assert.rejects(access(join(home, "extras")));
  }
});

test("Extra option names do not inherit values or conflicts from Object.prototype", async (t) => {
  const { cli } = await fixture(
    t,
    `export default {apiVersion:1,commands:[{
      name:"check",description:"Check input",options:[
        {name:"constructor",type:"string",required:true,description:"Construction mode"},
        {name:"mode",type:"string",description:"Optional mode"}
      ],async run(ctx,input){return {value:input.options};}
    }]};`
  );
  assert.equal((await cli(["custom-service", "check"])).code, 2);
  const result = await cli(["custom-service", "check", "--constructor", "factory"]);
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(JSON.parse(result.output), { constructor: "factory" });
});

test("Native options retain their legacy position before components without accepting duplicates", async () => {
  for (const [prefix, path, expected] of [
    [["--autostart=false"], ["executor-kernel", "install"], { autostart: "false" }],
    [["--lines", "100", "--follow"], ["channel-wecom", "logs"], { lines: "100", follow: "true" }],
    [
      ["--acknowledge-orphan-cleanup"],
      ["executor-kernel", "recover"],
      { "acknowledge-orphan-cleanup": "true" }
    ]
  ]) {
    const result = await parseCliCommand([...prefix, ...path], {});
    assert.deepEqual(result.positional, path);
    for (const [key, value] of Object.entries(expected)) assert.equal(result.flags[key], value);
  }
  await assert.rejects(
    parseCliCommand(["--autostart=false", "executor-kernel", "install", "--autostart=true"], {}),
    /INVALID_ARGUMENTS/
  );
});

test("Legacy JSON equals flags keep parse failures machine readable", async (t) => {
  const { cli } = await fixture(
    t,
    'export default {apiVersion:1,commands:[{name:"check",description:"Check",options:[{name:"value",type:"string",required:true,description:"Value"}],async run(){}}]};'
  );
  const result = await cli(["custom-service", "check", "--json=true"]);
  assert.equal(result.code, 2);
  assert.equal(result.errors, "");
  assert.equal(JSON.parse(result.output).error.code, "INVALID_ARGUMENTS");
});

test("Built-ins remove config set/get while third-party commands retain ownership of their subtree", async (t) => {
  const { home, cli } = await fixture(
    t,
    'export default {apiVersion:1,commands:[{name:"config",description:"Business settings",commands:[{name:"inspect",description:"Inspect",async run(){return {value:{custom:true}};}}]}]};'
  );
  const custom = await cli(["custom-service", "config", "inspect"]);
  assert.equal(custom.code, 0, custom.errors);
  assert.deepEqual(JSON.parse(custom.output), { custom: true });
  for (const name of ["channel-gateway", "channel-wecom", "webui"]) {
    for (const action of ["get", "set"]) {
      const code = await runCli(["--home", home, name, "config", action], {
        output() {},
        errorOutput() {}
      });
      assert.equal(code, 2);
    }
  }
});
