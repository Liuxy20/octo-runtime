import { copyFile, mkdir } from "node:fs/promises";

// CLI 专属资源随自身产物交付，SDK 不读取或复制这份清单。
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../src/manifest.json", import.meta.url),
  new URL("../dist/manifest.json", import.meta.url)
);
