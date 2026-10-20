import type {
  KernelLookupKey,
  KernelRunRef,
  KernelRunSnapshot,
  KernelStatus,
  InvokeInput,
  InvokeEnvironment,
  InputInvoke,
  HostFrame,
  InteractionResponse,
  NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
import type { HostedAdapterMetadata } from "@mininglamp-oss/octo-runtime-executor-core";

export type LookupKey = KernelLookupKey;
export type RunRef = KernelRunRef;
export type RunSnapshot = KernelRunSnapshot;
export type { KernelStatus };
export interface KernelInvocationRecord {
  readonly key: LookupKey;
  readonly ref?: RunRef;
  readonly phase: "admitting" | "accepted" | "acceptance_unknown" | "unobserved";
  readonly cancellation: "none" | "requested" | "acknowledged" | "unknown";
  readonly lastSeq: number;
  readonly observationError?: string;
}
/** 只确认本 client 登记的执行是否排空；不代表卡片投递或业务 dispose 已完成。 */
export interface KernelInvocationDrainResult {
  readonly complete: boolean;
  readonly unresolved: readonly KernelInvocationRecord[];
}
export interface KernelInvocationLifecycle {
  /** 身份与观察状态的副本，不缓存消息正文；结果未知的执行仍保留在列表中。 */
  snapshot(): readonly KernelInvocationRecord[];
  /** 同步关闭 invoke 接纳；已有执行仍可取消、查询和消费尾流。 */
  stopAdmission(): void;
  /** 共享 Date.now() 毫秒绝对期限；首次调用确定预算，后续调用复用同一排空结果。 */
  drain(options: { deadline: number; reason: string }): Promise<KernelInvocationDrainResult>;
}
/**
 * 附着到独立 Kernel 的客户端，不拥有 Kernel 进程。
 * 常规接入使用 invoke；owner 退出时先 stopAdmission，再并行 drain 与业务收尾，最后 close。
 * submit/subscribe 是低层入口，调用方自行保存 RunRef、管理取消与尾流，不自动登记为 invoke。
 */
export interface KernelClient {
  readonly topology: "kernel-ipc";
  readonly ownership: "attached";
  /** 开始消费才提交；signal 请求取消但保留尾流，提前结束迭代则仅停止观察。 */
  readonly invoke: InputInvoke;
  readonly invocations: KernelInvocationLifecycle;
  /** 仅操作当前 client 的 invoke 登记；accepted 是取消受理，不是终态或清理完成。 */
  cancelInvocation(invocationId: string, reason?: string): Promise<{ accepted: boolean }>;
  respondInteraction(invocationId: string, response: InteractionResponse): Promise<void>;
  respondNativeInteraction(
    invocationId: string,
    response: NativeInteractionResponse
  ): Promise<void>;
  status(): Promise<KernelStatus>;
  list(): Promise<HostedAdapterMetadata[]>;
  /** 接纳后由 Kernel 持续驱动执行；ACK 丢失只查原身份，不重复执行。 */
  submit(input: InvokeInput, environment?: InvokeEnvironment): Promise<{ ref: RunRef }>;
  /** 按完整 LookupKey 查询原执行；指定 expectedInstance 可拒绝服务重启后的同名身份。 */
  get(key: LookupKey, expectedInstance?: string): Promise<RunSnapshot>;
  /** 从 afterSeq 之后观察同一执行；signal 只关闭订阅，游标过期/身份变化须交给调用方处理。 */
  subscribe(ref: RunRef, afterSeq?: number, signal?: AbortSignal): AsyncGenerator<HostFrame>;
  /** 显式控制原 RunRef；ACK 丢失报结果未知，不能自动重试可能已受理的控制动作。 */
  cancel(ref: RunRef, reason?: string): Promise<{ accepted: boolean }>;
  /** 交互响应必须匹配原引用和协议模式，过期/未知的响应不能改投其他 Run。 */
  respond(ref: RunRef, response: InteractionResponse): Promise<void>;
  respondNative(ref: RunRef, response: NativeInteractionResponse): Promise<void>;
  /** 释放本 client 的连接和控制请求，不取消已接纳 Run，也不关闭共享 Kernel。 */
  close(): void;
}
export class KernelError extends Error {
  constructor(
    readonly code: string,
    readonly data?: Record<string, unknown>
  ) {
    super(code);
    this.name = "KernelError";
  }
}
