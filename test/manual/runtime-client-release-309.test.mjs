import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkRegistryVersion } from "../../scripts/check-release-registry.mjs";
import { resolveReleaseBuildTime } from "../../scripts/resolve-release-build-time.mjs";
import { createCommandClient, reconcileLatest } from "../../scripts/reconcile-release-latest.mjs";

const runtime = "@mininglamp-oss/octo-runtime";
const client = `${runtime}-client`;
const registry = "https://registry.npmjs.org";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildTime = "2026-11-05T00:00:00.000Z";
const integrity = (data) => `sha512-${createHash("sha512").update(data).digest("base64")}`;

test("client registry checks use the client name, distinguish missing from unknown and reject immutable conflicts", async () => {
  const options = { version: "0.0.309", name: client, registry, integrity: integrity("client") };
  const runCommand = async (_command, args) => {
    assert.equal(args[1], `${client}@0.0.309`);
    return JSON.stringify(options.integrity);
  };
  assert.equal((await checkRegistryVersion(options, { runCommand })).exists, true);
  for (const code of ["E404", "E401", "E403", "ETIMEDOUT"]) {
    const lookup = () =>
      checkRegistryVersion(options, {
        runCommand: async () => {
          throw Object.assign(new Error(code), { stdout: JSON.stringify({ error: { code } }) });
        }
      });
    if (code === "E404") assert.equal((await lookup()).exists, false);
    else await assert.rejects(lookup(), new RegExp(code));
  }
  await assert.rejects(
    checkRegistryVersion(options, {
      runCommand: async () => JSON.stringify(integrity("different"))
    }),
    /different tarball/
  );
});

async function archives(t, timestamps = [buildTime, buildTime]) {
  const directory = await mkdtemp(join(tmpdir(), "oc309-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = new Map();
  for (const [index, name] of [runtime, client].entries()) {
    const path = join(directory, String(index));
    const dist = join(path, name === client ? "package" : "package/apps/cli/dist");
    await mkdir(dist, { recursive: true });
    await writeFile(
      join(dist, "build-info.json"),
      JSON.stringify({ commit, dirty: false, buildTime: timestamps[index] })
    );
    execFileSync("tar", ["-czf", "artifact.tgz", "package"], { cwd: path });
    result.set(name, await readFile(join(path, "artifact.tgz")));
  }
  return result;
}

for (const existing of [[], [client], [runtime], [runtime, client]]) {
  test(`build time recovery from ${existing.join("+") || "neither"} published artifact`, async (t) => {
    const data = await archives(t);
    const seen = [];
    const request = async (url) => {
      const value = String(url);
      if (value.endsWith(".tgz"))
        return new Response(data.get(value.includes("-client") ? client : runtime));
      const name = decodeURIComponent(new URL(value).pathname.split("/")[1]);
      seen.push(name);
      if (!existing.includes(name)) return new Response(null, { status: 404 });
      return Response.json({
        name,
        version: "0.0.309",
        dist: {
          tarball: `${registry}/${name.endsWith("-client") ? "-client" : "runtime"}.tgz`,
          integrity: integrity(data.get(name))
        }
      });
    };
    const before = Date.now();
    const value = await resolveReleaseBuildTime("0.0.309", commit, request, { paired: true });
    assert.deepEqual(seen, [runtime, client]);
    if (existing.length) assert.equal(value, buildTime);
    else assert.ok(Date.parse(value) >= before);
  });
}

test("two published build timestamps cannot silently select one recovery source", async (t) => {
  const data = await archives(t, [buildTime, "2026-11-05T00:00:01.000Z"]);
  const request = async (url) => {
    const value = String(url);
    const name = value.includes("-client") ? client : runtime;
    if (value.endsWith(".tgz")) return new Response(data.get(name));
    return Response.json({
      name,
      version: "0.0.309",
      dist: {
        tarball: `${registry}/${name.endsWith("-client") ? "-client" : "runtime"}.tgz`,
        integrity: integrity(data.get(name))
      }
    });
  };
  await assert.rejects(
    resolveReleaseBuildTime("0.0.309", commit, request, { paired: true }),
    /timestamps differ/
  );
});

function fixture() {
  const state = {
    completeVersions: ["1.2.0"],
    npmLatest: "1.0.0",
    clientNpmLatest: "1.0.0",
    githubLatest: "1.0.0"
  };
  const writes = [];
  return {
    state,
    writes,
    api: {
      readState: async () => structuredClone(state),
      setNpmLatest: async (version) => {
        writes.push(["runtime", version]);
        state.npmLatest = version;
      },
      setClientNpmLatest: async (version) => {
        writes.push(["client", version]);
        state.clientNpmLatest = version;
      },
      setGitHubLatest: async (version) => {
        writes.push(["github", version]);
        state.githubLatest = version;
      }
    }
  };
}

test("dry-run labels an unverified paired candidate as conditional and performs no writes", async () => {
  const { api, writes } = fixture();
  const result = await reconcileLatest(api, { dryRun: true, candidate: "1.3.0" });
  assert.equal(result.targetVerified, false);
  assert.deepEqual(result.candidate, { version: "1.3.0", verified: false });
  assert.deepEqual(result.actions, []);
  assert.match(result.warning, /not verified.*simulation.*not release readiness/);
  assert.deepEqual(result.conditionalActions, [
    ["npm", "1.3.0"],
    ["npm-client", "1.3.0"],
    ["github", "1.3.0"]
  ]);
  assert.deepEqual(writes, []);
});

test("an unpublished candidate never becomes verified evidence or promotion actions", async () => {
  const { api, state, writes } = fixture();
  state.completeVersions = [];
  state.npmLatest = state.clientNpmLatest = state.githubLatest = null;
  api.readState = async () => state;
  const result = await reconcileLatest(api, { dryRun: true, candidate: "9.9.9" });
  assert.equal(result.target, "9.9.9");
  assert.equal(result.targetVerified, false);
  assert.deepEqual(result.candidate, { version: "9.9.9", verified: false });
  assert.deepEqual(result.actions, []);
  assert.equal(result.conditionalActions.length, 3);
  assert.match(result.warning, /not verified/);
  assert.deepEqual(state.completeVersions, []);
  await assert.rejects(reconcileLatest(api, { maxAttempts: 1 }), /没有同时完成/);
  await assert.rejects(reconcileLatest(api, { candidate: "9.9.9" }), /仅能与 --dry-run/);
  assert.deepEqual(writes, []);
});

test("verified dry-run targets retain actionable plans without conditional readiness", async () => {
  for (const candidate of [null, "1.2.0", "1.1.0"]) {
    const { api, state, writes } = fixture();
    const result = await reconcileLatest(api, { dryRun: true, candidate });
    assert.equal(result.target, "1.2.0");
    assert.equal(result.targetVerified, true);
    assert.equal(result.actions.length, 3);
    assert.equal(Object.hasOwn(result, "conditionalActions"), false);
    assert.equal(Object.hasOwn(result, "warning"), false);
    if (candidate !== null)
      assert.deepEqual(result.candidate, {
        version: candidate,
        verified: state.completeVersions.includes(candidate)
      });
    assert.deepEqual(writes, []);
  }
});

test("candidate simulation retains latest floors and propagates verification failures", async () => {
  const { api, state, writes } = fixture();
  state.clientNpmLatest = "1.4.0";
  await assert.rejects(reconcileLatest(api, { dryRun: true, candidate: "1.3.0" }), /拒绝把 latest/);
  const failure = new Error("GitHub Release archive integrity mismatch");
  api.readState = async () => {
    throw failure;
  };
  await assert.rejects(
    reconcileLatest(api, { dryRun: true, candidate: "9.9.9" }),
    (error) => error === failure
  );
  assert.deepEqual(writes, []);
});

test("partial latest promotion resumes only missing writes and never downgrades either package", async () => {
  const { api, state, writes } = fixture();
  const setClient = api.setClientNpmLatest;
  api.setClientNpmLatest = async () => {
    throw new Error("interrupted");
  };
  await assert.rejects(reconcileLatest(api), /interrupted/);
  assert.equal(state.npmLatest, "1.2.0");
  assert.equal(state.githubLatest, "1.0.0");
  api.setClientNpmLatest = setClient;
  await reconcileLatest(api);
  assert.deepEqual(writes, [
    ["runtime", "1.2.0"],
    ["client", "1.2.0"],
    ["github", "1.2.0"]
  ]);
  state.completeVersions = ["1.1.0"];
  await assert.rejects(reconcileLatest(api, { maxAttempts: 1 }), /拒绝把 latest/);
  assert.equal(state.clientNpmLatest, "1.2.0");
});

test("a newer client latest is a floor even when runtime and GitHub lag behind", async () => {
  const { api, state, writes } = fixture();
  state.clientNpmLatest = "1.3.0";
  await assert.rejects(reconcileLatest(api, { maxAttempts: 1 }), /拒绝把 latest/);
  assert.deepEqual(writes, []);
});

for (const absentAsset of [null, "client", "runtime", "client-version"]) {
  test(`command client requires both package versions and both assets (missing=${absentAsset})`, async () => {
    const tags = new Map([
      [runtime, "1.0.0"],
      [client, "1.0.0"]
    ]);
    let githubLatest = "1.0.0";
    const checked = [];
    const artifact = (name, version) =>
      `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
    const runCommand = async (command, args) => {
      if (command === "npm") {
        if (args[0] === "dist-tag") {
          const at = args[2].lastIndexOf("@");
          tags.set(args[2].slice(0, at), args[2].slice(at + 1));
          return "";
        }
        if (args[2] === "versions")
          return JSON.stringify(
            absentAsset === "client-version" && args[1] === client ? ["1.0.0"] : ["1.0.0", "1.2.0"]
          );
        if (args[2] === "version") return JSON.stringify(tags.get(args[1].replace(/@latest$/, "")));
        if (args[2] === "dist.integrity") {
          checked.push(args[1]);
          return JSON.stringify(integrity(args[1]));
        }
      }
      if (args[1] === "list")
        return JSON.stringify(
          ["1.0.0", "1.2.0"].map((v) => ({
            tagName: `v${v}`,
            isDraft: false,
            isPrerelease: false,
            isLatest: v === githubLatest
          }))
        );
      if (args[1] === "view") {
        const v = args[2].slice(1);
        return JSON.stringify({
          assets: [runtime, client]
            .filter(
              (name) =>
                v !== "1.2.0" ||
                !(
                  (absentAsset === "client" && name === client) ||
                  (absentAsset === "runtime" && name === runtime)
                )
            )
            .map((name) => ({ name: artifact(name, v) }))
        });
      }
      if (args[1] === "download") {
        const filename = args[args.indexOf("--pattern") + 1];
        const v = args[2].slice(1);
        await writeFile(
          join(args[args.indexOf("--dir") + 1], filename),
          `${filename.includes("-client-") ? client : runtime}@${v}`
        );
        return "";
      }
      if (args[1] === "edit") {
        githubLatest = args[2].slice(1);
        return "";
      }
      throw new Error(`Unexpected command: ${command} ${args}`);
    };
    const api = createCommandClient({
      packageName: runtime,
      repository: "fixture/runtime",
      paired: true,
      runCommand
    });
    const plan = await reconcileLatest(api, { dryRun: true, candidate: "1.2.0" });
    assert.equal(plan.targetVerified, absentAsset === null);
    assert.deepEqual(plan.candidate, { version: "1.2.0", verified: absentAsset === null });
    if (absentAsset) {
      assert.deepEqual(plan.actions, []);
      assert.equal(plan.conditionalActions.length, 3);
      assert.match(plan.warning, /not verified/);
    } else {
      assert.equal(plan.actions.length, 3);
      assert.equal(Object.hasOwn(plan, "warning"), false);
    }
    assert.equal(tags.get(runtime), "1.0.0");
    assert.equal(tags.get(client), "1.0.0");
    assert.equal(githubLatest, "1.0.0");
    const result = await reconcileLatest(api);
    const expected = absentAsset ? "1.0.0" : "1.2.0";
    assert.equal(result.target, expected);
    assert.equal(tags.get(runtime), expected);
    assert.equal(tags.get(client), expected);
    assert.ok(checked.includes(`${client}@${expected}`));
  });
}

async function workflowFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "oc309-publish-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  await mkdir(join(directory, "release"));
  const artifacts = new Map();
  for (const [index, name] of [runtime, client].entries()) {
    const path = join(
      directory,
      `release/mininglamp-oss-octo-runtime${index ? "-client" : ""}-0.0.309.tgz`
    );
    await writeFile(path, name);
    artifacts.set(name, path);
  }
  for (const name of ["npm", "gh"]) {
    await cp(join(import.meta.dirname, "fixtures/release-commands-309.mjs"), join(bin, name));
    await chmod(join(bin, name), 0o755);
  }
  await mkdir(join(directory, "scripts"));
  await cp(
    new URL("../../scripts/check-release-registry.mjs", import.meta.url),
    join(directory, "scripts/check-release-registry.mjs")
  );
  const stateFile = join(directory, "state.json");
  const state = { calls: [], packages: {}, releaseExists: true, assets: [], ...options };
  await writeFile(stateFile, JSON.stringify(state));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    OCTO_RELEASE_FIXTURE: stateFile,
    VERSION: "0.0.309",
    REGISTRY: registry,
    DRY_RUN: "false",
    NPM_TOKEN: randomUUID(),
    NODE_AUTH_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    TAG: "v0.0.309",
    GITHUB_REPOSITORY: "fixture/runtime",
    GITHUB_OUTPUT: join(directory, "output.txt")
  };
  const readState = async () => JSON.parse(await readFile(stateFile, "utf8"));
  const step = async (workflow, name) => {
    const source = await readFile(
      new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url),
      "utf8"
    );
    const block = source.split(`- name: ${name}\n`)[1]?.split(/\n      - /)[0];
    const body = block?.split("        run: |\n")[1];
    assert.ok(body, `Missing workflow run step ${name}`);
    const lines = [];
    for (const line of body.split("\n")) {
      if (line && !line.startsWith("          ")) break;
      lines.push(line.replace(/^          /, ""));
    }
    return lines.join("\n");
  };
  const executeStep = async (workflow, name) =>
    execFileSync("bash", ["-c", await step(workflow, name)], {
      cwd: directory,
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000
    });
  return { artifacts, env, state, stateFile, readState, executeStep };
}

for (const existing of [[], [client], [runtime], [runtime, client]]) {
  test(`actual publish workflow skips existing packages: ${existing.join("+") || "neither"}`, async (t) => {
    const f = await workflowFixture(t, {
      packages: Object.fromEntries(existing.map((name) => [name, integrity(name)])),
      lostPublishAck: true
    });
    await f.executeStep("npm-publish", "Check registry version");
    f.env.RUNTIME_EXISTS = String(existing.includes(runtime));
    f.env.CLIENT_EXISTS = String(existing.includes(client));
    await f.executeStep("npm-publish", "Publish verified archive");
    await f.executeStep("npm-publish", "Verify published registry version");
    const state = await f.readState();
    assert.deepEqual(
      state.calls
        .filter((call) => call[0] === "npm" && call[1] === "publish")
        .map((call) => call[2]),
      [client, runtime]
        .filter((name) => !existing.includes(name))
        .map(
          (name) =>
            `./release/${name.endsWith("-client") ? "mininglamp-oss-octo-runtime-client" : "mininglamp-oss-octo-runtime"}-0.0.309.tgz`
        )
    );
    assert.deepEqual(state.packages, {
      [runtime]: integrity(runtime),
      [client]: integrity(client)
    });
  });
}

test("actual preflight blocks all uploads on either conflict or authentication failure", async (t) => {
  for (const options of [
    { packages: { [client]: integrity("conflict") } },
    { lookupError: "E401" }
  ]) {
    const f = await workflowFixture(t, options);
    await assert.rejects(f.executeStep("npm-publish", "Check registry version"));
    assert.equal(
      (await f.readState()).calls.some((call) => call[1] === "publish"),
      false
    );
  }
});

test("actual dry-run publishes neither archive", async (t) => {
  const f = await workflowFixture(t);
  f.env.DRY_RUN = "true";
  f.env.RUNTIME_EXISTS = "false";
  f.env.CLIENT_EXISTS = "false";
  await f.executeStep("npm-publish", "Publish verified archive");
  const state = await f.readState();
  assert.deepEqual(state.packages, {});
  const uploads = state.calls.filter((call) => call[1] === "publish");
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((call) => call.includes("--dry-run")));
});

test("actual Release repair preserves matching assets and uploads only missing ones", async (t) => {
  for (const existing of [[], [runtime], [client], [runtime, client]]) {
    const f = await workflowFixture(t);
    f.state.assets = existing.map((name) => f.artifacts.get(name));
    await writeFile(f.stateFile, JSON.stringify(f.state));
    await f.executeStep("release-publish", "Create or repair GitHub Release");
    const state = await f.readState();
    const uploads = state.calls.filter((call) => call[0] === "gh" && call[2] === "upload");
    assert.equal(uploads.length, existing.length === 2 ? 0 : 1);
    assert.equal(state.assets.length, 2);
    assert.ok(uploads.every((call) => !call.includes("--clobber")));
  }
});

test("actual Release repair rejects an existing attachment with different bytes", async (t) => {
  const f = await workflowFixture(t);
  const path = join(f.stateFile, "..", "conflict");
  await mkdir(path);
  const file = join(path, "mininglamp-oss-octo-runtime-0.0.309.tgz");
  await writeFile(file, "conflict");
  f.state.assets = [file];
  await writeFile(f.stateFile, JSON.stringify(f.state));
  await assert.rejects(f.executeStep("release-publish", "Create or repair GitHub Release"));
  assert.equal(
    (await f.readState()).calls.some((call) => call[0] === "gh" && call[2] === "upload"),
    false
  );
});
