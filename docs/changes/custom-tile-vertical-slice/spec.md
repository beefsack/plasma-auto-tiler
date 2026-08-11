# Specification: Custom Tile Vertical Slice

Ownership and approval:
- Owner: Lead (`lead-openai`)
- Change class: Standard.
- Status: Approved by the user on 2026-08-10.
- Artifact map: [plan](plan.md), [state](state.md), and [log](log.md).
- Dependency: accepted structural KWin source/composition evidence from the active [integrated-plasma-structural-feasibility change](../integrated-plasma-structural-feasibility/). Its unsafe live harness and nested-KWin path remain blocked and are not this change's runtime path.

## Intent and Desired Outcome

Deliver one narrow Custom Tile vertical slice for the current workspace and
output only. The KWin component is authored production TypeScript and KWin
executes only the generated bundled JavaScript artifact.

The slice demonstrates deterministic topology and hit-test behavior plus the
smallest guarded KWin integration needed for the following journeys:

- Keyboard insertion places the next eligible window to the right of the
  focused occupied leaf.
- Pointer drag over a different occupied leaf resolves four directional
  regions; the central 50% is a no-op, and a diagonal tie resolves horizontally.
- Cancellation restores the origin association and geometry without mutating
  the target.
- A successful drag retains the now-empty origin leaf.
- Ordinary placement fills a retained empty leaf without restructuring it.

## Scope and Constraints

In scope:

- A strict TypeScript-only authored KWin component and reproducible generated
  JavaScript bundle.
- Pure deterministic topology and pointer hit-test logic independent of KWin
  and Qt, with executable vectors and tests.
- Narrow, runtime-guarded KWin/Qt adapter boundaries for the specified current
  workspace/output behavior.
- A separately authorized, minimal runtime smoke after static and unit evidence
  is accepted.
- Directional focus uses `Meta+H`, `Meta+J`, and `Meta+K`; directional
  move-to-empty uses `Meta+Shift+H/J/K/L`. The requested arrow vocabulary is
  excluded when another active KGlobalAccel owner holds it. Focus-right retains
  its safe `Meta+Alt+Ctrl+L` fallback while active Session Management owns
  `Meta+L`.
- Active-window detach uses `plasma-auto-tiler-detach` on `Meta+Shift+Space`.
  It is inert unless the active eligible window is assigned to a non-layout
  Custom Tile, then performs one guarded `window.tile = null` compatibility
  write with an immediately revalidated association. It does not claim rollback
  or live runtime acceptance.
- Active-window attach uses `plasma-auto-tiler-attach` on
  `Meta+Alt+Shift+Space` only when an exact read-only KGlobalAccel scan finds no
  unrelated active conflict. It is inert unless the active eligible window is
  floating in the exact current workspace/output scope and a deterministic
  first empty non-layout authored Custom Tile leaf is available in that scope.
  It revalidates every association immediately before at most one
  `window.tile = target` compatibility write, never changes topology or another
  occupant, and does not claim rollback or live runtime acceptance.
- Keyboard insertion arms exactly one eligible focused non-layout leaf and uses
  `Meta+Alt+Left/Right/Up/Down` when each exact KGlobalAccel chord is
  conflict-free. The next eligible unassigned in-scope window splits that exact
  leaf horizontally for left/right or vertically for up/down, with the new
  window on the requested side. Split results and both assignments are guarded;
  a post-split assignment failure stops without a rollback claim.
- Window removal clears controller-owned deferred placement and armed keyboard
  insertion state by ephemeral wrapper identity, so queued stale work cannot
  later place a removed window or split for a removed source or target.
- Selected focused-leaf preset overlays may reflow only their current valid,
  explicitly selected scope after eligible additions, removals, or a successful
  detach. Reflow is assignment-only: it preserves authored topology, ratios,
  persistence, and ordinal leaf traversal while compacting eligible occupants.

Constraints:

- Before implementation, search for suitable high-quality upstream or official
  KWin and KDE TypeScript types. Use them when suitable. A narrow local subset
  is permitted only when the search records that suitable upstream types do not
  exist; pin every local declaration to its source provenance.
- Strict controls prohibit `any`, unchecked casts, non-null assertions, and
  manual edits to generated JavaScript. KWin and Qt boundary values require
  runtime guards.
- Node, TypeScript, and build/test tools are development-only and must not be
  runtime product dependencies.
- A `devenv.nix` toolchain change requires the user to restart the session
  before new tools are assumed available.
- Current-workspace/output state is scoped by session-local exact `Output`
  object identity plus virtual-desktop ID. Pending state must clear when the
  output is removed, replaced, or leaves scope. That identity survives neither
  restart nor hotplug; KWin retains persistent topology. Stable multi-output
  identity remains deferred.

Non-goals:

- No runtime smoke, installation, enablement, or live session action in this
  planning package.
- No panel, indicator, settings UI, animation, broad layout support, native
  plugin, Rust bridge or daemon, release packaging, full multi-output or
  hotplug support, second persistence model, or broad performance work.
- No reuse, launch, or unblocking of the feasibility change's unsafe live
  harness or nested-KWin path.
- No edit to `docs/decisions.md`, the technical report, or the paused
  sustained-workload-validation change.

## Acceptance Criteria

- [ ] The TypeScript toolchain and type provenance meet the strict controls,
      and generated JavaScript is reproducible rather than manually authored.
- [ ] Pure topology and hit-test logic has executable deterministic tests for
      every specified journey, including central no-op and horizontal tie
      precedence.
- [ ] The adapter applies only to the current workspace and output and guards
      all KWin/Qt boundary values at runtime.
- [ ] Static and unit review finds no prohibited TypeScript escape hatches,
      generated-artifact edits, or unguarded boundary assumptions.
- [ ] The manual launcher reports successful startup only after the fixed
      shortcut-registration and handler-readiness diagnostics confirm an
      enabled controller; this is not shortcut callback or broader runtime
      capability acceptance.
- [ ] The detach action uses the pinned KWin writable `Window.tile` contract,
      rejects every unsafe association before its single write, and has focused
      static tests for registration, guards, write failures, and postcondition.
- [x] The attach action uses the same pinned writable `Window.tile` contract,
      rejects every unsafe source, scope, and target association before its
      single write, and has focused static tests for registration, deterministic
      empty-leaf selection, revalidation, write failures, and postcondition.
- [ ] Removal notifications make deferred placement and armed insertion inert
      for removed windows, with focused static tests for queued callbacks,
      source/target removal, duplicate notifications, and failed registration.
- [x] Valid explicitly selected overlays reflow only guarded `window.tile`
      assignments after relevant lifecycle changes, preserving immutable
      topology, exact scope, deterministic ordinal occupant order, capacity,
      and fail-fast partiality semantics.
- [ ] No runtime smoke occurs without separate fresh authorization; any future
      smoke remains limited to this slice and does not unpark the feasibility
      change's blocked live path.
