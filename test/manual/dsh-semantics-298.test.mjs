import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DshTrajectory } from "../../packages/octo-runtime-adapter-dsh/dist/trajectory.js";
import { createDshAdapter } from "../../packages/octo-runtime-adapter-dsh/dist/index.js";
import { AgentExecutor } from "../../packages/octo-runtime-executor-core/dist/index.js";
import {
  invocationInput,
  assertCanonicalEvent
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { invokeRequest } from "../runtime-fixture.js";
import { scenario } from "./fixtures/dsh-semantics-298.mjs";

// 手动运行，不加入默认测试/CI。可显式指定独立 Gateway checkout 验证真实消费者。
const baseline = process.env.OCTO_DSH_BASELINE === "1";
const finalText = (events) =>
  events
    .filter((e) => e.type === "message.delta" && e.payload.channel === "final")
    .map((e) => e.payload.text)
    .join("");
const commentaryText = (events) =>
  events
    .filter((event) => event.type === "message.delta" && event.payload.channel === "commentary")
    .map((event) => event.payload.text)
    .join("");
const terminal = (events) =>
  events.filter((e) => /^run\.(completed|failed|cancelled)$/.test(e.type));
function settle(trajectory) {
  const result = trajectory.finish("receipt");
  return Array.isArray(result) ? result : [result];
}

for (const status of ["ok", "error"])
  test(`DSH child ${status} finish is idempotent without closing its durable identity`, () => {
    const trajectory = new DshTrajectory("root", 8192);
    const started = {
      method: "subagent.started",
      params: { parentSessionId: "root", childSessionId: "child" }
    };
    const finished = { method: "subagent.finished", params: { ...started.params, status } };
    const first = trajectory.accept(started);
    assert.deepEqual(trajectory.accept(started), []);
    const end = trajectory.accept(finished);
    assert.equal(end[0].payload.activityId, first[0].payload.activityId);
    assert.equal(end[0].payload.status, status === "ok" ? "completed" : "failed");
    assert.deepEqual(trajectory.accept(finished), []);
    const late = {
      method: "session.event",
      params: {
        sessionId: "child",
        event: { type: "turn/start", seq: 0, time: 1000, data: { turn: 0 } }
      }
    };
    assert.deepEqual(trajectory.accept(late), []);
    const resumed = trajectory.accept(started);
    assert.equal(resumed.length, 1);
    assert.notEqual(resumed[0].payload.activityId, first[0].payload.activityId);
    assert.equal(trajectory.accept(finished)[0].payload.activityId, resumed[0].payload.activityId);
    assert.deepEqual(trajectory.accept(finished), []);
  });

test("DSH native child reattachment creates paired activities and preserves root final", () => {
  const trajectory = new DshTrajectory("root", 8192);
  const events = scenario("child-reattach").flatMap((notification) =>
    trajectory.accept(notification)
  );
  events.push(...settle(trajectory));
  events.forEach(assertCanonicalEvent);
  const starts = events.filter(
    (event) => event.type === "activity.started" && event.payload.activityId.includes(":agent:")
  );
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].payload.activityId, starts[1].payload.activityId);
  for (const start of starts)
    assert.equal(
      events.filter(
        (event) =>
          event.type === "activity.finished" &&
          event.payload.activityId === start.payload.activityId
      ).length,
      1
    );
  assert.ok(commentaryText(events).includes("子代理续跑结果"));
  assert.ok(!commentaryText(events).includes("LATE_CHILD_REPLAY"));
  assert.equal(finalText(events), "检查完成。");
});

for (const mode of ["child-late", "child-reattach"])
  test(`official SDK/Core child activity boundaries: ${mode}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-298-child-"));
    const core = new AgentExecutor();
    core.register(createDshAdapter());
    t.after(async () => {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    });
    const request = invokeRequest({
      workdir: directory,
      approvalMode: "full_access",
      agentConfig: {
        providerOptions: {
          dshBin: fileURLToPath(new URL("./fixtures/dsh-semantics-298.mjs", import.meta.url))
        }
      }
    });
    const events = await Array.fromAsync(
      core.invoke(invocationInput(request, "canonical", "dsh"), {
        executionEnvOverrides: { env_variables: [{ key: "OCTO_DSH_SEMANTICS_MODE", value: mode }] }
      })
    );
    assert.equal(terminal(events).length, 1);
    assert.equal(terminal(events)[0].type, "run.completed");
    assert.equal(finalText(events), "检查完成。");
    assert.ok(!commentaryText(events).includes("LATE_CHILD_REPLAY"));
    const starts = events.filter(
      (event) => event.type === "activity.started" && event.payload.activityId.includes(":agent:")
    );
    assert.equal(starts.length, mode === "child-reattach" ? 2 : 1);
    for (const start of starts)
      assert.equal(
        events.filter(
          (event) =>
            event.type === "activity.finished" &&
            event.payload.activityId === start.payload.activityId
        ).length,
        1
      );
    if (process.env.OCTO_GATEWAY_CHECKOUT) {
      const { ImRunProjector } = await import(
        pathToFileURL(
          join(
            resolve(process.env.OCTO_GATEWAY_CHECKOUT),
            "dist/packages/gateway/src/presentation/run-projector.js"
          )
        )
      );
      const projector = new ImRunProjector(request.runId);
      events.forEach((event) => projector.accept(event));
      assert.equal(projector.finalReply.text, "检查完成。");
      assert.equal(projector.snapshot().terminal, "completed");
      projector.dispose();
    }
  });

for (const mode of ["multi", "final", "chunks", "turns"])
  test(`DSH ${mode}: terminal confirmation owns the only root final`, () => {
    const trajectory = new DshTrajectory("root", 8192);
    const events = scenario(mode).flatMap((n) => trajectory.accept(n));
    if (!baseline) assert.equal(finalText(events), "");
    events.push(...settle(trajectory));
    for (const event of events) assertCanonicalEvent(event);
    if (!baseline) {
      assert.equal(finalText(events), mode === "turns" ? "最后一轮回答。" : "检查完成。");
      assert.equal(
        events.filter((e) => e.type === "message.create" && e.payload.channel === "final").length,
        1
      );
      assert.equal(terminal(events).length, 1);
      const finished = events.filter((e) => e.type === "model_step.finished");
      assert.equal(finished.at(-1).payload.finishReason, "stop");
      if (["multi", "turns"].includes(mode)) {
        assert.equal(finished[0].payload.finishReason, "tool-calls");
        const tools = events.filter((e) => e.type === "tool_call.create");
        const updates = events.filter((e) => e.type === "tool_call.update");
        assert.equal(updates[0].payload.id, tools[1].payload.id);
        assert.equal(updates[0].payload.status, "failed");
        assert.equal(updates[0].payload.stepId, finished[0].payload.stepId);
        assert.equal(updates[0].payload.durationMs, 10);
      }
    }
  });
for (const mode of ["cancel", "error", "max-tokens", "tool-only"])
  test(`DSH ${mode}: partial or tool narration cannot become final`, () => {
    const trajectory = new DshTrajectory("root", 8192);
    const events = scenario(mode).flatMap((n) => trajectory.accept(n));
    if (mode === "cancel") events.push(...settle(trajectory));
    else
      assert.throws(
        () => settle(trajectory),
        mode === "tool-only" ? /DSH_NO_FINAL_OUTPUT/ : /DSH_EXECUTION_FAILED/
      );
    assert.equal(finalText(events), "");
  });

test("DSH interrupted commit is rejected even when the turn reports completed", () => {
  const input = scenario("interrupted-completed");
  assert.equal(
    input.find((item) => item.params.event?.type === "assistant/message").params.event.data
      .interrupted,
    true
  );
  assert.equal(input.at(-1).params.event.data.reason.kind, "completed");
  const trajectory = new DshTrajectory("root", 8192);
  const events = input.flatMap((notification) => trajectory.accept(notification));
  assert.throws(() => settle(trajectory), { code: "DSH_NO_FINAL_OUTPUT" });
  assert.equal(
    events.some((event) => event.type.startsWith("message.") && event.payload.channel === "final"),
    false
  );
  assert.equal(terminal(events).length, 0);
});

test("official SDK and Core fail an interrupted commit with a completed turn without publishing final", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-298-interrupted-"));
  const core = new AgentExecutor();
  core.register(createDshAdapter());
  t.after(async () => {
    await core.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const request = invokeRequest({
    workdir: directory,
    approvalMode: "full_access",
    agentConfig: {
      providerOptions: {
        dshBin: fileURLToPath(new URL("./fixtures/dsh-semantics-298.mjs", import.meta.url))
      }
    }
  });
  const events = await Array.fromAsync(
    core.invoke(invocationInput(request, "canonical", "dsh"), {
      executionEnvOverrides: {
        env_variables: [{ key: "OCTO_DSH_SEMANTICS_MODE", value: "interrupted-completed" }]
      }
    })
  );
  events.forEach(assertCanonicalEvent);
  assert.equal(
    events.some((event) => event.type.startsWith("message.") && event.payload.channel === "final"),
    false
  );
  assert.equal(terminal(events).length, 1);
  assert.equal(terminal(events)[0].type, "run.failed");
  assert.equal(terminal(events)[0].payload.failure.reasonCode, "DSH_NO_FINAL_OUTPUT");
});

test("DSH commit mismatch, byte budget, repeated seq and tool ownership", () => {
  const input = scenario("chunks");
  const index = input.findIndex((n) => n.params.event?.type === "assistant/message");
  const bad = structuredClone(input);
  bad[index].params.event.data.message.content[1].text = "different";
  const trajectory = new DshTrajectory("root", 8192);
  assert.throws(() => bad.flatMap((n) => trajectory.accept(n)), /DSH_TRAJECTORY_INVALID/);
  const small = new DshTrajectory("root", 2);
  assert.throws(() => input.flatMap((n) => small.accept(n)), /DSH_TRAJECTORY_INVALID/);
  const duplicate = new DshTrajectory("root", 8192);
  const n = input[0];
  duplicate.accept(n);
  assert.deepEqual(duplicate.accept(n), []);
  const conflict = structuredClone(n);
  conflict.params.event.time++;
  assert.throws(() => duplicate.accept(conflict), /DSH_TRAJECTORY_INVALID/);
  const wrong = scenario("multi");
  wrong.find((n) => n.params.event?.type === "tool/result").params.event.data.step++;
  const owner = new DshTrajectory("root", 8192);
  assert.throws(() => wrong.flatMap((n) => owner.accept(n)), /DSH_TRAJECTORY_INVALID/);
});

test("DSH lifecycle confirmation, commit identity and pending chunk count are bounded", () => {
  const input = scenario("final");
  const candidate = new DshTrajectory("root", 8192);
  input.forEach((n) => candidate.accept(n));
  assert.throws(() => candidate.finish("wrong-receipt"), /DSH_TRAJECTORY_INVALID/);
  assert.equal(finalText(settle(candidate)), "检查完成。");
  assert.throws(() => settle(candidate), /DSH_NO_FINAL_OUTPUT/);
  const missing = new DshTrajectory("root", 8192);
  input.slice(0, -1).forEach((n) => missing.accept(n));
  assert.throws(() => settle(missing), /DSH_TRAJECTORY_INVALID/);
  const committed = new DshTrajectory("root", 8192);
  const messageAt = input.findIndex((n) => n.params.event?.type === "assistant/message");
  input.slice(0, messageAt + 1).forEach((n) => committed.accept(n));
  const repeated = structuredClone(input[messageAt]);
  repeated.params.event.seq++;
  assert.throws(() => committed.accept(repeated), /DSH_TRAJECTORY_INVALID/);
  const flood = new DshTrajectory("root", 8192);
  input.slice(0, 3).forEach((n) => flood.accept(n));
  assert.throws(() => {
    for (let seq = 3; seq < 4100; seq++)
      flood.accept({
        method: "session.event",
        params: {
          sessionId: "root",
          event: {
            type: "assistant/chunk",
            seq,
            time: 2000,
            data: { turn: 0, step: 0, chunk: { type: "text-delta", text: "" } }
          }
        }
      });
  }, /DSH_TRAJECTORY_INVALID/);
  const incompatibleStream = structuredClone(scenario("chunks"));
  incompatibleStream.find(
    (n) => n.params.event?.type === "assistant/message"
  ).params.event.data.stream[0].texts = ["conflicting"];
  const stream = new DshTrajectory("root", 8192);
  assert.throws(
    () => incompatibleStream.flatMap((n) => stream.accept(n)),
    /DSH_TRAJECTORY_INVALID/
  );
});

test(
  "official SDK → Core → independent Gateway projector and card",
  { skip: !process.env.OCTO_GATEWAY_CHECKOUT },
  async (t) => {
    const gateway = resolve(process.env.OCTO_GATEWAY_CHECKOUT);
    const { ImRunProjector } = await import(
      pathToFileURL(join(gateway, "dist/packages/gateway/src/presentation/run-projector.js"))
    );
    const { reasoningPhases, buildReasoningFrame } = await import(
      pathToFileURL(join(gateway, "dist/packages/gateway/src/transport/reasoning-frame.js"))
    );
    const directory = await mkdtemp(join(tmpdir(), "dsh-298-"));
    const core = new AgentExecutor();
    core.register(createDshAdapter());
    t.after(async () => {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    });
    const request = invokeRequest({
      workdir: directory,
      approvalMode: "full_access",
      agentConfig: {
        providerOptions: {
          dshBin: fileURLToPath(new URL("./fixtures/dsh-semantics-298.mjs", import.meta.url))
        }
      }
    });
    const projector = new ImRunProjector(request.runId);
    const events = [];
    const observations = [];
    for await (const event of core.invoke(invocationInput(request, "canonical", "dsh"))) {
      events.push(event);
      projector.accept(event, 2000 + events.length * 10);
      observations.push({
        type: event.type,
        phase: projector.snapshot().phase,
        finalText: projector.finalText
      });
    }
    const snapshot = projector.snapshot();
    const phases = reasoningPhases(snapshot);
    const frame = buildReasoningFrame(snapshot, {
      ref: { templateId: "fixture", version: "0.4.0" },
      maxPayloadBytes: 65536
    });
    const report = {
      fixture: true,
      node: process.version,
      platform: process.platform,
      baseline,
      gateway,
      events,
      observations,
      snapshot,
      phases,
      frame,
      finalReply: projector.finalReply
    };
    if (process.env.OCTO_DSH_EVIDENCE)
      await writeFile(process.env.OCTO_DSH_EVIDENCE, JSON.stringify(report, null, 2));
    assert.equal(terminal(events)[0]?.type, "run.completed", JSON.stringify(terminal(events)));
    assert.ok(!JSON.stringify(phases).includes("PRIVATE_FIXTURE"));
    if (!baseline) {
      assert.equal(projector.finalReply.text, "检查完成。");
      assert.equal(
        events.filter((e) => e.type === "message.update" && e.payload.channel === "final").length,
        1
      );
      assert.ok(phases.some((phase) => phase.thought.includes("分析并调用工具")));
      assert.ok(phases.some((phase) => phase.thought.includes("整理回答")));
      assert.ok(
        observations
          .filter((o) => o.type === "tool_call.create")
          .every((o) => o.finalText === "" && o.phase === "tool")
      );
      assert.equal(snapshot.terminal, "completed");
      assert.equal(snapshot.toolCallCount, 2);
      assert.equal(snapshot.reasoningCount, 0);
      const first = snapshot.modelSteps.find((s) => s.finishReason === "tool-calls");
      assert.ok(first.durationMs > 0);
      assert.equal(snapshot.items.filter((i) => i.kind === "tool").length, 2);
      assert.equal(frame.state, "completed");
    }
    // 复用捕获的真实 Core canonical，走 Gateway 的实际终局选择和 replyFinal 调度。
    // 仅连接器/发送端口用 fixture，无 IM 网络请求；不能声称服务端送达。
    const { ImRuntime } = await import(
      pathToFileURL(join(gateway, "dist/packages/gateway/src/index.js"))
    );
    const { GatewayTransport } = await import(
      pathToFileURL(join(gateway, "dist/packages/gateway/src/transport/channel.js"))
    );
    const { kernelMock } = await import(
      pathToFileURL(join(gateway, "test-support/kernel-mock.js"))
    );
    let receive;
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const delivery = Promise.withResolvers();
    const replies = [];
    const runtime = new ImRuntime(
      {
        bot_id: "fixture-298",
        api_url: "https://im-test.deepminer.com.cn/api",
        agent: { adapter_type: "dsh", workdir: directory }
      },
      {
        kernel: kernelMock({
          async *invoke() {
            yield* events;
          },
          async interrupt() {
            return { accepted: false };
          },
          async respondInteraction() {}
        })
      }
    );
    t.after(() => runtime.close());
    await runtime.start();
    receive({
      messageId: "fixture-message-298",
      text: "fixture task",
      senderId: "fixture-owner",
      conversationId: "fixture-group",
      conversationKind: "group",
      async buildContext() {
        return { schema: "octo.context-envelope/v3", items: [] };
      },
      async reply(text) {
        delivery.reject(new Error(text));
      },
      async replyFinal(text) {
        replies.push(text);
        delivery.resolve();
      }
    });
    const timer = setTimeout(() => delivery.reject(new Error("fixture delivery timeout")), 5000);
    try {
      await delivery.promise;
      await runtime.close();
    } finally {
      clearTimeout(timer);
    }
    assert.deepEqual(replies, [baseline ? "我将检查文件。\n\n检查完成。" : "检查完成。"]);
    report.deliveryPortReplies = replies;
    if (process.env.OCTO_DSH_EVIDENCE)
      await writeFile(process.env.OCTO_DSH_EVIDENCE, JSON.stringify(report, null, 2));
    projector.dispose();
  }
);
