import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const inspectAcl = String.raw`
$ErrorActionPreference = 'Stop'
$env:PSModulePath = "$PSHOME\Modules"
$acl = Get-Acl -LiteralPath $env:OCTO_FILE_PROTECTION_FIXTURE
$trusted = @(
  [Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
  'S-1-5-18',
  'S-1-5-32-544'
)
$descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
$otherReaders = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
  $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
  -not ($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
  ([long]$_.FileSystemRights -band [Convert]::ToInt64('90000001', 16)) -and
  $_.IdentityReference.Value -notin $trusted
})
@{
  hasDacl = $null -ne $descriptor.DiscretionaryAcl
  trustedOwner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -in $trusted
  otherReaders = $otherReaders.Count
} | ConvertTo-Json -Compress
`;

/** 仅检查测试拥有的普通文件；不为产品设置权限，也不以 Windows mode 推断 ACL。 */
export async function assertPrivateFile(file) {
  const info = await lstat(file);
  assert.ok(info.isFile(), "FILE_PROTECTION_TYPE: expected an ordinary file");
  if (process.platform !== "win32") {
    assert.equal(info.mode & 0o777, 0o600, "FILE_PROTECTION_MODE: expected POSIX 0600");
    return;
  }
  // 只读检查实际 DACL。SID 避免依赖系统语言；ReadData / GENERIC_READ / GENERIC_ALL
  // 都可能授予正文读取。保守拒绝其他主体的 Allow ACE，不模拟任意 deny/group 的有效权限。
  // 子进程只用自身系统模块，避免继承 pwsh 的不兼容模块路径；不改变父进程环境。
  // 缺少 PowerShell、读取 ACL 失败或共享临时目录均须暴露失败，不能退化为跳过。
  const { stdout } = await execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", inspectAcl],
    {
      env: { ...process.env, OCTO_FILE_PROTECTION_FIXTURE: file },
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 64 * 1024,
      encoding: "utf8"
    }
  );
  const acl = JSON.parse(stdout);
  assert.ok(
    acl.hasDacl && acl.trustedOwner && acl.otherReaders === 0,
    "FILE_PROTECTION_ACL: fixture must restrict reading to the current account, SYSTEM and Administrators; use a private per-user test directory"
  );
}
