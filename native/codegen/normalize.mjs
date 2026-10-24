import { readFile } from "node:fs/promises";

// Validate all inputs before emitting files; unknown assertions must not become permissive types.
const annotations = new Set([
  "$id",
  "$schema",
  "title",
  "description",
  "default",
  "tsType",
  "definitions",
  "x-octo-methods"
]);
const assertions = new Set([
  "$ref",
  "type",
  "properties",
  "additionalProperties",
  "required",
  "items",
  "enum",
  "const",
  "oneOf",
  "anyOf",
  "allOf",
  "if",
  "then",
  "else",
  "not",
  "contains",
  "propertyNames",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "pattern",
  "format",
  "x-octo-http-url",
  "x-octo-matching-trigger-fields",
  "x-octo-max-json-bytes",
  "x-octo-max-json-depth",
  "x-octo-max-utf16-length",
  "x-octo-max-utf8-bytes",
  "x-octo-runtime-selection-invariants",
  "x-octo-unicode-scalar-strings",
  "x-octo-unique-env-keys",
  "x-octo-unique-header-names",
  "x-octo-unique-resource-refs",
  "x-octo-unique-type-keys"
]);
const lists = ["oneOf", "anyOf", "allOf"];
const children = ["items", "if", "then", "else", "not", "contains", "propertyNames"];
export async function normalize(schemaDir) {
  const files = ["protocol.schema.json", "kernel-ipc.schema.json", "kernel-client.behavior.json"];
  const sources = await Promise.all(
    files.map(async (name) => [name, await readFile(new URL(name, schemaDir), "utf8")])
  );
  const [protocol, ipc, behavior] = sources.map(([, text]) => JSON.parse(text));
  const nodes = [];
  const names = new Map();
  const roots = {};
  function visit(schema, name, doc) {
    if (typeof schema === "boolean") schema = schema ? {} : { not: {} };
    if (!schema || typeof schema !== "object" || Array.isArray(schema))
      throw Error(`Invalid schema ${name}`);
    for (const key of Object.keys(schema))
      if (!annotations.has(key) && !assertions.has(key))
        throw Error(`Unsupported keyword ${key} at ${name}`);
    const id = nodes.length;
    if (names.has(name)) throw Error(`Duplicate generated name: ${name}`);
    names.set(name, id);
    const node = { id, name, schema, doc, properties: {}, branches: {} };
    nodes.push(node);
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      node.properties[key] = visit(child, name + pascal(key), doc);
    for (const key of children)
      if (schema[key] !== undefined)
        node.branches[key] = visit(schema[key], name + pascal(key), doc);
    for (const key of lists)
      if (schema[key])
        node.branches[key] = schema[key].map((child, i) =>
          visit(child, name + pascal(key) + i, doc)
        );
    if (typeof schema.additionalProperties === "object")
      node.branches.additionalProperties = visit(
        schema.additionalProperties,
        name + "Additional",
        doc
      );
    return id;
  }
  for (const [doc, prefix] of [
    [protocol, ""],
    [ipc, "Ipc"]
  ]) {
    for (const [name, schema] of Object.entries(doc.definitions))
      roots[prefix + name] = visit(schema, prefix + name, doc);
  }
  for (const node of nodes)
    if (node.schema.$ref) {
      const [uri, pointer] = node.schema.$ref.split("#");
      const doc = !uri ? node.doc : [protocol, ipc].find((d) => d.$id === uri);
      if (!doc || !pointer?.startsWith("/definitions/"))
        throw Error(`Unsupported ref ${node.schema.$ref}`);
      const name = (doc === ipc ? "Ipc" : "") + pointer.slice("/definitions/".length);
      if (roots[name] === undefined) throw Error(`Unresolved ref ${node.schema.$ref}`);
      node.ref = roots[name];
    }
  const methods = ipc["x-octo-methods"];
  if (new Set(methods.map((m) => m.method)).size !== methods.length)
    throw Error("Duplicate methods");
  for (const m of methods) {
    m.paramsId = roots["Ipc" + m.params.$ref.split("/").at(-1)];
    if (m.result.$ref)
      m.resultId =
        roots[(m.result.$ref.startsWith("#") ? "Ipc" : "") + m.result.$ref.split("/").at(-1)];
    else m.resultId = visit(m.result, `Ipc${m.name}Result`, ipc);
  }
  // Resolve newly added inline result nodes, which may contain references.
  for (const n of nodes)
    if (n.ref === undefined && n.schema.$ref)
      n.ref =
        roots[
          (n.schema.$ref.startsWith("#")
            ? n.doc === ipc
              ? "Ipc"
              : ""
            : n.schema.$ref.startsWith(ipc.$id)
              ? "Ipc"
              : "") + n.schema.$ref.split("/").at(-1)
        ];
  return { nodes, roots, methods, behavior, sources };
}
export function pascal(s) {
  return s.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, a, b) => b.toUpperCase());
}
export function snake(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}
// Deduplicate validation IR independently of public types; omit type names and schema descriptions.
export function ruleNodes(nodes) {
  return nodes.map((n) => {
    const s = n.schema;
    const r = {};
    if (n.ref !== undefined) r.ref = n.ref;
    for (const k of [
      "type",
      "enum",
      "const",
      "required",
      "minimum",
      "maximum",
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "minProperties",
      "maxProperties",
      "uniqueItems",
      "pattern",
      "format"
    ])
      if (s[k] !== undefined) r[k] = s[k];
    if (s.properties) r.properties = n.properties;
    if (s.additionalProperties === false) r.strict = true;
    Object.assign(r, n.branches);
    const extensions = Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("x-")));
    if (Object.keys(extensions).length) r.extensions = extensions;
    return r;
  });
}

// Merge equivalent rules rather than type names; partition refinement also handles recursive refs.
export function compactValidation(ir) {
  const remap = (n, ids) => ({
    ...n,
    ref: n.ref === undefined ? undefined : ids[n.ref],
    properties: Object.fromEntries(Object.entries(n.properties).map(([k, id]) => [k, ids[id]])),
    branches: Object.fromEntries(
      Object.entries(n.branches).map(([k, value]) => [
        k,
        Array.isArray(value) ? value.map((id) => ids[id]) : ids[value]
      ])
    )
  });
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])])
          )
        : v;
  let indices = ir.nodes.map(() => 0);
  for (;;) {
    const classes = new Map();
    const next = ruleNodes(ir.nodes.map((n) => remap(n, indices))).map((r) => {
      const key = JSON.stringify(canonical(r));
      if (!classes.has(key)) classes.set(key, classes.size);
      return classes.get(key);
    });
    if (next.every((id, i) => id === indices[i])) break;
    indices = next;
  }
  const nodes = [];
  for (const n of ir.nodes) {
    const id = indices[n.id];
    if (!nodes[id]) nodes[id] = { ...remap(n, indices), id };
  }
  return {
    nodes,
    indices,
    roots: Object.fromEntries(Object.entries(ir.roots).map(([name, id]) => [name, indices[id]])),
    methods: ir.methods.map((m) => ({
      ...m,
      paramsId: indices[m.paramsId],
      resultId: indices[m.resultId]
    }))
  };
}

// Emit types reachable from public roots; validation-only nodes remain in the rules table.
export function modelNodes({ nodes, roots, methods }) {
  const needed = new Set();
  const seen = new Set();
  function visit(id, named = false) {
    const n = nodes[id],
      s = n.schema;
    if (named || s.properties || s.oneOf || s.anyOf) needed.add(id);
    if (seen.has(id)) return;
    seen.add(id);
    if (n.ref !== undefined) visit(n.ref, true);
    else if (s.properties) Object.values(n.properties).forEach((child) => visit(child));
    else if (s.oneOf || s.anyOf)
      (n.branches.oneOf ?? n.branches.anyOf).forEach((child) => visit(child));
    else if (s.type === "array") visit(n.branches.items);
  }
  Object.values(roots).forEach((id) => visit(id, true));
  for (const m of methods) {
    visit(m.paramsId, true);
    visit(m.resultId, true);
  }
  return nodes.filter((n) => needed.has(n.id));
}
