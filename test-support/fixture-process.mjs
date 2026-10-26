import { setTimeout as delay } from "node:timers/promises";

/** 测试仅回收已登记的所属 PID；发出信号后确认消失，调用方才可删除仍可能被写入的目录。 */
export async function terminateFixtureProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid fixture PID");
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(10);
  }
  throw new Error(`Fixture process ${pid} did not exit before directory cleanup`);
}
