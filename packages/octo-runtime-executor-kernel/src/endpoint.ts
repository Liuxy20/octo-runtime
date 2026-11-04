import net from "node:net";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { assertIpcEndpoint, assertRuntimePath } from "./runtime-home.js";
import { isCanonicalKernelEndpoint, legacyKernelEndpoint } from "./kernel-endpoint-layout.js";

/** 升级拒绝保留具体旧路径与操作；不输出文件正文，也不把连接失败当作删除授权。 */
export class KernelEndpointUpgradeError extends Error {
  readonly code = "KERNEL_ENDPOINT_UPGRADE_REQUIRED";
  readonly diagnostic;
  constructor(endpoint: string, path: string, operation: string, cause?: unknown) {
    super("KERNEL_ENDPOINT_UPGRADE_REQUIRED", { cause });
    this.name = "KernelEndpointUpgradeError";
    this.diagnostic = Object.freeze({
      domain: "startup",
      code: this.code,
      endpoint,
      path,
      resource: "kernel-endpoint-transition",
      operation,
      action:
        "Stop the old Kernel and its Extras with the old version and the same Home. Resolve old ownership/cleanup records with that version before upgrading and restarting all clients. Existing files are preserved."
    });
  }
}

const upgradeRequired = (endpoint: string, path: string, operation: string, cause?: unknown) =>
  new KernelEndpointUpgradeError(endpoint, path, operation, cause);

/** owner 是小型普通文件；同一描述符校验和读取，拒绝链接/FIFO，避免诊断挂住或读取外部内容。 */
async function readOwnerSource(file: string): Promise<string> {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const info = await handle.stat();
    const pathInfo = await lstat(file);
    if (
      !info.isFile() ||
      !pathInfo.isFile() ||
      info.dev !== pathInfo.dev ||
      info.ino !== pathInfo.ino ||
      info.size > 4096
    )
      throw new Error("ENDPOINT_OWNER_INVALID");
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) throw new Error("ENDPOINT_OWNER_INVALID");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** 独占创建后的写入失败也拥有清理责任；只按该描述符的文件身份回滚，不留下假 complete。 */
async function createOwnerFile(file: string, source: string): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  let identity: Awaited<ReturnType<typeof handle.stat>> | undefined;
  let failure: unknown;
  let closeFailed = false;
  try {
    identity = await handle.stat();
    await handle.writeFile(source);
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    closeFailed = true;
    failure = new AggregateError(
      failure ? [failure, error] : [error],
      "ENDPOINT_OWNER_CLOSE_FAILED",
      {
        cause: error
      }
    );
  }
  if (!failure) return;
  // 描述符关闭未确认时保留冲突文件；不能先 unlink 再仅返回一个 incomplete 码。
  if (closeFailed)
    throw new AggregateError([failure], "ENDPOINT_ACQUISITION_CLEANUP_INCOMPLETE", {
      cause: failure
    });
  try {
    const current = await lstat(file);
    if (
      !identity ||
      !current.isFile() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      throw new Error("ENDPOINT_OWNER_CHANGED");
    await rm(file);
  } catch (cleanup) {
    throw new AggregateError([failure, cleanup], "ENDPOINT_ACQUISITION_CLEANUP_INCOMPLETE", {
      cause: cleanup
    });
  }
  if (failure instanceof Error) throw failure;
  throw new Error("ENDPOINT_OWNER_WRITE_FAILED", { cause: failure });
}

/**
 * 仅用于 POSIX 规范 Kernel 地址：占住旧版认识的 owner 协议，但绝不监听旧 socket。
 * 此文件租约独立于本机传输，便于显式验证跨版本竞争；Windows 调用方不使用它。
 * 旧/未知记录全部保留；只允许回收本实现留下、匹配当前地址且 PID 已消失的租约。
 */
export async function acquireKernelTransition(endpoint: string): Promise<() => Promise<void>> {
  const legacy = legacyKernelEndpoint(endpoint);
  assertRuntimePath(`${legacy}.owner.recovery`, "kernel-transition-ownership");
  await mkdir(dirname(legacy), { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw upgradeRequired(legacy, dirname(legacy), "prepare-transition-directory", error);
  });
  try {
    return await acquireFileEndpoint(legacy, endpoint);
  } catch (error) {
    if (error instanceof KernelEndpointUpgradeError) throw error;
    // errno 明确投影到旧租约路径；同一新实例之间的既有互斥码仍保留。
    if ((error as NodeJS.ErrnoException).code)
      throw upgradeRequired(legacy, `${legacy}.owner`, "acquire-transition", error);
    throw error;
  }
}

/** 规范 Kernel 同时占有旧版兼容租约和新端点；原始自选 endpoint 保持单地址合同。 */
export async function acquireKernelEndpoint(endpoint: string): Promise<() => Promise<void>> {
  assertIpcEndpoint(endpoint);
  if (process.platform === "win32" || !isCanonicalKernelEndpoint(endpoint))
    return acquireEndpoint(endpoint);
  const releaseTransition = await acquireKernelTransition(endpoint);
  let release: () => Promise<void>;
  try {
    release = await acquireFileEndpoint(endpoint, undefined, true);
  } catch (error) {
    try {
      await releaseTransition();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "KERNEL_START_CLEANUP_INCOMPLETE", {
        cause: cleanup
      });
    }
    throw error;
  }
  // 新端点释放失败时保留兼容锁；旧版本不能趁未确认清理的窗口启动。
  return async () => {
    await release();
    await releaseTransition();
  };
}

/** 端点租约保护启动竞争；只移除已确认无人监听的旧 socket，不替换用户文件。 */
export async function acquireEndpoint(endpoint: string): Promise<() => Promise<void>> {
  assertIpcEndpoint(endpoint);
  if (process.platform === "win32") return async () => {};
  return acquireFileEndpoint(endpoint);
}

async function acquireFileEndpoint(
  endpoint: string,
  transitionEndpoint?: string,
  canonicalKernel = false
): Promise<() => Promise<void>> {
  const file = `${endpoint}.owner`;
  const nonce = randomUUID();
  let acquired = false;
  let recoveredKernelOwner = false;
  let recovering: Awaited<ReturnType<typeof open>> | undefined;
  const recoveryFile = `${file}.recovery`;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await createOwnerFile(
          file,
          JSON.stringify({
            pid: process.pid,
            nonce,
            ...(canonicalKernel ? { kernelEndpoint: endpoint } : {}),
            ...(transitionEndpoint ? { transitionEndpoint } : {})
          })
        );
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // 回收旧 owner 也需独占；避免竞争者删除刚建立的新实例锁。
        try {
          recovering = await open(recoveryFile, "wx", 0o600);
        } catch (error) {
          throw new Error("ENDPOINT_RECOVERY_IN_PROGRESS", { cause: error });
        }
        let owner: {
          pid?: number;
          nonce?: string;
          transitionEndpoint?: string;
          kernelEndpoint?: string;
        };
        let source: string;
        try {
          source = await readOwnerSource(file);
          owner = JSON.parse(source) as typeof owner;
        } catch (error) {
          if (transitionEndpoint) throw upgradeRequired(endpoint, file, "read-owner", error);
          throw new Error("ENDPOINT_OWNER_INVALID", { cause: error });
        }
        if (
          transitionEndpoint &&
          (owner?.transitionEndpoint !== transitionEndpoint ||
            typeof owner.nonce !== "string" ||
            !/^[0-9a-f-]{36}$/.test(owner.nonce))
        )
          throw upgradeRequired(endpoint, file, "verify-owner");
        // 直接地址的遗留 socket 只能由本实现的匹配 owner 证明归属；未知记录不删除。
        if (
          canonicalKernel &&
          (owner?.kernelEndpoint !== endpoint ||
            typeof owner.nonce !== "string" ||
            !/^[0-9a-f-]{36}$/.test(owner.nonce))
        )
          throw new Error("ENDPOINT_OWNER_INVALID", { cause: error });
        if (!Number.isSafeInteger(owner.pid) || owner.pid! < 1)
          throw new Error("ENDPOINT_OWNER_INVALID", { cause: error });
        try {
          process.kill(owner.pid!, 0);
          throw new Error("ENDPOINT_IN_USE", { cause: error });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        recoveredKernelOwner = canonicalKernel;
        if ((await readOwnerSource(file)) !== source)
          throw new Error("ENDPOINT_OWNER_CHANGED", { cause: error });
        await rm(file);
      }
    }
  } finally {
    if (recovering) {
      await recovering.close();
      await rm(recoveryFile);
    }
  }
  if (!acquired) throw new Error("ENDPOINT_IN_USE");
  const release = async () => {
    const saved = JSON.parse(await readOwnerSource(file)) as { nonce?: string };
    if (saved.nonce !== nonce) throw new Error("ENDPOINT_OWNER_CHANGED");
    await rm(file);
  };
  try {
    if (transitionEndpoint) {
      // 不连接旧地址：旧布局可能已超出 IPC 预算；存在即需旧 owner 完成处理。
      // .runs 是 endpoint-only SDK 的旧默认清单，不能随文件名变化绕过其未确认清理。
      for (const path of [endpoint, `${endpoint}.runs`]) {
        const info = await lstat(path).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw upgradeRequired(endpoint, path, "inspect-legacy", error);
        });
        if (info) throw upgradeRequired(endpoint, path, "inspect-legacy");
      }
      return release;
    }
    const info = await lstat(endpoint).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (info) {
      if (!info.isSocket()) throw new Error("ENDPOINT_PATH_INVALID");
      if (canonicalKernel && !recoveredKernelOwner) throw new Error("ENDPOINT_OWNER_MISSING");
      const active = await new Promise<boolean>((resolve, reject) => {
        const socket = net.createConnection(endpoint);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
          socket.destroy();
          if (["ECONNREFUSED", "ENOENT"].includes(error.code ?? "")) resolve(false);
          else reject(new Error("ENDPOINT_UNVERIFIABLE"));
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error("ENDPOINT_UNVERIFIABLE"));
        });
      });
      if (active) throw new Error("ENDPOINT_IN_USE");
      const current = await lstat(endpoint);
      if (!current.isSocket() || current.dev !== info.dev || current.ino !== info.ino)
        throw new Error("ENDPOINT_OWNER_CHANGED");
      await rm(endpoint);
    }
    return release;
  } catch (error) {
    try {
      await release();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "ENDPOINT_ACQUISITION_CLEANUP_INCOMPLETE", {
        cause: cleanup
      });
    }
    throw error;
  }
}
