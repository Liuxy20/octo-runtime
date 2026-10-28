import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { inspect } from "node:util";
import vm from "node:vm";
import test from "node:test";
import {
  executeVerificationCommand as execute,
  verificationCommandError
} from "../scripts/verification-command.mjs";

const windows = process.platform === "win32";
const entrySource = `
if (process.argv.includes('--fail')) { console.error('business failure'); process.exit(7); }
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.FIXTURE_VALUE }));
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "octo verification 中文 "));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: `${root}${delimiter}${dirname(process.execPath)}`,
    PATHEXT: ".EXE;.CMD;.BAT;.COM",
    HOME: root,
    USERPROFILE: root,
    APPDATA: root,
    XDG_CONFIG_HOME: root,
    FIXTURE_VALUE: randomUUID()
  };
  return { root, env, options: { env, cwd: root, timeout: 10_000, windowsHide: true } };
}

async function shim(root, command, { local = false, source = entrySource, macro = "%dp0%" } = {}) {
  const directory = local ? join(root, "node_modules/.bin") : root;
  const relative =
    command === "npm"
      ? local
        ? "../npm/bin/npm-cli.js"
        : "node_modules/npm/bin/npm-cli.js"
      : local
        ? "../@mininglamp-oss/octo-cli/bin/octo-cli.js"
        : "node_modules/@mininglamp-oss/octo-cli/bin/octo-cli.js";
  const entry = join(directory, relative);
  await mkdir(dirname(entry), { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(entry, source);
  await writeFile(
    join(directory, `${command}.cmd`),
    `@echo off\r\nnode "${macro}\\${relative.replaceAll("/", "\\")}" %*\r\n`
  );
  return { directory, entry };
}

for (const command of ["npm", "octo-cli"]) {
  for (const local of [false, true]) {
    test(
      `Windows ${command} ${local ? "local" : "global"} shim preserves argv, cwd and env`,
      { skip: !windows },
      async (t) => {
        const { root, env, options } = await fixture(t);
        const { directory } = await shim(root, command, {
          local,
          macro: local ? "%dp0%" : "%~dp0"
        });
        env.PATH = directory;
        const args = [
          "version",
          "",
          "中文 空格",
          JSON.stringify({ text: 'quote " & | < > ^ %PATH% !value! \\ tail' }),
          "trailing\\"
        ];
        const { stdout, stderr } = await execute(command, args, options);
        assert.equal(stderr, "");
        assert.deepEqual(JSON.parse(stdout), { args, cwd: root, value: env.FIXTURE_VALUE });
      }
    );
  }
}

test(
  "Windows relative PATH and case aliases select the child environment",
  { skip: !windows },
  async (t) => {
    const { root, env, options } = await fixture(t);
    await shim(join(root, "chosen"), "octo-cli");
    delete env.PATH;
    env.Path = "missing";
    env.PATH = '"chosen"';
    const { stdout } = await execute("octo-cli", ["version"], options);
    assert.deepEqual(JSON.parse(stdout).args, ["version"]);
  }
);

test(
  "Windows selected invalid or broken shim does not fall through to another installation",
  { skip: !windows },
  async (t) => {
    const { root, env, options } = await fixture(t);
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(first);
    await shim(second, "octo-cli");
    env.PATH = `${first};${second}`;
    await writeFile(join(first, "octo-cli.cmd"), "@echo off\r\necho custom wrapper\r\n");
    await assert.rejects(execute("octo-cli", [], options), { code: "EINVAL" });
    const { entry } = await shim(first, "octo-cli");
    await rm(entry);
    await assert.rejects(execute("octo-cli", [], options), { code: "ENOENT" });
  }
);

test("Windows original npm prefix override remains effective", { skip: !windows }, async (t) => {
  const { root, options } = await fixture(t);
  const { entry } = await shim(root, "npm");
  const prefix = join(root, "updated npm");
  const updated = await shim(prefix, "npm", { source: "console.log('selected-prefix-npm')" });
  await writeFile(join(dirname(entry), "npm-prefix.js"), `console.log(${JSON.stringify(prefix)})`);
  await writeFile(
    join(root, "npm.cmd"),
    `@echo off\r\nset "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\nrem NPM_PREFIX_NPM_CLI_JS\r\n`
  );
  assert.ok(updated.entry);
  assert.equal((await execute("npm", ["--version"], options)).stdout.trim(), "selected-prefix-npm");
});

test(
  "Windows native exe keeps direct launch and argv boundaries",
  { skip: !windows },
  async (t) => {
    const { root, options } = await fixture(t);
    const executable = join(root, "octo-cli.exe");
    try {
      await link(process.execPath, executable);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await copyFile(process.execPath, executable);
    }
    const args = ["空格 中文", '{"text":"& | %value% ! ^ \\\""}'];
    const { stdout } = await execute(
      "octo-cli",
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...args],
      options
    );
    assert.deepEqual(JSON.parse(stdout), args);
  }
);

test("POSIX keeps the selected executable and argument arrays", { skip: windows }, async (t) => {
  const { root, options } = await fixture(t);
  const program = join(root, "octo-cli");
  await writeFile(program, `#!/usr/bin/env node\n${entrySource}`);
  await chmod(program, 0o700);
  const args = ["中文 空格", '{"text":"$HOME ; & |"}'];
  assert.deepEqual(JSON.parse((await execute("octo-cli", args, options)).stdout).args, args);
});

test("missing installation preserves ENOENT; business failure preserves numeric exit and stderr", async (t) => {
  const { root, options } = await fixture(t);
  await assert.rejects(execute("octo-cli", ["version"], options), { code: "ENOENT" });
  const program = join(root, "exit.cjs");
  await writeFile(program, entrySource);
  await assert.rejects(execute(process.execPath, [program, "--fail"], options), (error) => {
    assert.equal(error.code, 7);
    assert.equal(error.stderr.trim(), "business failure");
    return true;
  });
});

test("Windows shim forwards nonzero exit and maxBuffer", { skip: !windows }, async (t) => {
  const { root, options } = await fixture(t);
  await shim(root, "octo-cli");
  await assert.rejects(execute("octo-cli", ["--fail"], options), {
    code: 7,
    stderr: "business failure\n"
  });
  await assert.rejects(execute("octo-cli", ["version"], { ...options, maxBuffer: 8 }), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  });
});

test(
  "Windows shim forwards timeout without waiting for the command to finish",
  { skip: !windows },
  async (t) => {
    const { root, options } = await fixture(t);
    await shim(root, "octo-cli", { source: "setInterval(() => {}, 1000)" });
    await assert.rejects(execute("octo-cli", [], { ...options, timeout: 500 }), (error) => {
      assert.equal(error.killed, true);
      return true;
    });
  }
);

const wrappers = [
  "channel-features",
  "channel-group-entrypoints",
  "channel-connection",
  "gateway-drain",
  "opencode-im",
  "im-diagnostic"
];
for (const name of wrappers) {
  test(`${name} original wrapper retains safe launch diagnostics`, async () => {
    const source = await readFile(
      new URL(`../scripts/verify-${name}-live.mjs`, import.meta.url),
      "utf8"
    );
    const helper = source.match(/^async function cli\(account, args, body\) \{[\s\S]*?^\}/m)?.[0];
    assert.ok(helper);
    for (const code of ["ENOENT", "EINVAL", 7]) {
      const sensitive = randomUUID();
      const original = Object.assign(new Error(sensitive), {
        code,
        errno: code === "ENOENT" ? -4058 : undefined,
        stderr: sensitive,
        stdout: sensitive,
        cmd: sensitive
      });
      const cli = vm.runInNewContext(`${helper}\ncli`, {
        execute: async () => {
          throw original;
        },
        verificationCommandError,
        process: { env: {} },
        assert,
        directory: ".",
        report: { endpoint: "https://im-test.deepminer.com.cn" }
      });
      await assert.rejects(
        cli({ api: "https://im-test.deepminer.com.cn/api" }, ["version"]),
        (error) => {
          assert.equal(error.code, code);
          assert.equal(error.errno, original.errno);
          assert.match(
            error.message,
            typeof code === "number" ? /exit:7/ : new RegExp(`spawn:${code}`)
          );
          assert.ok(!inspect(error).includes(sensitive));
          return true;
        }
      );
    }
  });
}
