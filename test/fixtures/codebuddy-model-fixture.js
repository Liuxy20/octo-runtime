import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createCodeBuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";
import { subscriptionResult } from "./codebuddy-fixture.js";

export const modelIds = ["model-a", "model-b", "denied", "subscription"];

// 目录/原生状态归此测试 Provider；故意忽略 session/new.model，复现真实 CodeBuddy 行为。
export function codeBuddyModelFixture({
  catalog = "config",
  grouped = false,
  configId = "model",
  selectionResult,
  audit = false
} = {}) {
  const sessions = new Map();
  const state = { calls: [], promptModels: [], closes: 0 };
  const view = (model) => {
    const options = modelIds.map((value) => ({ value }));
    return catalog === "missing"
      ? {}
      : catalog === "models"
        ? {
            models: {
              currentModelId: model,
              availableModels: modelIds.map((modelId) => ({ modelId }))
            }
          }
        : {
            configOptions: [
              {
                id: configId,
                category: "model",
                currentValue: model,
                options:
                  catalog === "empty" ? [] : grouped ? [{ name: "Models", options }] : options
              }
            ]
          };
  };
  const adapter = createCodeBuddyAdapter({
    acpClientFactory: ({ cwd }) => {
      let closed = false;
      let nextId = 0;
      const record = (entry) => {
        state.calls.push(entry);
        if (audit)
          appendFileSync(join(cwd, "codebuddy-model-audit.ndjson"), JSON.stringify(entry) + "\n");
      };
      return {
        initialize: async () => ({}),
        reserveRequestId: () => ++nextId,
        request: async (method, params) => {
          record({ method, params });
          if (method === "session/new") {
            const sessionId = `native-${sessions.size + 1}`;
            sessions.set(sessionId, "model-a");
            return { sessionId, ...view("model-a") };
          }
          if (method === "session/load") {
            if (!sessions.has(params.sessionId)) throw new Error("session not found");
            return view(sessions.get(params.sessionId));
          }
          if (!sessions.has(params.sessionId)) throw new Error("setter used wrong session");
          const model = params.value ?? params.modelId;
          if (model === "denied")
            throw new Error("Native selection rejected: access to denied is forbidden");
          sessions.set(params.sessionId, model);
          return selectionResult === undefined ? view(model) : selectionResult;
        },
        async *prompt(sessionId) {
          const model = sessions.get(sessionId);
          state.promptModels.push(model);
          record({ method: "session/prompt", sessionId, model });
          if (model === "subscription") {
            yield subscriptionResult;
          } else {
            yield {
              sessionUpdate: "agent_message_chunk",
              content: { text: `Provider used ${model}` }
            };
            yield { type: "prompt_result", stopReason: "end_turn" };
          }
        },
        close: async () => {
          if (!closed) {
            state.closes++;
            record({ method: "close" });
          }
          closed = true;
        }
      };
    }
  });
  return { adapter, state };
}
