/** Cleanup contract for explicitly configured external native executables. */
export interface CleanupResult {
  complete: boolean;
  processExited: boolean;
  pendingResources: string[];
  errors: { code: string; component: string }[];
}
export class ComponentStartError extends Error {
  constructor(
    cause: unknown,
    readonly cleanup: CleanupResult
  ) {
    super(cause instanceof Error ? cause.message : "COMPONENT_START_FAILED", { cause });
    this.name = "ComponentStartError";
  }
}
export async function deadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
