import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const archive = process.argv[2];
if (!archive?.endsWith(".tgz")) throw new Error("Explicit local release .tgz required");
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const consumer = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc313-"));
try {
  await writeFile(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  await execute(
    "npm",
    ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", resolve(archive)],
    { cwd: consumer, timeout: 60000 }
  );
  await cp(
    new URL("./fixtures/codex-service-313.mjs", import.meta.url),
    join(consumer, "provider.mjs")
  );
  await writeFile(
    join(consumer, "consumer.mts"),
    `
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime/adapters/codex";
import { createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
const home = process.cwd();
const makeOwner = () => createManagedCodexEngine({ codexHome: home, command: process.execPath, appServerArgs: [join(home, "provider.mjs"), join(home, "rpc.ndjson")] });
const input: InvokeInput & { protocol_mode: "canonical" } = { inputs: [{ type: "text", text: "hello" }], protocol_mode: "canonical",
  agentEnv: { schema: "octo.context-envelope/v3", items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },{namespace:"octo.execution",name:"workspace",payload:{path:home}}] } };
const core = new AgentExecutor();
const owner = makeOwner();
core.register(createCodexAdapter({ engine: owner.provider }));
try {
  assert.deepEqual(core.processes(), []);
  let pid: number | undefined;
  for (let i = 0; i < 3; i++) {
    let terminal = "";
    for await (const event of core.invoke(input)) if (event.type.startsWith("run.")) terminal = event.type;
    assert.equal(terminal, "run.completed");
    const service = owner.processes()[0]!;
    if (pid) assert.equal(service.pid, pid);
    pid = service.pid;
  }
} finally { try { assert.equal((await core.shutdown()).cleanup, "complete"); } finally { assert.equal((await owner.close({ deadline: performance.now()+2500 })).complete, true); } }
const kernelHome = join(home, "kernel");
await mkdir(kernelHome);
const kernelOwner = makeOwner();
const kernel = createKernelService({ home: kernelHome, endpoint: componentEndpoint(kernelHome), adapters: [createCodexAdapter({ engine: kernelOwner.provider })],
  serviceProcesses: () => kernelOwner.processes(), async finalizeHostResources(deadline) {
    assert.equal((await kernelOwner.close({ deadline })).complete, true);
  } });
try {
  await kernel.initialize();
  let pid: number | undefined;
  for (let i = 0; i < 3; i++) {
    let terminal = "";
    const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
    for await (const event of kernel.client.invoke({ ...content, parts }, sessionId, providerSession, agentEnv)) if (event.type.startsWith("run.")) terminal = event.type;
    assert.equal(terminal, "run.completed");
    const service = (await kernel.client.status()).service_processes![0]!;
    if (pid) assert.equal(service.pid, pid);
    pid = service.pid;
  }
} finally { try { assert.equal((await kernel.close()).complete, true); } finally { assert.equal((await kernelOwner.close({ deadline: performance.now()+2500 })).complete, true); } }
console.log(JSON.stringify({ installedPackages: 1, strictTypes: "passed", directTurns: 3, ipcTurns: 3, pidReuse: "passed", ownerCleanup: "passed" }));
`
  );
  await execute(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "consumer.mts",
      "--module",
      "NodeNext",
      "--target",
      "ES2022",
      "--strict",
      "--skipLibCheck",
      "false",
      "--types",
      "node",
      "--typeRoots",
      join(root, "node_modules/@types")
    ],
    { cwd: consumer, timeout: 30000 }
  );
  const { stdout } = await execute(process.execPath, ["consumer.mjs"], {
    cwd: consumer,
    timeout: 30000
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.ownerCleanup, "passed");
  console.log(JSON.stringify(result));
} finally {
  await rm(consumer, { recursive: true, force: true });
}
