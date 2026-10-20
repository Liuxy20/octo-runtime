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
export interface KernelInvocationDrainResult {
  readonly complete: boolean;
  readonly unresolved: readonly KernelInvocationRecord[];
}
export interface KernelInvocationLifecycle {
  snapshot(): readonly KernelInvocationRecord[];
  stopAdmission(): void;
  /** Absolute Date.now() deadline shared with the owner's other cleanup work. */
  drain(options: { deadline: number; reason: string }): Promise<KernelInvocationDrainResult>;
}
export interface KernelClient {
  readonly topology: "kernel-ipc";
  readonly ownership: "attached";
  readonly invoke: InputInvoke;
  readonly invocations: KernelInvocationLifecycle;
  cancelInvocation(invocationId: string, reason?: string): Promise<{ accepted: boolean }>;
  respondInteraction(invocationId: string, response: InteractionResponse): Promise<void>;
  respondNativeInteraction(
    invocationId: string,
    response: NativeInteractionResponse
  ): Promise<void>;
  status(): Promise<KernelStatus>;
  list(): Promise<HostedAdapterMetadata[]>;
  submit(input: InvokeInput, environment?: InvokeEnvironment): Promise<{ ref: RunRef }>;
  get(key: LookupKey, expectedInstance?: string): Promise<RunSnapshot>;
  subscribe(ref: RunRef, afterSeq?: number, signal?: AbortSignal): AsyncGenerator<HostFrame>;
  cancel(ref: RunRef, reason?: string): Promise<{ accepted: boolean }>;
  respond(ref: RunRef, response: InteractionResponse): Promise<void>;
  respondNative(ref: RunRef, response: NativeInteractionResponse): Promise<void>;
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
