import {
  describeStartupError,
  type StartupDiagnostic,
  type StartupLocation
} from "./startup-diagnostics.js";

import type { ServiceCleanupResult } from "@mininglamp-oss/octo-runtime-client/internal";
export type {
  ServiceCleanupResult,
  ServicePhase
} from "@mininglamp-oss/octo-runtime-client/internal";

export interface ServiceLifecycle<S> {
  initialize(options?: { signal?: AbortSignal }): Promise<void>;
  status(): Promise<S>;
  close(): Promise<ServiceCleanupResult>;
  readonly closed: Promise<ServiceCleanupResult>;
}

export class ServiceInitializationError extends Error {
  readonly diagnostic: StartupDiagnostic;
  constructor(
    cause: unknown,
    readonly cleanup: ServiceCleanupResult,
    location: StartupLocation = { component: "host", phase: "initializing" }
  ) {
    super("SERVICE_INITIALIZATION_FAILED", { cause });
    this.name = "ServiceInitializationError";
    this.diagnostic = describeStartupError(this, location);
  }
}

/** 所有阶段共用停止起点，超时只结束等待，不代表底层资源已释放。 */
export async function beforeDeadline<T>(operation: Promise<T>, until: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("SERVICE_CLEANUP_TIMEOUT")),
          Math.max(1, until - Date.now())
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
