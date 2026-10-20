export class HostRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly scope: string,
    readonly retryable: boolean,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HostRuntimeError";
  }
}
