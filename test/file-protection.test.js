import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertPrivateFile } from "../test-support/file-protection.mjs";

test("file protection oracle accepts a private fixture and rejects public read access", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-file-protection-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, "fixture 空格 #%.json");
  await writeFile(file, "{}", { mode: 0o600 });
  await assertPrivateFile(file);
  if (process.platform === "win32") {
    // 只放宽本测试独占的虚构文件，保留当前账号的控制权，确保 after 可以正常删除。
    const expose = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:OCTO_FILE_PROTECTION_FIXTURE
$acl = Get-Acl -LiteralPath $path
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$rule = [Security.AccessControl.FileSystemAccessRule]::new($everyone, [Security.AccessControl.FileSystemRights]::Read, [Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
`;
    await promisify(execFile)(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", expose],
      {
        env: { ...process.env, OCTO_FILE_PROTECTION_FIXTURE: file },
        windowsHide: true,
        timeout: 10000
      }
    );
  } else {
    // 显式 chmod 避免严格 umask 将负向 fixture 意外创建成私有文件。
    await chmod(file, 0o666);
  }
  await assert.rejects(assertPrivateFile(file), /FILE_PROTECTION_(ACL|MODE)/);
});
