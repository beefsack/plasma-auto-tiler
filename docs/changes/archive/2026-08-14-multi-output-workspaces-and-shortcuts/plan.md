# Implementation plan: multi-output workspaces and shortcuts

Status: completed and user-approved 2026-08-14. Final acceptance evidence and
residual risks were reconciled by the Lead before archival.

## Constraints and evidence

- Preserve the tiling structural safety contract in `docs/handover.md:285-317`
  and `docs/live-kwin-testing.md:357-366`: no `remove()` then `split()` in one
  run, fresh whole-root decode after every structural call, homogeneous
  structural batches only, and no structural probe in a persistent user scope.
  Workspace and keyboard work must not weaken or bypass these prohibitions.
- Do not use DBus, external helper processes, C++/effects, or a native-helper
  workaround. The required per-output desktop write is a documented scripting
  API.
- Preserve the dirty keyboard prototype and correct it in place. It is a
  source of candidate action code only: retain code only when it matches the
  revised selected-profile catalog. Do not remove prototype code during planning.
- `setCurrentDesktopForScreen` is already globally declared in
  `kwin/src/kwin-globals.d.ts:276`, but must be added to the controller
  environment seam and `kwin/src/entry.ts` wiring. The current desktop-change
  seam also drops its output argument and must preserve it.
- No existing controller configuration access uses `readConfig`. Use the
  smallest KWin-conventional seam: declare global `readConfig`, wire it through
  `ControllerEnvironment`, and read `workspaceMode` with default
  `per-output-local`. Do not introduce JSON persistence. This is sufficient
  unless typechecking or KWin packaging evidence contradicts the global API.
- `Meta+0` registers as `plasma-auto-tiler-workspace-0` in every profile unless
  an exact in-profile conflict exists. It focuses or creates the mode-defined
  trailing empty on the active output (per-output-local, global-unique) or
  synchronizes every output to the shared trailing empty (shared), idempotently
  when already trailing empty, with no hard workspace-count bound. Meta+Shift+0
  remains move-to-newly-appended-and-follow where the selected profile defines
  it.
- KWin `registerShortcut` is KWin-local registration, not Plasma-global
  reassignment. An installer/KCM migration is a gated later dependency for
  collision takeover, displaced-action reassignment, rollback, and live proof.

## Unit 01 - Binding profile catalog and validation

Implementation status: accepted 2026-08-14. Commit pending with the approved
Unit 01 changes. The legacy `scripts/start-test.test.sh` literal-registration
assertion remains intentionally deferred to Unit 03, where its catalog-aware
replacement and migration-boundary documentation belong.

Dependencies: none. Scope: implement profile data model and pinned complete
fixtures for `cosmic`, `hyprland`, and the canonical bspwm `sxhkdrc` example;
select `cosmic` by default through `readConfig`; classify every entry exact,
canonical example, compatibility alias, or deferred; and validate effective
profile collisions before registration. Model profile/user/KGlobalAccel
precedence as user override > selected baseline > profile default. Do not claim
or implement Plasma-global takeover.

Likely files: `kwin/src/controller.ts`, `kwin/src/boundary.ts`,
`kwin/src/entry.ts`, `kwin/src/kwin-globals.d.ts`,
`kwin/tests/controller.test.ts`, and pinned shortcut fixtures under an existing
test-data convention if one exists.

Acceptance and reproducible evidence:

1. Fixture tests prove exact equality to pinned upstream COSMIC and Hyprland
   defaults and the pinned bspwm example, except explicitly classified aliases
   and Meta+0 rows, which register as `plasma-auto-tiler-workspace-0` unless an
   exact in-profile conflict exists.
2. Tests prove absent/invalid profile selects `cosmic`, and valid profile names
   select their own catalog.
3. Deterministic tests reject every duplicate effective sequence inside a
   profile, identify both action IDs, and ensure no shipped profile duplicates.
4. Tests prove user-customized shortcut values survive reload/profile change and
   take precedence without overwriting the catalog-owned default.
5. Tests prove aliases register under distinct IDs and Meta+0 registers as
   `plasma-auto-tiler-workspace-0`.
6. `npm run typecheck` and targeted controller tests pass.

Risks and stop conditions: stop if an upstream fixture cannot be pinned and
reviewed, if preserving a user KGlobalAccel change needs unsupported script
introspection, or if any profile catalog has an unresolved in-profile duplicate.
Do not solve Plasma-global conflicts through silent script registration or
unapproved DBus/config mutation.

## Unit 02 - Profile action implementations and compatibility aliases

Implementation status: accepted 2026-08-14. COSMIC resize mode uses its exact
`Meta+R` and `Meta+Shift+R` entries and the separately registered directional
focus aliases while active; no Meta+Ctrl resize default is registered. Resize
uses one guarded tile-relative-geometry write and fresh postcondition decode.
Static source evidence establishes sibling adjustment, but live KWin behavior
remains unproven. The generated bundle remains deferred to Unit 03's
registration checkpoint.

Dependencies: Unit 01. Scope: implement only actions required by the selected
profile catalogs that can be truthfully supported inside the controller. Start
with exact COSMIC actions, including Meta+R / Meta+Shift+R resize mode if it is
feasible without violating geometry/structural safety. Add required arrow/HJKL
compatibility aliases only after catalog collision validation, never labelling
them upstream defaults. Preserve useful dirty prototype action code only where
it matches this catalog; do not remove unrelated code.

Likely files: `kwin/src/controller.ts`, `kwin/src/boundary.ts`,
`kwin/tests/controller.test.ts`, and `kwin/src/logic.ts` only for a necessary
resize planner correction.

Acceptance and reproducible evidence:

1. Tests map every implemented action to the selected profile fixture row and
   separately label compatibility aliases.
2. COSMIC resize tests prove exact mode bindings and safe geometry behavior; no
   invented Meta+Ctrl sequence is presented as COSMIC default.
3. Tests cover lower-bound refusal and setter failure without a partial second
   geometry write or rollback assumption.
4. Unsupported system actions (lock, launcher, overview, stacking, and any
   profile action without a controller implementation) are reported as explicit
   component requirements, not registered as false equivalents.
5. `npm run typecheck` and targeted controller tests pass.

Risks and stop conditions: stop if an exact profile action needs structural
mutation, an unavailable KWin scripting capability, or an external Plasma
component. Escalate the component boundary rather than inventing a binding.

## Unit 03 - KWin-local registration and global-migration boundary

Implementation status: accepted 2026-08-14. Selected catalog rows register
under stable KWin-local IDs on restart/reload, catalog and individual
registration failures diagnose clearly, and the aggregate gate is catalog-aware.
`Meta+0` registers as `plasma-auto-tiler-workspace-0` with a controller
append/focus handler; `Meta+Shift+0` remains independently registered. The
regenerated bundle and static lifecycle/install checks pass. The installer/KCM migration remains a
documented, separately gated dependency, not an implementation.

Dependencies: Unit 02. Scope: register validated effective catalog rows as
distinct KWin script shortcut IDs, document the collision status, and expose
profile/readConfig reconfigure semantics. Keep this strictly separate from
Plasma-global reassignment. Define the installer/KCM migration interface,
snapshot, collision detection, displaced-action mapping, rollback contract, and
required live evidence, but do not implement it without separate approval.

Likely files: `kwin/src/controller.ts`, `kwin/src/boundary.ts`,
`kwin/src/entry.ts`, `kwin/tests/controller.test.ts`, and relevant user docs.

Acceptance and reproducible evidence:

1. Tests prove one KWin-local registration per validated action/alias and make
   no assertion that registration wins an existing Plasma global collision.
2. Documentation and diagnostics identify known shadowed sequences and state
   that full profile activation is blocked pending installer/KCM migration.
3. The migration design assigns a displaced Plasma action only to the selected
   reference environment's documented equivalent; otherwise it records it
   unassigned. It has an atomic snapshot and rollback requirement.
4. `npm run typecheck` and targeted controller tests pass.

Risks and stop conditions: do not write `kglobalshortcutsrc`, invoke
`org.kde.kglobalaccel`, or mutate a live session. If a profile cannot register
without claiming false activation, leave it as a catalog limitation and report
the gated dependency.

## Unit 04 - Mode seam and per-output model

Implementation status: accepted 2026-08-14. `workspaceMode` parsing, deterministic
session output keys, typed per-output desktop-write/event seams, and the
non-destructive one-output migration are complete. Per-output workspace
dispatch and reconciliation remain Unit 05.

Dependencies: Unit 03. Scope: introduce `workspaceMode` configuration and the
session-only output/workspace state needed by all modes. Default to
`per-output-local`; validate the three allowed values and use the default for
invalid input with a diagnostic. Expose `readConfig`, per-output current-desktop
read/write, and output-bearing desktop-change events through the boundary.
Define deterministic session output keys from manufacturer/model/serial/name
plus first-seen collision ordering. Migrate the current session-owned global
desktop behavior without adopting or deleting pre-existing desktops.

Likely files: `kwin/src/controller.ts`, `kwin/src/boundary.ts`,
`kwin/src/entry.ts`, `kwin/src/kwin-globals.d.ts`,
`kwin/tests/controller.test.ts`.

Acceptance and reproducible evidence:

1. Fake-environment tests prove missing `workspaceMode` selects
   `per-output-local`, each valid mode parses, and invalid input falls back.
2. Tests prove `setCurrentDesktopForScreen` and the output argument from
   `currentDesktopChanged` reach the controller seam.
3. Two same-tuple fake outputs use deterministic first-seen distinct keys; a
   desktop rename/reorder does not change an id-based mapping.
4. Migration tests prove pre-existing desktop ids are neither marked owned nor
   removed, and a one-output session preserves logical behavior.
5. `npm run typecheck` and targeted controller tests pass.

Risks and stop conditions: stop if `readConfig` cannot be declared/wired under
the repository's KWin bundle type model, or if output identity cannot be held
without persisted state. Do not invent persisted JSON; return for a configuration
decision if the conventional seam is unavailable.

## Unit 05 - Per-output-local default

Implementation status: accepted 2026-08-14. The default mode holds a
session-only `outputKey -> desktop-id[]` map, creates distinct per-output
backing desktops and trailing empties, and routes selection and move-follow to
the active output. Static two-output, lifecycle, and safety coverage passed;
the accepted global-desktop pager limitation remains.

Dependencies: Unit 04. Scope: implement mode dispatch and complete only
`per-output-local`: outputKey-to-ordered-desktop-id mapping, screens/desktops
reconciliation, automatic one-trailing-empty maintenance, safe owned-desktop
cleanup, navigation, move-follow, and deferred move-append keyed by active
output. Register Meta+0 as `plasma-auto-tiler-workspace-0` plus Meta+Shift+0.
Update the aggregate shortcut-registration gate and its test to require only
the remaining approved workspace registrations.

Likely files: `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`, and
`kwin/src/boundary.ts` only for an already identified test seam gap.

Acceptance and reproducible evidence:

1. Two-output tests prove distinct local logical ids, active-output-only
   Meta+1..9 navigation via `setCurrentDesktopForScreen`, and no change to the
   other output.
2. Reconciliation creates exactly one local trailing empty desktop and creates
   no duplicate on repeat.
3. Meta+0 focuses or creates the active output's local trailing empty and is
   idempotent when already trailing empty. Meta+Shift+0 moves an eligible
   active window to the local trailing empty and follows; it creates exactly
   one destination if absent. The aggregate gate passes with Meta+0 registered.
4. Sticky, maximized, and fullscreen move refusal, hotplug cleanup candidacy,
   and desktop rename/reorder invariants are covered.
5. `npm run typecheck` and `npm test` pass.

Risks and stop conditions: stop if cleanup could remove a current, visible,
pre-existing, or another output's mapped desktop; if desktop events recurse
without a bounded drain; or if a workspace operation requires structural tiling
mutation. Keep cleanup session-owned and global-visibility-aware.

## Unit 06 - Global-unique mode

Implementation status: accepted 2026-08-14. Session-only assigned subsets and
their inverse resolve logical positions by global desktop number, including the
visible-target output swap. The typed `activeScreen` seam supplies keyboard
active-output selection when no window is focused. Shared mode remains Unit 07.

Dependencies: Unit 05. Scope: add only `global-unique` assignment state:
ordered output subsets and inverse desktop assignment. Implement active-output
navigation and move-follow, including the specified visible-target output swap,
automatic trailing-empty maintenance, and owned/unassigned cleanup.

Likely files: `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`.

Acceptance and reproducible evidence:

1. Two-output tests with E `[1,2,4]` and L `[3,5,6]` select E's 3rd = 4 and
   L's 2nd = 5 using per-output desktop writes.
2. A target visible on another output applies the specified swap before follow.
3. Meta+0 focuses or creates the active output's assigned trailing empty;
   Meta+Shift+0 appends/assigns once only when no trailing empty exists.
4. Cleanup rejects assigned, visible, current, and pre-existing desktops.
5. `npm run typecheck` and `npm test` pass.

Risks and stop conditions: stop if desktop assignment becomes ambiguous after
hotplug/reorder beyond the documented first-seen session limitation, or if the
swap cannot preserve one assigned current desktop per output. Do not silently
change global-unique semantics.

## Unit 07 - Shared mode

Implementation status: accepted 2026-08-14. Shared mode maintains one ordered
global desktop-id set and synchronizes each connected output through the
per-screen desktop seam for selection and move-follow. Its one shared trailing
empty is session-owned; cleanup is visibility-safe and hotplug only
synchronizes, never deletes. Static two-output, failure, idempotence, and
state-refusal coverage passed. Live KWin behavior remains unproven.

Dependencies: Unit 06. Scope: add only the one shared ordered desktop set and
synchronize all outputs for navigation and move-follow. Retain automatic shared
trailing-empty maintenance, Meta+0 append/focus, and Meta+Shift+0 move-append.

Likely files: `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`.

Acceptance and reproducible evidence:

1. Two-output tests prove Meta+2 writes the same desktop id to E and L.
2. Meta+0 focuses or creates the shared trailing empty and synchronizes all
   outputs, idempotently when already trailing empty. Meta+Shift+n and
   Meta+Shift+0 move the eligible active window then synchronize all outputs;
   sticky/maximized/fullscreen refusal remains unchanged.
3. Reconciliation keeps one shared trailing empty and cleanup never removes a
   current or pre-existing desktop.
4. `npm run typecheck` and `npm test` pass.

Risks and stop conditions: stop if shared synchronization produces event loops
or overwrites a desktop outside the shared mapping. Reuse bounded deferred
intent handling rather than adding an out-of-process workaround.

## Unit 08 - Integration, review, and documentation

Implementation status: accepted 2026-08-14. The three workspace modes,
profile catalog, dynamic lifecycle, and documentation were reconciled. Focused
independent review found and the bounded correction pass resolved singleton
multi-output reconciliation, output-wrapper identity, synchronous tiled
move-follow, and unimplemented catalog-row truthfulness. The user approved the
delivered result on 2026-08-14; the completion transaction may archive this
change.

Dependencies: Units 01-07. Scope: run the complete static/unit suite, inspect
the aggregate shortcut gate and all mode dispatches, update user-facing project
documentation only where current shortcuts/configuration are documented, and
perform an independent focused review of the high-risk desktop lifecycle and
resize changes.

Likely files: `kwin/tests/controller.test.ts`, relevant existing documentation,
and no new runtime mechanism.

Acceptance and reproducible evidence:

1. `npm run typecheck` and `npm test` pass from `kwin`.
2. The final test matrix maps every spec H criterion, including exact fixture
   equality, zero in-profile duplicate sequences, registered Meta+0, separable
   Meta+Shift+0, all three modes, and two-output behavior, to a named test.
3. Focused review finds no unapproved DBus/external helper or live mutation, no
   persisted JSON, no stale dual-write resize logic, and no violation of the
   structural safety contract.
4. Documentation states profile precedence, `cosmic` default, exact/default
   classifications, KWin-local collision limitation, `workspaceMode` values,
   session-local output identity limitation, and Meta+0 registered status and
   per-mode append/focus semantics.

Risks and stop conditions: no live KWin/Plasma mutation is authorized by this
plan. If static tests cannot emulate an API edge, record the gap for separate
live-testing authorization rather than exercising a user session.

## Verification sequence

Run targeted controller tests after each unit, then `npm run typecheck` and
`npm test` after Units 01, 02, 04, 05, 06, 07, and 08. Review the dirty keyboard
diff as Unit 02 input, not as accepted behavior. Do not commit, push, stage all,
touch protected untracked paths, or run live KWin/Plasma mutation during
planning or implementation without later authorization.

## Final acceptance evidence

- Profile catalogs, collision validation, stable KWin-local registration, and
  the `Meta+0` registration/append-focus amendment are covered by accepted
  Units 01-03 and the final static verification record.
- `workspaceMode` parsing, session-only output identity, and the
  per-output-local, global-unique, and shared mode behavior are covered by
  accepted Units 04-07, including static two-output, lifecycle, idempotence,
  and state-refusal cases.
- Unit 08's final static verification passed: `npm run typecheck`, `npm test`
  (692 tests), 248 lifecycle checks, 108 installer checks, and two reproducible
  builds. The approved `Meta+0` amendment was subsequently implemented and
  statically verified in commit `fd59ed8`.
- The focused independent review and its bounded correction pass found no
  unapproved DBus, helper, persistence, live mutation, or structural-safety
  violation. User result approval is recorded for this completed delivery.

## Residual risks

- Live KWin/Plasma behavior, including desktop lifecycle and shortcut
  activation in the presence of Plasma-global conflicts, remains
  unproven-until-live; no live mutation was authorized or performed.
- KWin-local registration cannot displace Plasma-global bindings. The separate
  installer/KCM migration, collision handling, rollback, and live evidence
  remain unfinished and are not part of this archived change.
- Output identity and per-output mappings are session-local. Identical output
  tuples use first-seen order, and `per-output-local` exposes N*M desktops in
  Plasma's pager/overview.
