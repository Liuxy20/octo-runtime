# Maintenance and Validation

[简体中文](../zh-CN/maintenance.md) | [Documentation](README.md)

## Scope and Baseline

This page is for documentation maintainers. It records the source version, roles of existing documents, and validation methods. The library describes revision `d44f5cd42694b5f8cb7c8c18daa65eff0265ba8e`, reviewed on 2026-10-21. Architecture explanations use the root architecture and integration documents; API fields are checked against source and schemas.

English and Chinese use matching paths under `docs/en` and `docs/zh-CN`. Language links open the same topic. Executable examples are shared in `docs/examples`. The library uses repository Markdown without a documentation website. Octospec remains for development-process records.

## Existing-Document Map

| Existing entry                                                                            | Purpose                                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Root [README](../../README.md), [INTEGRATION](../../INTEGRATION.md)                       | Project overview and integration selection; detailed APIs link here.                                  |
| [ARCHITECTURE](../../ARCHITECTURE.md)                                                     | Design background, historical comparison, and future goals; current module APIs are covered here.     |
| [SDK Gateway guide](../../SDK_CHANNEL_GATEWAY_GUIDE.md)                                   | Retains Chinese IM configuration and storage implementations; common Extra lifecycle is covered here. |
| [CLI operations](getting-started/cli.md), [deployments](../../DEPLOYMENTS.md), CLI README | Service operations and distribution steps.                                                            |
| Package READMEs                                                                           | Package implementation and contribution details; application integration APIs are covered here.       |
| `release/README.md`                                                                       | Removed; packaging uses the root README. Temporary CI download directories are unaffected.            |
| Octospec                                                                                  | Development context and process records, not required for SDK integration.                            |

Repository links point to the consolidated pages listed above; the superseded root CLI and native SDK guides have been removed. Common SDK integration content is available in both languages. Business-specific guides retain their original language for now; add translations when updating those guides.

## Update Rules

When an API or behavior changes, update both languages, shared examples, diagrams, source revision, and validation results. Keep API names untranslated. Adding or removing a Context type also requires updating the type reference and `contexts.json` example.

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
| Mermaid                                                        | Bilingual architecture, supervision, inputs, IPC recovery, MCP, and Extra lifecycle diagrams; separately rendered for verification                          |
| Real Providers, MCP tool calls, IM, Electron, native Windows   | Not run for this delivery; require integration tests in those environments.                                                                                 |
| Harness installation, Computer Use, account credits            | Source commands and official vendor documentation checked on 2026-10-21; no provider installation, login, billed call, or desktop tool execution performed. |

On 2026-10-21, the build, documentation checks (16 paired pages, 14 JSON examples, all 12 built-in Context examples, and four tests), focused MCP/IPC tests (seven tests), and tgz packaging/installation verification passed on macOS. All 16 diagrams rendered successfully with Mermaid CLI 12.0.0 and local Chrome. After adding CLI and Harness setup, documentation checks passed again and the built CLI help was checked against the documented commands; the diagrams and runtime code were unchanged.

On 2026-10-22, the Issue #101 implementation branch, based on `102fb9caf995d9eb1ac53acaf5b91922be4f023d`, updated both languages for Gateway instruction composition (application entries before channel defaults), Bot mentions, self-message rejection, per-turn reminders, and model-directed compaction retention. These scoped updates extend the baseline above without changing the public Context schema or merge rules. Gateway build and 90 related tests passed after the ordering adjustment; live two-Bot delivery was not tested. Compaction retention is delegated to the model by design and is outside the validation scope.
