import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

// 从固定上游 AST 提取 Runtime 会发送的字段约束；未发送的可选字段不纳入投影。
// 这是比原 Schema 更窄的请求子集，不是完整上游 Schema 的副本。
const sourceRoot = process.argv[2];
assert.ok(sourceRoot, "Usage: node extract-request-fixtures.mjs <upstream-cache-root>");
const evidence = JSON.parse(await readFile(new URL("source-evidence.json", import.meta.url)));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const selected = {
  SessionsCreateParamsSchema: [
    "key",
    "agentId",
    "model",
    "permissionMode",
    "thinkingLevel",
    "idempotencyKey"
  ],
  SessionsPatchParamsSchema: ["key", "execSecurity", "execAsk"],
  AgentParamsSchema: [
    "message",
    "agentId",
    "sessionKey",
    "deliver",
    "idempotencyKey",
    "extraSystemPrompt",
    "model",
    "thinking",
    "timeout"
  ]
};
const schemas = {};
const versions = [];
for (const version of evidence.versions) {
  const legacy = version.create.path === "packages/gateway-protocol/src/schema/sessions.ts";
  const definitions = new Map();
  const sources = {};
  const files = new Set([
    version.create.path,
    version.agent.path,
    "packages/gateway-protocol/src/schema/primitives.ts",
    ...(legacy ? [] : ["packages/gateway-protocol/src/schema/sessions-row.ts"])
  ]);
  for (const path of files) {
    const text = await readFile(resolve(sourceRoot, version.tag, path), "utf8");
    const hash = digest(text);
    if (path === version.create.path) assert.equal(hash, version.create.sha256);
    if (path === version.agent.path) assert.equal(hash, version.agent.sha256);
    sources[path] = hash;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          definitions.set(declaration.name.text, declaration.initializer);
    }
  }
  function evaluate(node) {
    if (ts.isIdentifier(node)) {
      assert.ok(definitions.has(node.text), `Missing declaration ${node.text}`);
      return evaluate(definitions.get(node.text));
    }
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((property) => {
          assert.ok(ts.isPropertyAssignment(property));
          return [property.name.getText().replaceAll('"', ""), evaluate(property.initializer)];
        })
      );
    assert.ok(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression));
    assert.equal(node.expression.expression.getText(), "Type");
    const args = node.arguments.map(evaluate);
    switch (node.expression.name.text) {
      case "Optional":
        return args[0];
      case "String":
        return { type: "string", ...args[0] };
      case "Integer":
        return { type: "integer", ...args[0] };
      case "Boolean":
        return { type: "boolean", ...args[0] };
      case "Null":
        return { type: "null" };
      case "Literal":
        return { const: args[0], ...args[1] };
      case "Union":
        return { anyOf: args[0], ...args[1] };
      default:
        throw new Error(`Unsupported schema expression: ${node.getText()}`);
    }
  }
  const refs = {};
  for (const [name, fields] of Object.entries(selected)) {
    if (name === "SessionsPatchParamsSchema" && !legacy) continue;
    const declaration = definitions.get(name);
    assert.ok(declaration && ts.isCallExpression(declaration));
    const factory = declaration.expression.getText();
    assert.ok(factory === "Type.Object" || factory === "closedObject");
    if (factory === "Type.Object")
      assert.equal(evaluate(declaration.arguments[1]).additionalProperties, false);
    const object = declaration.arguments[0];
    assert.ok(ts.isObjectLiteralExpression(object));
    const properties = {};
    const required = [];
    for (const property of object.properties) {
      assert.ok(ts.isPropertyAssignment(property));
      const field = property.name.getText();
      const optional =
        ts.isCallExpression(property.initializer) &&
        property.initializer.expression.getText() === "Type.Optional";
      assert.ok(optional || fields.includes(field), `Projection omitted required ${field}`);
      if (!fields.includes(field)) continue;
      properties[field] = evaluate(property.initializer);
      if (!optional) required.push(field);
    }
    const schema = { type: "object", properties, required, additionalProperties: false };
    const ref = digest(JSON.stringify(schema));
    schemas[ref] = schema;
    refs[name] = ref;
  }
  versions.push({ tag: version.tag, commit: version.commit, sources, schemas: refs });
}
await writeFile(
  new URL("../../../test-support/openclaw-request-contracts.json", import.meta.url),
  JSON.stringify(
    {
      scope:
        "Strict projection of transmitted request fields, extracted from fixed upstream AST. Other optional fields are intentionally rejected. Not live Gateway or harness validation.",
      upstream: evidence.upstream,
      versions,
      schemas
    },
    null,
    2
  ) + "\n"
);
console.log(
  `Extracted ${versions.length} releases; ${Object.keys(schemas).length} distinct request projections`
);
