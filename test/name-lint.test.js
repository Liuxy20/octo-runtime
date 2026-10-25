import assert from "node:assert/strict";
import { test } from "node:test";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  realpath
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { hasGitMetadata } from "../scripts/git-worktree.mjs";

const script = fileURLToPath(new URL("../scripts/lint-names.mjs", import.meta.url));
const previous = ["octo", "harness"].join("-");
async function fixture(t, temporaryDirectory = tmpdir()) {
  // TMPDIR/TEMP 可能位于 checkout 内，真实路径也可能穿过 junction；非 Git 用例必须移出所有 Git 祖先。
  let base;
  for (const candidate of [temporaryDirectory, homedir(), process.cwd()]) {
    let outside = await realpath(candidate);
    for (let directory = outside; ; directory = dirname(directory)) {
      if (hasGitMetadata(directory)) outside = dirname(directory);
      if (dirname(directory) === directory) break;
    }
    try {
      await access(outside, constants.W_OK);
      base = outside;
      break;
    } catch (error) {
      if (error.code !== "EACCES" && error.code !== "EPERM") throw error;
    }
  }
  assert.ok(base, "No writable fixture directory outside Git worktrees");
  const root = await mkdtemp(join(base, "runtime-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    run() {
      // 临时 fixture 不依赖宿主工具；Windows 环境变量名不区分大小写，两种写法都清空。
      const result = spawnSync(process.execPath, [script, "--root", root], {
        encoding: "utf8",
        env: { ...process.env, PATH: "", Path: "" }
      });
      assert.equal(result.error, undefined);
      assert.ok(result.stdout.trim(), `lint-names produced no report: ${result.stderr}`);
      return { code: result.status, report: JSON.parse(result.stdout) };
    }
  };
}

test("non-Git naming fixtures stay isolated when the temporary directory is inside a Git worktree", async (t) => {
  const outer = await fixture(t);
  const checkout = join(outer.root, "checkout");
  const temporaryDirectory = join(checkout, "nested", "tmp");
  await mkdir(temporaryDirectory, { recursive: true });
  // worktree 的 .git 是文件；隔离逻辑同时兼容普通仓库的 .git 目录。
  await writeFile(join(checkout, ".git"), "gitdir: ../metadata\n");
  const { root, run } = await fixture(t, temporaryDirectory);
  assert.equal(dirname(root), outer.root);
  await writeFile(join(root, "source.ts"), 'const name = "octo-runtime";');
  const result = run();
  assert.equal(result.code, 0);
  assert.equal(result.report.respectsGitIgnore, false);
});

test("name lint requires executable ripgrep inside a Git worktree instead of ignoring ignore rules", async (t) => {
  const { root } = await fixture(t);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/test\n");
  const child = join(root, "nested");
  await mkdir(child);
  const outside = await fixture(t);
  const alias = join(outside.root, "linked");
  await symlink(child, alias, process.platform === "win32" ? "junction" : "dir");
  for (const directory of [child, alias]) {
    const result = spawnSync(process.execPath, [script, "--root", directory], {
      encoding: "utf8",
      env: { ...process.env, PATH: "", Path: "" }
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /RIPGREP_REQUIRED:.*Git/);
  }
});

test("an empty .git directory in a temporary ancestor does not force fixtures into filesystem root", async (t) => {
  const outer = await fixture(t);
  await mkdir(join(outer.root, ".git"));
  const temporaryDirectory = join(outer.root, "tmp");
  await mkdir(temporaryDirectory);
  const { root, run } = await fixture(t, temporaryDirectory);
  assert.equal(dirname(root), temporaryDirectory);
  assert.equal(run().code, 0);
});

test("name lint accepts current names and rejects case variants without echoing source contents", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(join(root, "package.json"), '{"name":"octo-runtime-adapter-codex"}');
  assert.equal(run().code, 0);
  await writeFile(
    join(root, "source.ts"),
    `const secret = "DO_NOT_ECHO_${previous.toUpperCase()}";`
  );
  const result = run();
  assert.equal(result.code, 1);
  assert.equal(result.report.findings.length, 1);
  assert.equal(result.report.findings[0].line, 1);
  assert.ok(!JSON.stringify(result.report).includes("DO_NOT_ECHO"));
});

test("name lint rejects old filenames even when their contents use only new names", async (t) => {
  const { root, run } = await fixture(t);
  await writeFile(join(root, `${previous}.md`), "Octo Runtime");
  assert.equal(run().code, 1);
  assert.equal(run().report.findings[0].kind, "path");
});

test("only the exact architecture-review explanation is reported as an exception", async (t) => {
  const { root, run } = await fixture(t);
  await mkdir(join(root, "docs"));
  const file = join(root, "docs/octo-runtime-rename-ipd-se.md");
  const explanation = `架构评审指出：\`${previous}\` 命名有歧义，容易被理解为自研 ReAct 框架。`;
  await writeFile(file, explanation);
  assert.equal(run().code, 0);
  assert.equal(run().report.exceptions.length, 1);
  await writeFile(file, `${explanation}\nimport '${previous}-protocol';`);
  assert.equal(run().code, 1);
  assert.equal(run().report.findings.length, 1);
});

test("name lint does not read dependencies, independent worktrees, credentials or binary contents", async (t) => {
  const { root, run } = await fixture(t);
  for (const directory of ["node_modules", ".worktree"]) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, `${previous}.js`), previous);
  }
  await writeFile(join(root, "secret.md"), previous);
  await writeFile(join(root, "binary.dat"), Buffer.from(`\0${previous}`));
  assert.equal(run().code, 0);
});

const historyFiles = [".gitleaksignore", ".octospec/tasks/gitleaks-history-triage/findings.md"];

test("name lint accepts reviewed historical evidence with LF and CRLF line endings", async (t) => {
  for (const file of historyFiles) {
    const { root, run } = await fixture(t);
    await mkdir(join(root, ".octospec/tasks/gitleaks-history-triage"), { recursive: true });
    const original = await readFile(new URL("../" + file, import.meta.url), "utf8");
    for (const newline of ["\n", "\r\n"]) {
      await writeFile(
        join(root, file),
        original.replaceAll("\r\n", "\n").replaceAll("\n", newline)
      );
      const result = run();
      assert.equal(result.code, 0);
      assert.equal(result.report.findings.length, 0);
      assert.ok(result.report.exceptions.length > 0);
    }
  }
});

test("name lint rejects edits and appended legacy uses in historical evidence", async (t) => {
  for (const file of historyFiles) {
    const { root, run } = await fixture(t);
    await mkdir(join(root, ".octospec/tasks/gitleaks-history-triage"), { recursive: true });
    const original = await readFile(new URL("../" + file, import.meta.url), "utf8");
    for (const changed of [
      original.replace(previous + "-protocol", previous + "-other"),
      original + "\nimport '" + previous + "-protocol';\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(join(root, file), changed);
      const result = run();
      assert.equal(result.code, 1);
      assert.ok(result.report.findings.length > 0);
      assert.equal(result.report.exceptions.length, 0);
    }
  }
});

test("name lint rejects copied history elsewhere and legacy uses beside approved evidence", async (t) => {
  const { root, run } = await fixture(t);
  const original = await readFile(new URL("../.gitleaksignore", import.meta.url), "utf8");
  await writeFile(join(root, ".gitleaksignore"), original);
  await writeFile(join(root, "copied-history.md"), original);
  await writeFile(join(root, "source.ts"), "import '" + previous + "-protocol';");
  await writeFile(join(root, previous + ".md"), "Octo Runtime");
  const result = run();
  assert.equal(result.code, 1);
  assert.ok(result.report.exceptions.length > 0);
  assert.deepEqual(
    [...new Set(result.report.findings.map((finding) => finding.file))].sort(),
    ["copied-history.md", "source.ts", previous + ".md"].sort()
  );
});
