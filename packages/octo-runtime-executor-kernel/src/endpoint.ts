import net from "node:net";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rm } from "node:fs/promises";

/** 端点租约保护启动竞争；只移除已确认无人监听的旧 socket，不替换用户文件。 */
export async function acquireEndpoint(endpoint: string): Promise<() => Promise<void>> {
  if (process.platform === "win32") return async () => {};
  const file = `${endpoint}.owner`;
  const nonce = randomUUID();
  let acquired = false;
  let recovering: Awaited<ReturnType<typeof open>> | undefined;
  const recoveryFile = `${file}.recovery`;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(file, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
        } finally {
          await handle.close();
        }
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
        let owner: { pid?: number };
        try {
          owner = JSON.parse(await readFile(file, "utf8")) as typeof owner;
        } catch (error) {
          throw new Error("ENDPOINT_OWNER_INVALID", { cause: error });
        }
        if (!Number.isSafeInteger(owner.pid) || owner.pid! < 1)
          throw new Error("ENDPOINT_OWNER_INVALID", { cause: error });
        try {
          process.kill(owner.pid!, 0);
          throw new Error("ENDPOINT_IN_USE", { cause: error });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
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
    const saved = JSON.parse(await readFile(file, "utf8")) as { nonce?: string };
    if (saved.nonce !== nonce) throw new Error("ENDPOINT_OWNER_CHANGED");
    await rm(file);
  };
  try {
    const info = await lstat(endpoint).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (info) {
      if (!info.isSocket()) throw new Error("ENDPOINT_PATH_INVALID");
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
      await rm(endpoint);
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
