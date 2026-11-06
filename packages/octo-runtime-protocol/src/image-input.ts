/** 浏览器与 Node 入口共享图片合同；此模块不得依赖 Node 标准库。 */
export const IMAGE_INPUT_LIMITS = Object.freeze({
  maxCount: 4,
  maxBytes: 2 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024
});
export const IMAGE_INPUT_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp"
] as const);

/** 只检查协议要求的文件签名，不宣称已完成图片解码。 */
export function hasImageInputHeader(bytes: Uint8Array, mimeType: string): boolean {
  const starts = (header: readonly number[], offset = 0) =>
    header.every((value, index) => bytes[offset + index] === value);
  return mimeType === "image/png"
    ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mimeType === "image/jpeg"
      ? starts([255, 216, 255])
      : mimeType === "image/webp" && starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8);
}
