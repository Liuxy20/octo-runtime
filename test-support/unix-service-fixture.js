import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";

/** 模拟 Unix 的路径只出现在 spec 中；真实文件始终归本次测试的原生临时目录所有。 */
export async function createUnixServiceFixture(t, prefix, directory = tmpdir()) {
  const home = await fs.mkdtemp(join(directory, prefix));
  const unixHome = `/octo-fixtures/${basename(home)}`;
  const root = normalize(unixHome);
  const nativePath = (path) => {
    if (typeof path !== "string") return path;
    const normalized = normalize(path);
    if (normalized !== root && !normalized.startsWith(`${root}${sep}`)) return path;
    return join(home, relative(root, normalized));
  };

  // backend 仍执行真实文件 IO；仅在测试边界翻译 fixture 路径，不改产品校验或渲染。
  // 用例保持串行；每项结束恢复 ESM binding，避免映射泄漏到下一个用例。
  const mocks = ["mkdir", "readFile", "open", "rm"].map((method) => {
    const original = fs[method];
    return t.mock.method(fs, method, (path, ...args) => original(nativePath(path), ...args));
  });
  const rename = fs.rename;
  mocks.push(t.mock.method(fs, "rename", (from, to) => rename(nativePath(from), nativePath(to))));
  syncBuiltinESMExports();
  t.after(async () => {
    for (const mocked of mocks) mocked.mock.restore();
    syncBuiltinESMExports();
    await fs.rm(home, { recursive: true, force: true });
  });
  return { home, unixHome, nativePath };
}

/** CLI 使用本机 Home/IPC；注入的模拟 backend 接收同一服务的 Unix 路径投影。 */
export function mapCliServiceToUnix(t, backend, home, unixHome) {
  for (const method of [
    "inspect",
    "install",
    "uninstall",
    "enable",
    "disable",
    "start",
    "stop",
    "restart"
  ]) {
    const original = backend[method];
    t.mock.method(backend, method, function (spec) {
      // backend 内部会再次 inspect 已投影的 spec；只在 CLI 注入边界做一次映射。
      if (spec.workingDirectory === unixHome) return original.call(this, spec);
      assert.equal(spec.command, process.execPath);
      assert.equal(spec.workingDirectory, home);
      assert.ok(isAbsolute(spec.args[0]));
      assert.deepEqual(spec.args.slice(2), ["run", "--home", home]);
      return original.call(this, {
        ...spec,
        command: "/usr/bin/node",
        workingDirectory: unixHome,
        args: spec.args.map((arg, index) =>
          index === 0 ? "/opt/octo-runtime/cli.js" : arg === home ? unixHome : arg
        )
      });
    });
  }
  return backend;
}
