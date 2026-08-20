# Specification: COSMIC Evidence Mining (Research)

Ownership and approval:
- Owner: Lead
- Status: Pending user approval

## Intent and Desired Outcome

Mine previously-captured evidence of COSMIC (System76's Rust desktop, used as
this project's reference implementation) into durable, cited written
references that later implementation changes can consult. The evidence: 10
chronological screenshots of COSMIC's tiled-window border/layout, 2
screenshots of the tray icon and its menu, and one 59.25s/60fps/2560x1440
screen recording of directional window-move testing.

This is a RESEARCH change. It produces no production code and no behaviour
change. It establishes what COSMIC actually does; it does not decide what
this project adopts.

Four independent evidence streams:

- **A** - border/gap/spacing metrics from the 10 layout screenshots, measured
  programmatically in pixels.
- **B** - tray icon and menu design, read visually and documented for later
  close reproduction.
- **C** - directional window-movement semantics from the video: what COSMIC
  does when a move has no candidate window in the requested direction
  (split rotation, screen-edge behaviour, tree-depth dependence).
- **D** - file one new backlog entry for the Steam-GUI tiling-escape issue.

## Scope and Non-Goals

In scope:

- Programmatic pixel measurement of the 10 screenshots for Stream A.
- Visual documentation of the 2 tray screenshots for Stream B.
- Scene-change-driven, budget-capped frame extraction and interpretation of
  the video for Stream C.
- One new `docs/backlog.md` line for Stream D.
- Extending `docs/reference-wm-comparison.md` with observed COSMIC evidence
  (Streams A and C).
- Creating `docs/reference-cosmic-tray-menu.md` for Stream B.

Non-goals:

- No production code changes; no behaviour change to `kwin/` or the native
  effect.
- No decision on what gap value, border width, or movement rule this project
  adopts. Every adoption decision is a later implementation change.
- No live KWin/Plasma testing. The evidence is COSMIC-side (a different
  desktop, captured by the user on their own host), not a KWin mutation, so
  `docs/live-kwin-testing.md`'s protocol does not govern this change.
- No resolution of `docs/backlog.md` line 42's bspwm/Hyprland halves; only
  the COSMIC portion is discharged, and only partially (runtime behaviour
  observed via screenshots/video, not interactive verification).
- No fix or investigation of the Steam issue itself beyond filing it.

## Applicable Principles and Decisions

- `docs/reference-wm-comparison.md`'s existing `verified`/`unverified`
  evidence-labelling convention, extended with a third `observed` tier for
  this change's direct empirical evidence (see Consequential Decisions).
- `docs/backlog.md` line 42 (P3, paused): this change partially discharges
  the COSMIC half by observing actual runtime behaviour from user-captured
  evidence rather than source/docs alone.

## Constraints

- Tooling: `ffmpeg`, `ffprobe`, `python3` (stdlib only). No ImageMagick, no
  PIL/Pillow. No new `devenv.nix` dependency without escalating to the
  Orchestrator first.
- Image/frame-reading budget is a hard constraint, not a target:
  - Stream A's metrics come from programmatic pixel/byte analysis
    (ffmpeg crops/PPM output plus python3 stdlib parsing); the Worker never
    opens a screenshot with an image-reading tool.
  - Stream C's geometry/timeline pass (unit-C1) is likewise pure pixel
    analysis: zero direct image-tool reads.
  - Stream C's interpretive pass (unit-C2) is capped at 40 direct image
    reads of downscaled, cropped candidate frames.
  - Stream B reads exactly 2 images (the tray screenshots).
  - Committed ceiling for the whole change: at most 42 direct image reads.
- Workers write detailed findings and any raw pixel dumps to files; only
  curated summaries return to the Lead.
- Exactly one Worker active at a time (per `worker-anthropic`). No image or
  video frame is read by the Lead or Orchestrator directly in this change
  (see Consequential Decisions on Lead review method).

## Acceptance Criteria

- [ ] `docs/reference-wm-comparison.md` gains a cited COSMIC evidence entry
      for gap/border/corner metrics (Stream A): gap between windows, gap
      border-to-window, gap to screen edge, gap to panel, active border
      thickness, inactive border thickness, inactive border colour/treatment,
      active border colour, corner treatment (with explicit note that
      COSMIC's aggressive corner rounding is not adoptable here), and whether
      the numbers are consistent across all 10 screenshots or vary.
- [ ] `docs/reference-wm-comparison.md` gains a new section documenting
      COSMIC's actual directional-movement-with-no-candidate behaviour
      (Stream C): whether/when a split rotates, behaviour at the screen
      edge, and whether behaviour differs by tree depth - each claim
      labelled confidently-observed or inferred.
- [ ] `docs/reference-cosmic-tray-menu.md` documents the tray icon and full
      menu structure (Stream B) - every item, label, ordering, grouping,
      separators, state indicators, submenus, shortcut hints - at a fidelity
      sufficient for a later change to reproduce closely.
- [ ] `docs/backlog.md` gains one new line for the Steam tiling-escape issue,
      in the existing entry format (Stream D).
- [ ] No file under `kwin/` or the native effect is modified.
- [ ] No image or video frame is read outside the committed budget without
      the Lead escalating a plan amendment to the Orchestrator first.

## Unresolved Questions

- Whether the video contains any state with 3 or more tiled windows. If it
  does not, the crux ambiguity behind the user's proposed movement rule
  (immediate-parent split vs ancestor-chain vs whole-workspace - these
  coincide at two windows and diverge at four) cannot be empirically
  resolved from this evidence. Stream C must state this explicitly rather
  than infer an answer it cannot support.
- Whether the 40-frame cap for unit-C2 is sufficient to cover every distinct
  layout state the scene-change detector finds in unit-C1. If unit-C1's
  timeline shows materially more distinct states than the cap allows, that
  is a plan amendment (frame budget increase) requiring Orchestrator
  sign-off, not a silent overrun.

## Consequential Decisions

- **New "observed" evidence tier.** `docs/reference-wm-comparison.md`
  currently labels claims `verified` (external primary source cited) or
  `unverified` (community/secondary source, negative inference, or
  unconfirmed). This change's screenshots and video are neither: they are
  the user's own direct, timestamped, empirical capture of a running COSMIC
  install, stronger than `unverified` but not a published primary source.
  A third tier, `observed`, is introduced with a new citation-tag family
  (e.g. `[C-OBS-*]`) pointing at the local evidence files by path and
  timestamp, following the existing citation-table pattern.
- **Extend `docs/reference-wm-comparison.md` for Streams A and C**, rather
  than create a new COSMIC-only document. Same purpose (decision-support
  comparison across bspwm/Hyprland/COSMIC feeding roadmap decisions), same
  structural pattern (aspect table, agreements/differences, adoption
  recommendation deferred to later changes, decision ledger). The new
  evidence directly upgrades existing `unverified` COSMIC rows in section 9
  (gaps/borders/corners) and adds one new section for directional-movement
  semantics, a topic the file does not currently cover.
- **New, separate `docs/reference-cosmic-tray-menu.md` for Stream B.** The
  tray icon and menu are a UI design reference for this project's own tray,
  not a three-way WM behaviour comparison; they do not fit
  `reference-wm-comparison.md`'s scope, audience, or table structure.
- **Stream D is executed directly by the Lead, not delegated to a Worker.**
  It is a single backlog line in a format the Lead has already loaded and
  understood while scoping this change (corpus-ownership forfeit); it
  requires no new evidence.
- **Lead review of image-derived evidence (Streams B and C2) is a
  prose-completeness and citation-consistency check against the acceptance
  criteria, not independent re-viewing of the source images or frames.**
  Direct Lead image reads are excluded from this change's budget by design,
  given this project's history of context exhaustion on image-heavy work. A
  Worker's incomplete or internally inconsistent write-up gets one
  same-scope correction round; the Lead does not reopen the source imagery
  to adjudicate a factual dispute it cannot see.

Implementation does not begin until the specification is approved unless
autonomous mode was explicitly requested.
