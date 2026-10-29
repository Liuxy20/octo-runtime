/** API/WS 时间为秒，已解码历史为毫秒；单位由调用方明确，缺失或无效时间不补为当前时间。 */
export function messageDate(
  timestamp: unknown,
  unit: "seconds" | "milliseconds"
): Date | undefined {
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0)
    return undefined;
  const milliseconds = unit === "seconds" ? timestamp * 1000 : timestamp;
  if (milliseconds > 0xffffffff * 1000) return undefined;
  return new Date(milliseconds);
}

/** 按该消息时刻的系统时区输出 ISO 8601，保留显式偏移（含夏令时），不转换为 UTC Z。 */
export function messageSentAt(timestamp: unknown, unit: "seconds" | "milliseconds"): string | null {
  const date = messageDate(timestamp, unit);
  if (!date) return null;
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${zone}`;
}
