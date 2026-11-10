// PR #314 复审专项：真实 manifest → CLI → 最近失败记录；不加入默认 selector/CI。
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { runCli } from "../../apps/cli/dist/main.js";
import { readStartupFailure } from "../../apps/cli/dist/output.js";
import {
  StartupError,
  describeStartupError,
  formatStartupDiagnostic,
  safeStartupValue
} from "../../packages/octo-runtime-executor-kernel/dist/index.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "review304-"));
  t.after(async () => {
    const child = relative(tmpdir(), root);
    assert(child && !isAbsolute(child) && !child.startsWith(".."));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function cliFailure(home, module, json, preceding = []) {
  const manifest = join(home, "manifest-review.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [...preceding, { type: "review", module }],
      extras: []
    }),
    { mode: 0o600 }
  );
  const lines = [];
  const args = ["run", "--home", home, "--manifest", manifest];
  if (json) args.push("--json");
  const since = Date.now() - 100;
  const code = await runCli(args, {
    output: (line) => lines.push(line),
    errorOutput: (line) => lines.push(line)
  });
  assert.equal(code, 1);
  const rendered = lines.join("\n");
  const persisted = await readFile(join(home, "logs", "startup-executor-kernel.json"), "utf8");
  const restored = await readStartupFailure(join(home, "logs"), "executor-kernel", since);
  assert(restored);
  const diagnostic = describeStartupError(restored);
  return {
    rendered,
    persisted,
    restored: JSON.stringify(diagnostic),
    formatted: formatStartupDiagnostic(diagnostic),
    failure: json ? JSON.parse(rendered).error : undefined
  };
}

function excludesFragments(projections, fragments) {
  for (const projection of Object.values(projections)) {
    if (typeof projection !== "string") continue;
    for (const fragment of fragments)
      assert(!projection.includes(fragment), "A private fragment reached a public projection");
  }
}

for (const [label, delimiter] of [
  ["space", " "],
  ["quote", '"'],
  ["less-than", "<"],
  ["greater-than", ">"]
]) {
  test(`URL authentication with ${label} stays private in CLI text, JSON and records`, async (t) => {
    const home = await fixture(t);
    const parts = [randomUUID(), randomUUID()];
    const module = `https://user:${parts.join(delimiter)}@example.invalid/provider.mjs`;
    for (const json of [false, true]) {
      const result = await cliFailure(home, module, json);
      excludesFragments(result, parts);
      if (json) assert.equal(result.failure.diagnostic.rootCode, "ERR_UNSUPPORTED_ESM_URL_SCHEME");
    }
  });
}

for (const encoding of ["base64", "percent"]) {
  test(`inline ${encoding} module payload stays private through the actual CLI`, async (t) => {
    const home = await fixture(t);
    const secret = randomUUID();
    const source = `const privateValue = ${JSON.stringify(secret)}; throw new Error("REVIEW_IMPORT_FAILED");`;
    const payload =
      encoding === "base64" ? Buffer.from(source).toString("base64") : encodeURIComponent(source);
    const module = `data:text/javascript${encoding === "base64" ? ";base64" : ""},${payload}`;
    for (const json of [false, true])
      excludesFragments(await cliFailure(home, module, json), [secret, payload, module]);
  });
}

test("multi-word and punctuated assignments remain private in all startup projections", async (t) => {
  const home = await fixture(t);
  const parts = Array.from({ length: 4 }, () => randomUUID());
  const value = `${parts[0]} ${parts[1]},${parts[2]};${parts[3]}`;
  for (const quote of ["", '"', "'"]) {
    const diagnostic = new StartupError("LOCAL_STATE_INVALID", {
      component: "cli",
      phase: "created",
      context: { path: `password=${quote}${value}${quote}` }
    }).diagnostic;
    excludesFragments(
      { json: JSON.stringify(diagnostic), text: formatStartupDiagnostic(diagnostic) },
      parts
    );
  }
  const module = join(home, `password=${value}.mjs`);
  for (const json of [false, true]) excludesFragments(await cliFailure(home, module, json), parts);
});

test("missing bare Adapter resolution keeps its selected dependency and legacy exit", async (t) => {
  const home = await fixture(t);
  const module = `@review-${randomUUID()}/not-installed`;
  const available = join(home, "available.mjs"),
    marker = join(home, "imported.txt");
  await writeFile(
    available,
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "imported"); export default { metadata: { type: "available", }, async *invoke() {} };`
  );
  const preceding = [{ type: "available", module: available }];
  const result = await cliFailure(home, module, true, preceding);
  assert.equal(result.failure.code, "ERR_MODULE_NOT_FOUND");
  assert.equal(result.failure.diagnostic.rootCode, "ERR_MODULE_NOT_FOUND");
  assert.equal(result.failure.diagnostic.context.module, module);
  assert.equal(result.failure.diagnostic.context.resource, "adapter-module");
  assert.equal(result.failure.diagnostic.context.configKey, "adapters");
  const text = await cliFailure(home, module, false, preceding);
  assert(text.rendered.includes(module));
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("ordinary package/file facts and bounded malformed-scheme formatting remain usable", () => {
  for (const value of [
    "@example/adapter",
    "C:\\safe\\中文 file.mjs",
    "file:///tmp/safe%20file.mjs"
  ])
    assert.equal(safeStartupValue(value), value);
  const began = performance.now();
  safeStartupValue("a-".repeat(15000) + ":unfinished");
  assert(performance.now() - began < 1000);
  const numericCanary = randomUUID().replace(/\D/g, "").slice(0, 5).padEnd(5, "0");
  assert.equal(
    safeStartupValue(`https://user:${numericCanary}@example.invalid`, 20),
    "[redacted-url]"
  );
  const secret = randomUUID();
  assert(
    !safeStartupValue(`https://user:${secret}\u2028${secret}@example.invalid`).includes(secret)
  );
  for (const separator of [" ", ",", ";"])
    assert(
      !safeStartupValue(
        `https://public.invalid/path${separator}https://user:${secret}@example.invalid`
      ).includes(secret)
    );
});
