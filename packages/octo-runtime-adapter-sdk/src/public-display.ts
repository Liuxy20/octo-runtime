const SENSITIVE_OUTPUT_KEY =
  /(?:^|[_-])(?:authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|token|access[_-]?token|refresh[_-]?token|secret|password|passwd|api[_-]?key|credential|private[_-]?key)(?:$|[_-])/i;

export function sanitizePublicValue(value: unknown, key = "", depth = 0): unknown {
  if (key === "executionEnvOverrides") return "[REDACTED]";
  if (SENSITIVE_OUTPUT_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactCredentialText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 16) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, "", depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      sanitizePublicValue(childValue, childKey, depth + 1)
    ])
  );
}

function redactCredentialText(value: string): string {
  // 单向扫描 PEM，避免多个未闭合 BEGIN 反复扫描后缀；截断的私钥同样不能公开。
  const begin = /-----BEGIN [^-]*PRIVATE KEY-----/gi;
  const end = /-----END [^-]*PRIVATE KEY-----/gi;
  const parts: string[] = [];
  let offset = 0;
  for (let match = begin.exec(value); match; match = begin.exec(value)) {
    parts.push(value.slice(offset, match.index), "[REDACTED]");
    end.lastIndex = begin.lastIndex;
    const closing = end.exec(value);
    offset = closing ? end.lastIndex : value.length;
    begin.lastIndex = offset;
  }
  parts.push(value.slice(offset));
  return parts
    .join("")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(api[_-]?key|(?:access[_-]?|refresh[_-]?|bf[_-]?)?token|password|passwd|secret)\s*["']?\s*[:=]\s*["']?[^\s,;&"'}]+/gi,
      "$1=[REDACTED]"
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)=)[^&#\s]*/gi,
      "$1[REDACTED]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\b(?:bf_|ghp_|xoxb-)[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/:\/\/[^/\s:@]+:[^@\s/]+@/g, "://[REDACTED]@");
}
