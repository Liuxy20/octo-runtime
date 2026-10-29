import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";

// 显式手动运行：固定已有合同的 commit，提取本次新增 RPC 的实际发送字段。
const evidence = JSON.parse(
  await readFile(new URL("../40-openclaw-compatibility/source-evidence.json", import.meta.url))
);
const cacheRoot = process.argv[2];
const run = promisify(execFile);
assert.ok(cacheRoot, "Usage: node extract-resume-contracts.mjs <upstream-cache-root>");
const schemas = {};
const versions = [];
for (const version of evidence.versions) {
  const legacy = version.create.path.endsWith("/sessions.ts");
  const root = "packages/gateway-protocol/src/schema/";
  const files = legacy
    ? [version.create.path, `${root}primitives.ts`]
    : [
        `${root}sessions.ts`,
        `${root}sessions-patch.ts`,
        `${root}sessions-row.ts`,
        `${root}primitives.ts`
      ];
  const definitions = new Map();
  const sources = {};
  for (const path of files) {
    const cached = resolve(cacheRoot, version.tag, path);
    let source;
    try {
      source = await readFile(cached, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const response = await run(
        "gh",
        [
          "api",
          `repos/openclaw/openclaw/contents/${path}?ref=${version.commit}`,
          "--jq",
          ".content"
        ],
        { timeout: 30_000 }
      );
      source = Buffer.from(response.stdout, "base64").toString("utf8");
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, source);
    }
    sources[path] = createHash("sha256").update(source).digest("hex");
    if (path === version.create.path) assert.equal(sources[path], version.create.sha256);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          definitions.set(declaration.name.text, declaration.initializer);
    }
  }
  function dereference(node) {
    return ts.isIdentifier(node) ? dereference(definitions.get(node.text)) : node;
  }
  function properties(node) {
    const object = dereference(node);
    assert.ok(ts.isObjectLiteralExpression(object));
    return object.properties.flatMap((property) =>
      ts.isSpreadAssignment(property) ? properties(property.expression) : [property]
    );
  }
  function evaluate(node) {
    node = dereference(node);
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        properties(node).map((property) => [
          property.name.getText(),
          evaluate(property.initializer)
        ])
      );
    assert.ok(ts.isCallExpression(node));
    const args = node.arguments.map(evaluate);
    switch (node.expression.getText()) {
      case "Type.Optional":
        return args[0];
      case "Type.String":
        return { type: "string", ...args[0] };
      case "Type.Boolean":
        return { type: "boolean" };
      case "Type.Null":
        return { type: "null" };
      case "Type.Literal":
        return { const: args[0] };
      case "Type.Union":
        return { anyOf: args[0], ...args[1] };
      default:
        throw new Error(`Unsupported schema expression: ${node.getText()}`);
    }
  }
  const refs = {};
  for (const [name, fields] of Object.entries({
    SessionsDescribeParamsSchema: ["key"],
    SessionsPatchParamsSchema: legacy
      ? ["key", "execSecurity", "execAsk"]
      : ["key", "agentId", "permissionMode"]
  })) {
    const declaration = definitions.get(name);
    assert.ok(declaration && ts.isCallExpression(declaration));
    const factory = declaration.expression.getText();
    assert.ok(factory === "Type.Object" || factory === "closedObject");
    if (factory === "Type.Object")
      assert.equal(evaluate(declaration.arguments[1]).additionalProperties, false);
    const result = { type: "object", properties: {}, required: [], additionalProperties: false };
    for (const property of properties(declaration.arguments[0])) {
      assert.ok(ts.isPropertyAssignment(property));
      const field = property.name.getText();
      const initializer =
        ts.isIdentifier(property.initializer) && definitions.has(property.initializer.text)
          ? dereference(property.initializer)
          : property.initializer;
      const optional =
        ts.isCallExpression(initializer) && initializer.expression.getText() === "Type.Optional";
      assert.ok(optional || fields.includes(field), `Projection omitted required ${field}`);
      if (!fields.includes(field)) continue;
      result.properties[field] = evaluate(property.initializer);
      if (!optional) result.required.push(field);
    }
    for (const field of fields)
      assert.ok(result.properties[field], `${version.tag}: missing ${field}`);
    const ref = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    schemas[ref] = result;
    refs[name] = ref;
  }
  versions.push({ tag: version.tag, commit: version.commit, sources, schemas: refs });
  console.log(`Extracted ${version.tag}`);
}
await writeFile(
  new URL("../../../test-support/openclaw-resume-contracts.json", import.meta.url),
  JSON.stringify(
    {
      scope: "Fixed upstream AST projections of resume RPC requests; not live Gateway acceptance.",
      versions,
      schemas
    },
    null,
    2
  ) + "\n"
);
