import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { parseCliCommand } from "../apps/cli/dist/command-tree.js";
import { runCli } from "../apps/cli/dist/main.js";

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

test("Native options retain their legacy position before components without accepting duplicates", async () => {
  for (const [prefix, path, expected] of [
    [["--autostart=false"], ["executor-kernel", "install"], { autostart: "false" }],
    [["--lines", "100", "--follow"], ["executor-kernel", "logs"], { lines: "100", follow: "true" }],
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
