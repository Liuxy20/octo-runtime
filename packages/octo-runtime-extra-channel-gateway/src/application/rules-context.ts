import type {
  ContextEnvelope,
  ContextItem,
  ProviderSession
} from "@mininglamp-oss/octo-runtime-protocol";
import type { ImInvocationInput } from "../execution/dispatcher.js";

interface RuleStamp {
  version: number | null;
  status: "present" | "empty" | "not_found";
}
export interface ImRulesVersions {
  group: RuleStamp;
  topic?: RuleStamp;
}
export interface ImRulesContext {
  revision: number;
  supplied?: ImRulesVersions & { providerSessionId: string };
}

export function rulesGuidance(item: ContextItem): string {
  const document =
    item.name === "group-rules" ? "Octo IM Group's GROUP.md" : "Octo IM Group Topic Rules";
  if (item.payload.status === "not_found")
    return `${document} is currently unavailable (not found); previously supplied rules no longer apply.`;
  if (item.payload.status === "empty")
    return `${document} is currently empty; previously supplied rules no longer apply.`;
  return `${document}. These rules replace the previously supplied version.`;
}

/** 版本游标在应用层保留；执行快照只携带实际规则正文。显式宿主项不改写。 */
export function modelRulesContext(item: ContextItem): ContextItem {
  if (
    item.namespace !== "extra.im" ||
    !["group-rules", "topic-rules"].includes(item.name) ||
    item.payload.automatic !== true
  )
    return item;
  return {
    namespace: item.namespace,
    name: item.name,
    guidance: rulesGuidance(item),
    data_format: "text",
    payload: {
      text:
        typeof item.payload.text === "string" && item.payload.text.trim()
          ? item.payload.text
          : "NO RULES"
    }
  };
}

/** 仅选择 Gateway 自动读取的规则；宿主显式提交的 Context 不参与省略。 */
export function selectRulesContext(
  context: ContextEnvelope,
  cursor: ImRulesContext | undefined,
  provider: ProviderSession | undefined,
  refresh = false
): { context: ContextEnvelope; versions?: ImRulesVersions; omitted: ContextItem[] } {
  const rules = context.items.filter(
    (item) =>
      item.namespace === "extra.im" &&
      ["group-rules", "topic-rules"].includes(item.name) &&
      item.payload.automatic === true
  );
  const stamp = (item: ContextItem): RuleStamp => ({
    version: typeof item.payload.version === "number" ? item.payload.version : null,
    status: item.payload.status as RuleStamp["status"]
  });
  const group = rules.find((item) => item.name === "group-rules");
  if (!group) return { context, omitted: [] };
  const topic = rules.find((item) => item.name === "topic-rules");
  const versions = { group: stamp(group), ...(topic ? { topic: stamp(topic) } : {}) };
  const supplied = cursor?.supplied;
  const same = (left: RuleStamp | undefined, right: RuleStamp | undefined): boolean =>
    left?.version === right?.version && left?.status === right?.status;
  if (
    refresh ||
    !provider?.sessionId ||
    provider.resumable === false ||
    !supplied ||
    supplied.providerSessionId !== provider.sessionId ||
    !same(supplied.group, versions.group) ||
    !same(supplied.topic, versions.topic)
  )
    return { context, versions, omitted: [] };
  return {
    context: { ...context, items: context.items.filter((item) => !rules.includes(item)) },
    versions,
    omitted: rules
  };
}

/** 新 Provider 恢复本轮省略的渠道材料（规则、稳定说明和已覆盖历史），保留原 inputs/图片。 */
export function addRulesRecovery(input: ImInvocationInput, rules: ContextItem[]): void {
  if (!rules.length) return;
  const text = [
    "Current channel context for session recovery:",
    ...rules
      .map(modelRulesContext)
      .map((item) =>
        [
          `${item.namespace}/${item.name}`,
          ...(item.guidance ? [item.guidance] : []),
          item.data_format === "text"
            ? String(item.payload.text)
            : JSON.stringify(item.payload, null, 2)
        ].join("\n")
      )
  ].join("\n\n");
  input.freshFallbackModelInputParts = [{ type: "text", text }, ...structuredClone(input.inputs)];
  input.freshFallbackModelInput = input.freshFallbackModelInputParts
    .map((part) => (part.type === "text" ? part.text : "[Image]"))
    .join("\n\n");
}
