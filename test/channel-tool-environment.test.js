import { preparedFrames } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { octoCliEnvironment } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { configureCliOpenClaw, syncCliOpenClawToolEnvironment } from "../apps/cli/dist/openclaw.js";
import { spawnWorker, WorkerRpcClient } from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  assertInvokeRequest,
  invocationInput,
  InvokeInput
} from "@mininglamp-oss/octo-runtime-protocol";
import { codexEnvironmentConfig } from "../packages/octo-runtime-adapter-codex/dist/environment.js";
import { sanitizePublicValue } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { invokeRequest } from "./runtime-fixture.js";

const token = `bf_${randomUUID()}`;
const base = "https://im-test.deepminer.com.cn";
const context = {
  schema: "octo.context-envelope/v3",
  items: [
    {
      namespace: "octo.execution",
      name: "envs",
      payload: {
        env_variables: [
          { key: "OCTO_BOT_TOKEN", value: "wrong-context" },
          { key: "OCTO_TOKEN", value: randomUUID() },
          { key: "OCTO_API_BASE_URL", value: "wrong-context" },
          { key: "EXTRA_TOOL_VALUE", value: "kept" },
          { key: "EXPECTED_TOKEN", value: token }
        ]
      }
    }
  ]
};

test("channel tool URL normalization removes only the final api segment", () => {
  for (const [input, expected] of [
    [`${base}/api/`, base],
    [base, base],
    [`${base}:8443/api`, `${base}:8443`],
    [`${base}/api/tools`, `${base}/api/tools`]
  ])
    assert.equal(octoCliEnvironment(input, token).env_variables[1].value, expected);
  for (const input of [
    "file:///tmp/api",
    "https://user:pass@example.com/api",
    `${base}/api?x=1`,
    `${base}/api#x`
  ])
    assert.throws(() => octoCliEnvironment(input, token), /IM_API_URL_INVALID/);
  assert.throws(() => octoCliEnvironment(base, ""), /IM_BOT_TOKEN_INVALID/);
});

test("CLI dotenv and Gateway preserve URL normalization parity for repeated separators", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-tool-url-parity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const native = join(root, "native"),
    profile = join(root, "profile");
  await mkdir(native);
  await writeFile(
    join(native, "openclaw.json"),
    JSON.stringify({ gateway: { auth: { token: "gateway-fixture" } } })
  );
  await configureCliOpenClaw(profile, { openclawHome: native });
  const origin = "https://example.invalid";
  for (const [suffix, expected] of [
    ["/tenant///api/", "/tenant"],
    ["/tenant///api////", "/tenant"],
    ["/tenant///", "/tenant"],
    ["/tenant///api/tools////", "/tenant///api/tools"],
    ["///api/", ""],
    ["/api/", ""],
    ["", ""],
    ["/tenant///apiX///", "/tenant///apiX"]
  ]) {
    const apiUrl = origin + suffix;
    await syncCliOpenClawToolEnvironment(profile, [
      {
        name: "channel-gateway",
        config: {
          bots: [
            {
              bot_id: "fixture",
              bf_token: token,
              api_url: apiUrl,
              adapter: { adapter_type: "openclaw" }
            }
          ]
        }
      }
    ]);
    const actual = parseEnv(await readFile(join(native, ".env"), "utf8")).OCTO_API_BASE_URL;
    assert.equal(actual, origin + expected, apiUrl);
    assert.equal(actual, octoCliEnvironment(apiUrl, token).env_variables[1].value, apiUrl);
  }
});

test("tool overrides cross a real Host subprocess and reach child tools without changing Context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-tool-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, "adapters.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        {
          type: "tool-env",
          module: resolve("test/fixtures/tool-environment-adapter.js"),
          export: "adapter"
        }
      ]
    })
  );
  const host = await spawnWorker({
    entrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
    manifest,
    env: {
      ...process.env,
      OCTO_RUNTIME_HOME: root,
      OCTO_RUNTIME_LOGS_DIRECTORY: join(root, "logs"),
      OCTO_BOT_TOKEN: "wrong-device",
      OCTO_TOKEN: randomUUID(),
      OCTO_API_BASE_URL: "wrong-device"
    }
  });
  t.after(() => host.close());
  const original = structuredClone(context);
  const execute = async (value, index) => {
    const ctx = structuredClone(context);
    ctx.items[0].payload.env_variables.find((item) => item.key === "EXPECTED_TOKEN").value = value;
    const request = invokeRequest({
      invocationId: `tool-${index}`,
      runId: `tool-${index}`,
      approvalMode: "full_access",
      context: ctx
    });
    const input = invocationInput(request, "canonical");
    input.contexts.items.unshift({
      namespace: "octo.execution",
      name: "adapter",
      payload: { type: "tool-env" }
    });
    const events = [];
    for await (const event of host.client.invoke(
      { ...input, protocol_mode: "canonical" },
      { executionEnvOverrides: octoCliEnvironment(`${base}/api`, value) }
    ))
      events.push(event);
    assert.deepEqual(
      JSON.parse(events.findLast((event) => event.type === "message.update").payload.text),
      { tokenMatches: true, canonicalMatches: true, baseMatches: true, extraKept: true }
    );
  };
  await Promise.all([execute(token, 1), execute(`bf_${randomUUID()}`, 2)]);
  assert.deepEqual(context, original);
  await host.close();
  const log = (await readdir(join(root, "logs"))).find((name) =>
    /^kernel-\d{8}T\d{2}\.log$/.test(name)
  );
  assert.ok(!(await readFile(join(root, "logs", log), "utf8")).includes(token));
  const request = invokeRequest({
    context,
    executionEnvOverrides: octoCliEnvironment(`${base}/api`, token)
  });
  assert.equal(
    codexEnvironmentConfig(request, {})["shell_environment_policy.set"].OCTO_BOT_TOKEN,
    token
  );
  assert.equal(
    codexEnvironmentConfig(request, {})["shell_environment_policy.set"].OCTO_TOKEN,
    token
  );
  assert.equal(sanitizePublicValue(request).executionEnvOverrides, "[REDACTED]");
  assert.throws(
    () =>
      InvokeInput.check({
        ...invocationInput(request),
        executionEnvOverrides: request.executionEnvOverrides
      }),
    /local invoke environment/
  );
  for (const invalid of [
    { env_variables: [{ key: "BAD-KEY", value: "x" }] },
    { env_variables: [{ key: "X", value: "a\0b" }] },
    {
      env_variables: [
        { key: "X", value: "a" },
        { key: "X", value: "b" }
      ]
    },
    { env_variables: [{ key: "X", value: "a".repeat(65536) }] }
  ])
    assert.throws(() => assertInvokeRequest({ ...request, executionEnvOverrides: invalid }));
});

test("old Host cannot silently ignore the tool environment", async (t) => {
  const input = new PassThrough(),
    output = new PassThrough();
  const client = new WorkerRpcClient({ input, output });
  t.after(() => {
    client.close();
    input.destroy();
    output.destroy();
  });
  let method;
  output.on("data", (bytes) => {
    const message = JSON.parse(bytes.toString());
    method = message.method;
    input.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "unknown method" }
      }) + "\n"
    );
  });
  await assert.rejects(async () => {
    for await (const frame of preparedFrames(
      client,
      "test",
      invokeRequest({ executionEnvOverrides: octoCliEnvironment(base, token) })
    ))
      void frame;
  }, /unknown method/);
  assert.equal(method, "invoke.with-environment");
});

test("F24: OpenClaw CLI updates only two dotenv keys, last enabled OpenClaw Bot wins", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "octo-tool-dotenv-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const native = join(root, "native"),
    profile = join(root, "profile");
  await mkdir(native);
  await writeFile(
    join(native, "openclaw.json"),
    JSON.stringify({ gateway: { port: 19900, auth: { token: "gateway-test" } } })
  );
  await configureCliOpenClaw(profile, { openclawHome: native });
  const file = join(native, ".env");
  await writeFile(
    file,
    '# Keep this comment\nOTHER="line1\nline2"\nexport OCTO_BOT_TOKEN="old\nvalue"\nOCTO_BOT_TOKEN=duplicate\nOCTO_TOKEN=old\nOCTO_API_BASE_URL=old\n'
  );
  const extra = (bots) => [{ name: "channel-gateway", config: { bots }, load: async () => ({}) }];
  const bot = (id, credential) => ({
    bot_id: id,
    api_url: `${base}/api/`,
    bf_token: credential,
    adapter: { adapter_type: "openclaw" }
  });
  const credentialFile = join(root, "bot-token");
  const lastToken = `bf_${randomUUID()}`;
  await writeFile(credentialFile, `${lastToken}\n`, { mode: 0o600 });
  // 宿主读取自己的配置来源，SDK 只接收已经取得的凭据值。
  const second = bot("second", await readFile(credentialFile, "utf8"));
  const configs = extra([
    bot("first", token),
    second,
    { ...bot("disabled", "bf_disabled"), enabled: false },
    { ...bot("codex", "bf_codex"), adapter: { adapter_type: "codex" } },
    { ...bot("default", "bf_default"), adapter: {} }
  ]);
  assert.equal((await syncCliOpenClawToolEnvironment(profile, configs)).written, true);
  const content = await readFile(file, "utf8");
  // Node.js 26 返回无原型对象；此处验证 dotenv 键值，不约束解析器的对象原型。
  assert.deepEqual(
    { ...parseEnv(content) },
    {
      OTHER: "line1\nline2",
      OCTO_TOKEN: "old",
      OCTO_BOT_TOKEN: lastToken,
      OCTO_API_BASE_URL: base
    }
  );
  assert.ok(content.startsWith("# Keep this comment\n"));
  assert.equal((content.match(/OCTO_BOT_TOKEN=/g) ?? []).length, 1);
  assert.equal((content.match(/OCTO_TOKEN=/g) ?? []).length, 1);
  const info = await stat(file);
  assert.ok(info.isFile());
  // Windows 不提供 POSIX 权限位；正文和普通文件断言仍在所有平台执行。
  if (process.platform !== "win32") assert.equal(info.mode & 0o777, 0o600);
  assert.deepEqual(await syncCliOpenClawToolEnvironment(profile, configs), {
    file,
    written: false,
    restartRequired: true
  });
  assert.deepEqual(
    await syncCliOpenClawToolEnvironment(
      profile,
      extra([{ ...bot("codex-only", token), adapter: { adapter_type: "codex" } }])
    ),
    { written: false, restartRequired: false }
  );
  assert.equal(await readFile(file, "utf8"), content);
  const other = join(root, "other");
  await mkdir(other);
  await writeFile(
    join(other, "openclaw.json"),
    JSON.stringify({ gateway: { auth: { token: "other-gateway" } } })
  );
  await configureCliOpenClaw(join(root, "other-profile"), { openclawHome: other });
  await syncCliOpenClawToolEnvironment(join(root, "other-profile"), extra([bot("first", token)]));
  assert.equal(parseEnv(await readFile(join(other, ".env"), "utf8")).OCTO_BOT_TOKEN, token);
  assert.equal(await readFile(file, "utf8"), content);
  const state = join(root, "state"),
    custom = join(root, "custom.json"),
    customProfile = join(root, "custom-profile");
  await mkdir(state);
  await writeFile(custom, JSON.stringify({ gateway: { auth: { token: "custom-gateway" } } }));
  await configureCliOpenClaw(
    customProfile,
    {},
    { OPENCLAW_CONFIG_PATH: custom, OPENCLAW_STATE_DIR: state }
  );
  await configureCliOpenClaw(customProfile, {}, {});
  const synced = await syncCliOpenClawToolEnvironment(customProfile, extra([bot("custom", token)]));
  assert.equal(synced.file, join(state, ".env"));
  await configureCliOpenClaw(join(root, "remote-profile"), {
    url: "wss://gateway.example",
    token: "remote-token"
  });
  assert.deepEqual(await syncCliOpenClawToolEnvironment(join(root, "remote-profile"), configs), {
    written: false,
    restartRequired: false
  });
});
