# Plan — race start light in the HUD

**Date:** 2026-11-05 · **Status:** done

## Goal
The race start light (German *Ampel*: red → red + amber → green) moves from a
3D pole beside the road into the head-up display, and looks elegant.

## Decisions
- **Pure HTML/CSS overlay** (`#startLight` in `index.html`): a dark, blurred
  capsule centred at the top with three glowing lamps (red, amber, green) and a
  big countdown digit (3 · 2 · 1 · LOS!). CSS draws lamps, glow and fade.
  JS only sets `data-light` and the digit text, so the cost is a few hundred bytes.
- Driven by the existing pure `ampelState(serverNow, goAt)`; no change to the
  shared-clock logic, so every client still turns green at the same moment.
- Visible during the countdown and for 1.5 s after green, then fades out.
- The 3D light (`buildScenery()` in `main.js`) and `track.ampel` (its position)
  are removed. The status chip keeps saying "Ampel" but no longer counts; the
  HUD light does that now.

## Side fix
Merge `c155a50` dropped the `<div id="lobby" …>` opening tag from
`index.html`, which crashed `?online` on load. Restored.
