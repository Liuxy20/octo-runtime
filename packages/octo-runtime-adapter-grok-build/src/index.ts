import { GrokBuildRpcError, spawnGrokBuildAcpClient } from "./client.js";
import { createGrokBuildAcpAdapter } from "./adapter.js";
import {
  initialControlInstructions,
  invocationEnvironment,
  invocationMcpServers,
  probeCommand,
  type CanonicalEvent,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { InteractionResponse } from "@mininglamp-oss/octo-runtime-protocol";

type JsonRecord = Record<string, unknown>;
export const GROK_BUILD_TESTED_VERSION = "1.0.67";
const levels = { low: "low", medium: "medium", high: "high", xhigh: "xhigh" } as const;

function supportedVersion(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return !!match && Number(match[1]) === 1 && (Number(match[2]) > 0 || Number(match[3]) >= 67);
}

/** 宿主可指定已安装命令；每次调用拥有独立 ACP 子进程，不连接用户常驻 leader。 */
export function createGrokBuildAdapter({
  command = "grok",
  acpClientFactory = spawnGrokBuildAcpClient
}: { command?: string; acpClientFactory?: typeof spawnGrokBuildAcpClient } = {}) {
  const adapter = createGrokBuildAcpAdapter(
    {
      type: "grok-build",
      provider: "grok-build",
      command,
      args: ["--no-auto-update", "agent", "--no-leader", "stdio"],
      controlInstructions: "session",
      reasoningLevels: levels,
      async probe() {
        const result = await probeCommand(command);
        if (!result.available)
          return {
            ...result,
            reason: "command_not_found: install Grok Build and put grok on PATH"
          };
        return supportedVersion(result.version)
          ? result
          : {
              ...result,
              available: false,
              reason: `grok_version_unsupported: install Grok Build ${GROK_BUILD_TESTED_VERSION} or a compatible 1.x release`
            };
      },
      async initialize(client, init, _request, env) {
        const version =
          record(init._meta).agentVersion ?? (await probeCommand(command, { env })).version;
        if (init.protocolVersion !== 1 || !supportedVersion(version))
          throw new Error(
            `GROK_VERSION_UNSUPPORTED: expected ACP v1 and Grok Build >= ${GROK_BUILD_TESTED_VERSION}, < 2.0.0`
          );
        const methods = Array.isArray(init.authMethods)
          ? init.authMethods.map((m) => record(m).id)
          : [];
        // 只按 harness 广告顺序协商非交互握手；凭据来源和可用性由 harness 判断。
        const methodId = methods.find((id) => id === "xai.api_key" || id === "cached_token");
        if (!methodId)
          throw new Error(
            "GROK_AUTH_REQUIRED: Grok Build did not advertise a supported non-interactive ACP authentication method; check the harness setup"
          );
        try {
          await client.request(
            "authenticate",
            { methodId, _meta: { headless: true } },
            { timeoutMs: 30_000 }
          );
        } catch {
          throw new Error(
            "GROK_AUTH_FAILED: Grok Build rejected ACP authentication; check the harness setup"
          );
        }
      },
      sessionParams(params, request, fresh) {
        // 原生 rules 仅用于新会话；恢复不改系统指令，也不恢复工作区文件快照。
        const rules = initialControlInstructions(request, fresh);
        return {
          ...params,
          _meta: {
            yoloMode: request.approvalMode === "full_access",
            autoMode: false,
            ...(fresh ? (rules ? { rules } : {}) : { "x.ai/restore_code": false })
          }
        };
      },
      isMissingSessionError: (error) =>
        error instanceof GrokBuildRpcError &&
        error.code === -32603 &&
        record(error.data).code === "FS_NOT_FOUND",
      selectActmode(_session, sessionId, requested) {
        // 1.0.67 不发布 modes，但实现标准 set_mode(default/plan)；成功响应后才发布 applied。
        return {
          method: "session/set_mode",
          params: { sessionId, modeId: requested },
          effective: requested,
          nativeMode: requested,
          unchanged: false
        };
      },
      async *configureSession(client, session, sessionId, request) {
        const requested = request.agentConfig.effort;
        if (requested === undefined) return;
        const option = (Array.isArray(session.configOptions) ? session.configOptions : [])
          .map(record)
          .find((value) => value.id === "reasoning_effort");
        const available = (Array.isArray(option?.options) ? option.options : []).map(
          (value) => record(value).value
        );
        const effective = available.includes(requested)
          ? requested
          : requested === "xhigh" && available.includes("high")
            ? "high"
            : undefined;
        if (effective === undefined || effective !== requested)
          yield reasoningWarning(
            request,
            effective === undefined ? "REASONING_EFFORT_NOT_APPLIED" : "REASONING_EFFORT_DOWNGRADED"
          );
        if (effective !== undefined && option?.currentValue !== effective) {
          const result = record(
            await client.request("session/set_config_option", {
              sessionId,
              configId: "reasoning_effort",
              value: effective
            })
          );
          const applied = (Array.isArray(result.configOptions) ? result.configOptions : [])
            .map(record)
            .find((value) => value.id === "reasoning_effort");
          if (applied?.currentValue !== effective)
            throw new Error(
              "GROK_REASONING_UNCONFIRMED: provider did not confirm the requested effort"
            );
        }
      },
      clientOptions(_request, bridge) {
        return {
          requestHandler(method, original) {
            // ACP 扩展仅给方法名加下划线，params 仍为原生请求正文。
            const nativeMethod = method.startsWith("_") ? method.slice(1) : method;
            const params = original;
            if (nativeMethod === "x.ai/ask_user_question") {
              const questions = questionFields(params.questions);
              return bridge.requestQuestion(original, { questions }, (response) =>
                questionResponse(questions, response)
              );
            }
            if (nativeMethod === "x.ai/exit_plan_mode") {
              return bridge.requestQuestion(
                original,
                {
                  questions: [
                    {
                      id: "decision",
                      question:
                        typeof params.planContent === "string"
                          ? params.planContent
                          : "Review the plan",
                      options: [{ label: "Approve" }, { label: "Abandon" }]
                    }
                  ]
                },
                (response) => {
                  if (response.outcome === "cancelled") return { outcome: "cancelled" };
                  const answer = answerValues(response, "decision");
                  if (answer.length !== 1 || !["Approve", "Abandon"].includes(answer[0]))
                    throw new Error("GROK_PLAN_RESPONSE_INVALID");
                  return { outcome: answer[0] === "Approve" ? "approved" : "abandoned" };
                }
              );
            }
            throw new Error("GROK_CLIENT_METHOD_UNSUPPORTED");
          },
          onRequestResponseWritten: (params) => bridge.responseWritten(params),
          onRequestResponseFailed: (params, error) => bridge.responseFailed(params, error)
        };
      },
      validatePromptResult(update) {
        const meta = record(update._meta);
        if (meta.completionKind !== undefined)
          throw new Error("GROK_PROMPT_INCOMPLETE: prompt was removed from the provider queue");
        if (!["end_turn", "cancelled"].includes(String(update.stopReason)))
          throw new Error("GROK_PROMPT_INCOMPLETE: provider did not report end_turn");
        const usage = record(meta.usage);
        const payload: JsonRecord = {};
        for (const key of [
          "inputTokens",
          "outputTokens",
          "totalTokens",
          "cachedReadTokens",
          "reasoningTokens"
        ]) {
          const value = usage[key] ?? meta[key];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0)
            payload[key] = value;
        }
        if (typeof meta.modelId === "string") payload.model = meta.modelId;
        return Object.keys(payload).length
          ? [{ protocolVersion: 2, type: "usage.update", payload }]
          : [];
      }
    },
    { command, acpClientFactory }
  );

  return Object.freeze({
    ...adapter,
    async *invoke(request: InvokeRequest, context?: Parameters<typeof adapter.invoke>[1]) {
      if (request.agentConfig.sandbox !== undefined)
        throw new Error("SANDBOX_UNSUPPORTED: grok-build ACP has no per-session sandbox override");
      // Grok 的 MCP 配置会展开模板；拒绝不能可靠保留的最终字面量，不改写用户配置。
      const env = invocationEnvironment(request);
      const mcp = invocationMcpServers(request, env);
      if (JSON.stringify(mcp).includes("${"))
        throw new Error("MCP_LITERAL_UNSUPPORTED: grok-build");
      try {
        yield* adapter.invoke(request, context);
      } catch (error) {
        throw publicFailure(error, env);
      }
    }
  });
}

function publicFailure(error: unknown, env: NodeJS.ProcessEnv): Error {
  if (record(error).code === "ENOENT")
    return new Error(
      "GROK_START_FAILED: check Grok Build installation, PATH and invocation workdir"
    );
  // 原始 cause/stack 也可能含凭据，公开错误只保留脱敏消息，不挂回原始错误。
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /token|secret|password|api.?key/i.test(key))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
  let safe = error instanceof Error ? error.message : "Grok Build ACP invocation failed";
  for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
  const failure = new Error(safe);
  const details = record(error);
  if (typeof details.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(details.code))
    Object.assign(failure, { code: details.code });
  for (const key of ["boundary", "measuredBytes", "limitBytes", "itemCount", "limitItems"]) {
    const value = details[key];
    if (
      (key === "boundary" && typeof value === "string" && /^[a-z0-9._-]+$/.test(value)) ||
      (key !== "boundary" && typeof value === "number" && Number.isFinite(value))
    )
      Object.assign(failure, { [key]: value });
  }
  return failure;
}

function reasoningWarning(request: InvokeRequest, warningCode: string): CanonicalEvent {
  return {
    protocolVersion: 2,
    type: "run.notice",
    payload: {
      noticeId: `${request.invocationId}:grok-reasoning`,
      code: "config_warning",
      severity: "warning",
      params: { warningCode }
    }
  };
}

function questionFields(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16)
    throw new Error("GROK_QUESTION_INVALID");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const question = record(entry);
    if (typeof question.question !== "string" || !question.question || seen.has(question.question))
      throw new Error("GROK_QUESTION_INVALID");
    seen.add(question.question);
    return { ...question, id: `q${index}` };
  });
}

function answerValues(response: InteractionResponse, id: string): string[] {
  if (response.outcome !== "answered") throw new Error("GROK_QUESTION_RESPONSE_INVALID");
  const answers = record(record(response.value)[id]).answers;
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    !answers.every((value) => typeof value === "string" && value.length > 0)
  )
    throw new Error("GROK_QUESTION_RESPONSE_INVALID");
  return answers as string[];
}

function questionResponse(questions: JsonRecord[], response: InteractionResponse): JsonRecord {
  if (response.outcome === "cancelled") return { outcome: "cancelled" };
  const answers: JsonRecord = {};
  const annotations: JsonRecord = {};
  for (const question of questions) {
    const values = answerValues(response, String(question.id));
    const labels = (Array.isArray(question.options) ? question.options : []).map(
      (option) => record(option).label
    );
    const selected = values.filter((value) => labels.includes(value));
    const custom = values.filter((value) => !labels.includes(value));
    if (question.multiSelect !== true && values.length !== 1)
      throw new Error("GROK_QUESTION_RESPONSE_INVALID");
    answers[String(question.question)] = custom.length ? [...selected, "Other"] : selected;
    if (custom.length) annotations[String(question.question)] = { notes: custom.join("\n") };
  }
  return {
    outcome: "accepted",
    answers,
    ...(Object.keys(annotations).length ? { annotations } : {})
  };
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export const grokBuildAdapter = createGrokBuildAdapter();
export default grokBuildAdapter;
