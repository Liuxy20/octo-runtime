import { KernelError } from "./types.js";

const notSubmitted = new WeakSet<KernelError>();

/** 包内接纳检查专用；当前 client 在请求写出前拒绝时创建证据。 */
export function admissionClosedError(): KernelError {
  const error = new KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED");
  notSubmitted.add(error);
  return error;
}

/** 仅实际 invoke RPC 的拒绝响应、且实例和专用证据均匹配，才标记未进入执行源。 */
export function markSubmissionRejected(error: unknown, instance: string): void {
  if (
    error instanceof KernelError &&
    ["KERNEL_UNAVAILABLE", "WORKER_RESTART_EXHAUSTED"].includes(error.code) &&
    error.data?.invocation_not_submitted === true &&
    error.data.kernel_instance_id === instance
  )
    notSubmitted.add(error);
}

/**
 * 判断本模块验证的未执行拒绝；包装、序列化及同名错误均返回 false。
 * 只证明本次未进入执行源，不证明此前业务尝试没有执行，也不授权自动重放。
 */
export function isInvocationNotSubmitted(error: unknown): boolean {
  return error instanceof KernelError && notSubmitted.has(error);
}
