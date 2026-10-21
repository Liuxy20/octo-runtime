/**
 * 宿主依赖入口：注入执行能力、凭据来源和脱敏诊断。
 * SDK 应用自行决定账号目录和凭据生命周期，通道无需依赖 CLI 或具体 Provider。
 */
import type { KernelClient } from "@mininglamp-oss/octo-runtime-executor-kernel";
import type { ImBotConfig } from "./contracts.js";
import type { ImSessionStore } from "./application/session-store.js";
import type {
  RuntimeLog,
  JsonObject,
  ChannelDependencies
} from "@mininglamp-oss/octo-runtime-host-sdk";
import type { ContextItem } from "@mininglamp-oss/octo-runtime-protocol";

export type ImCredentialSource = (
  config: ImBotConfig,
  signal: AbortSignal
) => Promise<string | undefined>;

/** 根据可信 Bot 配置的独立快照同步创建句柄；数据库及其迁移仍归宿主所有。 */
export type CreateSessionStore = (config: JsonObject) => ImSessionStore;

/** Gateway 专属依赖；通过同一泛型 Extra 服务注入，不扩展通用 ExtraContext。 */
export interface GatewayDependencies extends ChannelDependencies {
  createSessionStore?: CreateSessionStore;
}

/** Manager 额外拥有工厂句柄；直接 sessions 仍为借用，不能与工厂同时配置。 */
export interface ImChannelManagerDependencies extends ImModuleDependencies {
  createSessionStore?: CreateSessionStore;
}
export interface ImModuleDependencies {
  prepareContexts?: (config: JsonObject, signal: AbortSignal) => Promise<ContextItem[]>;
  log?: RuntimeLog;
  kernel: Pick<KernelClient, "invoke" | "cancelInvocation" | "respondInteraction">;
  /** Owning Extra/manager lifetime; aborts connections, execution and delivery. */
  signal?: AbortSignal;
  authorizeSpace?: (spaceId: string) => void;
  credentials?: ImCredentialSource;
  sessions?: ImSessionStore;
  onDiagnostic?: (code: string, identity: { endpointId: string; runId?: string }) => void;
}
