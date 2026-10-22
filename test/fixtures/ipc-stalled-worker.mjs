// 模拟启动阶段事件循环卡住，无法读取父进程的大快照；由父进程负责超时/取消回收。
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
