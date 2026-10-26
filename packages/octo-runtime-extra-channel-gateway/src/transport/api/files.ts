/**
 * 文件输入辅助与渠道固定产物交付；显式业务上传仍由 Agent 工具负责。
 * 合同：.octospec/tasks/182-channel-artifact-delivery/brief.md
 */
// Adapted from Mininglamp-OSS/openclaw-channel-octo/src/api-fetch.ts.
import path from "node:path";
import { open } from "node:fs/promises";
import { readResponseText } from "./client.js";
import { trimTrailingSlashes } from "./url.js";

/** 校验服务端返回的长期下载地址；不把 PUT 地址、签名有效期或 Bot 鉴权路由冒充附件。 */
export function attachmentUrl(raw: unknown, apiUrl: string): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 8192)
    throw new Error("invalid-download-url");
  let url: URL;
  try {
    url = new URL(raw, `${trimTrailingSlashes(apiUrl)}/`);
  } catch {
    throw new Error("invalid-download-url");
  }
  const api = new URL(apiUrl);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        url.origin === api.origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    /\/(?:v1\/)?(?:bot\/)?file\/(?:preview|download|upload)(?:\/|$)/i.test(url.pathname) ||
    /\/(?:v1\/)?botfile(?:\/|$)/i.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) =>
      /^(?:x-amz-|x-goog-|q-sign-|signature$|sig$|expires$|expiry$|expire$|token$|access_token$|ossaccesskeyid$)/i.test(
        key
      )
    )
  )
    throw new Error("unstable-download-url");
  return url.href;
}

/** 当前 Bot 获取聊天上传凭据后直传；只交付独立 downloadUrl，绝不转发 Bot Token。 */
export async function uploadChatAttachment(
  apiUrl: string,
  token: string,
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal: AbortSignal
): Promise<string> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  signal.throwIfAborted();
  const query = new URLSearchParams({ filename, fileSize: String(bytes.byteLength) });
  const response = await fetch(
    `${trimTrailingSlashes(apiUrl)}/v1/bot/upload/presigned?${query.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal,
      redirect: "error"
    }
  );
  const body = await readResponseText(response, 64 << 10);
  if (!response.ok) throw new Error("upload-rejected");
  let result: {
    method?: unknown;
    uploadUrl?: unknown;
    downloadUrl?: unknown;
    contentType?: unknown;
    contentDisposition?: unknown;
    maxFileSize?: unknown;
    expiredTime?: unknown;
  };
  try {
    result = JSON.parse(body) as typeof result;
  } catch {
    throw new Error("invalid-upload-response");
  }
  if (!result || typeof result !== "object") throw new Error("invalid-upload-response");
  const download = attachmentUrl(result.downloadUrl, apiUrl);
  if (
    result.method !== "PUT" ||
    typeof result.uploadUrl !== "string" ||
    result.uploadUrl.length > 16_384 ||
    (result.maxFileSize !== undefined && result.maxFileSize !== bytes.byteLength) ||
    (result.expiredTime !== undefined &&
      (typeof result.expiredTime !== "number" || result.expiredTime * 1000 <= Date.now()))
  )
    throw new Error("invalid-upload-response");
  let upload: URL;
  try {
    upload = new URL(result.uploadUrl);
  } catch {
    throw new Error("invalid-upload-response");
  }
  const api = new URL(apiUrl);
  if (
    upload.username ||
    upload.password ||
    (upload.protocol !== "https:" &&
      !(
        upload.protocol === "http:" &&
        upload.origin === api.origin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(upload.hostname)
      ))
  )
    throw new Error("invalid-upload-response");
  const headers: Record<string, string> = {};
  const contentType = result.contentType ?? ensureTextCharset(mime);
  for (const [name, value] of [
    ["Content-Type", contentType],
    ["Content-Disposition", result.contentDisposition]
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 8192 || /[\r\n]/.test(value))
      throw new Error("invalid-upload-response");
    headers[name] = value;
  }
  signal.throwIfAborted();
  // PUT 必须原样回显签名的类型/文件名；临时上传地址仅在此使用，网络未知不自动重放。
  const stored = await fetch(upload.href, {
    method: "PUT",
    headers,
    body: new Uint8Array(bytes),
    redirect: "error",
    signal
  });
  await stored.body?.cancel();
  if (!stored.ok) throw new Error("upload-rejected");
  return download;
}

/**
 * Infer MIME type from filename extension. Returns a sensible default if unknown.
 */
export function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".xml": "text/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".json": "application/json"
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Ensure text/* content types include a charset parameter.
 * If the content type starts with "text/" and has no charset, appends "; charset=utf-8".
 */
export function ensureTextCharset(contentType: string): string {
  if (contentType.startsWith("text/") && !contentType.includes("charset")) {
    return contentType + "; charset=utf-8";
  }
  return contentType;
}

/**
 * Parse image dimensions from buffer (PNG/JPEG/GIF/WebP).
 * Lightweight — reads only the header bytes, no external dependencies.
 */
export function parseImageDimensions(
  buf: Buffer,
  mime: string
): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length > 24) {
      // PNG: width at offset 16 (4 bytes BE), height at offset 20 (4 bytes BE)
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if ((mime === "image/jpeg" || mime === "image/jpg") && buf.length > 2) {
      // JPEG: scan for SOF0/SOF2 marker (0xFF 0xC0 or 0xFF 0xC2)
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
    if (mime === "image/gif" && buf.length > 10) {
      // GIF: width at offset 6 (2 bytes LE), height at offset 8 (2 bytes LE)
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/webp" && buf.length > 30) {
      // WebP VP8: width at offset 26, height at offset 28 (both 2 bytes LE)
      if (buf.toString("ascii", 12, 16) === "VP8 " && buf.length > 29) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

/**
 * Parse image dimensions from a file path by reading only the first 64KB.
 * Avoids loading the entire file into memory.
 */
export async function parseImageDimensionsFromFile(
  filePath: string,
  mime: string
): Promise<{ width: number; height: number } | null> {
  const HEADER_SIZE = 65536; // 64KB — enough for PNG/JPEG/GIF/WebP headers
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(HEADER_SIZE);
    const { bytesRead } = await fh.read(buf, 0, HEADER_SIZE, 0);
    return parseImageDimensions(buf.subarray(0, bytesRead), mime);
  } catch {
    /* ignore read/parse errors */
  } finally {
    await fh?.close();
  }
  return null;
}
