// 显式包外专项：node test/manual/packed-home-306.mjs <local-release.tgz>；不加入 CI/default selector。
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runReleaseCommand, withReleaseDirectory } from "../../scripts/release-process.mjs";

if (!process.argv[2]) throw new Error("A local packed archive is required");
const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "ph306-"));
const npm = join(
  dirname(process.execPath),
  process.platform === "win32"
    ? "node_modules/npm/bin/npm-cli.js"
    : "../lib/node_modules/npm/bin/npm-cli.js"
);
await withReleaseDirectory(directory, async () => {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" })
  );
  await runReleaseCommand(
    process.execPath,
    [
      npm,
      "install",
      resolve(process.argv[2]),
      "--global",
      "--prefix",
      directory,
      "--offline",
      "--ignore-scripts",
      "--engine-strict",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(directory, "empty-cache")
    ],
    { cwd: directory, timeout: 60000, label: "Install local archive offline" }
  );
  const consumer = process.platform === "win32" ? directory : join(directory, "lib");
  const file = join(consumer, "host.mts");
  await cp(new URL("./packed-home-306.mts", import.meta.url), file);
  await runReleaseCommand(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--types",
      "node",
      "--typeRoots",
      join(root, "node_modules/@types"),
      file
    ],
    { cwd: consumer, timeout: 60000, label: "Strict external SDK types including required Home" }
  );
  const result = await runReleaseCommand(process.execPath, [file], {
    cwd: consumer,
    timeout: 30000,
    label: "External public SDK Home lifecycle"
  });
  console.log(result.stdout.trim());
});
