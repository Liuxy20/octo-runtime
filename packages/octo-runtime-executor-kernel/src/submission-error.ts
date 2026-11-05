// 兼容旧入口；客户端状态、错误身份和恢复实现由独立包统一持有。
export {
  admissionClosedError,
  markSubmissionRejected,
  isInvocationNotSubmitted
} from "@mininglamp-oss/octo-runtime-client/internal";
