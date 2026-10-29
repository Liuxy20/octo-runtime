import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runPlayboard } from "../../../apps/cli/dist/playboard.js";
import { loadLocalOpenClawGateway } from "../../../packages/octo-runtime-adapter-openclaw/dist/local-gateway.js";
import { OpenClawGatewayClient } from "../../../packages/octo-runtime-adapter-openclaw/dist/gateway.js";
import { ImRunProjector } from "../../../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { reasoningPhases } from "../../../packages/octo-runtime-extra-channel-gateway/dist/transport/reasoning-frame.js";

// 手动 non-gating：Playboard 独立 Kernel/worker + 本机 OpenClaw；不发送 IM。
// 只输出事件身份、类型和计数；原生 thinking/工具参数及凭据不写入证据。
const scratch = await mkdtemp(join(tmpdir(), "octo-245-live-"));
const runtimeHome = process.env.OCTO245_RUNTIME_HOME ?? join(homedir(), ".octo-runtime");
const runId = `qa245-${randomUUID()}`;
const marker = `QA245_${randomUUID().replaceAll("-", "")}`;
const connection = await loadLocalOpenClawGateway(join(runtimeHome, "default"));
const observer = new OpenClawGatewayClient(connection);
const native = [];
const canonical = [];
const projector = new ImRunProjector(runId);
const checkpoints = [];
let sessionKey;
let lastNativeKind;
const stopObserving = observer.onEvent((event) => {
  const p = event.payload;
  if (!p || typeof p !== "object") return;
  if (event.event === "agent" && typeof p.runId === "string" && p.runId.includes(runId)) {
    const kind = `${p.stream}:${p.data?.phase ?? ""}:${p.data?.kind ?? ""}`;
    if (kind === lastNativeKind && !p.data?.toolCallId) return;
    lastNativeKind = kind;
    native.push({
      event: event.event,
      seq: p.seq,
      stream: p.stream,
      dataKeys: Object.keys(p.data ?? {}),
      phase: p.data?.phase,
      kind: p.data?.kind,
      itemId: p.data?.itemId,
      toolCallId: p.data?.toolCallId
    });
  }
  if (event.event === "session.message" && p.sessionKey === sessionKey) {
    native.push({
      event: event.event,
      messageId: p.messageId,
      messageSeq: p.messageSeq,
      runIdPresent: !!p.runId,
      runMatches: p.runId?.includes(runId),
      role: p.message?.role,
      messageKeys: Object.keys(p.message ?? {}),
      metadataKeys: Object.keys(p.message?.__openclaw ?? {}),
      userRequestMatches: String(
        p.message?.idempotencyKey ?? p.message?.__openclaw?.idempotencyKey ?? ""
      ).includes(runId),
      stopReason: p.message?.stopReason,
      blocks: p.message?.content?.map?.((b) => ({ type: b.type, id: b.id, name: b.name })),
      toolCallId: p.message?.toolCallId
    });
  }
});
try {
  assert.equal((await fetch("https://im-test.deepminer.com.cn/")).status, 200);
  const hello = await observer.connect();
  const input = {
    runId,
    sessionName: `qa245-${randomUUID()}`,
    inputs: [
      {
        type: "text",
        text:
          `This is a small local protocol QA. Keep reasoning and replies very short. ` +
          `Before the first tool call, say QA245_PROGRESS_ONLY as progress. Exclude this from your final reply. ` +
          `Use exec once to run: printf 'QA245_FIRST'. After that result arrives, ` +
          `use exec a second time to run: printf 'QA245_SECOND'. ` +
          `Then reply exactly ${marker}. Run the two commands sequentially in separate model calls. ` +
          `Do not read skills, send messages, access the network, or modify files.`
      }
    ],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [
        {
          namespace: "octo.execution",
          name: "adapter",
          payload: { type: "openclaw", provider_agent_id: "main" }
        },
        { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
        {
          namespace: "octo.execution",
          name: "limits",
          payload: { run_timeout_ms: 240000, cancel_grace_ms: 10000 }
        }
      ]
    },
    protocol_mode: "canonical",
    workdir: scratch
  };
  const code = await runPlayboard({
    input: Readable.from([JSON.stringify(input)]),
    home: runtimeHome,
    profile: "default",
    async output(line) {
      const e = JSON.parse(line);
      if (e.type === "session.update" && e.payload.providerSession?.sessionId && !sessionKey) {
        sessionKey = e.payload.providerSession.sessionId;
        await observer.request("sessions.messages.subscribe", { key: sessionKey, agentId: "main" });
      }
      canonical.push(e);
      projector.accept(e);
      if (e.type.startsWith("model_step.") || e.type.startsWith("tool_call.")) {
        const s = projector.snapshot();
        const checkpoint = {
          type: e.type,
          stepId: e.payload.stepId,
          toolId: e.payload.id,
          status: e.payload.status,
          finishReason: e.payload.finishReason,
          steps: s.modelStepCount,
          tools: s.toolCallCount,
          cardRounds: reasoningPhases(s).map((p) => p.thought.match(/^第 \d+ 轮/)?.[0])
        };
        checkpoints.push(checkpoint);
        console.log(JSON.stringify({ checkpoint }));
      }
    }
  });
  const snapshot = projector.snapshot();
  const summary = {
    version: hello.server?.version,
    code,
    terminal: snapshot.terminal,
    modelSteps: snapshot.modelStepCount,
    tools: snapshot.toolCallCount,
    markerSeen: projector.finalReply.text.includes(marker),
    finalOnlyMarker: projector.finalReply.text.trim() === marker,
    finalMessages: canonical.filter(
      (e) => e.type.startsWith("message.") && e.payload.channel === "final" && e.payload.text
    ).length,
    toolEventsWithoutStepId: canonical.filter(
      (e) => e.type.startsWith("tool_call.") && !e.payload.stepId
    ).length,
    starts: canonical.filter((e) => e.type === "model_step.started").length,
    finishes: canonical.filter((e) => e.type === "model_step.finished").length
  };
  console.log(JSON.stringify({ native, summary }));
  assert.equal(code, 0);
  assert.equal(summary.terminal, "completed");
  assert.ok(summary.markerSeen);
  if (!process.argv.includes("--baseline")) {
    assert.ok(summary.finalOnlyMarker);
    assert.equal(summary.finalMessages, 1);
    assert.equal(summary.modelSteps, 3);
    assert.equal(summary.tools, 2);
    assert.equal(summary.toolEventsWithoutStepId, 0);
    assert.equal(summary.starts, summary.finishes);
    const steps = snapshot.items.filter((i) => i.kind === "tool").map((i) => i.stepId);
    assert.equal(new Set(steps).size, 2);
  }
  if (process.argv.includes("--resume")) {
    assert.ok(sessionKey);
    const resumedRunId = `qa245-resume-${randomUUID()}`;
    const resumedProjector = new ImRunProjector(resumedRunId);
    const resumedEvents = [];
    const resumedCode = await runPlayboard({
      input: Readable.from([
        JSON.stringify({
          ...input,
          runId: resumedRunId,
          providerSession: { sessionId: sessionKey, resumable: true }
        })
      ]),
      home: runtimeHome,
      profile: "default",
      output(line) {
        const event = JSON.parse(line);
        resumedEvents.push(event);
        resumedProjector.accept(event);
      }
    });
    const resumedSnapshot = resumedProjector.snapshot();
    const resumedSummary = {
      version: hello.server?.version,
      resumed: true,
      code: resumedCode,
      terminal: resumedSnapshot.terminal,
      modelSteps: resumedSnapshot.modelStepCount,
      tools: resumedSnapshot.toolCallCount,
      finalOnlyMarker: resumedProjector.finalReply.text.trim() === marker,
      finalMessages: resumedEvents.filter(
        (event) => event.payload.channel === "final" && event.payload.text
      ).length,
      sameSession:
        resumedEvents.find((event) => event.type === "session.update")?.payload.providerSession
          ?.sessionId === sessionKey
    };
    console.log(JSON.stringify({ summary: resumedSummary }));
    assert.equal(resumedCode, 0);
    assert.equal(resumedSummary.terminal, "completed");
    assert.equal(resumedSummary.sameSession, true);
    assert.equal(resumedSummary.modelSteps, 3);
    assert.equal(resumedSummary.tools, 2);
    assert.equal(resumedSummary.finalOnlyMarker, true);
    assert.equal(resumedSummary.finalMessages, 1);
    assert.ok(
      resumedEvents
        .filter((event) => event.type.startsWith("tool_call."))
        .every((event) => event.payload.stepId)
    );
    assert.equal(
      resumedEvents.filter((event) => event.type === "model_step.started").length,
      resumedEvents.filter((event) => event.type === "model_step.finished").length
    );
  }
} finally {
  stopObserving();
  await observer.close();
  await rm(scratch, { recursive: true, force: true });
}
