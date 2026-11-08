// 只连接宿主提供的服务；不拥有 Kernel、Adapter、Home 或业务状态。
export { attachKernel } from "./client.js";
export * from "./types.js";
export { AsyncQuestionReply, type AsyncQuestionReplyResult } from "./async-question-reply.js";
export { isInvocationNotSubmitted } from "./submission-error.js";
export { RuntimeHomeError, assertIpcEndpoint } from "./runtime-path.js";
export type {
  InvokeInput,
  AgentEnv,
  InvocationInputs,
  InvocationContent,
  ProviderSession,
  ModelInputPart,
  InvokeEnvironment,
  HostFrame,
  CanonicalEvent,
  InteractionResponse,
  NativeInteractionResponse,
  HostedAdapterMetadata
} from "@mininglamp-oss/octo-runtime-protocol";
