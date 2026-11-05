#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const stateFile = process.env.OCTO_RELEASE_FIXTURE;
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
state.calls.push([command, ...args]);
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const fail = (code) => {
  save();
  console.log(JSON.stringify({ error: { code } }));
  process.exit(1);
};
if (command === "npm") {
  if (args[0] === "view") {
    if (state.lookupError) fail(state.lookupError);
    const name = args[1].slice(0, args[1].lastIndexOf("@"));
    if (!state.packages[name]) fail("E404");
    console.log(JSON.stringify(state.packages[name]));
  } else if (args[0] === "publish") {
    if (!args.includes("--dry-run")) {
      const name = `@mininglamp-oss/octo-runtime${args[1].includes("-client-") ? "-client" : ""}`;
      state.packages[name] =
        `sha512-${createHash("sha512").update(readFileSync(args[1])).digest("base64")}`;
      if (state.lostPublishAck) fail("ETIMEDOUT");
    }
  } else throw new Error(`Unexpected npm command: ${args}`);
} else if (command === "gh") {
  if (args[1] === "view") {
    if (!state.releaseExists) fail("HTTP404");
    if (args.includes("--json")) console.log(state.assets.map((file) => basename(file)).join("\n"));
  } else if (args[1] === "download") {
    const name = args[args.indexOf("--pattern") + 1];
    copyFileSync(
      state.assets.find((file) => basename(file) === name),
      join(args[args.indexOf("--dir") + 1], name)
    );
  } else if (args[1] === "upload" || args[1] === "create") {
    const files = args.slice(3).filter((value) => value.endsWith(".tgz"));
    state.assets.push(...files);
    state.releaseExists = true;
  } else if (args[1] !== "edit") throw new Error(`Unexpected gh command: ${args}`);
} else throw new Error(`Unexpected fixture executable: ${command}`);
save();
