import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sanitizeDiagnosticBody } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { resolveReleaseBuildTime } from "../../scripts/resolve-release-build-time.mjs";
import { hasGitMetadata } from "../../scripts/git-worktree.mjs";
import { testAdapter } from "../fixtures/pipe-fault-adapter.mjs";

test(
  "diagnostic scanning remains bounded for long non-keys and preserves redaction",
  { timeout: 10000 },
  () => {
    const value = randomUUID();
    for (const body of [
      `prefix Authorization: ${value}`,
      `prefix 'authorization' = ${value}`,
      JSON.stringify({ message: `prefix authorization: ${value}` }),
      JSON.stringify({ authorization: value })
    ]) {
      const result = sanitizeDiagnosticBody(body);
      assert.ok(!result.includes(value));
      assert.match(result, /\[REDACTED\]/);
    }
    for (const suffix of ["", " ", '\\"', ":", "="]) {
      const body = "-".repeat(200000) + suffix;
      const start = performance.now();
      assert.equal(sanitizeDiagnosticBody(body), "-".repeat(200));
      assert.ok(performance.now() - start < 3000, "long input must not rescan every suffix");
    }
    assert.equal(sanitizeDiagnosticBody("useful reason"), "useful reason");
  }
);

test("registry lookup encodes package and version as complete path components", async () => {
  const version = "1/extra/?query#fragment";
  const calls = [];
  await resolveReleaseBuildTime(
    version,
    "unused",
    async (url) => {
      calls.push(String(url));
      return new Response(null, { status: 404 });
    },
    { paired: true }
  );
  assert.deepEqual(calls, [
    `https://registry.npmjs.org/%40mininglamp-oss%2Focto-runtime/${encodeURIComponent(version)}`,
    `https://registry.npmjs.org/%40mininglamp-oss%2Focto-runtime-client/${encodeURIComponent(version)}`
  ]);
});

test("Git metadata supports missing markers, gitdir files and checkout directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "security-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(hasGitMetadata(root), false);
  await writeFile(join(root, ".git"), "invalid");
  assert.equal(hasGitMetadata(root), false);
  await writeFile(join(root, ".git"), "gitdir: ../metadata\r\n");
  assert.equal(hasGitMetadata(root), true);
  await rm(join(root, ".git"));
  await mkdir(join(root, ".git"));
  assert.equal(hasGitMetadata(root), false);
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  assert.equal(hasGitMetadata(root), true);
});

test("pipe fixture passes hostile-looking gate paths as data", { timeout: 10000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "security-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gate = join(root, "gate'; process.exit(17); '");
  const command = testAdapter.buildCommand({ prompt: "sibling", runMetadata: { gate } });
  assert.equal(command.args[2], gate);
  assert.ok(!command.args[1].includes(gate));
  const child = spawn(command.command, command.args, { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
  await writeFile(gate, "ready");
  await exited;
  assert.deepEqual(stdout.trim().split("\n").map(JSON.parse), [{ ready: true }, { done: true }]);
});
