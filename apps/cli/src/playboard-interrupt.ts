import { execFileSync } from "node:child_process";
import { writeSync } from "node:fs";

/**
 * 仅 CLI 可执行入口在确认 playboard 命令后安装，监听持续到本进程退出。
 * 人工停止不等待 import、Run 终态或 Kernel close；SDK 不使用此策略。
 * 命令返回但清理失败时仍须能停止残留进程树；信号监听本身不维持事件循环。
 */
export function installPlayboardInterrupt(): void {
  let stopping = false;
  const stop = (code: number): void => {
    if (stopping) return;
    stopping = true;
    diagnostic("PLAYBOARD_FORCE_STOP: execution and cleanup are unconfirmed");
    try {
      if (process.platform === "win32") {
        // 保持 leader 存活，由系统按 PID 回收树；不能先退出再查找后代。
        execFileSync("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 2000
        });
      } else {
        // Adapter 可创建独立组，不能只杀当前组，更不能按 node/应用名匹配。
        // 选择本次 CLI 的可识别后代，先杀最深层再退出自身，不触及兄弟服务。
        const listing = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], {
          encoding: "utf8",
          timeout: 2000,
          maxBuffer: 8 * 1024 * 1024
        });
        const children = new Map<number, number[]>();
        for (const line of listing.split("\n")) {
          const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
          if (!match) continue;
          const pid = Number(match[1]),
            parent = Number(match[2]);
          if (pid <= 1 || pid === process.pid) continue;
          const group = children.get(parent) ?? [];
          group.push(pid);
          children.set(parent, group);
        }
        const owned = [process.pid];
        const seen = new Set(owned);
        for (let i = 0; i < owned.length; i++)
          for (const pid of children.get(owned[i]) ?? [])
            if (!seen.has(pid)) {
              seen.add(pid);
              owned.push(pid);
            }
        let failed = false;
        for (const pid of owned.slice(1).reverse()) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") failed = true;
          }
        }
        if (failed) diagnostic("PLAYBOARD_TREE_STOP_UNCONFIRMED");
      }
    } catch {
      // 查询/终止失败不能继续吞掉人工退出；不声称未知或已重新归属的后代已停止。
      diagnostic("PLAYBOARD_TREE_STOP_UNCONFIRMED");
    } finally {
      process.exit(code);
    }
  };
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
}

function diagnostic(message: string): void {
  try {
    writeSync(2, `${message}\n`);
  } catch {
    // stderr 已关闭时仍执行定向强退。
  }
}
