# ADR 0003 — An enforced size budget

**Status:** accepted · **Date:** 2026-11-04

## Context
"Kilobytes, not megabytes" is the core constraint of the project. Unenforced budgets erode one commit at a time.

## Decision
`tools/size-check.mjs` measures the shipped files (`index.html` + `src/**`) concatenated, raw and gzip level 9, and fails above **96 KB raw / 32 KB gzip**. It runs as `npm run size` and is part of `npm run check`.

The MVP uses ~52 KB raw / ~19 KB gzip, leaving ~40 % headroom for candidate features. Source is shipped unminified so candidates and reviewers can read it; comments count against the budget on purpose (it rewards concise code, not deleted documentation — the gzip limit is the one that matters).

## Consequences
- ✅ The constraint is objective and visible in CI or pre-commit.
- ✅ Discussions about bytes become concrete ("this feature costs 2.1 KB gzip").
- ❌ Raw size penalises comments; if this becomes a problem, add a minify step and budget the minified output instead.
