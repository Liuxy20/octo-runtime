const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const imfFixdate =
  /^(?<weekday>Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?<day>\d{2}) (?<month>[A-Z][a-z]{2}) (?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/;
const rfc850Date =
  /^(?<weekday>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (?<day>\d{2})-(?<month>[A-Z][a-z]{2})-(?<year>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/;
const asctimeDate =
  /^(?<weekday>Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?<month>[A-Z][a-z]{2}) (?<day>\d{2}| \d) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<year>\d{4})$/;

/**
 * 解析 HTTP Retry-After 的秒数或日期，返回相对 nowMs 的非负毫秒数。
 * 无效值返回 undefined，过去日期返回零；默认退避和等待预算由调用方决定。
 * 有限秒数换算溢出时保留 Infinity，使 REST 仍能按超预算拒绝，不能退回短等待。
 */
export function parseRetryAfterMs(
  raw: string | null | undefined,
  nowMs = Date.now()
): number | undefined {
  // 先限制字符集，trim 才只会移除 HTTP 的 SP/HTAB；避免空白正则在长畸形值上重复回溯。
  if (raw == null || /[^\t\x20-\x7e]/.test(raw)) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  // HTTP 秒数只接受十进制；保留 REST 的普通小数兼容，不接收 Number 的进制、符号或指数语法。
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.round(seconds * 1000);
  }

  const fields = (imfFixdate.exec(value) ?? rfc850Date.exec(value) ?? asctimeDate.exec(value))
    ?.groups;
  if (!fields) return undefined;
  let year = Number(fields.year);
  const month = months.indexOf(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  const second = Number(fields.second);
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return undefined;

  // 三种 HTTP-date 均为 UTC。先保留第 59 秒以校验日历，闰秒最后映射到下一秒。
  const date = new Date(0);
  const leapSecondMs = second === 60 ? 1000 : 0;
  if (fields.year.length === 2) {
    const limit = new Date(nowMs);
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    year += Math.floor(limit.getUTCFullYear() / 100) * 100;
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(hour, minute, Math.min(second, 59), 0);
    // 比较完整 UTC 时间戳：恰好 50 年保留，超过才回到最近的过去世纪。
    if (date.getTime() + leapSecondMs > limit.getTime()) year -= 100;
  }
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  // Date 的分量 API 会自动顺延无效日期，必须回读校验；星期按最终展开的年份校验。
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    weekdays[date.getUTCDay()] !== fields.weekday.slice(0, 3)
  )
    return undefined;
  return Math.max(0, date.getTime() + leapSecondMs - nowMs);
}
