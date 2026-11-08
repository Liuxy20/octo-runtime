# Maintenance and Validation

[简体中文](../zh-CN/maintenance.md) | [Documentation](README.md)

The [startup diagnostic catalog](guides/startup-diagnostics.md) is generated from the shared catalog. After changing its definitions or recovery guidance, explicitly run `node test/manual/generate-startup-catalog.mjs` and `node --test test/manual/startup-diagnostics.test.js` after the build. These manual checks do not extend default tests or CI.

## Scope and Baseline

This page is for documentation maintainers. It records the roles of existing documents and validation methods. The initial library was reviewed against revision `d44f5cd42694b5f8cb7c8c18daa65eff0265ba8e` on 2026-10-21. That is the initial validation baseline, not a claim that all later pages describe only that revision. Architecture explanations use the root architecture and integration documents; API fields are checked against source and schemas.

English and Chinese use matching paths under `docs/en` and `docs/zh-CN`. Language links open the same topic. Executable examples are shared in `docs/examples`. The library uses repository Markdown without a documentation website. Octospec remains for development-process records.

## Existing-Document Map

| Existing entry                                                                            | Purpose                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Root [README](../../README.md), [INTEGRATION](../../INTEGRATION.md)                       | Project overview and integration selection; detailed APIs link here.                                  |
| [ARCHITECTURE](../../ARCHITECTURE.md)                                                     | Design background, historical comparison, and future goals; current module APIs are covered here.     |
| [SDK Gateway guide](../../SDK_CHANNEL_GATEWAY_GUIDE.md)                                   | Migration entry pointing to the independent Gateway repository, which owns channel SDK/CLI documentation. |
| [CLI operations](getting-started/cli.md), [deployments](../../DEPLOYMENTS.md), CLI README | Service operations and distribution steps.                                                            |
| Package READMEs                                                                           | Package implementation and contribution details; application integration APIs are covered here.       |
| `release/README.md`                                                                       | Removed; packaging uses the root README. Temporary CI download directories are unaffected.            |
| Octospec                                                                                  | Development context and process records, not required for SDK integration.                            |

Repository links point to the consolidated pages listed above; the superseded root CLI and native SDK guides have been removed. Common SDK integration content is available in both languages. Business-specific guides retain their original language for now; add translations when updating those guides.

## Update Rules

When an API or behavior changes, update both languages and affected shared examples and diagrams. Record the reviewed source revision and actual validation scope for that change; retain earlier results with their original dates and versions. A focused update does not require relabeling the whole library with a new baseline. Keep API names untranslated. Adding or removing a Context type also requires updating the type reference and `contexts.json` example.

Run `pnpm build`, then `pnpm docs:check`. Checks cover local links, matching language pages and code examples, JSON structure, complete built-in Context examples, and `.mts` example types. Local Kernel calls with a test Adapter also check service shutdown, interactions, cancellation, and image validation.

`docs:check` checks only Mermaid block type and count. After changing a diagram, use a Mermaid renderer to validate its syntax and inspect its layout.

For package validation, `scripts/verify-release.mjs` copies shared examples into a separate project, installs the generated tgz there, checks public API types, and runs a test Adapter invocation. It also checks that the packaged README matches the root README. This validates a local package without publishing to npm.

## Validation Boundaries

| Check                                                          | Evidence / limit                                                                                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build, examples, JSON/catalog/links/languages                  | Deterministic repository checks after build                                                                                                                 |
| Service/invocation, interaction, cancellation, image integrity | Test Adapter over real local Kernel IPC, without calling a model.                                                                                           |
| Public tgz consumer                                            | Existing pack/verify plus shared examples, offline installation                                                                                             |
| MCP preparation/mapping                                        | Existing focused `test/context-mcp.test.js`; endpoints use `example.com`                                                                                    |
| Mermaid                                                        | Current architecture, inputs, IPC recovery, and MCP diagrams; diagram changes require separate rendering                          |
| Real Providers, MCP tool calls, IM, Electron, native Windows   | Not run for this delivery; require integration tests in those environments.                                                                                 |
| Harness installation, Computer Use, account credits            | Source commands and official vendor documentation checked on 2026-10-21; no provider installation, login, billed call, or desktop tool execution performed. |

## Issue 328 Documentation Follow-up

On 2026-11-07, the uncommitted split worktree based on `bf9ff6b599b0e325362698acd3cebd9ac1363467` was checked on macOS with Node.js 26.13.0. Both language entries, Harness setup, session/Context guidance, IPC, output/control, Home, and diagnostics now describe the execution-only Runtime. Channel SDK/CLI and business policies link to the independent Gateway. Historical URLs remain migration entries.

`pnpm run docs:check` passed: 36 paired pages, 73 Markdown files, 12 JSON examples, 8 unchanged Mermaid blocks, all 12 built-in Context examples, and four local execution tests. Existing-document links and anchors were also audited, including engineering rules. No live Provider or IM verification was run for this documentation update.

## Historical Validation

The dated results below describe their original revisions. References to Extra, Gateway loaders, workers, and removed packages are historical evidence, not the current integration contract. Current boundaries follow [Issue 328](../../.octospec/tasks/328-remove-extra/validation.md).

On 2026-10-21, the build, documentation checks (16 paired pages, 14 JSON examples, all 12 built-in Context examples, and four tests), focused MCP/IPC tests (seven tests), and tgz packaging/installation verification passed on macOS. All 16 diagrams rendered successfully with Mermaid CLI 12.0.0 and local Chrome. After adding CLI and Harness setup, documentation checks passed again and the built CLI help was checked against the documented commands; the diagrams and runtime code were unchanged.

On 2026-10-22, the Issue #101 implementation branch, based on `102fb9caf995d9eb1ac53acaf5b91922be4f023d`, updated both languages for Gateway instruction composition (application entries before channel defaults), Bot mentions, self-message rejection, per-turn reminders, and model-directed compaction retention. These scoped updates extend the baseline above without changing the public Context schema or merge rules. Gateway build and 90 related tests passed after the ordering adjustment; live two-Bot delivery was not tested. Compaction retention is delegated to the model by design and is outside the validation scope.

On 2026-11-01, the onboarding revision was checked against `49f9b11f58c13a65cc62e74d2c4751cac99a3707` with uncommitted documentation and example changes, on macOS arm64 with Node.js 24.22.2. The scope was the documentation entry, CLI/SDK onboarding, Extras, Harness prerequisites, troubleshooting, this page, and two shared entry examples. Earlier validation records above remain tied to their original revisions.

`pnpm install --frozen-lockfile` (including its build), `pnpm docs:check`, and `node scripts/check-developer-docs.mjs --scope current` passed. `node scripts/pack-release.mjs` and `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` passed the existing offline package, public-type, Kernel and independent Extra checks. The local `0.0.0` artifact was not published.

A separate temporary npm consumer compiled the actual shared examples, executed the compiled DSH worker with closed stdin, and ran `attach.mts` against a test Adapter: it printed the reply, and Kernel remained usable after the client closed. The new DSH host entry completed a real local Kernel invocation with a substitute test Adapter, not a DSH Provider. Both Gateway loaders returned valid current Context, observed changed data, and handled cancellation; complete Gateway construction was checked without initializing an IM connection. The CLI page's actual request passed Protocol validation and completed through the packaged `playboard` with fake Codex; its temporary Kernel directory was removed. These are fixture checks, not real model or IM acceptance.

No diagrams, Runtime code, default test commands, or GitHub CI scope changed. Real Provider initialization/model turns, live IM, external MCP, Electron, and native Windows were not run in this revision; [Windows acceptance #14](https://github.com/Mininglamp-OSS/octo-runtime/issues/14) remains separate.

Before PR submission on 2026-11-01, the same documentation changes were rebased onto `4a0f53b50723422d90f051944ae19eb28f60712a`. Build, formatting, documentation checks, current-link audit, package verification (with that expected source commit), and the separate npm-consumer checks above passed again on the same platform. These results cover that source baseline plus the documentation changes prepared for commit; the live-acceptance limitations remain unchanged.
