/** 仅移除末尾斜杠；保留路径与原有 URL 拼接合同，避免正则反复扫描长后缀。 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
