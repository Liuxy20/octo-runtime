import type {
  KernelLookupKey,
  KernelRunRef,
  KernelRunSnapshot,
  KernelStatus,
  InvokeInput,
  InvokeEnvironment,
  HostFrame,
  InteractionResponse,
  NativeInteractionResponse
} from "@mininglamp-oss/octo-runtime-protocol";
import type { HostedAdapterMetadata } from "@mininglamp-oss/octo-runtime-executor-core";

export type LookupKey = KernelLookupKey;
export type RunRef = KernelRunRef;
export type RunSnapshot = KernelRunSnapshot;
export type { KernelStatus };
export interface KernelClient {
  readonly topology: "kernel-ipc";
  readonly ownership: "attached";
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
