# Rust Pointer Resize Direct Geometry

## Goal

Add a disabled-by-default KWin direct-geometry adapter for signal-driven
pointer split-share resizing, with Rust as the sole topology, boundary, share,
projection, plan, revision, and reconciliation authority.

## Scope And Non-Goals

- Use public per-Window `interactiveMoveResizeStarted`,
  `interactiveMoveResizeStepped(nextGeometry)`, and
  `interactiveMoveResizeFinished` signals only. No polling or timer loop.
- Capture one exact native/Rust gesture scope at start. Distinguish move from
  resize through KWin interactive state plus proposed-edge changes; moves never
  submit resize work or reflow neighbours.
- Submit normalized proposed source geometry/boundary to Rust. Rust derives and
  validates the adjacent share change, then returns the complete geometry/focus
  plan through the existing acknowledgement and post-observation boundary.
- KWin writes only changed non-source neighbours in deterministic shared order,
  guards synchronous adapter writes, and fresh-observes before commit. Native
  geometry remains sequential and non-atomic.
- Retain only the latest normalized step while one request is pending; discard
  stale intermediate steps. Fail closed on identity, domain, membership,
  revision, capability, acknowledgement, post-observation, service, or native
  refusal failure.
- No production wiring, Custom Tile path, shortcut, configuration, workspace or
  output feature, drop topology, move-end snap-back, live KWin work, or POC
  promotion.

## Acceptance

- Rust proves horizontal, vertical, nested, and N-ary boundary/share derivation;
  positive adjacent-only shares; min/projectability refusal; deterministic
  repeated steps; stale/pending/capability refusal; and reconciliation commit or
  divergence.
- Focused KWin tests prove start/step/finish ordering, move separation,
  proposed-versus-lagging geometry, one-flight latest-step coalescing,
  deduplication, changed neighbour-only writes, recursion suppression, unrelated
  drift, finalization, service loss, partial/mismatch failure, and no polling.

## Approach

1. Add the smallest portable pointer-boundary Session/service contract using the
   existing resize reconciler and pure share application.
2. Add standalone opt-in KWin pointer adapter and lexical-workspace entry with
   public interactive signals and no production import.
3. Add focused durable Rust/KWin coverage, complete static checks, then record
   the outcome and archive this change.
