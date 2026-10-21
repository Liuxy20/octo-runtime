import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertModelInputParts, type ModelInputPart } from "@mininglamp-oss/octo-runtime/protocol";

/** 从调用方选定的本地图片构造 part；Runtime 不替业务下载或转换资源。 */
export async function imagePart(
  path: string,
  mimeType: "image/png" | "image/jpeg" | "image/webp"
): Promise<ModelInputPart> {
  const bytes = await readFile(path);
  const part: ModelInputPart = {
    type: "image",
    mimeType,
    data: bytes.toString("base64"),
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
  assertModelInputParts([part]);
  return part;
}
