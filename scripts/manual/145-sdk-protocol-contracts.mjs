import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";
import markdown from "prettier/plugins/markdown";
import ts from "typescript";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { attachKernel, createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import {
  InvokeInput,
  assertCanonicalEvent,
  assertHostFrame,
  envelope,
  resolveContextConfiguration
} from "@mininglamp-oss/octo-runtime-protocol";

// 独立手动入口，不加入默认测试 glob、docs:check 或 CI；所有测试使用本次构建产物。
const root = fileURLToPath(new URL("../../", import.meta.url));
const { adapters } = await import("./145-sdk-worker.mjs");
const source = (path) => readFile(join(root, path), "utf8");
const collect = async (stream) => {
  const values = [];
  for await (const value of stream) values.push(value);
  return values;
};
const input = (adapter = "docs", text = "example") =>
  InvokeInput.check({
    inputs: [{ type: "text", text }],

    agentEnv: {
      ...{
        schema: "octo.context-envelope/v3",
        items: [{ namespace: "octo.execution", name: "adapter", payload: { type: adapter } }]
      },
      approvalMode: "full_access"
    }
  });

function nodes(node) {
  return [node, ...(node.children ?? []).flatMap(nodes)];
}
function bounded(promise, milliseconds = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("manual validation timed out")), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

// 各清理步骤独立尝试；保留业务断言与清理错误，不能因 socket 失败跳过服务关闭。
async function withCleanup(action, operations) {
  const errors = [];
  let result;
  try {
    result = await action();
  } catch (error) {
    errors.push(error);
  }
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "manual validation and cleanup failed");
  return result;
}

test("manual cleanup attempts every owner and retains original and cleanup failures", async () => {
  const original = new Error("original assertion"),
    cleanup = new Error("socket close timeout");
  let closed = false;
  await assert.rejects(
    withCleanup(async () => {
      throw original;
    }, [
      async () => {
        throw cleanup;
      },
      async () => {
        closed = true;
      }
    ]),
    (error) =>
      error instanceof AggregateError && error.errors[0] === original && error.errors[1] === cleanup
  );
  assert.equal(closed, true);
});

test("A1/A2: extracted bilingual README examples compile and run with current validators", async () => {
  // 位于仓库内以复用真实包解析；仅补 export，不重写任何示例合同字段。
  await mkdir(join(root, ".tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp/sdk-docs-"));
  await withCleanup(async () => {
    // 根发行包不依赖私有 Adapter SDK；只在本次临时目录链接当前工作区包。
    const scope = join(directory, "node_modules/@mininglamp-oss");
    await mkdir(scope, { recursive: true });
    await symlink(
      join(root, "packages/octo-runtime-adapter-sdk"),
      join(scope, "octo-runtime-adapter-sdk"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const paths = [];
    for (const language of ["md", "zh.md"]) {
      for (const name of ["protocol", "adapter-sdk"]) {
        const path = `packages/octo-runtime-${name}/README.${language}`;
        const blocks = nodes(markdown.parsers.markdown.parse(await source(path))).filter(
          (node) => node.type === "code" && node.lang === "ts"
        );
        assert.equal(blocks.length, 1, `${path}: expected one complete TypeScript example`);
        const target = join(directory, `${name}-${language}.mts`);
        const suffix = name === "protocol" ? "\nexport { input };\n" : "\n";
        await writeFile(target, blocks[0].value + suffix);
        paths.push(target);
      }
    }
    const config = ts.readConfigFile(join(root, "docs/examples/tsconfig.json"), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      join(root, "docs/examples")
    );
    const program = ts.createProgram([...parsed.fileNames, ...paths], parsed.options);
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n"
      })
    );
    const schema = JSON.parse(
      await source("packages/octo-runtime-protocol/schema/protocol.schema.json")
    );
    const ajv = new Ajv({ strict: false });
    ajv.addSchema(schema);
    const validateEvent = ajv.compile({ $ref: `${schema.$id}#/definitions/CanonicalEventWire` });
    const validateIdentity = ajv.compile({ $ref: `${schema.$id}#/definitions/RunIdentity` });
    for (const path of paths) {
      const example = await import(pathToFileURL(path).href);
      if (example.input) {
        InvokeInput.check(example.input);
        continue;
      }
      const executor = new AgentExecutor();
      executor.register(example.echoAdapter);
      await withCleanup(async () => {
        const events = await collect(
          executor.invoke({ ...input("echo"), protocol_mode: "canonical" })
        );
        assert.equal(events.filter((event) => event.type === "run.completed").length, 1);
        assert.equal(
          events
            .filter((event) => event.type === "message.delta")
            .map((event) => event.payload.text)
            .join(""),
          "example"
        );
        const run = { id: randomUUID(), agentSessionId: randomUUID() };
        assert.ok(validateIdentity(run), JSON.stringify(validateIdentity.errors));
        for (const [index, event] of events.entries()) {
          assertCanonicalEvent(event);
          assert.ok(validateEvent(event), JSON.stringify(validateEvent.errors));
          const wrapped = envelope(run, index + 1, event);
          assert.equal(wrapped.agentSessionId, run.agentSessionId);
          assert.equal(wrapped.runId, run.id);
          assert.equal(wrapped.seq, index + 1);
          assert.equal(wrapped.protocolVersion, 2);
          assert.ok(Object.isFrozen(wrapped));
          assert.ok(Number.isSafeInteger(wrapped.tsMs) && wrapped.tsMs > 0);
          assert.match(wrapped.id, /^[0-9a-f-]{36}$/);
          // 当前 Schema 没有 EventEnvelope 定义；复用其事件及身份定义，另断言封套元数据。
          assert.ok(
            validateEvent({
              protocolVersion: wrapped.protocolVersion,
              type: wrapped.type,
              payload: wrapped.payload
            })
          );
          assert.ok(
            validateIdentity({ id: wrapped.runId, agentSessionId: wrapped.agentSessionId })
          );
        }
      }, [async () => assert.equal((await executor.shutdown()).cleanup, "complete")]);
    }
  }, [() => rm(directory, { recursive: true, force: true })]);
});

test("A3: public native-only execution completes without canonical output or conversion", async () => {
  const executor = new AgentExecutor();
  let conversions = 0;
  const adapter = {
    metadata: {
      type: "native-docs",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "docs.native", modes: ["native"], nativeMethods: [] }
    },
    async *invoke(request, context) {
      assert.equal(context.protocolMode, "native");
      // 记录执行边界的转换报告，出现转换仍执行原检查以保留真实错误。
      const report = context.reportConversion;
      context.reportConversion = () => {
        conversions++;
        report();
      };
      yield { kind: "native", messageKind: "notification", payload: { text: request.modelInput } };
      yield { kind: "control", control: { type: "state", state: "completed" } };
    }
  };
  executor.register(adapter);
  await withCleanup(async () => {
    for (const selection of [{}, { protocol_mode: "native" }]) {
      const frames = await collect(executor.invoke({ ...input("native-docs"), ...selection }));
      frames.forEach(assertHostFrame);
      assert.equal(frames.filter((frame) => frame.kind === "canonical").length, 0);
      assert.equal(frames.filter((frame) => frame.kind === "native").length, 1);
      assert.equal(frames.at(-1).control.state, "completed");
    }
    assert.equal(conversions, 0);
  }, [async () => assert.equal((await executor.shutdown()).cleanup, "complete")]);
});

test("A3: canonical-only adapter rejects default native before invocation", async () => {
  const { defineAdapter } = await import("../../packages/octo-runtime-adapter-sdk/dist/index.js");
  const executor = new AgentExecutor();
  let calls = 0;
  executor.register(
    defineAdapter({
      metadata: { type: "canonical-docs", agentSources: ["provisioned"] },
      async *invoke() {
        calls++;
        yield { protocolVersion: 2, type: "run.completed", payload: {} };
      }
    })
  );
  await withCleanup(async () => {
    await assert.rejects(collect(executor.invoke(input("canonical-docs"))), {
      code: "PROTOCOL_MODE_UNSUPPORTED"
    });
    assert.equal(calls, 0);
    const events = await collect(
      executor.invoke({ ...input("canonical-docs"), protocol_mode: "canonical" })
    );
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(calls, 1);
  }, [async () => assert.equal((await executor.shutdown()).cleanup, "complete")]);
});

test("A4: mandatory env values override request differences without mutating inputs", () => {
  const envs = (values) => ({
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "envs",
        payload: {
          env_variables: Object.entries(values).map(([key, value]) => ({ key, value }))
        }
      }
    ]
  });
  const configuration = {
    defaults: envs({ A: "base", B: "default" }),
    mandatory: envs({ A: "locked" })
  };
  for (const request of [envs({ A: "request", C: "request" }), envs({ C: "request" })]) {
    const original = structuredClone({ configuration, request });
    const result = resolveContextConfiguration(configuration, request);
    const values = Object.fromEntries(
      result.items[0].payload.env_variables.map(({ key, value }) => [key, value])
    );
    assert.deepEqual(values, { A: "locked", B: "default", C: "request" });
    assert.deepEqual({ configuration, request }, original);
  }
  assert.deepEqual(
    resolveContextConfiguration({ defaults: envs({ A: "base" }), mandatory: envs({}) }, envs({})),
    envs({ A: "base" })
  );
});

test("A5: legacy public wrappers, unversioned events and removed terminals are rejected", () => {
  for (const field of ["protocolMode", "adapterType", "request", "options"])
    assert.throws(
      () => InvokeInput.check({ ...input(), [field]: "canonical" }),
      /unified JSON contract/
    );
  assert.throws(
    () => assertCanonicalEvent({ type: "message.delta", payload: { text: "old" } }),
    /protocolVersion/
  );
  assert.throws(
    () => assertCanonicalEvent({ protocolVersion: 2, type: "run.finished", payload: {} }),
    /unsupported canonical event/
  );
});

async function subscribe(endpoint, ref, sockets, errors) {
  const socket = net.createConnection(endpoint);
  sockets.add(socket);
  const closed = new Promise((resolve) => socket.once("close", resolve));
  const lines = createInterface({ input: socket });
  const id = randomUUID();
  try {
    const acknowledged = new Promise((resolve, reject) => {
      let accepted = false;
      const failed = (error) => {
        if (accepted) {
          if (!errors.includes(error)) errors.push(error);
        } else reject(error);
      };
      socket.on("error", failed);
      lines.on("error", failed);
      socket.once("close", () => {
        if (!accepted) reject(new Error("closed before ACK"));
      });
      lines.on("line", (line) => {
        try {
          const value = JSON.parse(line);
          if (value.error) {
            const error = Object.assign(new Error(value.error.message), {
              code: value.error.data?.code
            });
            if (accepted) errors.push(error);
            else reject(error);
          } else if (!accepted) {
            assert.equal(value.id, id);
            assert.deepEqual(value.result.ref, ref);
            accepted = true;
            resolve();
          } else {
            assert.equal(value.method, "agent_run.event");
            assertHostFrame(value.params.event);
          }
        } catch (error) {
          if (accepted) errors.push(error);
          else reject(error);
        }
      });
    });
    socket.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method: "agent_run.subscribe", params: { ref, after_seq: 0 } })}\n`
    );
    await bounded(acknowledged);
    return async () => {
      socket.destroy();
      await bounded(closed);
      lines.close();
    };
  } catch (error) {
    return withCleanup(async () => {
      throw error;
    }, [
      async () => {
        socket.destroy();
        await bounded(closed);
      },
      () => lines.close()
    ]);
  }
}

async function subscribeAfterRelease(endpoint, ref, sockets, errors) {
  const deadline = Date.now() + 5000;
  // socket 关闭和 Run 终态均可能先于服务端归还额度；只对明确容量拒绝有界重试。
  while (true) {
    try {
      return await subscribe(endpoint, ref, sockets, errors);
    } catch (error) {
      if (error.code !== "STREAM_SUBSCRIBER_LIMIT" || Date.now() >= deadline) throw error;
    }
  }
}

test(
  "A3/A6: object attachment and two-run Kernel-wide subscription allocation and release",
  { timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(
      join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ort145-")
    );
    const endpoint = componentEndpoint(directory);
    const service = createKernelService({ home: directory, endpoint, adapters });
    const sockets = new Set();
    const errors = [];
    let client;
    let cleanupComplete = false;
    await withCleanup(async () => {
      await service.initialize();
      client = attachKernel({ endpoint });
      const { inputs: parts, agentEnv, sessionId, providerSession, ...metadata } = input();
      const frames = await collect(
        client.invoke({ ...metadata, parts }, sessionId, providerSession, agentEnv)
      );
      assert.equal(frames.at(-1).control.state, "completed");
      client.close();
      assert.equal((await service.client.status()).pid, process.pid);
      client = attachKernel({ endpoint });
      const refs = [];
      for (let i = 0; i < 2; i++) refs.push((await client.submit(input("docs", "hold"))).ref);
      assert.notEqual(refs[0].run_id, refs[1].run_id);
      const releases = [];
      for (const ref of refs)
        for (let i = 0; i < 8; i++) releases.push(await subscribe(endpoint, ref, sockets, errors));
      await assert.rejects(subscribe(endpoint, refs[1], sockets, errors), {
        code: "STREAM_SUBSCRIBER_LIMIT"
      });
      await releases[0]();
      await subscribeAfterRelease(endpoint, refs[1], sockets, errors);
      assert.deepEqual(errors, []);
      for (const ref of refs) {
        await client.cancel(ref, "manual_validation_complete");
        const until = Date.now() + 5000;
        let snapshot;
        do {
          snapshot = await client.get(ref, ref.kernel_instance_id);
          if (snapshot.terminal) break;
          assert.ok(Date.now() < until, "cancelled Run did not reach terminal");
          await new Promise(setImmediate);
        } while (true);
        assert.equal(snapshot.terminal.control.state, "cancelled");
      }
      assert.deepEqual(errors, []);
      // 对真实订阅 socket 注入 ACK 后的错误事件，证明失败不会落入已完成的 ACK Promise。
      const probeErrors = [];
      const releaseProbe = await subscribeAfterRelease(endpoint, refs[0], sockets, probeErrors);
      const probe = [...sockets].at(-1);
      const injected = new Error("injected post-ACK socket error");
      probe.emit("error", injected);
      assert.deepEqual(probeErrors, [injected]);
      await releaseProbe();
    }, [
      async () => {
        const closed = [...sockets].map((socket) =>
          socket.closed
            ? Promise.resolve()
            : new Promise((resolve) => socket.once("close", resolve))
        );
        for (const socket of sockets) socket.destroy();
        await bounded(Promise.all(closed));
      },
      () => client?.close(),
      async () => {
        const cleanup = await service.close();
        cleanupComplete = cleanup.complete;
        assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
      },
      async () => {
        // 未确认服务回收时保留现场目录，不能删除清理事实。
        if (cleanupComplete) await rm(directory, { recursive: true, force: true });
        else throw new Error(`incomplete service cleanup; retained ${directory}`);
      },
      () => assert.deepEqual(errors, [])
    ]);
  }
);

test("A7: bilingual signatures and shared capacity match the documented public contract", async () => {
  for (const language of ["en", "zh-CN"]) {
    for (const page of ["getting-started/sdk", "concepts/architecture"]) {
      const text = await source(`docs/${language}/${page}.md`);
      // 原生宿主使用自己的 RPC client；独立应用跨进程 attach 的示例在 CLI 章节。
      assert.ok(text.includes("createKernelService"));
      assert.ok(text.includes("kernel.client"));
      assert.ok(!text.includes("attachKernel(endpoint)"));
    }
    const cli = await source(`docs/${language}/getting-started/cli.md`);
    assert.ok(cli.includes("attachKernel({ endpoint"));
    const capacity = await source(`docs/${language}/reference/kernel-ipc.md`);
    assert.match(
      capacity,
      language === "en" ? /16, shared by all executions and clients/ : /16，所有执行和客户端共享/
    );
  }
  const baseline = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(baseline.status, 0, baseline.stderr);
  console.log(
    `Validated workspace HEAD ${baseline.stdout.trim()}; inspect git status for dirty files.`
  );
});
