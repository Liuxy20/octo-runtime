import test from "node:test";
import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { probeCommand } from "../packages/octo-runtime-adapter-sdk/dist/index.js";

const execute = promisify(execFile);

async function createProviderFixture(directory) {
  if (process.platform === "win32") {
    // 沿用 Windows console 测试工具链；编译产物仅保留在忽略的测试缓存中，
    // 实际探测独占临时目录中的副本，确保路径与清理断言覆盖真实启动。
    const cache = fileURLToPath(new URL("../.cache/test-support/", import.meta.url));
    await mkdir(cache, { recursive: true });
    const build = await mkdtemp(join(cache, "provider-discovery-"));
    const executable = join(build, "provider.exe");
    await execute(
      join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
      [
        "/nologo",
        `/out:${executable}`,
        fileURLToPath(new URL("../test-support/provider-discovery.cs", import.meta.url))
      ],
      { windowsHide: true, timeout: 10_000 }
    );
    const command = join(directory, "provider.exe");
    await copyFile(executable, command);
    return command;
  }
  const command = join(directory, "provider");
  await writeFile(
    command,
    '#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then echo \'provider v1.2.3\'; else exit 23; fi\n'
  );
  await chmod(command, 0o700);
  return command;
}

test("provider discovery reports real executable path/version, not adapter version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "octo provider 中文-"));
  try {
    const command = await createProviderFixture(directory);
    const { stdout } = await execute(command, ["--version"], { windowsHide: true });
    assert.equal(stdout.trim(), "provider v1.2.3");
    await assert.rejects(
      execute(command, ["--version", "unexpected argument"], { windowsHide: true }),
      { code: 23, stdout: "" }
    );
    const result = await probeCommand(command);
    assert.deepEqual(result, { available: true, command, version: "1.2.3" });
    const host = new AgentExecutor();
    host.register({
      metadata: {
        protocolSupport: {
          protocol: "codex" + ".canonical",
          modes: ["canonical"],
          nativeMethods: []
        },
        type: "codex",
        agentSources: ["provisioned"]
      },
      probe: () => probeCommand(command),
      async *invoke() {}
    });
    assert.deepEqual(await host.describe(), [
      {
        type: "codex",
        agentSources: ["provisioned"],
        protocolSupport: { protocol: "codex.canonical", modes: ["canonical"], nativeMethods: [] },
        available: true,
        providerPath: command,
        providerVersion: "1.2.3",
        unavailableReason: null
      }
    ]);
    assert.ok(host.list().every((adapter) => !Object.hasOwn(adapter, "capabilities")));
    assert.ok(
      [...host.list(), ...(await host.describe())].every(
        (adapter) => !Object.hasOwn(adapter, "executionFeatures")
      )
    );
    await mkdir(join(directory, "not-a-command"));
    assert.equal((await probeCommand(join(directory, "not-a-command"))).available, false);
    assert.equal((await probeCommand(join(directory, "missing"))).available, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing and failed probes report unavailable without invented provider metadata", async () => {
  const host = new AgentExecutor();
  for (const [type, probe] of [
    ["missing", () => ({ available: false, command: "missing", reason: "command_not_found" })],
    [
      "failed",
      () => {
        throw new Error("probe failed");
      }
    ],
    ["unchecked", undefined]
  ]) {
    host.register({
      metadata: {
        protocolSupport: { protocol: type + ".canonical", modes: ["canonical"], nativeMethods: [] },
        type,
        agentSources: ["provisioned"]
      },
      ...(probe ? { probe } : {}),
      async *invoke() {}
    });
  }
  for (const provider of await host.describe()) {
    assert.equal(provider.available, false);
    assert.equal(provider.providerPath, null);
    assert.equal(provider.providerVersion, null);
    assert.equal(
      provider.unavailableReason,
      { missing: "command_not_found", failed: "probe_failed", unchecked: "probe_missing" }[
        provider.type
      ]
    );
  }
});
