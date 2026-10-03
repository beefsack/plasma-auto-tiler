# Windows reference-WM comparison

Status: complete, 2026-10-04. Research published as `2b0540c` with hosted CI green.

## Goal and scope

- Deliver a concise source-backed comparison of GlazeWM and komorebi, with
  Seelen UI and Whim where useful, against the current Windows implementation.
- Cover hiding, admission, minimum sizes, input and shell shortcut containment,
  recovery, monitors/DPI, gaming, focus, latency, borders, drag/drop and indicators.
- Research/documentation only. No product changes or live desktop experiments.

## Acceptance

- Each area states verified implementation facts with pinned commit and
  file:line evidence, our behavior, gap/risk and adopt/keep/investigate advice.
- Separate inference and runtime unknowns; prominently report whether any
  official-API Win+G/Win+F11 suppression solution is established.
- Provide prioritized, roughly sized follow-ups without changing backlog or
  principles. Preserve KDE parity and the parked containment status.
- ASCII-only changed documents, valid local links, clean whitespace; commit,
  push and verify hosted CI. Archive this record at completion.

## Bounded units

1. Inspect our implementation and GlazeWM; collect pinned evidence across areas.
2. Inspect komorebi, Seelen UI and Whim; targeted official input API research.
3. Synthesize the research document and recommendations from accepted evidence.
4. Lead review, documentation gates, archive, commit/push and hosted CI.

## Outcome and accepted evidence

- Delivered [the comparison](../../research/windows-port/reference-wm-comparison.md)
  with pinned source, twelve decision areas and sized follow-ups. Linked it from
  [the prior-art catalogue](../../research/prior-art.md).
- Keep public SW_HIDE, identity-bound recovery, declared minimum hints and
  KDE-parity overlay geometry. Reference private ApplicationView cloaking is
  not a supported public desktop API alternative.
- Whim's LayoutPreview provides the useful parity-8 overlay precedent;
  komorebi-bar, Zebar bundled starters and Seelen viewer provide concrete
  workspace presentation evidence for parity 10.
- No working official desktop-API Win+G/Win+F11 suppression established.
  whkd also resolves to an LL hook, not RegisterHotKey. Seelen's E8 masking
  is Start-menu hygiene. Keyboard Filter excludes the selected Windows Pro.
  Parked containment and documented-API product constraints remain unchanged.
- Source review rejected incorrect draft negatives (Whim preview, komorebi
  eligibility floors), stale single-display conclusions from legacy constants,
  and claims of absent Zebar starter markup. Final evidence distinguishes
  source implementation, upstream comments and untested runtime behavior.
- No new product decisions; no decisions.md promotion required. No product
  code, backlog or principles edits; no reference-clone writes or live tests.

## Verification outcome

- Native locked build/tests for tiler-core, tiler-protocol,
  tiler-kwin-effect-ffi and tiler-windows; all-package format and strict
  all-target Clippy passed with installed stable Rust 1.98.1,
  x86_64-pc-windows-msvc. `mise` was unavailable; explicit `cargo +stable`
  used the existing approved toolchain without installing dependencies.
- Documentation gate checks ASCII, local links, whitespace, reference-clone
  pins and cited source-path/line-range existence. Lead reviewed the final diff.
- No test actors, input hooks, overlays or desktop mutations were launched by
  this research change. All four sequential research/documentation units ended.
- Hosted [CI run 37134290598](https://github.com/beefsack/plasma-auto-tiler/actions/runs/37134290598)
  passed all five jobs (Rust, KWin, shell, Windows, macOS) for `2b0540c`.
  The evidence-only record commit is also gated by hosted CI after push.

## Verification and decisions

- Reference clones are read-only; do not fetch, checkout or repair them.
- Source inspection is not physical acceptance, latency measurement or proof of
  anti-cheat compatibility. No product decisions are introduced by this survey.
- Initial repository tree clean at `a20e8e8`.
