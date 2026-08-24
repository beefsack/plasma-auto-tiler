# COSMIC Directional Movement Strategy

## Intent

Ship the runtime-validated COSMIC directional keyboard-movement model behind a
narrow strategy seam. COSMIC is the sole shipped implementation of that seam.

## User-Visible Behavior

Directional keyboard movement follows the accepted COSMIC rules R1-R4 and
sizing cases S1-S4. A move can structurally change the tile tree or move a
window to an adjacent output. Focus remains on the moved window. Movement does
not wrap or cross workspaces.

## Scope

- Directional keyboard movement only.
- Replace the current geometry-nearest-leaf assignment or occupied-leaf swap
  internals with the COSMIC structural strategy while retaining the controller
  facade, guards, and shortcut callbacks.
- Keep `controller.ts` as the sole composition root and retain narrow
  capability groups.
- Re-decode native split results after mutation. Native child order and
  cardinality are opaque; geometry ordering remains in `custom-tile-split.ts`.

## Non-Goals

- No movement-mode selector, persisted strategy setting, migration, default,
  or KCM control.
- No bspwm or Hyprland directional-movement implementation or advertising
  until equivalent runtime corpus replay validates a second model.
- No changes to focus, resize, insertion, drag, new-window behavior, float or
  sticky handling, workspaces, reconstruction, or unrelated behavior.
- Existing-window same-axis drag direct-parent insertion and new-window
  same-axis pre-mutation rejection remain separate from keyboard movement.
- No runtime sibling-domain imports or widened mutable capability bags.

## Preserved Invariants

- Ordered direct children remain the basis for N-ary decisions; nested groups
  count as one direct child.
- Structural decisions remain geometry-independent, while adapter-local
  geometry ordering stays in `custom-tile-split.ts`.
- Binary serialization and established keyboard guards remain stable.
- Existing bspwm and Hyprland shortcut-profile references remain untouched:
  they describe shortcut catalogs, not movement strategies. This change adds
  no directional-movement mode advertising.

## Governance

- `docs/decisions.md#unified-settings`: preserve existing script keys; no
  settings migration is introduced.
- `docs/decisions.md#core-distribution`: retain the script KPackage
  distribution boundary.
- `docs/decisions.md#native-effect-live-validation`: live operations require
  their separately applicable authorization and are outside static work.

## Evidence Authority

The accepted COSMIC closure is authoritative:
`docs/changes/archive/2026-08-20-cosmic-move-model-closure/spec.md` for R1-R4,
and `docs/cosmic-move-conformance.md` for case groups P1-P5, F1-F3, G1-G2,
M1-M4, U1-U2, and S1-S23. The archived N-ary acceptance record supplies the
frozen direct-child, opaque-split, adapter-ordering, and binary-preservation
contracts. Older incomplete reference-comparison wording is not normative.

## Acceptance Criteria

- Focused automated tests demonstrate the accepted R1-R4 behavior and S1-S4
  sizing through references to the authoritative case groups.
- Focus remains on the moved window; keyboard guards, workspace limits, and
  failure restoration remain preserved.
- N-ary direct-child behavior, opaque native split handling, and binary
  serialization remain preserved.
- Existing drag and new-window insertion behavior remains unchanged.
- Static acceptance passes focused tests, the full `kwin` suite, dual
  typechecks, dogfood, and a deterministic bundle build. The accepted baseline
  is 965 tests in 91 suites with 0 failures and 0 skipped, dual typechecks
  clean, dogfood 347/0, and bundle SHA-256
  `51af50efc153ba82dfaa2543ba973b443ef6b92f2c098409ae46e9a197c8f02b`.
  A changed bundle records a new hash rather than matching this baseline hash.
- A COSMIC-only live corpus replay is a separately and explicitly approved
  later checkpoint. It does not block static implementation acceptance.

## Evidence Boundaries

- Deeper-than-one-level parity descent and post-manual-resize behavior are
  unobserved.
- Vertical output adjacency has limited corpus coverage.
- Native split return shape, cardinality, and multi-ordinal order are
  unproven; implementation must fail closed rather than infer them.
