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

/** 仅选择 Gateway 自动读取的规则；宿主显式提交的 Context 不参与省略。 */
export function selectRulesContext(
  context: ContextEnvelope,
  cursor: ImRulesContext | undefined,
  provider: ProviderSession | undefined
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

/** 恢复新 Provider 会话时显式重带本轮规则和原 inputs，不改变普通续聊输入。 */
export function addRulesRecovery(input: ImInvocationInput, rules: ContextItem[]): void {
  if (!rules.length) return;
  const text = `以下为当前群和话题规则，替代旧版本；empty/not_found 表示旧规则已撤销。\n${JSON.stringify(rules)}`;
  input.freshFallbackModelInputParts = [{ type: "text", text }, ...structuredClone(input.inputs)];
  input.freshFallbackModelInput = input.freshFallbackModelInputParts
    .map((part) => (part.type === "text" ? part.text : "[Image]"))
    .join("\n\n");
}
