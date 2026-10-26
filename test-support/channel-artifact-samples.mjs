import { crc32, deflateSync } from "node:zlib";

/** 可见尺寸的测试位图，避免 1px 透明占位使聊天图片验收失真。 */
export function artifactImage() {
  const width = 640,
    height = 360;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      const color = x < width / 2 ? [28, 132, 166] : [244, 194, 66];
      rows.set(color, offset);
    }
  }
  const chunk = (type, bytes) => {
    const body = Buffer.concat([Buffer.from(type), bytes]);
    const output = Buffer.alloc(body.length + 8);
    output.writeUInt32BE(bytes.length);
    body.copy(output, 4);
    output.writeUInt32BE(crc32(body), output.length - 4);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
