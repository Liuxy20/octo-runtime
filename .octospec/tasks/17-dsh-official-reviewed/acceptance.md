---
type: Acceptance
title: Official DSH Client review and live qualification
timestamp: 2026-10-25T02:15:00Z
---

# Scope and Review

Replacement PR #176 follows withdrawal #175 and supersedes closed #174. Withdrawal #175 merged into main as `a35aeae3a3b5708449bb6ebd77a9094cff705e33` on 2026-10-25. It removes DSH while preserving generic diagnostics and the Windows verification budget requested by review. PR #176 was rebased onto that commit and retargeted to main. Before this baseline-documentation update, its entire tree matched reviewed head `55bab98649a4770cf589f9cb58edb9bee411989e` exactly. A merged #173 cannot be withdrawn by editing its GitHub metadata.

The runtime implementation reviewed and exercised below is `f7a69a800b3a94cbf100f12ddd5ad9ef5c9873cc`. Rebase onto the updated withdrawal produced identical production sources: the only subsequent code differences are two non-DSH logging regressions and stronger offline-release verification. The SDK remains the actual official `HarnessClient@0.2.1-rc.3` with two disclosed downstream safety patches; no custom Client or sink is substituted.

Verified-review plus independent Standards and Spec reviews reproduced and repaired these findings:

- Raw oversized initialize responses previously succeeded; the patched official reader rejects them before decoding/parsing with `PROVIDER_MESSAGE_TOO_LARGE`.
- A tool ignoring SIGTERM survived after its parent exited and the old adapter reported a terminal. The existing Adapter SDK process-group cleanup now confirms its death before the terminal.
- Official Client stderr and pre-filter lineage were unbounded. Diagnostic suffix/aggregate limits and a 128-relationship limit now bound those paths and fail closed.
- Version-probe IO and nonzero-exit diagnostics lost their original evidence. Native errno/exit/signal and primary-plus-cleanup errors are now preserved safely.
- Packaging no longer assumes a fixed upstream entry filename. Distributed patches and full upstream MIT licenses are checked, and the installed adapter is tested against the raw-response and orphan regressions.

Final source re-reviews found no remaining actionable findings. This is local review evidence, separate from GitHub approvals and protected-branch checks.

# Automated Checks

On `f7a69a8`, `pnpm build`, `pnpm lint`, `pnpm lint:names`, `pnpm format:check`, `pnpm docs:check`, TypeScript no-emit and `git diff --check` passed. `pnpm test:suites` passed 1,746 Node tests, skipped 40, failed zero; 35 UI tests passed. The targeted DSH and official Protocol/Client boundary suite passed 39 tests with zero skips.

The updated withdrawal independently passed build and the same static checks, 65 targeted tests and its complete suites: 1,709 Node passes, 40 skips, zero failures; 35 UI passes. Its new tests cover persisted safe process facts, rejection of bodies/invalid numbers and the actual Core-to-Adapter log chain.

The raw-response/orphan before-and-after probe ran against the preserved old official-client branch and the corrected branch. It cleaned its own subprocesses in all outcomes. Native Windows process-tree tests are not inferred from POSIX results.

# Real Desktop and IM

`node scripts/verify-dsh-live.mjs` passed against the installed macOS DeepSeek Harness Desktop CLI `0.2.1-rc.3`: new session, explicit resume with a remembered marker, actual file write/read, missing-session rejection, provider failure, cancellation with an independent successful sibling and recovery. Shutdown reported complete with no errors or pending resources. This run used the pre-retention-fix implementation; the final browser run below exercised `f7a69a8`.

SDK-hosted and CLI-hosted group runs used the real im-test service and existing QA accounts:

```sh
OCTO_CHANNEL_QA_ACCOUNTS=<local-account-file> node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm
OCTO_CHANNEL_QA_ACCOUNTS=<local-account-file> node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm --cli
```

Both passed group mention admission, denial without mention, same-session continuation, actual tool events, terminal/same-message card acknowledgement, failure card, drain, restart and sibling/kernel preservation. Drain took 244 ms and 166 ms respectively. These were backend acknowledgement/readback checks, rather than visual browser claims. The Bot-to-Bot DM case was explicitly skipped because those peers are not friends; no friendship was created.

On `f7a69a8`, a separate actual Chrome DOM run used the already logged-in human account and existing `orbtex-codex` friendship. Messages were entered in the real conversation composer, not injected through the messaging API:

1. First reply was exactly `DSH_OFFICIAL_V2_f7a69a8`.
2. A subsequent prompt omitted that marker and still returned it exactly, proving continuation.
3. Real `write` and `read` tools created and read the private working-directory file. The expanded card showed both completed; an independent filesystem read confirmed its exact content. Final answer: `DSH_BROWSER_TOOL_OK`.
4. A missing-executable fault displayed a failed card and reply with `OH-ADP-3002`, stable reason `DSH_EXECUTABLE_NOT_FOUND` and a diagnostic ID.
5. Restoring the real configuration returned exactly `DSH_BROWSER_RECOVERY_f7a69a8`.

After all five messages the Gateway had zero working/queued tasks. Gateway and Kernel shutdown both reported `complete: true`, empty errors and empty pending resources. Their private temporary working directory was removed. Browser login was preserved. DOM evidence was observed; attempted OS screenshots exposed only wallpaper, so no screenshot is counted as visual proof. Browser cancellation was not exercised in this final run; cancellation evidence comes from the live Kernel and automated tests.

# Offline Release and Remaining Conditions

An empty-cache offline npm installation of the clean `f7a69a8` archive passed public SDK/type/component examples, CLI, native Kernel, independent Extra, status, uninstall-preserved-home and the strengthened installed-DSH checks. The verifier checked the archive's full expected commit and `dirty: false`; both patches matched the tracked source, three oversized raw-input variants failed with the expected reason and the POSIX orphan was gone before its terminal. Final delivery archive identity and hosted CI are recorded in the PR rather than inferred from this earlier archive.

Native Windows DSH and cleanup after its leader exits remain unqualified under #14. Interactive approval, unsupported actmodes and live per-token notifications remain outside the upstream capability contract. Withdrawal #175 has merged; #176 still requires its normal main-target GitHub approvals/checks. Earlier checks against the stacked base are historical evidence and do not substitute for those checks.

# Main-Target Review Follow-up

Review baseline: `0608ccc2522bcbd1dc5f277da089602ddb60e2e9`, with fixes exercised in its working tree on Darwin arm64 and Node `v24.19.0`. Verified-review was applied serially to the review delta, including each changed source, test, documentation and release-verifier path; unchanged implementation and downstream patches retain the earlier review evidence above. The generated dependency lock was excluded from line review.

- Replaced the hardcoded nested official Client filename with package-name resolution from the adapter dependency scope. Internal trajectory tests retain the repository's built-artifact convention; `pnpm test` cleans/builds current sources before execution, and CI builds through `pnpm typecheck` before `pnpm test:suites`. The README now states that standalone test commands require a build.
- Reproduced the admitted-call error boundary: unsupported actmode/sandbox produced a failed run but left Core shutdown cleanup incomplete. DSH preflight now yields one safe failure terminal before acquiring a session; duplicate rejection cannot release the active owner's session. Direct and public Core tests cover the failure reasons, owner cancellation and subsequent session reuse.
- Reproduced six related launch-validation paths reporting `DSH_EXECUTION_FAILED` instead of configuration failure. Typed local errors now preserve `DSH_CONFIG_INVALID` without parsing arbitrary native error text. All six tests failed before the launch fix and passed afterward, including same-session recovery and complete shutdown.
- Preserved and documented the shared contract rejection boundary: Core rejects ask/assisted before admission, while direct Adapter calls reject those modes during iteration. Shared permission tests and new Core tests prove those paths launch no protocol and leave shutdown complete. The Adapter SDK interface documents contract throws separately from expected execution failure terminals.
- The final no-terminal fallback also yields a structured failure after confirmed cleanup. Offline release verification now exercises the installed public Adapter's actmode, sandbox and timeout validation in addition to raw-input/orphan checks.

After the runtime fixes, `pnpm test` passed 1,764 Node tests with 40 skips and zero failures, plus 35 UI tests. Strict TypeScript, lint, naming, formatting, documentation checks and diff checks passed. Sixteen new regression cases passed; after extending the release verifier, its 20 existing release tests passed independently. No additional medium-or-higher source findings remained after the serial follow-up review and false-positive filtering.

The actual local Desktop verification was repeated after these runtime fixes: new/resumed sessions, remembered marker, actual tool file effect, missing-session rejection, provider failure, cancellation with a successful independent sibling, and recovery all passed. Kernel shutdown reported `complete: true`, empty errors and empty pending resources. This is current Desktop evidence; the earlier browser/IM evidence is historical and was not rerun for the preflight fixes. Clean archive identity and current-head CI/re-review results are recorded in the PR after commit.

# P2 Follow-up and Provider Compatibility

Validation baseline: `ebe0c945cbbff6efcec9797f1ccbcfa5b58ac187`, dirty working tree on Darwin arm64 / Node `v24.19.0`. The owner confirmed Node 22 is unsupported; the prior documentation commit explicitly requires Node 24/26 for consumers and records the retained experimental execve dependency. These changes were implemented and validated locally while commits were paused. The owner subsequently authorized committing and updating the current branch after the documentation was clarified.

- **Native sequence continuity, suggestion declined:** upstream's current sequential numbering does not establish a requirement for the Adapter to reject forward jumps. The owner rejected this additional failure condition, so the local hard-gap check and its new error code were removed. Native `seq` remains a per-session deduplication input; completion still requires receipt, turn, committed-answer, wait and cleanup evidence. Core assigns HostFrame sequences independently. Four regressions cover nonzero offsets, forward jumps, interleaved parent/child sessions and successful Adapter/Core completion with cleanup; the Core case also checks contiguous HostFrame sequences. Fixture sequences were corrected to be per session, matching upstream. The installed public Adapter verifier also accepts a native sequence jump.
- **Pre-parse budget, verified and strengthened:** a new official Protocol test directly proves oversized data triggers no `JSON.parse` call. Frozen pnpm installation applies the pinned patches; all platform CI release verifiers use the common offline verifier. That verifier checks exact shipped patch bytes and executes the installed public Adapter against oversized responses, fragmented frames and unterminated lines. At that baseline, the callback retained an additional post-parse object check; the later follow-up below removes its incorrect reuse of the raw-input budget.
- **Threshold literals, addressed:** named constants now cover version-probe timeout/output budget, launch-argument/string/integer bounds and process exit grace. Version probes and the official Client's managed cleanup use the same grace constant; all numerical budgets retain their prior values.
- **Dependency weight, assessed:** the official Client declares the same-version Provider as a regular dependency, so its development lock graph is large. The default CLI includes DSH; changing the adapter installation model is outside this fix. Existing bundling excludes Provider implementation, and offline verification confirms the consumer package declares neither official Provider nor Client npm dependencies. The README distinguishes source-install cost from consumer distribution cost; no manual lockfile pruning was performed.
- **Live verification, retained as manual qualification:** the real Desktop verification requires a locally installed, configured Provider. It is not part of the ordinary CI gate; local Desktop evidence and CI fixture evidence remain separate.
- **Gate-diff inventory, review-tool suggestion:** an earlier reviewer reported unmatched rule patterns in its automatic change inventory. The scanner implementation was not found in this repository and the report was not independently reproduced. This is not established as a runtime defect or a failed CI gate. No scanner changes are included in this follow-up; the owner accepted this disposition.

Before removing the local hard-gap check, all four corrected regressions failed under `node --test --test-name-pattern='forward sequence jumps|sequence tracking|native sequence jumps' test/dsh-adapter.test.js`. These failures demonstrate the overstrict local change, not a defect in the original forward-jump behavior. After removal, all four passed. The README and task brief explicitly record the Provider compatibility boundary and distinguish native sequence jumps from missing completion evidence.

Corrected working-tree validation before commit: `pnpm test` passed 1,769 Node tests with 40 skips and zero failures, plus 35 UI tests. Strict TypeScript, lint, documentation checks, formatting of changed code and diff checks passed. `node scripts/pack-release.mjs` and `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit ebe0c945cbbff6efcec9797f1ccbcfa5b58ac187` passed, including the installed public Adapter's native-sequence-jump case, raw-input budget regressions and offline SDK/CLI checks. Serial review found no remaining medium-or-higher findings in this follow-up.

The preceding iteration passed real Desktop/KernelClient qualification: new/resumed session memory, actual tool file effect, missing-session and provider failures, cancellation with an independent successful sibling, recovery and complete shutdown with no errors/pending resources. Its offline archive verification also passed. Those runs preceded removal of the local hard-gap check and are historical evidence for this follow-up. The archives verified while commits were paused record `dirty: true` against the baseline above; they provide local working-tree evidence, not a clean release artifact or hosted validation of these changes. Native Windows DSH qualification remains outstanding as previously documented.

# Review Follow-up: Raw Budget and Lifecycle Evidence

Reviewed baseline: `65998d452751ddada67170553407ef2b55555ebb`, Darwin arm64 / Node `v24.19.0`. The owner requested fixes for confirmed defects and an English PR comment explaining false positives in review `5642363240`.

- **Callback serialization, reproduced and fixed:** a valid 566-byte notification (including CR) with scientific-notation values is accepted by the Protocol's 1024-byte raw limit, but JSON.stringify of the parsed notification produces 2249 bytes. Before the fix, both direct Adapter and public Core incorrectly failed with PROVIDER_MESSAGE_TOO_LARGE. The callback-wide size serialization is removed; the patched Protocol still enforces raw bytes before decode/parse, and DriverQueue still enforces independent projected-event and queue budgets. Adapter, Core, Protocol and installed-package verification cover this distinction.
- **Launch argument length, bounded configuration hardening:** a 512 KiB argument previously reached the version probe and returned DSH_START_FAILED. Explicit args now reject values above 4096 UTF-8 bytes before starting that probe, returning DSH_CONFIG_INVALID; a 4098-byte multibyte case proves the bound is not a character count. Supported explicit launches already permit at most one Node module argument, so supported aggregate args are also bounded by 4096 bytes. Invalid configuration must not retain the session; regressions also verify successful reuse and complete Core shutdown.
- **Repeated producer await, P0 not substantiated:** the producer's existing internal try/catch records the primary failure and closes the queue. Both awaits wait on the same task; the finally wait also covers cancellation and consumer early exit. Existing tests preserve the primary error together with cleanup failure and verify session recovery. A baseline probe exercised provider failure, transport exit, missing terminal, later reuse and combined cleanup failure without an unhandled rejection. No producer lifecycle rewrite was made merely to remove the second await.
- **Single pending subscription read, P0 not substantiated:** the pinned official SDK invokes the filter for each notification and resolves next only for matching notifications. The Adapter projects synchronously and always returns false. A new test observes all 15 fixture notifications, no queued notification and an unsettled next; actual Client close then rejects that read with TransportClosedError. The existing immediate subscription-close test remains. No second drain loop or replacement client was introduced.
- **Directory equivalence, documented and tested:** realpath equality accepts a symlink alias and, on this local case-insensitive volume, the same directory under different casing. A different child directory is deliberately rejected before prompt. The case test skips on case-sensitive volumes rather than asserting filesystem behavior they do not provide. This does not establish native Windows DSH qualification, and no root-containment fallback was added.

Before/after regression command: `node --test --test-name-pattern='normalized numbers grow|oversized arg|oversized UTF-8 arg|raw bytes rather|false-filter subscription|resume directory comparison' test/dsh-adapter.test.js test/dsh-sdk-boundaries.test.js`. Against the baseline implementation, four failed and five controls passed; after the fixes all nine passed with no skips on this host. Fresh build followed by `pnpm test:suites` passed 1778 Node tests, 40 skips and zero failures, plus 35 UI tests. Strict TypeScript, lint, naming, formatting, documentation and diff checks passed. Serial review found no remaining medium-or-higher source findings in this follow-up. Clean archive verification and hosted checks are separate observations recorded in the PR response; prior live Desktop/IM/browser evidence is not represented as a rerun for this change.
