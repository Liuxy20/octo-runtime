import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

test(
  "isolated SDK host natively composes selected modules without CLI, manifest or unselected packages",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(
      join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ons-")
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const copied = new Set();
    async function collect(name, from = root) {
      if (copied.has(name)) return;
      copied.add(name);
      const source = name.startsWith("@mininglamp-oss/")
        ? join(root, "packages", name.split("/")[1])
        : await realpath(join(from, "node_modules", name));
      const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      const target = join(directory, "node_modules", name);
      await mkdir(target, { recursive: true });
      if (name.startsWith("@mininglamp-oss/")) {
        await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
        await writeFile(join(target, "package.json"), JSON.stringify(metadata));
      } else
        await cp(source, target, {
          recursive: true,
          filter: (path) => path.split(/[\\/]/).at(-1) !== "node_modules"
        });
      for (const dependency of Object.keys(metadata.dependencies ?? {}))
        await collect(dependency, source);
    }
    await collect("@mininglamp-oss/octo-runtime-host-sdk");
    assert.ok([...copied].every((name) => !name.includes("runtime-extra-")));
    assert.ok(
      [...copied].every((name) => !name.includes("runtime-adapter-") || name.endsWith("-sdk"))
    );
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    for (const file of ["native-loading-host.mts", "native-loading-extra.mjs", "test-adapter.js"])
      await cp(join(root, "test/fixtures", file), join(directory, file));
    // 这是宿主维护的 worker 代码；原生 import、注册所选 Adapter，不经内置 JSON runner。
    await writeFile(
      join(directory, "native-worker.mjs"),
      `
    import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
    import { testAdapter } from "./test-adapter.js";
    serveWorker([testAdapter]);
  `
    );
    const tsc = join(root, "node_modules/typescript/bin/tsc");
    await execute(
      process.execPath,
      [
        tsc,
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "--allowJs",
        "--typeRoots",
        join(root, "node_modules/@types"),
        "--types",
        "node",
        "native-loading-host.mts"
      ],
      {
        cwd: directory,
        timeout: 10000
      }
    );
    const result = await execute(process.execPath, ["native-loading-host.mts"], {
      cwd: directory,
      timeout: 10000
    });
    assert.match(result.stdout, /Native SDK selection.*passed/);
    assert.ok((await readdir(directory)).every((name) => !name.includes("manifest")));
    assert.ok(!copied.has("@mininglamp-oss/octo-runtime-cli"));
  }
);
