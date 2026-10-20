import { appendFileSync } from "node:fs";
import { ImRuntime } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/im-channel.js";
import { GatewayTransport } from "../../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { MemoryImSessionStore } from "../../packages/octo-runtime-extra-channel-gateway/dist/application/session-store.js";

export const name = "drain-gateway";
export default (context, config) => async () => {
  const record = (type, data = {}) =>
    appendFileSync(config.trace, `${JSON.stringify({ type, ...data })}\n`);
  let callbacks;
  GatewayTransport.prototype.start = async function () {
    callbacks = this.callbacks;
  };
  GatewayTransport.prototype.close = async () => {
    record("connector.close");
  };
  const sessions = new MemoryImSessionStore();
  const save = sessions.save.bind(sessions);
  sessions.save = (key, binding) => {
    if (binding.providerSession) record("binding", { session: binding.providerSession.sessionId });
    save(key, binding);
  };
  let releaseTail;
  const tail = new Promise((resolve) => {
    releaseTail = resolve;
  });
  const kernel = {
    ...context.kernel,
    async *invoke(input, environment) {
      record("invoke", { invocationId: input.invocationId });
      for await (const event of context.kernel.invoke(input, environment)) {
        if (event.type === "session.update") {
          record("accepted.tail");
          await tail;
        }
        yield event;
      }
    },
    async cancelInvocation(id, reason) {
      const result = await context.kernel.cancelInvocation(id, reason);
      record("cancel.ack");
      releaseTail();
      return result;
    }
  };
  const runtime = new ImRuntime(
    {
      bot_id: "drain",
      api_url: "https://im-test.deepminer.com.cn/api",
      adapter: { adapter_type: "test", workdir: process.cwd() }
    },
    { kernel, signal: context.signal, sessions }
  );
  context.onDispose(async () => {
    try {
      await runtime.close();
    } finally {
      sessions.close();
      record("store.close");
    }
  });
  context.onStatus(() => JSON.parse(JSON.stringify(runtime.status)));
  await runtime.start();
  callbacks.onMessage({
    messageId: "drain-message",
    senderId: "sender",
    conversationId: "conversation",
    conversationKind: "direct",
    text: "wait-for-drain",
    buildContext: async () => ({ schema: "octo.context-envelope/v3", items: [] }),
    reply: async (text) => {
      record("final", { text });
    }
  });
};
