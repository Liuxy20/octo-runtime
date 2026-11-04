import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";

// 测试宿主显式准备本文件进程独占的 Home；不借用 cwd、真实用户目录或 SDK 默认值。
export const fixtureHome = mkdtempSync(
  join(process.platform === "win32" ? tmpdir() : "/tmp", "osh-")
);
after(() => rmSync(fixtureHome, { recursive: true, force: true }));
export const fixtureEndpoint = () => componentEndpoint(fixtureHome, `test-${randomUUID()}`);
