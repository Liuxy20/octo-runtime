## Summary

Describe the problem and the resulting behavior.

## Related Work

Link the actual issue or `.octospec/tasks/<slug>/brief.md`. Explain the basis for
changes to architecture or shared contracts.

## Validation

List checks actually performed, integration environments and evidence. Identify
checks not performed. Never include credentials.

Report fake-Provider/CI results separately from **Non-gating live acceptance**.
For affected adapter behavior, the change author records the operator, source SHA/dirty
state, native version, platform, command, scenario outcomes, cleanup and limitations.
Mark unavailable live checks blocked or not run; real Provider/IM access is not a
required CI gate. See the [live acceptance guide](../.octospec/guides/provider-live-acceptance.md).

## Architecture and Critical Paths

For architecture, shared contracts or P0 changes, answer the following questions.
Remove this section for simple documentation, formatting or configuration changes.

1. What changes in the critical execution path?
2. Which callers are affected, and what happens on failure?
3. Which tests, reproduction steps or runtime evidence validate the change?
