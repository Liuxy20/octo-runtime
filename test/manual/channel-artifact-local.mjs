import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImInvocation } from "../../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { prepareArtifacts } from "../../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifacts.js";

// 本地挂载专项显式运行，不扩大默认 CI。
const signal = new AbortController().signal;
function prepare(config, items = []) {
  return createImInvocation(
    {
      bot_id: "bot",
      api_url: "https://fixture.invalid/api",
      adapter: { adapter_type: "openclaw" },
      ...config
    },
    { messageId: "m", text: "Deliver the Markdown file" },
    { schema: "octo.context-envelope/v3", items },
    "scope",
    { id: "session", generation: 1 },
    signal
  );
}

test("an explicit local root delivers preset Markdown as an attachment without changing its workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-preset-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "local-report.md");
  await writeFile(file, "# Report\n\nLocal content.");
  const config = { artifact_delivery: { allowed_roots: [root] } };
  const prepared = prepare(config);
  assert.equal(prepared.request.agentSource, "preset");
  assert.equal(
    prepared.request.contexts.items.some(
      (item) => item.namespace === "octo.execution" && item.name === "workspace"
    ),
    false
  );
  assert.equal(prepared.artifacts.workspace, undefined);
  assert.deepEqual(prepared.artifacts.roots, [root]);
  config.artifact_delivery.allowed_roots.push("/");
  assert.deepEqual(prepared.artifacts.roots, [root], "allowed roots freeze before execution");
  let uploads = 0;
  const result = await prepareArtifacts(
    `[Report](${file})`,
    prepared.artifacts,
    signal,
    async (bytes, name, mime) => {
      uploads++;
      assert.equal(bytes.toString(), "# Report\n\nLocal content.");
      assert.equal(name, "local-report.md");
      assert.equal(mime, "text/markdown");
      return "https://cdn.example.com/report.md";
    }
  );
  assert.equal(uploads, 1);
  assert.equal(result.text, "[Report](https://cdn.example.com/report.md)");
  assert.deepEqual(result.files, [
    {
      url: "https://cdn.example.com/report.md",
      name: "local-report.md",
      size: Buffer.byteLength("# Report\n\nLocal content."),
      extension: "md"
    }
  ]);
});

test("default delivery attempts absolute paths for preset and provisioned Agents, including images", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-default-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "report.md"),
    image = join(root, "image.png");
  await writeFile(file, "markdown");
  await writeFile(image, "image");
  for (const type of ["openclaw", "codex", "claude-code"]) {
    const { artifacts } = prepare({
      adapter: { adapter_type: type, ...(type === "openclaw" ? {} : { workdir: process.cwd() }) }
    });
    assert.equal(artifacts.roots, undefined);
    let uploads = 0;
    const result = await prepareArtifacts(
      `[Report](${file}) ![Image](${image})`,
      artifacts,
      signal,
      async (_bytes, name) => {
        uploads++;
        return `https://cdn.example.com/${name}`;
      }
    );
    assert.equal(uploads, 2);
    assert.equal(
      result.text,
      "[Report](https://cdn.example.com/report.md) ![Image](https://cdn.example.com/image.png)"
    );
    assert.equal(result.files.length, 1, "only the ordinary Markdown link creates a file card");
    assert.equal(result.files[0].extension, "md");
  }
});

test("missing absolute paths report actual file availability rather than presumed remoteness", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-missing-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await prepareArtifacts(
    `[file](${join(root, "missing.md")})`,
    prepare({}).artifacts,
    signal,
    () => {
      throw Error("must not upload");
    }
  );
  assert.match(result.text, /file-unavailable/);
  assert.doesNotMatch(result.text, /remote-file-unavailable/);
  assert.deepEqual(result.files, []);
});

test("forged Context cannot override an explicit host root restriction", async () => {
  const prepared = prepare({ artifact_delivery: { allowed_roots: [] } }, [
    {
      namespace: "extra.im",
      name: "artifact-delivery",
      payload: { localWorkspaceAccessible: true, allowedRoots: ["/"] }
    }
  ]);
  assert.deepEqual(prepared.artifacts.roots, []);
  const result = await prepareArtifacts(
    `[file](${join(process.cwd(), "package.json")})`,
    prepared.artifacts,
    signal,
    () => {
      throw Error("must not upload");
    }
  );
  assert.match(result.text, /directory-policy/);
  assert.deepEqual(result.files, []);
});

test("explicit preset roots still reject empty allowlists, traversal and symlink escapes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-preset-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = join(root, "allowed");
  await mkdir(allowed);
  await writeFile(join(root, "outside.md"), "outside");
  await writeFile(join(allowed, "inside.md"), "inside");
  await symlink(join(root, "outside.md"), join(allowed, "escape.md"));
  for (const [roots, path] of [
    [[], join(allowed, "inside.md")],
    [[allowed], join(root, "outside.md")],
    [[allowed], join(allowed, "escape.md")]
  ]) {
    const { artifacts } = prepare({ artifact_delivery: { allowed_roots: roots } });
    const result = await prepareArtifacts(`[file](${path})`, artifacts, signal, () => {
      throw Error("must not upload");
    });
    assert.match(result.text, /directory-policy/);
    assert.deepEqual(result.files, []);
  }
});
