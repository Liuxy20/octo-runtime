import assert from "node:assert/strict";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { probeCommand, spawnJsonLines } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { createCodexAdapter } from "../packages/octo-runtime-adapter-codex/dist/index.js";
import { createClaudeCodeAdapter } from "../packages/octo-runtime-adapter-claude-code/dist/index.js";
import { spawnAcpClient } from "../packages/octo-runtime-acp-client/dist/index.js";
import { spawnGrokBuildAcpClient } from "../packages/octo-runtime-adapter-grok-build/dist/client.js";
import { invokeRequest } from "./runtime-fixture.js";
import { resolveProcessLaunch } from "../packages/octo-runtime-adapter-sdk/dist/process-launch.js";

const windows = process.platform === "win32";
const source = fileURLToPath(new URL("./fixtures/windows-command-provider.mjs", import.meta.url));
const shimHeader =
  "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n";

test("POSIX launch keeps the original executable and argv without Windows carrier lookup", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { ...original, value: "linux" });
    const args = ["a b", '{"value":"$HOME & |"}'];
    const launch = resolveProcessLaunch("provider", args, { env: {}, cwd: "/missing" });
    assert.equal(launch.command, "provider");
    assert.equal(launch.args, args);
  } finally {
    Object.defineProperty(process, "platform", original);
  }
});

async function fixture(t, name = "provider") {
  const root = await mkdtemp(join(tmpdir(), "octo launch 中文 "));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const entry = join(root, "node_modules/@fixture", name, "bin/main.mjs");
  await mkdir(dirname(entry), { recursive: true });
  await copyFile(source, entry);
  const relative = `node_modules\\@fixture\\${name}\\bin\\main.mjs`;
  const command = join(root, `${name}.cmd`);
  await writeFile(command, `${shimHeader}node "%dp0%\\${relative}" %*\r\n`);
  // npm 同时生成 Unix 入口；探测返回此路径时也必须能用于后续启动。
  await writeFile(join(root, name), '#!/bin/sh\nexec node unused "$@"\n');
  const env = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: `${root};${dirname(process.execPath)};${process.env.SystemRoot}/System32`,
    PATHEXT: ".EXE;.CMD;.BAT;.COM",
    HOME: root,
    USERPROFILE: root,
    CODEX_HOME: root,
    CLAUDE_CONFIG_DIR: root,
    APPDATA: root,
    FIXTURE_MARKER: randomUUID(),
    FIXTURE_PID_FILE: join(root, "pid")
  };
  return { root, command, entry, env };
}

async function lines(command, args, f, extra = {}) {
  return Array.fromAsync(
    spawnJsonLines({ command, args, cwd: f.root, env: f.env, parseLine: JSON.parse, ...extra })
  );
}

test(
  "Windows shared JSON-lines launches an npm shim with exact argv/env/cwd",
  { skip: !windows },
  async (t) => {
    const f = await fixture(t);
    const args = [
      "",
      "中文 空格",
      '{"text":"quote \\\" & | < > ^ %PATH% !literal!"}',
      "trailing\\"
    ];
    const [output] = await lines("provider", ["json", ...args], f);
    assert.deepEqual(output, { args, cwd: f.root, marker: f.env.FIXTURE_MARKER });
  }
);

test(
  "Windows probe and subsequent launch agree for bare, cmd and npm Unix entry paths",
  { skip: !windows },
  async (t) => {
    const f = await fixture(t);
    for (const command of ["provider", f.command, join(f.root, "provider")]) {
      const probe = await probeCommand(command, { env: f.env, cwd: f.root });
      assert.equal(probe.available, true);
      assert.equal(probe.version, "1.2.3");
      assert.deepEqual((await lines(probe.command, ["json", "selected"], f))[0].args, ["selected"]);
    }
  }
);

for (const [name, create] of [
  ["codex", (env) => createCodexAdapter({ env })],
  ["claude", () => createClaudeCodeAdapter()]
]) {
  test(
    `Windows default ${name} Adapter completes through its npm shim and closes its process`,
    { skip: !windows, timeout: 10000 },
    async (t) => {
      const f = await fixture(t, name);
      const request = invokeRequest({
        workdir: f.root,
        approvalMode: "full_access",
        signal: AbortSignal.timeout(7000),
        executionEnvOverrides: {
          env_variables: Object.entries(f.env)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => ({ key, value }))
        }
      });
      const events = await Array.fromAsync(create(f.env).invoke(request));
      assert.equal(events.filter((event) => event.type === "run.completed").length, 1);
      assert.ok(!events.some((event) => ["run.failed", "run.cancelled"].includes(event.type)));
      const pid = Number(await readFile(f.env.FIXTURE_PID_FILE, "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  );
}

for (const [label, create] of [
  ["ACP", spawnAcpClient],
  ["Grok ACP", spawnGrokBuildAcpClient]
]) {
  test(
    `Windows ${label} preserves synchronous creation, initialize, close and later calls`,
    { skip: !windows, timeout: 10000 },
    async (t) => {
      const f = await fixture(t);
      for (const command of ["provider", f.command]) {
        const client = create({
          command,
          args: ["acp"],
          env: f.env,
          cwd: f.root,
          signal: AbortSignal.timeout(5000)
        });
        assert.equal(client.then, undefined);
        let pid;
        try {
          const result = await client.initialize();
          assert.equal(result.marker, f.env.FIXTURE_MARKER);
          pid = result.pid;
        } finally {
          await client.close();
        }
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
    }
  );
}

test(
  "Windows native exe wrapper bypasses Node script parsing and keeps argv",
  { skip: !windows },
  async (t) => {
    const f = await fixture(t);
    const binary = join(f.root, "native.exe");
    try {
      await link(process.execPath, binary);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await copyFile(process.execPath, binary);
    }
    await writeFile(f.command, `${shimHeader}"%~dp0\\native.exe" %*\r\n`);
    const [output] = await lines(
      f.command,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", "a & b", "中文 空格"],
      f
    );
    assert.deepEqual(output, ["a & b", "中文 空格"]);
  }
);

test(
  "Windows missing, unknown and nonzero commands retain distinct failures",
  { skip: !windows },
  async (t) => {
    const f = await fixture(t);
    await assert.rejects(lines(join(f.root, "missing"), [], f), { code: "ENOENT" });
    await assert.rejects(
      lines("provider", ["exit"], f),
      (error) => error.exit?.code === 7 && /controlled failure/.test(error.message)
    );
    await writeFile(f.command, "@echo off\r\necho arbitrary custom batch\r\n");
    await assert.rejects(lines(f.command, [], f), { code: "EINVAL" });
    await writeFile(
      f.command,
      `@echo off\r\nnode "%~dp0\\node_modules\\@fixture\\provider\\bin\\main.mjs" %*\r\n`
    );
    await assert.rejects(lines(f.command, [], f), { code: "EINVAL" });
  }
);

test(
  "Windows cancellation through a shim reclaims only its started Provider",
  { skip: !windows, timeout: 8000 },
  async (t) => {
    const f = await fixture(t);
    const controller = new AbortController();
    let pid;
    try {
      for await (const line of spawnJsonLines({
        command: "provider",
        args: ["hold"],
        env: f.env,
        cwd: f.root,
        signal: controller.signal,
        parseLine: JSON.parse
      })) {
        pid = line.pid;
        controller.abort();
      }
    } catch {
      assert.equal(controller.signal.aborted, true);
    }
    assert.ok(pid);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
);

test(
  "Windows command selection is per-run, immutable and does not fall through a broken first install",
  { skip: !windows },
  async (t) => {
    const first = await fixture(t);
    const second = await fixture(t);
    const outputs = await Promise.all([first, second].map((f) => lines("provider", ["json"], f)));
    assert.equal(outputs[0][0].marker, first.env.FIXTURE_MARKER);
    assert.equal(outputs[1][0].marker, second.env.FIXTURE_MARKER);
    const env = Object.freeze({
      PATH: `"${first.root}";${second.env.PATH}`,
      Path: second.root,
      PATHEXT: ".CMD;.EXE"
    });
    await rm(first.entry);
    assert.throws(() => resolveProcessLaunch("provider", ["json"], { env, cwd: first.root }), {
      code: "ENOENT"
    });
    assert.equal(env.Path, second.root);
  }
);
