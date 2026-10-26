import { KernelError } from "./types.js";

const notSubmitted = new WeakSet<KernelError>();

/** 包内接纳检查专用；只有当前 client 在请求写出前拒绝时才能创建此证据。 */
export function admissionClosedError(): KernelError {
  const error = new KernelError("CLIENT_INVOCATION_ADMISSION_CLOSED");
  notSubmitted.add(error);
  return error;
}

/**
 * 判断同一模块实例产生的本地未提交拒绝；包装、序列化及同名错误均返回 false。
 * 只证明本次 invoke 未写出，不证明此前业务尝试没有执行，也不授权自动重放。
 */
export function isInvocationNotSubmitted(error: unknown): boolean {
  return (
    error instanceof KernelError &&
    error.code === "CLIENT_INVOCATION_ADMISSION_CLOSED" &&
    notSubmitted.has(error)
  );
}
