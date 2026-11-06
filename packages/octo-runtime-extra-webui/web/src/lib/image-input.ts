import {
  IMAGE_INPUT_LIMITS,
  IMAGE_INPUT_MIME_TYPES,
  hasImageInputHeader,
  type ModelInputPart
} from "@mininglamp-oss/octo-runtime-protocol/browser";

export interface Attachment {
  id: string;
  name: string;
  url: string;
  part: Extract<ModelInputPart, { type: "image" }>;
}

/** 添加前、异步读取后和发送前都按同一协议预算检查整组附件。 */
export function checkImageLimits(parts: readonly { mimeType: string; byteSize: number }[]) {
  if (parts.length > IMAGE_INPUT_LIMITS.maxCount)
    throw new Error(`最多添加 ${IMAGE_INPUT_LIMITS.maxCount} 张图片`);
  let total = 0;
  for (const part of parts) {
    if (!(IMAGE_INPUT_MIME_TYPES as readonly string[]).includes(part.mimeType))
      throw new Error("请选择 PNG、JPEG 或 WebP 图片");
    if (
      !Number.isSafeInteger(part.byteSize) ||
      part.byteSize < 1 ||
      part.byteSize > IMAGE_INPUT_LIMITS.maxBytes
    )
      throw new Error(`每张图片须为 1 字节至 ${IMAGE_INPUT_LIMITS.maxBytes / 1024 / 1024} MiB`);
    total += part.byteSize;
  }
  if (total > IMAGE_INPUT_LIMITS.maxTotalBytes)
    throw new Error(`图片总大小不能超过 ${IMAGE_INPUT_LIMITS.maxTotalBytes / 1024 / 1024} MiB`);
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/** 原始 File 只读一次；预览、base64 与摘要来自相同字节。 */
export async function readImage(file: File): Promise<Attachment> {
  checkImageLimits([{ mimeType: file.type, byteSize: file.size }]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || !hasImageInputHeader(bytes, file.type))
    throw new Error("图片内容与格式不符");
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  const data = btoa(binary),
    id = crypto.randomUUID();
  return {
    id,
    name: file.name,
    url: `data:${file.type};base64,${data}`,
    part: {
      id,
      type: "image",
      mimeType: file.type as Attachment["part"]["mimeType"],
      data,
      byteSize: bytes.length,
      sha256: await digest(bytes)
    }
  };
}

/** 发送使用冻结快照再次核对数据；损坏的附件不会进入 HTTP 请求。 */
export async function checkImages(attachments: readonly Attachment[]) {
  checkImageLimits(attachments.map((image) => image.part));
  const ids = new Set<string>();
  for (const image of attachments) {
    const part = image.part;
    if (ids.has(image.id) || image.id !== part.id) throw new Error("图片标识重复");
    ids.add(image.id);
    if (part.data.length > Math.ceil(IMAGE_INPUT_LIMITS.maxBytes / 3) * 4)
      throw new Error("图片内容校验失败");
    const binary = atob(part.data);
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
    if (
      btoa(binary) !== part.data ||
      bytes.length !== part.byteSize ||
      !hasImageInputHeader(bytes, part.mimeType) ||
      (await digest(bytes)) !== part.sha256
    )
      throw new Error("图片内容校验失败");
  }
}
