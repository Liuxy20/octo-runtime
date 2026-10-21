import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import markdown from "prettier/plugins/markdown";
import Ajv from "ajv";
import { InvokeInput, assertContextEnvelope } from "@mininglamp-oss/octo-runtime/protocol";
import { CONTEXT_TYPE_CATALOG } from "@mininglamp-oss/octo-runtime-protocol";

const root = resolve(import.meta.dirname, "..");
const docs = join(root, "docs");
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(await json("packages/octo-runtime-protocol/schema/protocol.schema.json"));
const validateWire = ajv.compile(
  await json("packages/octo-runtime-protocol/schema/kernel-ipc.schema.json")
);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result.sort();
}

function* nodes(node) {
  yield node;
  for (const child of node.children ?? []) yield* nodes(child);
}

function isWithinDirectory(directory, path) {
  const suffix = relative(directory, path);
  return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}

const paths = await files(docs);
const pages = new Map();
let jsonExamples = 0;
let diagrams = 0;
for (const path of paths) {
  const source = await readFile(path, "utf8");
  const ast = markdown.parsers.markdown.parse(source);
  const all = [...nodes(ast)];
  const definitions = new Map(
    all.filter((n) => n.type === "definition").map((n) => [n.identifier, n.url])
  );
  const links = all.filter((n) =>
    ["link", "image", "linkReference", "imageReference"].includes(n.type)
  );
  for (const node of links) {
    const url = node.url ?? definitions.get(node.identifier);
    assert.ok(url, `${path}: unresolved Markdown reference`);
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue;
    const [target, fragment] = url.split("#");
    const destination = resolve(dirname(path), decodeURIComponent(target));
    assert.ok(isWithinDirectory(root, destination), `${path}: link outside repository: ${url}`);
    const info = await stat(destination).catch(() => undefined);
    assert.ok(info, `${relative(root, path)}: broken link ${url}`);
    // Library links intentionally use whole pages; fail instead of silently ignoring new anchors.
    if (fragment)
      throw new Error(`${path}: add anchor validation before linking a fragment: ${url}`);
  }
  const blocks = all.filter((n) => n.type === "code");
  for (const block of blocks) {
    if (block.lang === "json") {
      const value = JSON.parse(block.value);
      if (value.inputs) InvokeInput.check(value);
      else if (value.schema === "octo.context-envelope/v3") assertContextEnvelope(value);
      else if (value.jsonrpc) {
        assert.ok(validateWire(value), JSON.stringify(validateWire.errors));
        if (value.params?.input) InvokeInput.check(value.params.input);
      }
      jsonExamples++;
    }
    if (block.lang === "mermaid") {
      assert.match(
        block.value,
        /^(?:flowchart TB|sequenceDiagram)\b/,
        `${path}: expected TB flowchart or sequence diagram`
      );
      diagrams++;
    }
  }
  pages.set(path, { source, links, blocks });
}

const english = paths.filter((p) => isWithinDirectory(join(docs, "en"), p));
const chinese = paths.filter((p) => isWithinDirectory(join(docs, "zh-CN"), p));
assert.ok(english.length > 0, "The English documentation tree must not be empty");
assert.ok(chinese.length > 0, "The Chinese documentation tree must not be empty");
assert.equal(english.length, chinese.length, "Both language trees must have the same page count");
for (const path of english) {
  const suffix = relative(join(docs, "en"), path);
  const counterpart = join(docs, "zh-CN", suffix);
  const en = pages.get(path),
    zh = pages.get(counterpart);
  assert.ok(zh, `Missing Chinese counterpart for ${suffix}`);
  for (const [from, to, page] of [
    [path, counterpart, en],
    [counterpart, path, zh]
  ]) {
    assert.ok(
      page.links.some((n) => n.url && resolve(dirname(from), n.url) === to),
      `${from}: missing counterpart link`
    );
  }
  const executableBlocks = (page) =>
    page.blocks.filter((b) => b.lang !== "mermaid").map((b) => [b.lang, b.value]);
  assert.deepEqual(
    executableBlocks(en),
    executableBlocks(zh),
    `${suffix}: bilingual code examples differ`
  );
  const enDiagrams = en.blocks.filter((b) => b.lang === "mermaid");
  assert.equal(
    enDiagrams.length,
    zh.blocks.filter((b) => b.lang === "mermaid").length,
    `${suffix}: diagram parity`
  );
}

const catalog = await json("docs/examples/contexts.json");
assertContextEnvelope(catalog);
const identifiers = (items) => items.map((i) => `${i.namespace}/${i.name}`).sort();
assert.deepEqual(
  identifiers(catalog.items),
  identifiers(CONTEXT_TYPE_CATALOG),
  "Context examples must cover the entire current catalog"
);
for (const locale of ["en", "zh-CN"]) {
  const page = pages.get(join(docs, locale, "reference/contexts.md"));
  for (const id of identifiers(CONTEXT_TYPE_CATALOG))
    assert.ok(page.source.includes(`\`${id}\``), `Missing ${id} in ${locale}`);
}
console.log(
  `Developer docs: ${english.length} paired pages, ${paths.length} Markdown files, ${jsonExamples} JSON examples, ${diagrams} Mermaid blocks, ${catalog.items.length} built-in Context examples checked.`
);
