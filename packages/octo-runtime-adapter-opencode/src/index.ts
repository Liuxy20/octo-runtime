import {
  initialControlInstructions,
  hasImageInput,
  mapReasoningEffort,
  invocationEnvironment,
  processEnvironmentValue,
  invocationMcpServers,
  assertMcpOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { canonicalTerminalStatus } from "@mininglamp-oss/octo-runtime-protocol";
/**
 * OpenCode adapter: wraps the OpenCode CLI (`opencode run --format json
 * --thinking --auto`) for full access and ACP for interactive approval.
 * Both transports normalize provider output into canonical events.
 */
import { AcpInvocationError, createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import {
  createJsonCliAdapter,
  probeCommand,
  providerInputText,
  ProviderProcessError,
  type AdapterInvocationContext,
  type CanonicalEvent,
  type InvokeRequest,
  type ProbeResult
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, parse, resolve } from "node:path";

export const MINIMUM_OPENCODE_VERSION = "2.1.3";

class OpenCodeInputError extends Error {}

/** 检查本轮实际选中的程序；未知版本与 V1 都不能进入执行传输。 */
export async function probeOpenCode(
  command = "opencode",
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): Promise<ProbeResult> {
  const qualified = command.includes("/") || command.includes("\\") || parse(command).root !== "";
  // 本机 path 规则保留绝对路径；Windows 根相对和盘符相对路径也绑定本轮 cwd。
  const selected = qualified ? resolve(cwd, command) : command;
  const probeEnv = { ...env };
  if (process.platform === "win32") {
    // 普通对象的键区分大小写；与 Node 子进程一致，重复别名取字典序首项。
    for (const name of ["PATH", "PATHEXT"]) {
      const aliases = Object.keys(env)
        .filter((key) => key.toUpperCase() === name)
        .sort();
      const value = aliases.length ? env[aliases[0]] : undefined;
      for (const alias of aliases) delete probeEnv[alias];
      if (value !== undefined) probeEnv[name] = value;
    }
  }
  // 空项和相对项按子进程 cwd 查找；绝对项按本机规则保留原有含义。
  probeEnv.PATH = (probeEnv.PATH ?? "")
    .split(delimiter)
    .map((entry) => resolve(cwd, entry))
    .join(delimiter);
  const result = await probeCommand(selected, {
    cwd,
    env: probeEnv
  });
  if (!result.available) return result;
  if (!result.version)
    return {
      ...result,
      available: false,
      reason:
        "OPENCODE_VERSION_DETECTION_FAILED: could not determine OpenCode version (--version failed, timed out, or returned invalid output)"
    };
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(result.version);
  if (
    !match ||
    Number(match[1]) !== 2 ||
    Number(match[2]) < 1 ||
    (Number(match[2]) === 1 && Number(match[3]) < 3)
  )
    return {
      ...result,
      available: false,
      reason: `OPENCODE_VERSION_UNSUPPORTED: detected ${result.version}. ${result.version.startsWith("1.") ? "OpenCode 1 is no longer supported. " : ""}Install OpenCode >= ${MINIMUM_OPENCODE_VERSION} < 3 and retry.`
    };
  return result;
}

function inlineConfig(request: InvokeRequest): Record<string, unknown> {
  const content = processEnvironmentValue(
    invocationEnvironment(request),
    "OPENCODE_CONFIG_CONTENT"
  );
  if (!content) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new OpenCodeInputError(
      "OPENCODE_CONFIG_INVALID: OPENCODE_CONFIG_CONTENT must be a JSON object"
    );
  }
  if (!isRecord(parsed))
    throw new OpenCodeInputError(
      "OPENCODE_CONFIG_INVALID: OPENCODE_CONFIG_CONTENT must be a JSON object"
    );
  return parsed;
}

/** A single OpenCode stream part; tool lifecycle is carried in `state.status` (running -> completed/error). */
interface OpenCodePart {
  sessionID?: string;
  messageID?: string;
  type?: string;
  text?: string;
  reason?: string;
  callID?: string;
  id?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    time?: { start?: unknown; end?: unknown };
  };
  tokens?: Record<string, unknown>;
  cost?: unknown;
  time?: { start?: unknown; end?: unknown };
}

/** A top-level OpenCode event, which may wrap a part and carries session/usage/error at the envelope level. */
interface OpenCodeNativeEvent extends OpenCodePart {
  sessionID?: string;
  sessionId?: string;
  part?: OpenCodePart;
  timestamp?: unknown;
  usage?: Record<string, unknown>;
  error?: { data?: { message?: string }; message?: string };
}

/**
 * Build the OpenCode CLI argv/env for one invocation.
 *
 * Runtime context is injected as an extra entry in OpenCode's `instructions`
 * config (a temp markdown file) delivered through OPENCODE_CONFIG_CONTENT,
 * merged onto any inline config so the user's existing OpenCode config is not
 * overwritten. Returns a `cleanup` that removes the temp directory.
 *
 */
export async function buildOpenCodeCommand(req: InvokeRequest, command = "opencode") {
  if (hasImageInput(req))
    throw new Error("UNSUPPORTED_INPUT_MODALITY: opencode does not encode image input");
  if (req.approvalMode !== "full_access")
    throw new Error("APPROVAL_MODE_UNSUPPORTED: opencode permission transport is not qualified");
  const runEnv = invocationEnvironment(req);
  const servers = invocationMcpServers(req, runEnv);
  assertMcpOptions(servers, "opencode", ["toolTimeoutMs"]);
  const inline = inlineConfig(req);
  const configuredInstructions = Array.isArray(inline.instructions)
    ? inline.instructions.filter((value): value is string => typeof value === "string")
    : [];
  if (Object.keys(servers).length) {
    const existing = isRecord(inline.mcp) ? inline.mcp : {};
    inline.mcp = {
      ...existing,
      servers: {
        ...(isRecord(existing.servers) ? existing.servers : {}),
        ...Object.fromEntries(
          Object.entries(servers).map(([name, server]) => [
            name,
            {
              ...(server.type === "stdio"
                ? {
                    type: "local",
                    command: [server.command, ...(server.args ?? [])],
                    environment: server.env ?? {}
                  }
                : { type: "remote", url: server.url, headers: server.headers ?? {} }),
              disabled: false,
              ...(server.toolTimeoutMs !== undefined
                ? { timeout: { execution: server.toolTimeoutMs } }
                : {})
            }
          ])
        )
      }
    };
  }
  // Reasoning output and non-interactive tool approval are mandatory parts of
  // this adapter's provider contract.
  const args = ["run", "--format", "json", "--thinking", "--auto", "--standalone"];
  if (req.providerSession?.sessionId) args.push("--session", req.providerSession.sessionId);
  const variant = mapReasoningEffort("opencode", req.agentConfig?.effort);
  if (req.agentConfig?.model) {
    const model = req.agentConfig.model;
    args.push("--model", variant ? `${model.split("#")[0]}#${variant}` : model);
  }
  // 先校验和转换，再创建资源；写入失败由本层回收，返回后交给 CLI helper。
  let directory: string | undefined;
  try {
    if (initialControlInstructions(req)) {
      directory = await mkdtemp(join(tmpdir(), "octo-runtime-opencode-"));
      const instructions = join(directory, "instructions.md");
      await writeFile(instructions, initialControlInstructions(req), { mode: 0o600 });
      inline.instructions = [...configuredInstructions, instructions];
    }
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    command,
    args,
    input: providerInputText(req),
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(inline),
      OPENCODE_CLIENT: "octo-runtime",
      PWD: req.workdir
    },
    rpcMethod: "process.stdin",
    providerSessionId: req.providerSession?.sessionId,
    cleanup: async () => {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}

/** Translate one OpenCode native event/part into canonical events; unrelated events yield an empty list. */
export function normalizeOpenCodeEvent(native: OpenCodeNativeEvent): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  const part: OpenCodePart = native.part ?? native;
  const sessionId = native.sessionID ?? native.sessionId ?? native.part?.sessionID;
  if ((native.type === "step_start" || native.type === "session.created") && sessionId) {
    events.push({
      protocolVersion: 2,
      type: "session.update",
      payload: { providerSession: { sessionId, resumable: true } }
    });
  }
  const stepId = part.messageID;
  const timestamp = providerTimestamp(native.timestamp);
  if ((native.type === "step_start" || part.type === "step-start") && stepId) {
    events.push({
      protocolVersion: 2,
      type: "model_step.started",
      payload: { stepId, ...(timestamp === undefined ? {} : { startedAtMs: timestamp }) }
    });
  }
  const toolState = part.state;
  const toolId = part.callID ?? part.id;
  if ((native.type === "text" || part.type === "text") && typeof part.text === "string") {
    events.push({
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: part.text,
        ...(stepId
          ? { stepId, messageId: `opencode:${part.id ?? `${stepId}:answer`}` }
          : part.id
            ? { messageId: `opencode:${part.id}` }
            : {})
      }
    });
  }
  if ((native.type === "reasoning" || part.type === "reasoning") && typeof part.text === "string") {
    events.push({
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: part.text,
        ...(stepId ? { stepId, messageId: `opencode:${part.id ?? `${stepId}:reasoning`}` } : {}),
        channel: "analysis",
        exposure: "public_reasoning",
        provenance: { provider: "opencode", nativeEvent: "reasoning" }
      }
    });
  }
  if (part.type === "tool" && toolState?.status === "running" && toolId && part.tool) {
    const args = isRecord(toolState.input)
      ? toolState.input
      : toolState.input == null
        ? {}
        : { value: toolState.input };
    events.push({
      protocolVersion: 2,
      type: "tool_call.create",
      payload: {
        status: "running",
        id: toolId,
        name: part.tool,
        args,
        ...(stepId ? { stepId } : {})
      }
    });
  }
  if (
    part.type === "tool" &&
    toolId &&
    toolState?.status &&
    ["completed", "error"].includes(toolState.status)
  ) {
    const args = isRecord(toolState.input)
      ? toolState.input
      : toolState.input == null
        ? {}
        : { value: toolState.input };
    const durationMs = toolDurationMs(toolState.time);
    // A terminal-only OpenCode frame carries enough identity to let the
    // projector create the item without inventing a duplicate start event.
    events.push({
      protocolVersion: 2,
      type: "tool_call.update",
      payload: {
        id: toolId,
        ...(part.tool ? { name: part.tool, args } : {}),
        status: canonicalTerminalStatus(toolState.status === "error" ? "failed" : toolState.status),
        output: toolState.output ?? toolState.error,
        ...(stepId ? { stepId } : {}),
        ...(durationMs === undefined ? {} : { durationMs })
      }
    });
  }
  if ((native.type === "step_finish" || part.type === "step-finish") && stepId) {
    events.push({
      protocolVersion: 2,
      type: "model_step.finished",
      payload: {
        stepId,
        status: canonicalTerminalStatus("completed"),
        ...(typeof part.reason === "string" ? { finishReason: part.reason } : {}),
        ...(timestamp === undefined ? {} : { endedAtMs: timestamp })
      }
    });
  }
  if (native.type === "step_finish" || part.type === "step-finish") {
    events.push({
      protocolVersion: 2,
      type: "usage.update",
      payload: {
        ...(part.tokens ?? native.usage ?? {}),
        cost: part.cost,
        ...(stepId ? { stepId } : {})
      }
    });
  }
  if (native.type === "error")
    events.push({
      protocolVersion: 2,
      type: "run.failed",
      payload: {
        message: native.error?.data?.message ?? native.error?.message ?? "OpenCode failed",
        providerError: native.error
      }
    });
  return events;
}

/** Narrow an unknown value to a plain object (excluding arrays), used to guard tool input before spreading it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Return OpenCode's provider-measured whole-millisecond tool duration. */
function toolDurationMs(time: { start?: unknown; end?: unknown } | undefined): number | undefined {
  if (typeof time?.start !== "number" || typeof time.end !== "number") return undefined;
  if (!Number.isSafeInteger(time.start) || !Number.isSafeInteger(time.end) || time.end < time.start)
    return undefined;
  return time.end - time.start;
}

/** Preserve a provider event clock only when it is a valid Unix-millisecond value. */
function providerTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Create an OpenCode adapter over the JSON CLI helper. OpenCode's stream ends
 * without an explicit terminal, so `onSuccess` synthesizes the closing
 * message.update/run.completed; run.failed is emitted inline by the normalizer.
 */
export class OpenCodeEventNormalizer {
  readonly #text = new Map<string, string>();
  readonly #tools = new Set<string>();

  normalize(native: OpenCodeNativeEvent): CanonicalEvent[] {
    return normalizeOpenCodeEvent(native).flatMap((event) => {
      if (
        event.type === "message.delta" &&
        typeof event.payload.messageId === "string" &&
        typeof event.payload.text === "string"
      ) {
        const id = event.payload.messageId;
        const previous = this.#text.get(id);
        const text = event.payload.text;
        this.#text.set(id, text);
        if (previous === undefined) return [event];
        if (previous === text) return [];
        if (text.startsWith(previous))
          return [{ ...event, payload: { ...event.payload, text: text.slice(previous.length) } }];
        return [
          {
            protocolVersion: 2,
            type: "message.update",
            payload: { ...event.payload, status: "streaming" }
          }
        ];
      }
      if (event.type === "tool_call.create") {
        const id = event.payload.id;
        if (this.#tools.has(id)) {
          const output = (native.part ?? native).state?.output;
          return output === undefined
            ? []
            : [
                {
                  protocolVersion: 2,
                  type: "tool_call.delta",
                  payload: {
                    id,
                    outputSnapshot: typeof output === "string" ? output : JSON.stringify(output)
                  }
                }
              ];
        }
        this.#tools.add(id);
      }
      return [event];
    });
  }
}

export function createOpenCodeAdapter({ command = "opencode" }: { command?: string } = {}) {
  const interactiveAdapters = new Map<string, ReturnType<typeof createAcpAdapter>>();
  const createInteractive = (selected: string) =>
    createAcpAdapter({
      type: "opencode",
      provider: "opencode",
      command: selected,
      args: ["acp"],
      // ACP 原生权限策略决定何时请求审批；桥接层逐次处理，不覆盖用户的 deny。
      env: (request) => ({
        OPENCODE_CLIENT: "octo-runtime",
        PWD: request.workdir,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig(request))
      })
    });
  const options: Parameters<typeof createJsonCliAdapter<OpenCodeNativeEvent>>[0] = {
    metadata: {
      mcp: true,
      type: "opencode",
      agentSources: ["provisioned"]
    },
    probe: () => probeOpenCode(command),
    buildCommand: (req: InvokeRequest) => buildOpenCodeCommand(req, command),
    normalize: normalizeOpenCodeEvent,
    onSuccess: (): CanonicalEvent[] => [
      {
        protocolVersion: 2,
        type: "message.update",
        payload: { role: "assistant", status: "completed" }
      },
      { protocolVersion: 2, type: "run.completed", payload: {} }
    ]
  };
  const adapter = createJsonCliAdapter<OpenCodeNativeEvent>(options);
  return {
    ...adapter,
    async respondInteraction(
      ...args: Parameters<ReturnType<typeof createAcpAdapter>["respondInteraction"]>
    ) {
      const interactive = interactiveAdapters.get(args[0]);
      if (!interactive) throw new Error("INTERACTION_NOT_ACTIVE");
      await interactive.respondInteraction(...args);
    },
    async *invoke(
      request: InvokeRequest,
      context?: AdapterInvocationContext
    ): AsyncGenerator<CanonicalEvent> {
      if (hasImageInput(request))
        throw new Error("UNSUPPORTED_INPUT_MODALITY: opencode does not encode image input");
      if (request.approvalMode === "assisted")
        throw new Error("APPROVAL_MODE_UNSUPPORTED: opencode has no qualified assisted policy");
      request.signal?.throwIfAborted();
      const selected = await probeOpenCode(
        command,
        invocationEnvironment(request),
        request.workdir
      );
      if (!selected.available) throw new Error(selected.reason ?? "OpenCode is unavailable");
      request.signal?.throwIfAborted();
      try {
        inlineConfig(request);
      } catch (error) {
        if (!(error instanceof OpenCodeInputError)) throw error;
        yield {
          protocolVersion: 2,
          type: "run.failed",
          payload: { code: "OPENCODE_CONFIG_INVALID", message: error.message }
        };
        return;
      }
      if (request.approvalMode === "ask") {
        if (interactiveAdapters.has(request.invocationId))
          throw new Error("INVOCATION_ALREADY_ACTIVE");
        const interactive = createInteractive(selected.command);
        interactiveAdapters.set(request.invocationId, interactive);
        try {
          yield* interactive.invoke(request, context);
        } catch (error) {
          if (!(error instanceof AcpInvocationError)) throw error;
          // 只有共享 ACP 确认 close 成功后的调用错误才收敛为失败终态。
          yield { protocolVersion: 2, type: "run.failed", payload: { message: error.message } };
        } finally {
          interactiveAdapters.delete(request.invocationId);
        }
        return;
      }
      const normalizer = new OpenCodeEventNormalizer();
      let finalText = false;
      try {
        yield* createJsonCliAdapter<OpenCodeNativeEvent>({
          ...options,
          reasoningLevels: request.agentConfig.model ? undefined : null,
          buildCommand: (req) => buildOpenCodeCommand(req, selected.command),
          normalize: (native) => {
            const part = native.part ?? native;
            if (native.type === "step_start" || part.type === "step-start") finalText = false;
            if ((native.type === "text" || part.type === "text") && typeof part.text === "string")
              finalText = true;
            // 一个 step 的 stop 不能掩盖随后进程的失败；等待私有 CLI 正常退出。
            return normalizer.normalize(native);
          },
          onSuccess: (req) => {
            if (!finalText)
              return [
                {
                  protocolVersion: 2,
                  type: "run.failed",
                  payload: {
                    code: "OPENCODE_INCOMPLETE_OUTPUT",
                    message:
                      "OPENCODE_INCOMPLETE_OUTPUT: process exited without a final assistant response"
                  }
                }
              ];
            return options.onSuccess!(req);
          }
        }).invoke(request, context);
      } catch (error) {
        // helper 的 finally 已回收进程和临时文件；只收敛已知的进程退出，清理异常继续向上报告。
        if (!(error instanceof ProviderProcessError)) throw error;
        yield request.signal?.aborted
          ? {
              protocolVersion: 2,
              type: "run.cancelled",
              payload: { reason: String(request.signal.reason ?? "cancelled") }
            }
          : { protocolVersion: 2, type: "run.failed", payload: { message: error.message } };
      }
    }
  };
}

export const opencodeAdapter = createOpenCodeAdapter();
export default opencodeAdapter;
