# Resize Tiling Diagnosis

## Goal

- Determine whether native client geometry refusal causes the reported loss of
  tiling, and identify the smallest evidence-based next change.

## Scope

- Static source and existing development-log investigation only.
- No live KWin, Plasma, D-Bus, or window action.
- No production behavior change: a client-constraint reconciliation policy is
  an architecture change and is not safe to add within this diagnosis.

## Diagnosis

- The exact post-observation failure hypothesis is true only for the
  development-only resize adapter. `sameRect` requires exact integer equality
  (`kwin/src/resize-adapter.ts:291-293`); an altered rectangle reaches
  `failApply("resize-post-mismatch")`, which disables the adapter
  (`kwin/src/resize-adapter.ts:1970-1998, 1769-1781`). Its Rust verifier also
  terminally diverges on an unverified or mismatched operation
  (`src/reconcile.rs:1188-1253`). This route is recoverable only by restarting
  the adapter, not by a later resize.
- That route is not the loaded KWin entry. The production entry starts only
  `startPlanAdapterEntry` (`kwin/src/entry.ts:1, 51`). The current dev log has
  only `plasma-auto-tiler:plan` records, including applied plan operations and
  recoverable `duplicate-window` rejections; it contains no resize-adapter,
  mismatch, disable, divergence, or eligibility event
  (`/run/user/1000/plasma-auto-tiler-dev.qLvCX5.log:1-38`).
- The active plan adapter does not post-observe geometry after writes and does
  not disable after a failed flight: it clears the flight and can dispatch the
  next deferred operation (`kwin/src/plan-adapter.ts:1064-1188`). Therefore the
  fail-closed resize-adapter hypothesis does not explain the recorded current
  route or report.
- The active route has a distinct resize-loss mechanism. Every
  `moveResizedChanged` signal schedules `refreshNow`
  (`kwin/src/plan-adapter-entry.ts:592-637, 686-693`), but a same-membership
  refresh only records the changed geometry as `lastGood`; it sends a command
  only for membership growth or shrinkage
  (`kwin/src/plan-adapter.ts:758-852`). A user or client geometry change thus
  receives no reflow and becomes the adapter's baseline. This is consistent
  with a window visually dropping from its layout but has not been observed in
  the supplied log.
- Other static exit paths remain: non-normal windows and windows on another
  output/desktop are omitted from observation
  (`kwin/src/plan-adapter-entry.ts:301-302, 394-440`); a missing observed id
  produces a Rust remove (`kwin/src/plan-adapter.ts:818-839`). Fullscreen,
  maximize, minimized, sticky, output, desktop, and ordinary lifecycle changes
  can therefore appear as tiling loss. The legacy Custom Tile runtime has no
  reachable production entry in this checkout.

## COSMIC Reference

- COSMIC keeps tiling geometry authoritative: `update_positions` marks a
  surface tiled, assigns the tile geometry, and configures it
  ([source](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L3115-L3143)).
  It does not derive sibling sizes from an actual client commit.
- It waits/throttles configure progression until the latest requested size is
  committed, with bounded blocker timeouts, rather than disabling tiling
  ([latest-size gate](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/element/surface.rs#L628-L667),
  [blocker](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/blocker.rs#L15-L53)).
- Steady-state tiled rendering uses `CutOff`, not client-geometry adoption or
  letterboxing ([render path](https://github.com/pop-os/cosmic-comp/blob/81cd5fdbaa41c3973369ae85bccf829137836e20/src/shell/layout/tiling/mod.rs#L5620-L5626)).
- The audited path does not establish how KWin's `frameGeometry` setter behaves
  for every X11 or Wayland size-constrained client. No live constrained-client
  observation occurred.

## Recommended Next Change

- Add a bounded production reflow/reconcile command that retains the last
  planner-approved tile geometry, fences it against a fresh scope observation,
  and distinguishes interactive/client geometry changes from adapter writes.
- Define its constrained-client behavior before implementation. COSMIC keeps
  tile allocation authoritative and throttles configure progression; blindly
  adopting actual KWin rectangles and redistributing shares would diverge from
  that model. Reapplying an unattainable frame geometry without a bounded
  acknowledgement policy could oscillate.
- This is a production reconciliation-policy and command-contract change, not
  a tolerance adjustment. It requires architecture approval and is not shipped
  by this record.

## User-Owned Live Check

1. With the current dev loop running, open a normal resizable terminal in an
   existing tiled scope and resize it by dragging an edge, then release it.
2. Read the existing development log without restarting or reloading anything.
3. PASS for the diagnosis: the window stays visibly at its manually changed
   rectangle and the log records only `plasma-auto-tiler:plan` activity, with
   no `plasma-auto-tiler:resize` or `resize-post-mismatch` token. A different
   result is evidence for a different route and must be captured before a fix.

## Outcome

- Diagnosis only. No durable product decision was promoted because the
  reconciliation policy remains unselected.
