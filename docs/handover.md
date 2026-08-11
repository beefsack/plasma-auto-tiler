# Terminal Handover: plasma-auto-tiler

Status: living resumption snapshot, last updated 2026-08-11 after focused-leaf
preset application. Treat every prior Lead/Worker session as terminal,
failed, or completed; never resume one. A fresh Orchestrator or Lead should
read only this file plus the artifacts it links to reconstruct full context.

## Process and Authority

| Role | Effective agent/model | Context |
|---|---|---:|
| Orchestrator | top-level, model varies by session | 150000 |
| Lead | configured `lead-openai` | 150000 |
| Worker | `worker` | 150000 |

- Exactly one subagent may be active at a time across the hierarchy.
- Provisional ceilings are approximately 20 Orchestrator dispatches, three Lead
  packages or 50 Lead calls, and 30 Worker calls, with proportional caps for
  smaller briefs. A threshold is terminal succession, not a reason to continue.
- Autonomous mode is active. The user is unavailable for manual tests until
  further notice and authorizes automated tests in the current KWin/Plasma
  session. Do not prompt for manual interaction. Large architecture or
  product-goal changes remain user-reserved; sensible small reversible choices
  are delegated.
- Any live or system mutation must retain exact ownership, preflight,
  fail-fast, and cleanup safeguards. Broad automation authorization does not
  authorize broad cleanup or state ownership.
- Before any live KWin/Plasma work, read the authoritative
  [live-testing guide](live-kwin-testing.md). It does not grant live-mutation
  authorization.

## Product Direction

North star: integrated all-in-one KDE Plasma bspwm/Hyprland/COSMIC-class
experience, including dynamic workspaces, multi-output, range of tiling modes,
rounded corners, active-window highlight, keyboard navigation/management, and
coherent full tiling-WM essentials.

Multiple KDE components may form one product. Do not revive native C++/Rust
merely for performance.

## Repository and Toolchain

- Initial commits establish the project history. Stage explicit paths and commit
  after every future major change; do not rely on a dirty worktree as a baseline.
- `devenv.nix` supplies Node 24.18.1 and npm 11.16.0. Development dependencies
  are pinned in `kwin/package.json`: `@types/node@26.2.0`,
  `esbuild@0.28.2`, and `typescript@7.0.2`; the project lockfile is present.
  Do not install dependencies globally or ad hoc. System/toolchain changes
  belong in `devenv.nix` and require a user session restart before use.
- Authored production code is strict TypeScript. KWin receives only the
  generated ES2017 non-module IIFE. KWin declarations are a narrow local subset
  pinned to KWin 6.7.3 commit
  `45ec9a6d0ed312a803ff5658a2a3e61f221566c6`. Never manually edit generated
  JavaScript.
- Current `kwin/contents/code/main.js` SHA-256 is
  `c0b5e0d5a45fb13691bb5e0dccd48c0df298eefe817dc16caf1d05ecd744b27e`.
  The current source typechecks and has 279 tests across 39 suites. This is
  static evidence only; no current runtime acceptance follows.

## Active Custom Tile Slice

- [Custom Tile vertical slice](changes/custom-tile-vertical-slice/) remains P1
  active. `unit-01` and `unit-02` are accepted. `unit-03` source is statically
  complete but its structural/runtime behavior is unaccepted and gated by
  `unit-05`. `unit-05` remains unaccepted (most recently failed-clean before
  `run()` at `unit-05/attempt-20`; see below). Do not claim runtime acceptance
  from static tests.
- `unit-04` is accepted after `unit-04/attempt-07` independently reviewed the
  registration correction. The current `registerShortcut` path has the
  source-pinned boolean gate: all thirteen registrations must succeed; success logs
  `shortcut-registered` before `startup-handlers-ready`; false disables once
  with `disabled:shortcut-registration-failed` and returns inertly.
- Current actions are: `plasma-auto-tiler-insert-right` / `Insert next window
  right of focused leaf` / `Meta+Alt+Right`; `plasma-auto-tiler-focus-left` /
  `Focus window left` / `Meta+H`; `plasma-auto-tiler-focus-down` / `Focus
  window down` / `Meta+J`; `plasma-auto-tiler-focus-up` / `Focus window up` /
  `Meta+K`; and `plasma-auto-tiler-focus-right` / `Focus window right` /
  `Meta+Alt+Ctrl+L`. Active Session Management owns `Meta+L`, so that requested
  focus binding remains deferred.
- Move actions use the same directional geometry: `plasma-auto-tiler-move-left`
  / `Move window left` / `Meta+Shift+H`; `plasma-auto-tiler-move-down` /
  `Move window down` / `Meta+Shift+J`; `plasma-auto-tiler-move-up` / `Move
  window up` / `Meta+Shift+K`; and `plasma-auto-tiler-move-right` / `Move
  window right` / `Meta+Shift+L`. Active Krohnkite actions own every requested
  `Meta+Arrow` and `Meta+Shift+Arrow` variant, so arrows remain deferred.
  Focused-leaf presets are
  `plasma-auto-tiler-apply-columns` / `Apply columns in focused leaf` /
  `Meta+Alt+1`; `plasma-auto-tiler-apply-rows` / `Apply rows in focused leaf` /
  `Meta+Alt+2`; and `plasma-auto-tiler-apply-balanced-grid` / `Apply balanced
  grid in focused leaf` / `Meta+Alt+3`; and `plasma-auto-tiler-detach` /
  `Detach window from tile` / `Meta+Shift+Space`. All thirteen registrations
  share the aggregate false-result gate. A move targets only an empty non-layout leaf,
  revalidates active/source/target state before one tile assignment, and relies
  on decode-derived occupancy after success; it does not swap.
- Shortcut records persist in KGlobalAccel after the script unloads and do not
  prove callbacks are live. The manual launcher reports startup only after
  same-KWin-PID ordered `shortcut-registered` and `startup-handlers-ready`
  diagnostics, with no `disabled:` diagnostic. It preserves exact shortcut
  ownership and does not unregister records.
- Focus is a narrow write seam through `Workspace.activeWindow`, after exact
  output-object and desktop-ID scope checks. It filters only occupied,
  non-layout leaves whose occupants are eligible and in scope, so nearer empty
  or ineligible leaves are skipped. Target occupants are revalidated before the
  focus write. Diagnostics are fixed private payloads; no titles, app IDs,
  geometry, scope identity, or caught-error text is emitted.
- Strict decoders and guards fail inert at non-split KWin/Qt boundaries. Pure
  topology, hit testing, directional focus, binary blueprints, and blueprint
  split-instruction compilation are KWin-independent. The guarded blueprint
  executor uses compiled paths and local identity mappings only; its injected
  KWin seam maps orientations and decodes exactly two CustomTile children.
  `CustomTile.split()` remains structurally risky because it mutates before
  JavaScript can decode its result.
- Focused-leaf preset application gathers an explicit active-first scoped
  occupant list, retaining the remaining decoded leaf traversal order. It uses
  the catalog and executor only on the active leaf, performs guarded ordinal
  assignments with fresh identity/scope checks, and retains surrounding authored
  topology. Split and assignment failures are fail-fast and private; no rollback
  or reflow is claimed.
- Detach uses the pinned writable `Window.tile` compatibility property only for
  an active eligible window in a non-layout Custom Tile. It revalidates the same
  association before one `null` write and decodes the null postcondition where
  feasible; assignment and postcondition failures are private and do not claim
  rollback. Pinned source confirms the null setter path calls `unmanage` and
  restores floating geometry, but this remains static evidence only.
- Deferred desktop-scope retries retain a cancellation identity and re-check it
  before acting, so a timeout queued before `windowRemoved` is inert after its
  entry is cancelled. Armed insertion retains only source and target wrapper
  identity until cleared; either removal clears it. Duplicate removals are
  inert. Static tests also prove workspace signals and action callbacks remain
  inert after aggregate shortcut-registration failure. No live KWin claim is
  made.
- `unit-12` (accepted static correction 2026-08-12) adds
  minimal explicit ephemeral selected-overlay state recorded only after a
  user-applied focused-leaf preset succeeds entirely, keyed by exact
  current desktop/output scope and atomically replaced only by a later
  same-scope success. It records preset identity, the overlay root and ordinal
  leaf tile references, and the scope only - never titles, app IDs, geometry,
  or persisted data. The narrow `readSelectedOverlay(scope)` seam verifies
  scope match, overlay-root reachability beneath the current Custom Tile root,
  and intact ordinal leaf realization, discarding structural drift inertly
  with one fixed `selected-overlay-invalidated` diagnostic. Window removal does
  not discard structurally valid state. It prepares a later bounded
  assignment-only reflow only; no automatic reflow or persistence exists.
  Typecheck/build/test pass with 293 tests across 40 suites and 49 lifecycle
  shell checks; bundle SHA-256 `fb956315...`.

## Live Evidence and Parked Automation

- `unit-05` remains unaccepted. The current bundle is `18b05f22...`, with a
  pending singleton-occupant fallback aimed at
  `keyboard-rejected:target-occupancy-validity`; it has static typecheck and
  161-test evidence only.
- Reusable live infrastructure remains proven: the nonce-owned `systemd-run
  --user` supervisor, strict all-component KGlobalAccel collector, atomic
  load-ID parse plus `Script<ID>` introspection, and `_PID`-scoped `--user`
  journal capture. Cursor display prefixes must be stripped, and heartbeat
  coverage must continue through read-only diagnosis until triggering cleanup.
- `unit-05/attempt-18` live-proved Client A's
  `window-added-eligible` and `automatic-placement-managed` path on bundle
  `e76e...`. Client B reached `keyboard-invoked`, then fail-fast rejected at
  `keyboard-rejected:target-occupancy-validity`; Client C was not attempted.
  This is partial journey evidence, not unit-05 acceptance.
- `unit-05/attempt-20` received a valid load envelope but its jq
  predicate-precedence bug rejected it before `run()`. Its dedicated 10-second
  heartbeat wrote 28 advances and exact owned-resource cleanup completed, but
  retained postflight `kwinrc` evidence differs from preflight. Do not claim
  byte-identical configuration restoration for this attempt; the capture order
  cannot now explain the discrepancy.
- A failed-clean attempt proves restoration only, never registration, callback,
  or structural capability. Resume only under fresh authorization and the
  [live-testing guide](live-kwin-testing.md).
- Krohnkite remains disabled and unloaded. Preserve the ten unrelated stale
  tiling groups and their values; they are not cleanup targets.
- Do not build a bespoke harness mountain or repeat a live launch within one
  authorization.
- Manual-only journeys (titlebar drag split, Esc cancellation) remain entirely
  untested and require a future interactive session. QV4/QJSEngine sequential
  marshalling and wrapper identity remain hypotheses outside the live-accepted
  Client A path.

## Completed Static Changes

- [Keyboard navigation vertical slice](changes/archive/2026-08-11-keyboard-navigation-vertical-slice/)
  is archived with static units accepted. It delivered the four exact focus
  actions above, geometry-only neighbor selection, guarded focus assignment,
  and static review. KWin focus assignment, QList marshalling, shortcut
  registration, and Custom Tile runtime behavior remain deferred.
- [Keyboard window movement](changes/archive/2026-08-11-keyboard-window-movement/)
  is archived with static acceptance. It adds guarded move-to-empty actions
  using the focus directional ranking, a single KWin tile assignment, and
  decode-derived post-move occupancy. Live KWin assignment remains deferred.
- [Binary layout blueprints](changes/archive/2026-08-11-binary-layout-blueprints/)
  is archived and accepted. It provides a pure balanced immutable binary
  topology with deterministic ordinal leaves and caller-selected orientation.
  Runtime realization, geometry/ratios, and a preset catalog are deferred.
- [Blueprint split instructions](changes/archive/2026-08-11-blueprint-split-instructions/)
  is archived and accepted. It compiles accepted binary topology to immutable
  pre-order split instructions and ordinal-ordered root/left/right leaf paths.
  KWin execution remains deferred.
- [Topology preset catalog](changes/archive/2026-08-11-topology-preset-catalog/)
  is archived and accepted. `buildPreset` returns compiled instructions with
  stable ordinal mappings for columns (horizontal), rows (vertical), and
  balanced-grid (horizontal root alternating by depth). It remains topology
  only; it makes no geometry or ratio claim.
- [Focused-leaf preset application](changes/archive/2026-08-11-focused-leaf-preset-application/)
  is archived and statically accepted. It adds the three exact preset actions,
  explicit occupant realization, and private fail-fast diagnostics. Runtime
  `CustomTile.split()` and tile-assignment behavior remain deferred.

## Review and Governance Record

- Repeated Worker results were host-unknown, malformed, empty, over cap, or
  role-invalid. Never trust a report without Lead inspection of actual files
  and evidence. One substantive review found the focus implementation could
  select nearer empty/ineligible leaves; the accepted code now filters them.
  The final compliant keyboard review accepted the static scope, and the
  blueprint review was compliant. Two unauthorized `.orig` backups were
  removed exactly.
- `docs/principles.md` is absent. `docs/decisions.md` is absent and remains
  user-owned if created; do not create or edit either governance artifact. The
  large report is untouched. Do not commit unless explicitly asked.

## Acceptance Boundaries and Risks

- Static acceptance proves TypeScript behavior, generated-IIFE controls, and
  automated vectors only. It does not prove KWin QJSEngine parsing beyond the
  ES2017 regression check, `CustomTile.split()` results, drag/Esc behavior, or
  retained-empty placement in a live session. KGlobalAccel registration is
  live-proven. QList/QV4 marshalling is not generally live-proven: the deferred
  desktop-scope experiment observed a decode failure, while attempt 18 later
  accepted Client A. The current functional blocker is Client B target
  occupancy, not general client eligibility.
- Current scope deliberately excludes dynamic-workspace lifecycle, stable
  multi-output identity/hotplug, persistence, broader layout realization and ratios,
  broader tiling modes, effects/decorations, packaging, and performance claims.
- The active JS baseline and structural-feasibility changes remain P1; sustained
  workload validation remains paused. The blocked nested-KWin and unsafe live
  harness paths stay parked.

## Next Session

1. Package 5 resumes at the failed harness gate: correct and prevalidate the
   jq load-response predicate against the exact valid envelope, retaining the
   plugin manifest before parser-failure cleanup can race.
2. Under fresh live authorization, rerun the bounded Client B gate with the
   current `513e45d5...` bundle and the dedicated heartbeat writer. Confirm the
   parser before `run()`, then test Client B only after Client A acceptance.
3. Stop at the first missing/rejecting required diagnostic. Client C, drag, and
   Esc remain outside that initial retry unless separately authorized.
4. Retain exact ownership/fail-fast cleanup. Treat attempt-20's configuration
   restoration as evidence-ambiguous, not a baseline-preservation claim.
