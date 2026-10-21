import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

test("service construction cannot regain a top-level process launcher or Extra execution bridge", async () => {
  const forbidden = new Set([
    "startOwnedKernel",
    "OwnedKernel",
    "OwnedKernelOptions",
    "startExtra",
    "OwnedExtra",
    "ExtraLaunchOptions",
    "launchNode",
    "createExtraPort"
  ]);
  const roots = [
    "packages/octo-runtime-host-sdk/src",
    "packages/octo-runtime-executor-kernel/src",
    "public"
  ];
  for (const root of roots) {
    for (const file of await readdir(root)) {
      if (!file.endsWith(".ts")) continue;
      const path = join(root, file);
      const source = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const serviceAssembly =
        (root.includes("host-sdk") && !["native.ts", "launch.ts"].includes(file)) ||
        file === "service.ts";
      const visit = (node) => {
        if (ts.isIdentifier(node))
          assert.equal(forbidden.has(node.text), false, `${path}: forbidden ${node.text}`);
        if (serviceAssembly && ts.isStringLiteral(node))
          assert.equal(
            ["node:child_process", "child_process"].includes(node.text),
            false,
            `${path}: service assembly must not launch processes`
          );
        if (
          serviceAssembly &&
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(source) === "process"
        )
          assert.equal(
            ["exit", "kill", "abort"].includes(node.expression.name.text),
            false,
            `${path}: SDK must not terminate the host`
          );
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  for (const file of [
    "packages/octo-runtime-host-sdk/dist/kernel.js",
    "packages/octo-runtime-host-sdk/dist/extra-entry.js",
    "packages/octo-runtime-host-sdk/dist/extra-port.js",
    "packages/octo-runtime-executor-kernel/dist/entry.js"
  ])
    await assert.rejects(access(file), { code: "ENOENT" });
});
