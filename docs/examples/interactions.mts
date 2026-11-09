import { randomUUID } from "node:crypto";
import type { KernelClient } from "@mininglamp-oss/octo-runtime-client";
import { AsyncQuestionReply } from "@mininglamp-oss/octo-runtime-client";
import type {
  InvokeInput,
  CanonicalEvent,
  InteractionRequestedPayload,
  InteractionResponse
} from "@mininglamp-oss/octo-runtime-client/protocol";
import type { AsyncQuestionReplySnapshot } from "@mininglamp-oss/octo-runtime-client/protocol";
import { invokeOnce } from "./invoke.mts";
import { assertQuestionRequest } from "@mininglamp-oss/octo-runtime-client/protocol";

/** 用户界面决定回复；在原 client、原 invocation 下响应，并继续消费到终态。 */
export async function invokeInteractive(
  client: KernelClient,
  input: InvokeInput,
  ask: (request: InteractionRequestedPayload) => Promise<InteractionResponse>,
  consume: (event: CanonicalEvent) => void | Promise<void>
): Promise<void> {
  const invocationId = input.invocationId ?? randomUUID();
  await invokeOnce(client, { ...input, invocationId }, async (event) => {
    await consume(event);
    if (event.type === "interaction.requested" && event.payload.delivery !== "async") {
      const response = await ask(event.payload);
      await client.respondInteraction(invocationId, response);
    }
  });
}

/** 仅活动 Run 的低层示例；需要晚答时使用下方 asyncSupplementForm。 */
export function asyncQuestionForm(
  client: KernelClient,
  invocationId: string,
  event: CanonicalEvent
) {
  if (event.type !== "interaction.requested" || event.payload.delivery !== "async") return;
  const request = event.payload.request;
  assertQuestionRequest(request);
  return {
    interactionId: event.payload.interactionId,
    messageId: request.messageId,
    expiresAt: event.payload.expiresAt,
    fields: request.questions,
    // 每题一个选项原文或自定义文本；成功仅表示 Provider 已接纳。
    submit: (answers: { questionId: string; text: string }[]) =>
      client.respondInteraction(invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "answered",
        value: { schema: "octo.question-response/v1", answers }
      }),
    dismiss: () =>
      client.respondInteraction(invocationId, {
        interactionId: event.payload.interactionId,
        outcome: "cancelled"
      })
  };
}

/**
 * 宿主提供唯一控制者、原 RunRef/原题及明确授权的 continuation input；不在读流时等用户。
 * currentInput 须核对业务绑定和续跑授权，无法确认则抛错；不能盲用全局当前配置。
 * agentEnv 不做跨轮相等性检查；providerEpoch 是可选绑定版本，不是配置修改计数。
 * respond 捕获配置副本，消费前再次调用 currentInput 仅复核身份/代次，不替换该副本。
 * 使用低层原帧订阅时将原终态交给 reply.observe(frame)；canonical invoke 消费结束后
 * 用 client.get(snapshot.ref, snapshot.ref.kernel_instance_id).terminal 交给 observe。
 * 保存 reply.snapshot()，包括 submitting/unknown 状态；重启不得恢复在途提交为 pending。
 * new_run 要继续消费 events 并保存 session.update；宿主负责 signal、取消和业务收尾。
 */
export function asyncSupplementForm(
  client: KernelClient,
  snapshot: AsyncQuestionReplySnapshot,
  currentInput: () => InvokeInput,
  consume: (event: CanonicalEvent) => void | Promise<void>
) {
  const reply = new AsyncQuestionReply(client, snapshot, currentInput);
  return {
    reply,
    submit: async (answers: { questionId: string; text: string }[]) => {
      const result = await reply.respond({ schema: "octo.question-response/v1", answers });
      if (result.route === "new_run") for await (const event of result.events) await consume(event);
      return result.route;
    },
    dismiss: () => reply.cancel()
  };
}
