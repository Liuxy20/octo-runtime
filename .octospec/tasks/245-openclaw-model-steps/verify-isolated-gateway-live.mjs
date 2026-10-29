import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  configureOpenClawConnection,
  loadLocalOpenClawGateway
} from "../../../packages/octo-runtime-adapter-openclaw/dist/local-gateway.js";
import { OpenClawGatewayClient } from "../../../packages/octo-runtime-adapter-openclaw/dist/gateway.js";

// 手动真实验收：安装路径由调用方提供，隔离配置/工作区/端口，模型连接仅从仓库外读取。
const binary = process.argv[2];
assert.ok(binary, "Usage: node verify-isolated-gateway-live.mjs /absolute/path/openclaw.mjs");
const scratch = await mkdtemp(join(tmpdir(), "octo-245-isolated-"));
const home = join(scratch, "runtime");
const state = join(scratch, "openclaw");
const configPath = join(state, "openclaw.json");
const source = JSON.parse(await readFile(join(homedir(), ".openclaw/openclaw.json"), "utf8"));
// 旧版不会给自定义模型补齐 token 限额；仅补充隔离测试副本。
for (const provider of Object.values(source.models?.providers ?? {}))
  for (const model of provider.models ?? []) {
    model.maxTokens ??= 4096;
    model.contextWindow ??= 128000;
  }
const token = randomUUID();
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
let gateway;
let gatewayOutput = "";
try {
  await mkdir(state, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      models: source.models,
      agents: {
        defaults: {
          model: source.agents.defaults.model,
          workspace: join(scratch, "workspace"),
          skipBootstrap: true
        }
      },
      gateway: { mode: "local", bind: "loopback", port, auth: { mode: "token", token } },
      tools: { exec: { host: "gateway", security: "full", ask: "off" } }
    }),
    { mode: 0o600 }
  );
  gateway = spawn(
    process.execPath,
    [binary, "gateway", "run", "--port", String(port), "--bind", "loopback"],
    {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: state,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_SKIP_CHANNELS: "1",
        OPENCLAW_SKIP_CRON: "1",
        OPENCLAW_SKIP_BROWSER: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const exited = once(gateway, "exit");
  for (const stream of [gateway.stdout, gateway.stderr])
    stream.on("data", (chunk) => {
      gatewayOutput = (gatewayOutput + String(chunk)).slice(-32_768);
    });
  await configureOpenClawConnection(join(home, "default"), {
    url: `ws://127.0.0.1:${port}`,
    token
  });
  const connection = await loadLocalOpenClawGateway(join(home, "default"));
  let hello;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const client = new OpenClawGatewayClient(connection);
    try {
      hello = await client.connect();
      break;
    } catch {
      if (gateway.exitCode !== null) throw new Error("Isolated Gateway exited before handshake");
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      await client.close();
    }
  }
  assert.ok(hello, "Isolated Gateway did not become ready");
  console.log(JSON.stringify({ isolatedGateway: hello.server?.version, port }));
  const verification = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./verify-playboard-live.mjs", import.meta.url)),
      ...(process.argv.includes("--resume") ? ["--resume"] : [])
    ],
    {
      env: { ...process.env, OCTO245_RUNTIME_HOME: home },
      stdio: "inherit"
    }
  );
  const [code] = await once(verification, "exit");
  assert.equal(code, 0, "Isolated Gateway Playboard failed");
  gateway.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
} catch (error) {
  // 只暴露错误类型和已脱敏的启动诊断，模型凭据和认证 token 不输出。
  const secrets = [
    token,
    ...Object.values(source.models?.providers ?? {})
      .map((p) => p.apiKey)
      .filter((v) => typeof v === "string")
  ];
  for (const secret of secrets) gatewayOutput = gatewayOutput.replaceAll(secret, "[redacted]");
  console.error(gatewayOutput.slice(-6000));
  throw error;
} finally {
  if (gateway && gateway.exitCode === null) {
    gateway.kill("SIGKILL");
    await once(gateway, "exit");
  }
  await rm(scratch, { recursive: true, force: true });
}
