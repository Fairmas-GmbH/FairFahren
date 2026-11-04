# ADR 0003 — An enforced size budget

**Status:** accepted · **Date:** 2026-11-04

## Context
"Kilobytes, not megabytes" is the core constraint of the project. Unenforced budgets erode one commit at a time.

## Decision
`tools/size-check.mjs` measures the shipped files (`index.html` + `src/**`) concatenated, raw and gzip level 9, and fails above **128 KB raw / 40 KB gzip**. It runs as `npm run size` and is part of `npm run check`.

The base game uses ~69 KB raw / ~25 KB gzip, leaving ~15 KB gzip of headroom for candidate features.

*Revision (2026-11-04):* the budget was 96 KB / 32 KB for the first MVP (~52 KB / ~19 KB). The sensor view and traffic signs added ~6 KB gzip, which would have left candidates only ~7 KB. The budget was raised to keep roughly the same headroom; it is still "kilobytes, not megabytes". Source is shipped unminified so candidates and reviewers can read it; comments count against the budget on purpose (it rewards concise code, not deleted documentation — the gzip limit is the one that matters).

## Consequences
- ✅ The constraint is objective and visible in CI or pre-commit.
- ✅ Discussions about bytes become concrete ("this feature costs 2.1 KB gzip").
- ❌ Raw size penalises comments; if this becomes a problem, add a minify step and budget the minified output instead.
