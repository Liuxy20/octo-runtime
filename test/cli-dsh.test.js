import test from "node:test";
import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { readCliAdapterConfigurations } from "../apps/cli/dist/adapter-configurations.js";
import { runCli } from "../apps/cli/dist/main.js";
import { runPlayboard } from "../apps/cli/dist/playboard.js";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, waitFor } from "./runtime-fixture.js";

const runtime = fileURLToPath(new URL("./fixtures/dsh-runtime.mjs", import.meta.url));
const module = fileURLToPath(
  new URL("../packages/octo-runtime-adapter-dsh/dist/index.js", import.meta.url)
);
const manifest = {
  version: 1,
  adapters: [{ type: "dsh", module, export: "dshAdapter" }],
  extras: []
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cli-dsh 空格 "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function environment(path, values = {}) {
  const env = { ...process.env, ...values };
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  env[process.platform === "win32" ? "Path" : "PATH"] = path;
  return env;
}

async function installation(root, layout = "global") {
  const local = layout === "local";
  const modules = join(root, local || process.platform === "win32" ? "" : "lib", "node_modules");
  const packageRoot = join(modules, "@deepseek-ai", "dsh");
  const bin = local
    ? join(modules, ".bin")
    : process.platform === "win32"
      ? root
      : join(root, "bin");
  const dshBin = join(packageRoot, "lib", "bin.mjs");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await cp(runtime, dshBin);
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "@deepseek-ai/dsh", bin: { dsh: "lib/bin.mjs" } })
  );
  const command = join(bin, process.platform === "win32" ? "dsh.cmd" : "dsh");
  // shim 故意不可运行；宿主必须读取 npm 元数据并将 JS 入口交给 Adapter。
  await writeFile(command, "This shim must never be executed.\n");
  await chmod(command, 0o755);
  return { bin, dshBin, command, packageRoot };
}

for (const layout of ["global", "local"])
  test(`CLI resolves ${layout} npm metadata without executing the shim`, async (t) => {
    const directory = await fixture(t);
    const selected = await installation(directory, layout);
    const env = environment(selected.bin);
    const before = { ...env };
    const config = await readCliAdapterConfigurations(directory, undefined, manifest, env);
    assert.equal(config.dsh.providerOptions.dshBin, selected.dshBin);
    assert.deepEqual(env, before);
  });

test(
  "CLI resolves npm symlinks through the selected package's bin metadata",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await fixture(t);
    const selected = await installation(join(directory, "installation"));
    const bin = join(directory, "custom-bin");
    await mkdir(bin);
    await symlink(selected.dshBin, join(bin, "dsh"));
    await chmod(selected.dshBin, 0o755);
    const config = await readCliAdapterConfigurations(
      directory,
      undefined,
      manifest,
      environment(bin)
    );
    assert.equal(
      await readFile(config.dsh.providerOptions.dshBin, "utf8"),
      await readFile(runtime, "utf8")
    );
    assert.ok(config.dsh.providerOptions.dshBin.endsWith(join("dsh", "lib", "bin.mjs")));
  }
);

test("CLI preserves explicit DSH configuration and other host options", async (t) => {
  const directory = await fixture(t);
  const selected = await installation(directory);
  const explicit = join(directory, "missing.mjs");
  const config = await readCliAdapterConfigurations(
    directory,
    { dsh: { execution: { provider_options: { dshBin: explicit, dshHome: directory } } } },
    manifest,
    environment(selected.bin)
  );
  assert.deepEqual(config.dsh.providerOptions, { dshBin: explicit, dshHome: directory });
  const automatic = await readCliAdapterConfigurations(
    directory,
    {
      dsh: {
        execution: {
          provider_options: { dshHome: directory },
          stream_limits: { raw_message_max_bytes: 8192 }
        }
      }
    },
    manifest,
    environment(selected.bin)
  );
  assert.deepEqual(automatic.dsh.providerOptions, { dshBin: selected.dshBin, dshHome: directory });
  assert.equal(automatic.dsh.streamLimits.rawMessageMaxBytes, 8192);
});

test("CLI fixes the first PATH installation and does not select another package", async (t) => {
  const directory = await fixture(t);
  const first = await installation(join(directory, "first"));
  const second = await installation(join(directory, "second"));
  await rm(first.dshBin);
  const env = environment([first.bin, second.bin].join(delimiter));
  const config = await readCliAdapterConfigurations(directory, undefined, manifest, env);
  assert.equal(config.dsh.providerOptions.dshBin, first.dshBin);
  for (const metadata of [
    "{",
    JSON.stringify({ name: "unrelated" }),
    JSON.stringify({ name: "@deepseek-ai/dsh" }),
    JSON.stringify({ name: "@deepseek-ai/dsh", bin: { dsh: "" } }),
    JSON.stringify({ name: "@deepseek-ai/dsh", bin: { dsh: "../outside.mjs" } })
  ]) {
    await writeFile(join(first.packageRoot, "package.json"), metadata);
    assert.equal(
      (await readCliAdapterConfigurations(directory, undefined, manifest, env)).dsh,
      undefined,
      metadata
    );
  }
});

for (const kind of ["dangling-link", "not-executable", "directory"])
  test(
    `CLI does not skip an existing first PATH candidate: ${kind}`,
    { skip: kind === "not-executable" && process.platform === "win32" },
    async (t) => {
      const directory = await fixture(t);
      const first = await installation(join(directory, "first"));
      const second = await installation(join(directory, "second"));
      if (kind === "not-executable") await chmod(first.command, 0o644);
      else {
        await rm(first.command);
        if (kind === "directory") await mkdir(first.command);
        else
          await symlink(
            join(directory, "missing-target"),
            first.command,
            process.platform === "win32" ? "junction" : "file"
          );
      }
      const config = await readCliAdapterConfigurations(
        directory,
        undefined,
        manifest,
        environment([first.bin, second.bin].join(delimiter))
      );
      assert.equal(config.dsh, undefined);
    }
  );

test("CLI skips a genuinely absent PATH command and selects the next installation", async (t) => {
  const directory = await fixture(t);
  const first = await installation(join(directory, "first"));
  const second = await installation(join(directory, "second"));
  await rm(first.command);
  const config = await readCliAdapterConfigurations(
    directory,
    undefined,
    manifest,
    environment([first.bin, second.bin].join(delimiter))
  );
  assert.equal(config.dsh.providerOptions.dshBin, second.dshBin);
});

test("CLI accepts string npm bin metadata and rejects entries outside the package", async (t) => {
  const directory = await fixture(t);
  const selected = await installation(directory);
  const read = () =>
    readCliAdapterConfigurations(directory, undefined, manifest, environment(selected.bin));
  await writeFile(
    join(selected.packageRoot, "package.json"),
    JSON.stringify({ name: "@deepseek-ai/dsh", bin: "lib/bin.mjs" })
  );
  assert.equal((await read()).dsh.providerOptions.dshBin, selected.dshBin);
  for (const bin of ["../outside.mjs", selected.dshBin, { another: "lib/bin.mjs" }]) {
    await writeFile(
      join(selected.packageRoot, "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh", bin })
    );
    assert.equal((await read()).dsh, undefined);
  }
});

test("CLI leaves SDK-style configuration empty when DSH is absent or unselected", async (t) => {
  const directory = await fixture(t);
  assert.equal(
    (await readCliAdapterConfigurations(directory, undefined, manifest, environment(directory)))
      .dsh,
    undefined
  );
  const selected = await installation(directory);
  assert.equal(
    (
      await readCliAdapterConfigurations(
        directory,
        undefined,
        { ...manifest, adapters: [] },
        environment(selected.bin)
      )
    ).dsh,
    undefined
  );
  const legacy = { ...manifest, adapters: [{ module, export: "dshAdapter" }] };
  assert.equal(
    (await readCliAdapterConfigurations(directory, undefined, legacy, environment(selected.bin)))
      .dsh.providerOptions.dshBin,
    selected.dshBin
  );
});

test(
  "CLI foreground Kernel discovers DSH and invokes without manual dshBin",
  { timeout: 20_000 },
  async (t) => {
    const directory = await fixture(t);
    const selected = await installation(directory);
    const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "cd-"));
    const file = join(directory, "manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    const original = new Set(process.listeners("SIGTERM"));
    let ready = false;
    let client;
    const running = runCli(
      ["--home", home, "--manifest", file, "--json", "executor-kernel", "run"],
      {
        env: environment(selected.bin),
        output: (line) => {
          ready ||= line.includes('"state": "ready"');
        }
      }
    );
    t.after(async () => {
      client?.close();
      for (const stop of process.listeners("SIGTERM")) if (!original.has(stop)) stop();
      assert.equal(await running, 0);
      await rm(home, { recursive: true, force: true });
    });
    await waitFor(() => ready, 10_000);
    client = attachKernel({ endpoint: componentEndpoint(home) });
    assert.equal((await client.list()).find((entry) => entry.type === "dsh").available, true);
    const events = await Array.fromAsync(
      client.invoke(
        invocationInput(
          invokeRequest({ workdir: directory, approvalMode: "full_access", modelInput: "hello" }),
          "canonical",
          "dsh"
        )
      )
    );
    assert.equal(events.at(-1).type, "run.completed");
  }
);

test(
  "CLI playboard route uses injected PATH instead of process PATH",
  { timeout: 15_000 },
  async (t) => {
    const directory = await fixture(t);
    const selected = await installation(join(directory, "selected"));
    const other = await installation(join(directory, "process"));
    await writeFile(
      other.dshBin,
      `process.env.OCTO_DSH_FIXTURE = "version";\n${await readFile(runtime, "utf8")}`
    );
    const file = join(directory, "manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    const input = invocationInput(
      invokeRequest({ workdir: directory, approvalMode: "full_access", modelInput: "hello" }),
      "canonical",
      "dsh"
    );
    const env = environment(selected.bin, { OCTO_DSH_FIXTURE: "success" });
    const frames = [];
    const original = process.env;
    // 两套 PATH 都只含本测试的 fake Provider，防止漏传 env 时调用真实安装。
    process.env = environment(other.bin, { OCTO_DSH_FIXTURE: "success" });
    try {
      const code = await runCli(
        ["--home", join(directory, "home"), "--manifest", file, "playboard"],
        {
          env,
          input: Readable.from([JSON.stringify(input)]),
          output: (line) => frames.push(JSON.parse(line))
        }
      );
      assert.equal(code, 0, JSON.stringify(frames.at(-1)));
      assert.equal(frames.at(-1).type, "run.completed");
    } finally {
      process.env = original;
    }
  }
);

for (const [mode, reason] of [
  ["success", undefined],
  ["version", "DSH_VERSION_UNSUPPORTED"],
  ["missing", "DSH_EXECUTABLE_NOT_FOUND"],
  ["explicit-missing", "DSH_EXECUTABLE_NOT_FOUND"]
])
  test(
    `CLI playboard shares host discovery and preserves selected failures: ${mode}`,
    { timeout: 15_000 },
    async (t) => {
      const directory = await fixture(t);
      const first = await installation(join(directory, "first"));
      const second = await installation(join(directory, "second"));
      if (mode === "missing") await rm(first.dshBin);
      if (mode === "version")
        await writeFile(
          first.dshBin,
          `process.env.OCTO_DSH_FIXTURE = "version";\n${await readFile(runtime, "utf8")}`
        );
      const home = join(directory, "home");
      if (mode === "explicit-missing") {
        await mkdir(join(home, "default"), { recursive: true });
        await writeFile(
          join(home, "default", "config.json"),
          JSON.stringify({
            adapters: {
              dsh: { execution: { provider_options: { dshBin: join(directory, "missing.mjs") } } }
            }
          })
        );
      }
      const file = join(directory, "manifest.json");
      await writeFile(file, JSON.stringify(manifest));
      const input = invocationInput(
        invokeRequest({ workdir: directory, approvalMode: "full_access", modelInput: "hello" }),
        "canonical",
        "dsh"
      );
      const frames = [];
      const code = await runPlayboard({
        input: Readable.from([JSON.stringify(input)]),
        output: (line) => frames.push(JSON.parse(line)),
        env: environment([first.bin, second.bin].join(delimiter), {
          OCTO_DSH_FIXTURE: "success"
        }),
        home,
        manifest: file
      });
      assert.equal(code, reason ? 1 : 0);
      assert.equal(frames.at(-1).type, reason ? "run.failed" : "run.completed");
      if (reason) assert.equal(frames.at(-1).payload.failure.reasonCode, reason);
    }
  );
