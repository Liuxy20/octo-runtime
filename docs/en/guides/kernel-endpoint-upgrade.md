# Kernel endpoint upgrade

[中文](../../zh-CN/guides/kernel-endpoint-upgrade.md)

The persistent POSIX Kernel address is exactly `<home>/executor-kernel.sock`.
Derive it with `componentEndpoint(home)` and use that same result for Kernel
creation, attached clients and independently hosted Extras. An Extra's optional
control endpoint serves that Extra's status only; it retains
`<home>/sockets/octo-runtime-<extra>.sock` and is not another Kernel address.

On Windows the existing `\\.\pipe\octo-runtime-kernel-<home-hash>` name is
unchanged. The transport derives it from the same normalized Home; it does not
create a Unix socket file or select another state directory. Service IDs also
remain unchanged on every platform.

Home selection/preparation belongs to the host. The SDK requires an explicit,
prepared absolute Home under the [Home ownership contract](https://github.com/Mininglamp-OSS/octo-runtime/issues/306).
Only the CLI defaults to `~/.octo-runtime`; use `--home` to keep using an existing
custom or former platform-selected Home. Do not move data or create a fresh Home
just to change the endpoint. Configuration, credentials, machine/profile identity
and Provider data stay in place.

## Stop, upgrade and restart

1. Before replacing the old version, stop every Extra that connects to the old
   Kernel, then stop Kernel and wait for complete cleanup. For CLI deployments,
   use the old CLI's `<extra> stop --home <home>` and
   `executor-kernel stop --home <home>`; SDK hosts await each service's `close()`
   result before replacing code.
2. If the old version crashed, use that version's `doctor` and explicit
   `executor-kernel recover --acknowledge-orphan-cleanup --home <home>` only after
   stopping its orphan tools. Start and cleanly stop that version to finish its
   ownership cleanup before upgrading. SDK hosts use the old exact manifest path
   with `inspectOrphanCleanup` / `acknowledgeOrphanCleanup`. A default endpoint-only
   SDK manifest was `<old-endpoint>.runs`; CLI uses
   `<home>/run/kernel-invocations.json`. Unknown or damaged records require owner
   investigation; the new version does not delete or reinterpret them.
3. Upgrade Kernel and all clients/Extras together. Remove hard-coded old socket
   strings from host integrations and native clients; derive the current address.
   Restart Kernel first, then Extras. CLI service IDs and definitions still use
   the same Home, so reinstalling services is not required for this layout change.
4. Check the new Kernel status and each Extra's `kernel_available`. Attached
   clients must reconnect to the new endpoint. There is no alias listener,
   automatic fallback, request forwarding or replay of previous executions.

## Old endpoint protection

The old pathname is `<home>/sockets/octo-runtime-executor-kernel.sock`. On POSIX,
the new Kernel reserves its `.owner` lease for the lifetime of the new service,
using the PID/nonce protocol understood by the old version. This is a compatibility
lock, **not a second listening socket**. The `sockets` directory may therefore
remain or contain this lease even when no Extra has a control socket.

An old socket, old/unrecognized owner, or old endpoint-local `.runs` record causes
`KERNEL_ENDPOINT_UPGRADE_REQUIRED`, with the actual path and failed operation.
This applies to stopped-but-unconfirmed files as well as live listeners. The new
version preserves them and directs the owner to complete the old-version stop /
recovery procedure. It never unlinks an old socket merely because connecting
failed, kills a PID, scans other Homes or resets user state.

Only a matching transition lease left by this implementation, whose recorded
owner is confirmed absent, can be reclaimed under the recovery lock. Uncertain
PID identity or permissions remain failures. A new Kernel crash still leaves its
normal canonical invocation manifest for the existing explicit recovery flow;
the compatibility lease does not acknowledge execution cleanup. Failed cleanup
keeps both endpoint leases, blocking replacement until ownership is resolved.
The Kernel also checks whether its own Unix socket remains after server close;
a successful close callback alone does not establish pathname cleanup. It does
not issue another pathname delete that could remove a replacement file.

At the canonical address, a stale socket is recoverable only with a matching
Kernel owner record and a confirmed absent PID. An unowned socket or unknown
record stays in place. The socket/owner filenames are also reserved CLI profile
names; existing collisions fail explicitly and are not renamed or removed.

## Address budgets

The direct filename removes 21 UTF-8 bytes from the former Kernel pathname.
POSIX IPC budgets apply to the **entire encoded endpoint** (Node pathname socket
limits: 103 bytes on macOS, 107 on Linux), separately from filesystem limits for
owner/recovery/state filenames. Extra control endpoints keep their own budgets;
a Home valid for Kernel alone may be too long for a particular Extra control
address. Windows named-pipe budgets are separate from filesystem paths and do not
impose a blanket 260-character Home limit. An over-limit explicit Home/address
fails; it is never relocated to `/tmp`, a parent or a different Home.

See [Node IPC documentation](https://github.com/nodejs/node/blob/v24.22.2/doc/api/net.md#ipc-support).
Cross-platform validation evidence and remaining integration work are recorded in
the repository's Issue 303 task; platform calculations do not establish actual
Unix bind behavior.
