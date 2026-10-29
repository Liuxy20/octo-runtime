/**
 * 公开事件投影：将 CanonicalEvent 累积为平台无关的展示快照。
 * 只保留近期五条展示明细和必要在途元数据；最终正文独立保存，不展示私有 reasoning。
 */
import type { CanonicalEvent, FailureEnvelope } from "@mininglamp-oss/octo-runtime-protocol";
import { sanitizePublicValue } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { ImTaskAttempt } from "../contracts.js";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { ModelWaitSnapshot } from "../execution/model-wait.js";

export interface ProgressItem {
  id: string;
  kind: "model_step" | "reasoning" | "commentary" | "tool";
  status: string;
  stepId?: string;
  content: string;
  toolName?: string;
  summary?: string;
  outcome?: "check_findings";
  exitCode?: number;
  finishReason?: string;
  startedAtMs?: number;
  durationMs?: number;
  ordinal?: number;
}
export interface RunPresentation {
  runId: string;
  seq: number;
  phase: string;
  label?: string;
  terminal?: "completed" | "failed" | "cancelled";
  elapsedMs?: number;
  items: ProgressItem[];
  modelSteps?: ProgressItem[];
  reasoningCount: number;
  toolCallCount: number;
  modelStepCount: number;
  failure?: FailureEnvelope;
  failureMessage?: string;
  failureDetail?: string;
  resultUnknown?: boolean;
  attempts?: ImTaskAttempt[];
  replyAssessment?: "ready" | "empty" | "needs_verification";
  providerDiagnostic?: { adapter: string; diagnosticId: string; category: string; message: string };
  retryNoticeCount?: number;
  modelWait?: ModelWaitSnapshot;
}

const publicExposures = new Set(["public_reasoning", "public_summary", "public_plan"]);
const PROGRESS_WINDOW = 5;
const PREVIEW_RUNES = 180;
// 近期退役缓存只作辅助；未结束步骤的精确去重不能依赖其容量或滚动淘汰。
const RETIRED_WINDOW = 256;

export class ImRunProjector {
  readonly #items = new Map<string, ProgressItem>();
  readonly #messages = new Map<
    string,
    { channel: string; text: string; stepId?: string; stableId: boolean }
  >();
  readonly #toolInputs = new Map<string, Record<string, unknown>>();
  readonly #steps = new Map<string, ProgressItem>();
  readonly #activeTools = new Map<string, ProgressItem>();
  // 未结束步骤的身份与分类用于准确去重；不保存旧正文，步骤结束即释放。
  readonly #stepMessages = new Map<
    string,
    {
      channel: string;
      stepId?: string;
      hidden: boolean;
      counted: boolean;
      stableId: boolean;
    }
  >();
  readonly #stepTools = new Map<string, string | undefined>();
  readonly #unfinishedSteps = new Set<string>();
  #hasClosedStep = false;
  readonly #finalMessages = new Map<string, { text: string; stableId: boolean }>();
  readonly #retired = new Set<string>();
  #reasoningCount = 0;
  #toolCallCount = 0;
  #modelStepCount = 0;
  #disposed = false;
  #currentStep?: string;
  #seq = 0;
  #phase = "accepted";
  #label?: string;
  #startedAt?: number;
  #endedAt?: number;
  #terminal?: RunPresentation["terminal"];
  #failure?: FailureEnvelope;
  #failureMessage?: string;
  #failureDetail?: string;
  #providerDiagnostic?: RunPresentation["providerDiagnostic"];
  #retryNoticeCount = 0;
  #finalReply?: { text: string; allowMention: boolean };
  #replyAssessment?: RunPresentation["replyAssessment"];
  constructor(
    readonly runId: string,
    readonly allowToolPreview = false
  ) {}

  accept(event: CanonicalEvent, now = Date.now()): void {
    // 终态后不再接纳迟到帧，防止完成卡片被旧进度改回执行中。
    if (this.#terminal || this.#disposed) return;
    this.#seq++;
    const p = event.payload;
    // 实际协议以 activity/model_step 启动计时，不能只等待历史 run.started。
    if (event.type === "activity.started" || event.type === "model_step.started")
      this.#startedAt ??= now;
    if (event.type === "run.started") {
      this.#startedAt ??= now;
      this.#phase = "model";
      this.#label = undefined;
    }
    if (event.type === "run.queued") this.#phase = "accepted";
    if (event.type === "model_step.started") {
      const p = event.payload;
      if (this.#retired.has(`step:${p.stepId}`)) return;
      this.#currentStep = p.stepId;
      this.#unfinishedSteps.add(p.stepId);
      let step = this.#steps.get(p.stepId);
      if (!step) {
        step = {
          id: `step:${p.stepId}`,
          kind: "model_step",
          stepId: p.stepId,
          status: "running",
          content: "",
          ordinal: ++this.#modelStepCount
        };
        this.#steps.set(p.stepId, step);
      }
      step.startedAtMs = p.startedAtMs;
      this.#pruneSteps();
      this.#phase = "model";
      this.#label = undefined;
    }
    if (event.type === "model_step.finished") {
      const p = event.payload;
      const item = this.#steps.get(p.stepId);
      if (item) {
        item.status = p.status;
        item.finishReason = p.finishReason;
        if (item.startedAtMs !== undefined && p.endedAtMs !== undefined)
          item.durationMs = Math.max(0, p.endedAtMs - item.startedAtMs);
      }
      // 有的 Provider 只结束步骤、不逐条结束 reasoning；所属消息此时不再是在途资源。
      this.#hasClosedStep = true;
      this.#unfinishedSteps.delete(p.stepId);
      for (const [id, message] of this.#stepMessages)
        if (message.stepId === p.stepId) {
          this.#stepMessages.delete(id);
          this.#retire(`message:${id}`);
          const detail = this.#items.get(`message:${id}`);
          if (detail?.status === "running") detail.status = p.status;
        }
      for (const [id, stepId] of this.#stepTools)
        if (stepId === p.stepId && !this.#activeTools.has(id)) {
          this.#stepTools.delete(id);
          this.#retire(`tool:${id}`);
        }
    }
    if (event.type.startsWith("message.")) {
      const id =
        p.messageId ??
        `unidentified:${p.stepId ?? this.#currentStep ?? "run"}:${p.channel ?? "final"}`;
      const hasStableId = typeof p.messageId === "string" && p.messageId.length > 0;
      // 合成的匿名 key 不是源消息身份，不能借其碰巧命中的记录推断通道。
      if (p.channel === undefined && !hasStableId) return;
      const storedIdentity = this.#stepMessages.get(id);
      const identity = storedIdentity?.stableId === hasStableId ? storedIdentity : undefined;
      const knownFinal = hasStableId && this.#finalMessages.get(id)?.stableId === true;
      // 已淘汰进度的迟到 delta 可能省略 channel，不能按缺省 final 拼进最终回复。
      if (this.#retired.has(`message:${id}`) && !identity && p.channel !== "final" && !knownFinal)
        return;
      const storedPrevious = this.#messages.get(id);
      const previous = storedPrevious?.stableId === hasStableId ? storedPrevious : undefined;
      const channel =
        p.channel ?? (knownFinal ? "final" : (previous?.channel ?? identity?.channel));
      // 无法证明通道时不发布正文；匿名帧也不能借用另一个匿名 final 的身份。
      if (channel === undefined) return;
      const scopedStepId = p.stepId ?? previous?.stepId ?? identity?.stepId;
      // 步骤结束后，未知旧身份不能仅靠 currentStep 被补造成当前步骤的新记录。
      if (
        this.#hasClosedStep &&
        scopedStepId === undefined &&
        !identity &&
        !previous &&
        channel !== "final" &&
        event.type !== "message.create"
      )
        return;
      const stepId = scopedStepId ?? this.#currentStep;
      // 已结束步骤的非 final/未分类迟到帧不能因身份缓存滚动而重新进入当前步骤。
      if (p.channel !== "final" && !knownFinal && this.#stepClosed(stepId)) return;
      // update 也可能是流式替换快照（例如 OpenClaw），不能仅按事件名提前清除分类。
      const running =
        event.type !== "message.update" || p.status === "streaming" || p.status === "running";
      // analysis 必须显式声明可公开；历史片段也清除，避免后续快照泄漏。
      if (channel === "analysis" && !publicExposures.has(p.exposure ?? "")) {
        this.#stepMessages.set(id, {
          channel,
          stepId,
          hidden: identity?.hidden ?? false,
          counted: identity?.counted ?? false,
          stableId: hasStableId
        });
        this.#messages.delete(id);
        this.#items.delete(`message:${id}`);
        return;
      }
      if (
        !["analysis", "commentary", "final"].includes(channel) ||
        (p.role && p.role !== "assistant")
      )
        return;
      if (channel === "final") {
        this.#stepMessages.delete(id);
        const text =
          typeof p.text !== "string"
            ? (this.#finalMessages.get(id)?.text ?? "")
            : event.type === "message.delta"
              ? (this.#finalMessages.get(id)?.text ?? "") + p.text
              : p.text;
        this.#finalMessages.set(id, { text, stableId: hasStableId });
        const step = stepId && this.#steps.get(stepId);
        if (step) step.content = previewText(text);
      } else {
        if (this.#retired.has(`message:${id}`) && !identity) return;
        // 同一步骤内的迟到更新仍使用原分类和计数；已淘汰正文不回窗。
        if (identity?.hidden) {
          if (channel === "analysis" && !identity.counted) {
            this.#reasoningCount++;
            identity.counted = true;
          }
          identity.channel = channel;
          if (!running) this.#retire(`message:${id}`);
          return;
        }
        // 有步骤身份的迟到快照不能重新创建已离开窗口的旧阶段。
        if (stepId && stepId !== this.#currentStep && !this.#steps.has(stepId)) {
          // 首次公开但已不在近期阶段的摘要仍计数，不为了统计恢复旧正文。
          if (channel === "analysis" && !identity?.counted) this.#reasoningCount++;
          this.#stepMessages.set(id, {
            channel,
            stepId,
            hidden: true,
            counted: channel === "analysis" || !!identity?.counted,
            stableId: hasStableId
          });
          this.#retire(`message:${id}`);
          return;
        }
        const text =
          typeof p.text !== "string"
            ? (previous?.text ?? "")
            : event.type === "message.delta"
              ? appendPreview(previous?.text ?? "", p.text)
              : previewText(p.text);
        const existing = this.#items.get(`message:${id}`);
        if (!existing && channel === "analysis" && !identity?.counted) this.#reasoningCount++;
        this.#stepMessages.set(id, {
          channel,
          stepId,
          hidden: false,
          counted: channel === "analysis" || !!identity?.counted,
          stableId: hasStableId
        });
        const item = this.#item(
          `message:${id}`,
          channel === "analysis" ? "reasoning" : "commentary",
          stepId
        );
        item.content = text;
        item.status = event.type === "message.update" ? "completed" : "running";
        this.#messages.set(id, { channel, text, stepId, stableId: hasStableId });
      }
      this.#phase =
        channel === "final" ? "answering" : channel === "analysis" ? "thinking" : "commentary";
      this.#label = undefined;
    }
    if (event.type === "tool_call.create") {
      const p = event.payload;
      if (
        this.#retired.has(`tool:${p.id}`) ||
        this.#stepTools.has(p.id) ||
        this.#activeTools.has(p.id) ||
        this.#items.has(`tool:${p.id}`)
      )
        return;
      const stepId = p.stepId ?? this.#currentStep;
      if (this.#stepClosed(stepId)) return;
      const item = this.#item(`tool:${p.id}`, "tool", stepId);
      this.#toolCallCount++;
      this.#stepTools.set(p.id, stepId);
      item.toolName = p.name;
      item.startedAtMs = now;
      if (this.allowToolPreview) item.summary = toolPreview(p.name, p.args);
      const command = stringArg(p.args.command ?? p.args.cmd);
      if (command.length <= 8192) this.#toolInputs.set(p.id, { command });
      this.#activeTools.set(p.id, item);
      this.#phase = "tool";
      this.#label = undefined;
    }
    if (event.type === "tool_call.update") {
      const p = event.payload;
      let item = this.#activeTools.get(p.id) ?? this.#items.get(`tool:${p.id}`);
      const args =
        p.args && typeof p.args === "object" && !Array.isArray(p.args)
          ? (p.args as Record<string, unknown>)
          : {};
      if (!item) {
        // 已有步骤完成时，缺少自身步骤的未知终态可能是旧工具迟到；不能补造归属。
        if (this.#hasClosedStep && p.stepId === undefined) return;
        const stepId = p.stepId ?? this.#currentStep;
        if (
          this.#stepTools.has(p.id) ||
          this.#retired.has(`tool:${p.id}`) ||
          this.#stepClosed(stepId)
        )
          return;
        // ACP/OpenCode 支持仅终态工具；补建展示和计数，不虚构开始时间。
        item = this.#item(`tool:${p.id}`, "tool", stepId);
        this.#toolCallCount++;
        this.#stepTools.set(p.id, stepId);
      }
      if (typeof p.name === "string") {
        item.toolName = p.name;
        if (this.allowToolPreview && item.summary === undefined)
          item.summary = toolPreview(p.name, args);
      }
      item.status = p.status;
      item.exitCode = p.exitCode;
      item.durationMs =
        p.durationMs ??
        (item.startedAtMs === undefined ? undefined : Math.max(0, now - item.startedAtMs));
      const command = stringArg(args.command ?? args.cmd);
      const input =
        this.#toolInputs.get(p.id) ?? (command.length <= 8192 ? { command } : undefined);
      if (p.status === "failed" && p.exitCode === 2 && input && detectorFindings(input, p.output))
        item.outcome = "check_findings";
      this.#toolInputs.delete(p.id);
      this.#activeTools.delete(p.id);
      if (this.#stepClosed(item.stepId)) this.#stepTools.delete(p.id);
      if (!this.#items.has(item.id)) this.#retire(item.id);
      this.#phase = "tool";
      this.#label = "工具调用完成";
    }
    if (event.type === "activity.started") {
      const p = event.payload;
      const phases: Record<string, string> = {
        thinking: "thinking",
        executing_tool: "tool",
        responding: "answering",
        starting: "accepted",
        waiting_input: "waiting",
        waiting_approval: "waiting",
        compacting: "model",
        retrying: "model",
        working: "model"
      };
      this.#phase = phases[p.kind] ?? "model";
      this.#label = undefined;
    }
    if (event.type === "interaction.requested") {
      this.#phase = "waiting";
      this.#label = "等待你的确认或输入";
    }
    if (event.type === "interaction.resolved") {
      this.#phase = "model";
      this.#label = undefined;
    }
    if (event.type === "run.notice") {
      const p = event.payload;
      if (p.code === "provider_diagnostic" && !this.#providerDiagnostic) {
        this.#providerDiagnostic = {
          adapter: String(p.params.adapter),
          diagnosticId: String(p.params.diagnosticId),
          category: String(p.params.category),
          message: String(sanitizePublicValue(p.params.message))
        };
      }
      if (p.code === "retry_scheduled")
        this.#retryNoticeCount = Math.min(65535, this.#retryNoticeCount + 1);
      const labels: Record<string, string> = {
        retry_scheduled: "正在重试",
        context_compacted: "上下文已压缩",
        model_rerouted: "已切换模型",
        config_warning: "执行配置提示",
        provider_diagnostic: "执行遇到问题，等待最终结果"
      };
      this.#label = labels[p.code];
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled"
    ) {
      this.#terminal =
        event.type === "run.completed"
          ? "completed"
          : event.type === "run.failed"
            ? "failed"
            : "cancelled";
      this.#endedAt = now;
      this.#label = undefined;
      this.#failure = p.failure;
      if (event.type === "run.failed") {
        const message = sanitizePublicValue(p.message);
        const error = sanitizePublicValue(p.error);
        this.#failureMessage = typeof message === "string" && message.trim() ? message : undefined;
        const detail =
          typeof error === "string"
            ? error
            : error && typeof error === "object"
              ? JSON.stringify(error, null, 2)
              : undefined;
        this.#failureDetail =
          detail && detail !== this.#failureMessage
            ? [this.#failureMessage, detail].filter(Boolean).join("\n")
            : this.#failureMessage || detail;
      }
      this.#selectFinalReply();
      for (const item of [...this.#items.values(), ...this.#steps.values()])
        if (item.status === "running")
          item.status = this.#terminal === "completed" ? "completed" : "cancelled";
      this.#activeTools.clear();
      this.#stepMessages.clear();
      this.#stepTools.clear();
      this.#unfinishedSteps.clear();
      this.#toolInputs.clear();
    }
  }

  #item(id: string, kind: ProgressItem["kind"], stepId?: string): ProgressItem {
    let item = this.#items.get(id);
    if (!item) {
      item = { id, kind, stepId, status: "running", content: "" };
      this.#items.set(id, item);
      if (this.#items.size > PROGRESS_WINDOW) {
        const oldest = this.#items.keys().next().value!;
        this.#items.delete(oldest);
        if (oldest.startsWith("message:")) {
          const messageId = oldest.slice(8);
          this.#messages.delete(messageId);
          const identity = this.#stepMessages.get(messageId);
          if (identity) identity.hidden = true;
        }
        this.#retire(oldest);
      }
      this.#pruneSteps();
    }
    return item;
  }
  get finalText(): string {
    return [...this.#finalMessages.values()]
      .map((message) => message.text)
      .filter(Boolean)
      .join("\n\n");
  }
  #retire(id: string): void {
    this.#retired.add(id);
    if (this.#retired.size > RETIRED_WINDOW)
      this.#retired.delete(this.#retired.values().next().value!);
  }
  #pruneSteps(): void {
    const retained = new Set([...this.#items.values()].map((item) => item.stepId));
    retained.add(this.#currentStep);
    for (const [id] of this.#steps)
      if (!retained.has(id)) {
        this.#steps.delete(id);
        this.#retire(`step:${id}`);
      }
  }
  #stepClosed(stepId: string | undefined): boolean {
    // 无步骤事件沿用隐式单步，兼容旧归一化器；有步骤流以 started/finished 管理身份。
    return (
      stepId !== undefined && this.#currentStep !== undefined && !this.#unfinishedSteps.has(stepId)
    );
  }
  /** 最终文本已取出、卡片/投递收尾后调用；即使迟到回调仍引用对象，也不再持有正文。 */
  dispose(): void {
    this.#disposed = true;
    this.#items.clear();
    this.#messages.clear();
    this.#steps.clear();
    this.#activeTools.clear();
    this.#stepMessages.clear();
    this.#stepTools.clear();
    this.#unfinishedSteps.clear();
    this.#toolInputs.clear();
    this.#finalMessages.clear();
    this.#retired.clear();
    this.#currentStep = undefined;
    this.#finalReply = undefined;
    this.#failure = undefined;
    this.#failureDetail = this.#failureMessage = undefined;
    this.#providerDiagnostic = undefined;
  }
  // 只在终态选择一次；有故障证据的轮次才解析可见 Markdown 内容。
  #selectFinalReply(): void {
    let text: string;
    let allowMention = false;
    if (this.#terminal === "completed") {
      const selected = this.finalText;
      const diagnosed = !!this.#providerDiagnostic || this.#retryNoticeCount > 0;
      const visible = diagnosed ? hasVisibleReply(selected) : !!selected.trim();
      this.#replyAssessment = visible ? "ready" : diagnosed ? "needs_verification" : "empty";
      allowMention = visible;
      text = visible
        ? selected
        : diagnosed
          ? "执行已结束，但未收到可确认的回复。请核查任务结果，避免重复执行。" +
            (this.#providerDiagnostic
              ? `\n原因：${this.#providerDiagnostic.message}\n诊断编号：${this.#providerDiagnostic.diagnosticId}`
              : "")
          : "执行已结束，未返回文本。";
    } else
      text =
        this.#terminal === "cancelled"
          ? "本轮执行已中断。"
          : `执行失败：${clampRunes(this.#failureDetail || "系统未返回具体原因，请查看运行记录。", 8000)}${failureIdentity(this.#failure)}`;
    this.#finalReply = { text, allowMention };
  }
  get finalReply(): { text: string; allowMention: boolean } {
    return (
      this.#finalReply ?? {
        text: "本轮执行结果未知，请查看运行记录，避免重复执行。",
        allowMention: false
      }
    );
  }
  snapshot(now = Date.now()): RunPresentation {
    const items = structuredClone([...this.#items.values()]);
    return {
      runId: this.runId,
      seq: this.#seq,
      phase: this.#phase,
      label: this.#label,
      terminal: this.#terminal,
      elapsedMs:
        this.#startedAt === undefined
          ? undefined
          : Math.max(0, (this.#endedAt ?? now) - this.#startedAt),
      items,
      modelSteps: structuredClone([...this.#steps.values()]),
      reasoningCount: this.#reasoningCount,
      toolCallCount: this.#toolCallCount,
      modelStepCount: this.#modelStepCount,
      failure: this.#failure,
      failureMessage: this.#failureMessage,
      failureDetail: this.#failureDetail,
      replyAssessment: this.#replyAssessment,
      providerDiagnostic: this.#providerDiagnostic && { ...this.#providerDiagnostic },
      ...(this.#retryNoticeCount ? { retryNoticeCount: this.#retryNoticeCount } : {})
    };
  }
}

// 预览仅取有限首尾片段，避免为展示截短而 Array.from 整段长正文。
function previewText(text: string): string {
  const edge = PREVIEW_RUNES * 2;
  return compactRunes(
    text.length > edge * 2 ? text.slice(0, edge) + text.slice(-edge) : text,
    PREVIEW_RUNES
  );
}
function appendPreview(previous: string, delta: string): string {
  return previewText(previous + previewText(delta));
}

function failureIdentity(failure: FailureEnvelope | undefined): string {
  return failure ? `\n错误码：${failure.code}\n诊断编号：${failure.diagnosticId}` : "";
}

function hasVisibleReply(text: string): boolean {
  const visible = (value: string): boolean =>
    !!value.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, "");
  if (!visible(text)) return false;
  interface ReplyNode {
    type: string;
    value?: string;
    children?: readonly ReplyNode[];
    url?: string;
    identifier?: string;
  }
  const tree = fromMarkdown(text);
  const definitions = new Set<string>();
  const collectDefinitions = (node: ReplyNode): void => {
    if (node.type === "definition" && node.url && node.identifier) definitions.add(node.identifier);
    for (const child of node.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(tree);
  const visit = (node: ReplyNode): boolean => {
    if (node.type === "definition") return false;
    if (node.type === "html") return visible((node.value ?? "").replace(/<!--[\s\S]*?-->/g, ""));
    if (["text", "code", "inlineCode"].includes(node.type)) return visible(node.value ?? "");
    if (node.type === "image") return !!node.url;
    if (node.type === "imageReference") return definitions.has(node.identifier ?? "");
    return (node.children ?? []).some(visit);
  };
  return visit(tree);
}

export function clampRunes(value: string, maximum: number): string {
  const runes = Array.from(value);
  return runes.length <= maximum ? value : runes.slice(0, Math.max(0, maximum - 1)).join("") + "…";
}
export function compactRunes(value: string, maximum: number): string {
  const runes = Array.from(value);
  if (runes.length <= maximum) return value;
  const head = Math.floor(((maximum - 3) * 2) / 3);
  return runes.slice(0, head).join("") + " … " + runes.slice(-(maximum - 3 - head)).join("");
}
export function toolPreview(name: string, args: Record<string, unknown>): string {
  const sensitive =
    /token|secret|password|passwd|credential|authorization|cookie|api_key|apikey|\.env|id_rsa|id_ed25519|private_key|sk-|bf_|ghp_|xoxb-/i;
  if (["exec_command", "shell", "bash", "sh", "zsh"].includes(name.toLowerCase())) {
    let command = stringArg(args.command ?? args.cmd).trim();
    if (sensitive.test(command) || command.includes("\0")) return "";
    command = command.replace(
      /^(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|fish)\s+-[a-z]*c[a-z]*\s+(['"])([\s\S]*)\1$/,
      "$2"
    );
    return clampRunes(command.replace(/\s+/g, " ").trim(), 42);
  }
  if (["read", "read_file", "write_file", "file_read", "file_write"].includes(name.toLowerCase())) {
    const path = stringArg(args.path ?? args.file_path ?? args.filePath).replace(/\\/g, "/");
    if (sensitive.test(path) || /:\/\/|[\r\n\0]/.test(path)) return "";
    const parts = path
      .split("/")
      .filter((p) => p && p !== "." && p !== "..")
      .slice(-2);
    return parts.every((p) => /^[\p{L}\p{N}._+~ -]+$/u.test(p)) && parts.length
      ? clampRunes("…/" + parts.join("/"), 96)
      : "";
  }
  return "";
}
function detectorFindings(input: Record<string, unknown>, output: unknown): boolean {
  const command = stringArg(input.command ?? input.cmd);
  if (!/\bdetect\b/.test(command) || !/--json\b/.test(command)) return false;
  try {
    const findings = typeof output === "string" ? (JSON.parse(output) as unknown) : output;
    return (
      Array.isArray(findings) &&
      findings.some((f: unknown) => {
        if (!f || typeof f !== "object") return false;
        const value = (f as Record<string, unknown>).antipattern;
        return typeof value === "string" && !!value.trim();
      })
    );
  } catch {
    return false;
  }
}
function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}
