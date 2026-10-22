import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

// 只校验从上游取得的原始 Schema，不连接 Gateway 或发起模型调用。
const [sourceRoot, typeboxRoot, typescriptRoot] = process.argv.slice(2);
if (!sourceRoot || !typeboxRoot) {
  throw new Error(
    "Usage: node verify-legacy-schema.mjs <7.1-source-root> <typebox-package-root> [typescript-package-root]"
  );
}
const projectRequire = createRequire(new URL("../../../package.json", import.meta.url));
const typescriptPath = typescriptRoot
  ? resolve(typescriptRoot, "lib/typescript.js")
  : projectRequire.resolve("typescript");
const { default: ts } = await import(pathToFileURL(typescriptPath).href);
const typeboxRequire = createRequire(pathToFileURL(resolve(typeboxRoot, "package.json")));
const { Type } = await import(pathToFileURL(typeboxRequire.resolve("typebox")).href);
const { Compile } = await import(pathToFileURL(typeboxRequire.resolve("typebox/compile")).href);
const expressions = new Map();
for (const file of ["primitives.ts", "sessions.ts"]) {
  const path = resolve(sourceRoot, "packages/gateway-protocol/src/schema", file);
  const text = await readFile(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      expressions.set(node.name.getText(source), node.initializer.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const context = vm.createContext({ Type });
for (const name of [
  "SESSION_LABEL_MAX_LENGTH",
  "NonEmptyString",
  "SessionLabelString",
  "SessionsCreateParamsSchema"
]) {
  assert.ok(expressions.has(name), `Missing upstream declaration: ${name}`);
  vm.runInContext(`globalThis.${name} = ${expressions.get(name)}`, context, { timeout: 1000 });
}
const validate = Compile(context.SessionsCreateParamsSchema);
const base = { key: "agent:main:octo-run:research:example", agentId: "main" };
const cases = [
  [
    "current_default",
    { ...base, permissionMode: "full", idempotencyKey: "research-session" },
    false
  ],
  ["remove_permission_only", { ...base, idempotencyKey: "research-session" }, false],
  ["remove_permission_and_idempotency_with_effort", { ...base, thinkingLevel: "high" }, false],
  ["common_fields", base, true]
];
const results = cases.map(([name, params, expectedValid]) => {
  const valid = validate.Check(params);
  assert.equal(valid, expectedValid, name);
  const errors = valid
    ? []
    : [...validate.Errors(params)].map(({ instancePath, keyword, message, params }) => ({
        instancePath,
        keyword,
        message,
        params
      }));
  return { name, valid, errors };
});
console.log(
  JSON.stringify(
    {
      tag: "2026.7.1",
      validator:
        "TypeBox Compile; original AST schema expression and primitives; local installed dependency",
      results
    },
    null,
    2
  )
);
