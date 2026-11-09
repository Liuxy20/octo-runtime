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

/** Response summaries parse JSON before redaction; truncated credentials must also stay private. */
export function sanitizeDiagnosticBody(body: string): string {
  let safe: string;
  try {
    safe = JSON.stringify(sanitizePublicValue(JSON.parse(body)));
  } catch {
    safe = String(sanitizePublicValue(body));
  }
  if (/\\u[0-9a-f]{0,4}/i.test(safe)) safe = "[REDACTED]";
  // Headers can occur inside a JSON message too. Drop the entire suffix at the first
  // sensitive key instead of guessing where a spaced or truncated credential ends.
  // 先消费完整 key，再单向检查分隔符，避免无分隔符长输入反复回溯后缀。
  const keys = /[\w-]+/g;
  for (const match of safe.matchAll(keys)) {
    let end = match.index + match[0].length;
    while (end < safe.length && /[\\"']/.test(safe[end])) end += 1;
    while (end < safe.length && /\s/.test(safe[end])) end += 1;
    if ((safe[end] === ":" || safe[end] === "=") && SENSITIVE_OUTPUT_KEY.test(match[0])) {
      const start =
        match.index > 0 && /["']/.test(safe[match.index - 1]) ? match.index - 1 : match.index;
      safe = `${safe.slice(0, start)}[REDACTED]`;
      break;
    }
  }
  return Array.from(safe).slice(0, 200).join("");
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
