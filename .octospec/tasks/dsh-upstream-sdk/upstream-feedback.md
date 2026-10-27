---
type: Task
title: DSH SDK 上游反馈
description: 记录向 DSH 上游提交的进程生命周期与资源限制能力反馈。
tags: [adapter, dsh, sdk, upstream]
timestamp: 2026-10-26T00:00:00Z
---

## Request

Could the TypeScript SDK expose supported process-lifecycle ownership and configurable resource limits, so embedding applications can use the official SDK without downstream patches?

I maintain [octo-runtime](https://github.com/Mininglamp-OSS/octo-runtime), an open-source, provider-neutral agent runtime. Our DSH adapter uses the official `HarnessClient` to run an installed DeepSeek Harness, map its events into our common execution protocol, resume sessions, and handle cancellation. Each invocation owns one client; other invocations and the Desktop application must remain independent.

We integrated `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` and `@deepseek-ai/dsh-sdk-protocol@0.2.1-rc.3` in [octo-runtime PR #176](https://github.com/Mininglamp-OSS/octo-runtime/pull/176). Two version-pinned downstream patches let that integration meet our original cleanup and memory-budget goals. We want to stop maintaining those patches and keep using the unmodified official SDK, accepting its current limitations until upstream support is available.

## 1. Invocation-owned process cleanup

Our goal is for cancellation, timeout, or failure to stop the invocation's runtime and its owned tool processes before we report cleanup complete. A runtime leader exiting does not prove its descendants have stopped.

The published SDK owns `spawn()` and disposal internally. Its public launch options do not let the embedding application establish a process group and register its existing cleanup implementation. The disposal ladder confirms the direct child's exit, which does not establish that the owned process tree has exited.

Our [Client patch](https://github.com/Mininglamp-OSS/octo-runtime/blob/8af836068780ebb76581225254ad7bef18cc8170/patches/%40deepseek-ai__dsh-sdk-client%400.2.1-rc.3.patch) added optional `detached` and `createProcessCleanup(child)` hooks. On POSIX we capture a dedicated process group at spawn and confirm its disappearance after TERM/KILL, including when the leader exits first. We do not terminate the Desktop GUI or sibling invocations. This is process ownership, not a sandbox or a guarantee for descendants that deliberately leave that group.

A useful regression scenario is a fake SDK runtime that spawns a long-lived child ignoring SIGTERM and then exits before the host calls `close()`. Check whether that child is still writing a heartbeat after `close()` resolves. Our fixture and adapter regressions are linked below. We have exercised the process-group scenario on POSIX; we do not claim equivalent real Windows DSH acceptance.

An upstream-owned tree cleanup implementation or a supported spawn/cleanup extension would both work. We would welcome a documented contract for graceful shutdown, forced termination, cleanup failure, and platform-specific limitations rather than requiring these exact hook names.

## 2. Resource limits inside the SDK

Our goals were configurable limits at the point where the SDK itself retains data:

- **Raw protocol input:** bound each response/notification line, including fragmented UTF-8 and data with no newline, before decoding, string accumulation, and `JSON.parse`. Checking a parsed notification in an adapter is too late and misses initialize responses. Our [Protocol patch](https://github.com/Mininglamp-OSS/octo-runtime/blob/8af836068780ebb76581225254ad7bef18cc8170/patches/%40deepseek-ai__dsh-sdk-protocol%400.2.1-rc.3.patch) added a byte limit and an error callback wired through the Client. Overflow releases the retained prefix, rejects pending/future requests, and ends the affected invocation. Exact-limit input remains valid; raw bytes must not be confused with a reserialized object's length.
- **Diagnostics:** bound both an unfinished stderr line and total retained diagnostics; a line-count limit alone does not bound memory. Our Client patch kept a bounded suffix rather than retaining an arbitrarily large line.
- **Session relationships:** bound SDK-internal parent/child relationships, including notifications rejected by a subscription filter. Filtering adapter events should not leave a separate SDK table growing without limit.

For example, feed an initialize response larger than a configured budget, or send chunks that never contain LF. A transport-level limit should reject before parsing and retaining the full line. Another fixture emits a large stderr line without LF; a third emits many unrelated `subagent.started` relationships while the subscription filter returns false.

Related existing reports: [#1551 (JSON-RPC frame limits)](https://github.com/deepseek-ai/deepseek-harness/discussions/1551) and [#1566 (TypeScript stderr limits)](https://github.com/deepseek-ai/deepseek-harness/discussions/1566). This request adds our downstream integration context, process ownership requirement, and relationship-table boundary. We are happy for maintainers to track overlapping items in those discussions.

## Evidence and desired outcome

- [Adapter integration and cleanup regressions](https://github.com/Mininglamp-OSS/octo-runtime/blob/8af836068780ebb76581225254ad7bef18cc8170/test/dsh-adapter.test.js)
- [Fake runtime reproducing oversized responses, unterminated data, stderr, unrelated lineage, and leader exit](https://github.com/Mininglamp-OSS/octo-runtime/blob/8af836068780ebb76581225254ad7bef18cc8170/test/fixtures/dsh-runtime.mjs)
- [Focused Protocol/Client boundary tests for the patched implementation](https://github.com/Mininglamp-OSS/octo-runtime/blob/8af836068780ebb76581225254ad7bef18cc8170/test/dsh-sdk-boundaries.test.js)

These are deterministic fixture regressions and evidence of the downstream behavior, not claims that all failures occurred in normal Desktop use or that the published SDK already supports the added options. Our published-package baseline is `0.2.1-rc.3`; this is not a claim that every newer upstream version has identical behavior. I also inspected the public options, disposal, and transport at upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` when preparing this report.

The desired outcome is to consume a regular upstream release with documented lifecycle/resource contracts, retire all downstream modifications, and retain the official RPC implementation. Please let us know whether an existing supported API or recommended integration pattern already covers these requirements.


## Published reference implementation

The [published upstream discussion #11031](https://github.com/deepseek-ai/deepseek-harness/discussions/11031) additionally includes both complete historical patches in expandable diff blocks, the four optional Client inputs, and the shared process-cleanup call site. The posted diffs were read back through the GitHub API and verified to match the original tracked patches at `8af8360` exactly.

This local record links to that public reference rather than preserving another copy of the removed SDK patches. The upstream post retains the complete implementation for maintainers and community contributors.
