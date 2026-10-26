# Cross-platform User Services

[简体中文](README.zh.md) | [Packages](../README.md)

Installs, starts, stops, inspects, and removes long-running processes through the current user's own service manager: launchd on macOS, `systemctl --user` on Linux, Task Scheduler on Windows. It maps one portable `ServiceSpec` onto each platform. It never runs an Agent turn, and it never proves that Kernel IPC, Providers, cloud connections, or IM are ready.

## When to use it

- A CLI or installer has to leave a long-running service behind for the current user.
- You want drift reporting between the installed definition and the live state.
- Not for embedding a Kernel in an existing app — use the service factory directly instead.

## What each verb does

| Call                 | Behaviour                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `probe` / `inspect`  | Report native state, PID or exit code when available, and configuration drift. Nothing is repaired.                                       |
| `install`            | Reconciles the definition and autostart without starting a stopped service. Updating a running definition replaces the process as needed. |
| `enable` / `disable` | Control future activation only; they do not start or stop the current process.                                                            |
| `start` / `restart`  | Require an installed, enabled service.                                                                                                    |
| `stop`               | Keeps the definition.                                                                                                                     |
| `uninstall`          | Removes the definition, keeps application data.                                                                                           |

`createServiceBackend(options?)` picks the current platform without installing or probing. Backends expose exactly the verbs above; `ServiceError` carries stable codes, and tests can inject a `CommandRunner`.

## Platform limits

- macOS uses per-user LaunchAgents.
- Linux uses `systemctl --user` and does not enable linger.
- Windows uses a least-privilege task with the current user's interactive token, activated at login — not a LocalSystem service.
- Windows supports neither `environment`, `stdoutPath`, nor `stderrPath` in the spec: the application has to log itself. Its on-failure restart delay is at least 60 seconds, and `always` is rejected. The task XML is UTF-16LE with a BOM, so prefer the backend over hand-serializing.
- Screen lock is not logout. Login, boot, and logout behaviour depends on the native manager and Linux linger settings; this package does not configure administrator policy.

## Inputs

Use absolute executable and working-directory paths and an exact argv array — no shell interpretation. Definitions persist to disk, so never put tokens, passwords, cookies, or keys in arguments or environment; the application loads its own protected credentials.

## Import and distribution

Private workspace deployment helper, with no equivalent public SDK subpath. Seeding the definition is not application readiness: check IPC and application status separately.

## Further reading

- [Exports](src/index.ts), [contracts](src/types.ts), [CLI Operations](../../docs/en/getting-started/cli.md).
