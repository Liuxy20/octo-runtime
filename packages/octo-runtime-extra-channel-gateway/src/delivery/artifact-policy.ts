import type { ContextEnvelope, ContextItem } from "@mininglamp-oss/octo-runtime-protocol";
import type { OctoBotConfig } from "../contracts.js";

export interface ImArtifactPolicy {
  mode: "channel" | "tools";
  workspace?: string;
  local: boolean;
  roots: string[];
  mimeTypes?: string[];
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  timeoutMs: number;
}

export const ARTIFACT_LIMITS = {
  max_file_bytes: 20 * 1024 * 1024,
  max_total_bytes: 50 * 1024 * 1024,
  max_files: 16,
  timeout_ms: 30_000
} as const;

/** 从可信配置及实际执行目录派生合同；远程 preset 的同名主机路径永不成为可读产物。 */
export function artifactPolicy(
  config: OctoBotConfig,
  context: ContextEnvelope,
  local: boolean
): ImArtifactPolicy {
  const options = config.artifact_delivery;
  const workspace = context.items.find(
    (item) => item.namespace === "octo.execution" && item.name === "workspace"
  )?.payload.path;
  return {
    mode: options?.mode ?? "channel",
    ...(typeof workspace === "string" ? { workspace } : {}),
    local,
    roots: [...(options?.allowed_roots ?? (typeof workspace === "string" ? [workspace] : []))],
    ...(options?.allowed_mime_types ? { mimeTypes: [...options.allowed_mime_types] } : {}),
    maxFileBytes: options?.max_file_bytes ?? ARTIFACT_LIMITS.max_file_bytes,
    maxTotalBytes: options?.max_total_bytes ?? ARTIFACT_LIMITS.max_total_bytes,
    maxFiles: options?.max_files ?? ARTIFACT_LIMITS.max_files,
    timeoutMs: options?.timeout_ms ?? ARTIFACT_LIMITS.timeout_ms
  };
}

/** 在执行前向模型明示两种行为；这里只传递约定，不接受模型改写后的访问授权。 */
export function artifactContext(policy: ImArtifactPolicy): ContextItem {
  return {
    namespace: "extra.im",
    name: "artifact-delivery",
    guidance:
      policy.mode === "channel"
        ? "This channel delivers generated local output files referenced in your successful final reply. Create outputs in the effective workspace and use Markdown links or images (including reference style). Gateway's deterministic delivery workflow uploads accessible, policy-allowed files as IM attachments, rewrites their targets and sends native file cards for ordinary file links alongside this same final reply. Display image outputs inline with ![alt](path); a plain download link alone is not image delivery. Images alone do not add file cards. Offer a separate image download link only when requested. This workflow does not publish HTML, create online documents, grant document permissions or save to Drive. Explicit user requests to upload, publish, collaborate on an online document or perform another business action still use your normal tool calls; preserve their returned remote URLs. Do not send a duplicate final reply with a messaging tool. Code, quoted examples, and directory contents are not collected. Remote provider files cannot be retrieved by Gateway."
        : "This channel does not automatically upload output files. Use normal tool calls when the task requires file delivery and return recipient-accessible URLs. Do not present runtime-local paths as downloadable attachments. Do not send a duplicate final reply with a messaging tool.",
    payload: {
      mode: policy.mode,
      localWorkspaceAccessible: policy.local,
      ...(policy.workspace ? { workspace: policy.workspace } : {}),
      allowedRoots: policy.roots,
      ...(policy.mimeTypes ? { allowedMimeTypes: policy.mimeTypes } : {}),
      maxFileBytes: policy.maxFileBytes,
      maxTotalBytes: policy.maxTotalBytes,
      maxFiles: policy.maxFiles,
      timeoutMs: policy.timeoutMs
    }
  };
}
