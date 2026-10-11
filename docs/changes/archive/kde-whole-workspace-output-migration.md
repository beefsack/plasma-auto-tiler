# Q4: whole-workspace output migration

## Goal, scope, and acceptance

- Deliver accepted R-WS-12 / REQ-WS-12 through shared core, Linux planner,
  and KDE native workspace mapping. Windows changes are compile-only,
  preserving behavior; actual wiring belongs in the numbered Windows handoff.
- Reuse item-5 full-output-rectangle adjacency and item-1 stable-ID history
  invalidation. No adapter extraction, dependency installs or live testing.
  Added text is ASCII.
- The nine clauses below are tentative, pending user review;
  not recorded user decisions.
- Deliver offline fixtures, catalog/preset integration,
  correlated lifecycle diagnostics, matrix/spec/decision/dev-loop updates,
  Windows and pending-live handover, all requested offline gates, then archive.
  Backlog tracks Windows item 14, native checks and provisional review.

## Accepted research evidence

- Initial worktree clean; root guidance, principles, and live KWin guide read.
  Static sources researched; relevant source checked and hidden-target, collision,
  and native-capability assumptions corrected. Research preceded implementation; no live tests.
- `docs/spec/functional-spec.md:147` accepts whole-workspace movement but leaves
  destination/focus detail TBD. `docs/spec/reference-outcomes/workspaces.md:587-659`
  explicitly permits active-only no-counterpart on its hidden baseline plus an
  independent active leg; hidden targeting is not a selected requirement.
- COSMIC pin `3d55cba06c9cf6f27609cdefb520f7857dba20af`:
  [actions.rs:684-743](https://github.com/pop-os/cosmic-comp/blob/3d55cba06c9cf6f27609cdefb520f7857dba20af/src/input/actions.rs#L684-L743)
  migrates the active workspace directionally, activates it, then switches
  output. Next/previous-output migration actions are deprecated warn no-ops.
  [keybindings.ron](https://github.com/pop-os/cosmic-comp/blob/3d55cba06c9cf6f27609cdefb520f7857dba20af/data/keybindings.ron)
  has no migration binding.
- COSMIC [shell/mod.rs:1032-1062](https://github.com/pop-os/cosmic-comp/blob/3d55cba06c9cf6f27609cdefb520f7857dba20af/src/shell/mod.rs#L1032-L1062)
  refuses migration in Global mode, inserts the same workspace after the target
  active entry, and retains other target workspaces. Its source refill uses the
  last remaining entry, adding an empty only if none remain
  ([717-750](https://github.com/pop-os/cosmic-comp/blob/3d55cba06c9cf6f27609cdefb520f7857dba20af/src/shell/mod.rs#L717-L750)).
- COSMIC [workspace.rs:589-635](https://github.com/pop-os/cosmic-comp/blob/3d55cba06c9cf6f27609cdefb520f7857dba20af/src/shell/workspace.rs#L589-L635)
  carries tiled/floating/minimized/fullscreen state, preserves the Workspace,
  and forgets prior output preference on an explicit move. Sticky state is
  output-set-owned, not workspace-owned (`shell/mod.rs:370-380`).
  OutputBound/Global mode and Vertical/Horizontal layout are orthogonal
  (`cosmic-comp-config/src/workspace.rs:33-45`).
- KWin v6.7.4 peeled pin `8438567a741826da8b7536a8b10eb3af8fc8820d`:
  [virtualdesktops.cpp:577-602](https://github.com/KDE/kwin/blob/8438567a741826da8b7536a8b10eb3af8fc8820d/src/virtualdesktops.cpp#L577-L602)
  changes one view only when native per-output desktops are enabled; otherwise
  even a per-screen setter changes all outputs. The setting defaults false
  (`src/kwin.kcfg:109-110`), with live wiring in `src/workspace.cpp:215-216`.
- A read-only script guard is expressible without a new native bridge:
  [scripting.cpp:224-227](https://github.com/KDE/kwin/blob/8438567a741826da8b7536a8b10eb3af8fc8820d/src/scripting/scripting.cpp#L224-L227)
  exports global `options`; `src/options.h:132` exposes
  `options.perOutputVirtualDesktops`. The repository already declares this
  global (`kwin/src/kwin-globals.d.ts:50-58`). Never write the setting.
- KWin scripting has view and per-window output operations, no atomic
  desktop-ownership migration. `src/window.cpp:3874-3918` at the KWin pin moves
  geometry, restore rectangles, quick tiles, and transients, and may change
  active output; it does not rewrite desktop membership.
- Our local/global-unique mappings assign distinct backing IDs, whereas shared
  selects one backing ID everywhere (`docs/decisions.md:1681-1696`). Therefore
  global-unique is not COSMIC Global. Native separability is an additional
  capability requirement for this new verb, not authority to revise old modes.
- `crates/tiler-core/src/session/world.rs:240-338` already has `relocate_domain`
  preserving tree, shares, focus, exception origin, floating geometry and
  revision, with validation and rollback; unknown observation cannot auto-rekey.
  N ordinary window sends would re-admit leaves, not preserve a workspace.
- `kwin/src/workspace-native.ts:1851-1910` retains hotplug return associations;
  explicit migration needs a choice about removing the moved ID from them.
- Native catalog currently has 124 rows, 92 bound and 32 unbound, with 23
  compiled foreign conflicts (`kwin/native-effect/shortcutreconciler.cpp:525-536`;
  item-5 archive). Four unbound actions would make 128 / 92 / 36, without new
  default chord conflicts.

## Selected tentative choices (PROVISIONAL, user review pending)

| Topic | Recommendation | Alternatives and consequence |
| --- | --- | --- |
| Binding | Tentative PROVISIONAL: bindable, UNBOUND | A bound arm needs a separate conflict/chord choice; no stock holder invented |
| Modes/capability | Support local and global-unique only with strict-true live `options.perOutputVirtualDesktops`; shared/false/missing refuse with reason | Shared consolidation is window movement, not workspace reassignment; automatic native-setting mutation is outside scope |
| Targeting/verbs | Active workspace, four directions using item-5 adjacency, follow only | Hidden-ID targeting is larger; stay and next/previous add behaviors without COSMIC precedent |
| Destination/layout | Keep backing ID, tree/order/shares/focus/tiling mode; insert after target current entry, show it; target prior workspace stays hidden | Re-admission loses layout; swapping moves another workspace; refusal just because target current is occupied needlessly limits use |
| Source/empty | Source shows last remaining scoped entry; existing lifecycle restores minimum-two/trailing spare; allow empty moves | Neighbor or MRU refill changes COSMIC semantics; empty refusal is a narrower first delivery |
| Focus | Retain the moved active client after verified arrival/view change; empty source uses native output-switch behavior, no fabricated focus | Shell-only focus is less deterministic; stay needs its own replacement-focus choice |
| Floating/sticky | Carry workspace-bound floats, preserving origin/class via native output remap; sticky all-desktops windows stay on source and are not members | Refusing all float-containing workspaces is simpler but materially reduces whole-workspace support; carrying sticky changes output-owned state |
| Game/overlay safety | Refuse whole command before writes if moving members or affected current views contain fullscreen/maximized protected clients; never skip a member | Carrying native overlays matches COSMIC but requires additional native/game evidence; skipping splits the workspace |
| Explicit/hotplug | Remove only the explicitly migrated ID from return associations; existing history 1.3/1.5 clears out-of-source-scope previous IDs | Keeping return association can undo the explicit move on reconnect |

## Proposed minimal matrix action sequences

- Mode discriminator: same two-output active-workspace fixture in local,
  global-unique, and shared, each with native per-output option true/false/missing;
  invoke migration right; observe both views and ownership. Proposed supported
  legs vs refusal reasons; native outcomes TBD.
- Targeting discriminator: original hidden WS2 R-WS-12 baseline, then independent
  explicitly-selected WS2 leg; migrate right. Active-only baseline no-counterpart
  vs active-leg reassignment; native outcomes TBD.
- Layout/destination/source: source ordered WS1, moved WS2 `H[A,V[B*,C]]`, spare E;
  target WS3 occupied with another hidden workspace. Migrate right; inspect IDs,
  tree/shares, target order, source refill and focus. Proposed tree preservation,
  WS3 hidden and source E; native outcomes TBD.
- Empty: select source trailing empty, migrate right; inspect both minimum-two
  inventories, trailing spare and output focus. Proposed same-ID migration;
  native lifetime/focus TBD.
- Float/sticky: migrated workspace contains tile A and intentional/automatic
  float F; source also has sticky S. Migrate right; inspect F class/remap and S
  output/all-desktops flag. Proposed F carries, S stays; native geometry TBD.
- Overlay: fresh legs with fullscreen/maximized member, then protected target
  current view. Migrate right; inspect all native writes/focus. Proposed whole
  refusal before writes; native/game evidence TBD.
- History/return: remember moved workspace as previous on source; migrate it,
  invoke previous, then reconnect its displaced origin in a separate fixture.
  Existing previous entry clears; proposed explicit destination persists;
  native/hotplug outcomes TBD.

## Bounded units and verification

- Sequential units: core/planner retained-domain migration and tests;
  KDE mapping/native flight and tests; native catalog/presets and offline checks.
  Diffs, contracts, actual evidence reviewed, and durable docs integrated.
- Native flight must pin source/workspace/output/member identities, prevent
  cleanup/re-admission during transfer, verify every member and both views before
  follow/completion, and distinguish refusal, partial/uncertain, and confirmed
  terminal outcomes. Native writes are not atomic; no success inferred from
  setter return or signal. Existing bounded reconciliation remains required.
- Run requested npm, Rust offline test/clippy/fmt, portable, affected mock shell
  harnesses after binary build, native-effect Nix checks if native code changes,
  staged diff check and added-line ASCII scan.
- Future user-owned live evidence: native flag gating, two-output view/focus,
  differing work areas/scales, transient/removal mid-flight, floats, game/overlay
  refusal, empty lifecycle, history and hotplug. No such evidence claimed here.

## Outcome and accepted offline evidence (2026-10-08)

- Core typed `MigrateWorkspace` command/reply and planner wire operation retain
  the domain via `relocate_domain`; maximized observations gate migration.
  Windows production/test constructors add `maximized: false` only; current
  behavior is preserved, actual adapter wiring is handoff item 14.
- KDE pins output/workspace/member identities, retains mode and float origins,
  commits mapping, transfers natively and verifies all arrivals/views before
  follow. Per-setter fences and bounded reconciliation distinguish refusal,
  partial/uncertain and verified arrival; `planned` is never native completion.
- Catalog/preset integration: 128 bindings, 92 bound/36 unbound; four migration
  rows keep empty defaults and add no foreign conflicts. Entry registers 129
  actions including the separate keyless workspace-tiling toggle.
- Resumed assessment found the core/KDE implementation present but catalog and
  durable docs missing, with one failing policy-refusal diagnostic assertion.
  Entry refusal outcome tokens were aligned with the existing convention.
  Independent source review found a core/wire target-refusal kind mismatch;
  both direct Engine target cases now assert `cross-domain-mismatch`.
- Final implementation gates: KWin 1186 passed/0 failed and typecheck; Rust
  workspace 1250 passed/0 failed (service 148, core 494, protocol 174, FFI 40,
  Windows portable 394); workspace clippy with warnings denied, format check
  and portable check passed. Binary build passed. Native CTest 29/29 passed
  (shortcut subset 15/15); both requested native-effect Nix checks built.
  The initial 120-second Nix timeout had no semantic result; 600-second retry
  succeeded. Mock scripts: dev-native-effect 163/0, nix-host-kwin-build 93/0,
  build-kpackage contract passed.
- Final added-line ASCII scan and whitespace checks passed.
- Matrix R-WS-12 keeps its hidden baseline and explicit active leg; six minimal
  discriminator scenarios R-WS-21..26 cover mode/capability, retained layout,
  source/empty, float/sticky, overlays and history/return. Spec adds nine
  PROVISIONAL REQ-WS-12a..i clauses (74 NORMATIVE/61 OPEN/30 PROVISIONAL,
  155 scenarios). Decisions, trace guide and backlog mirror delivery.
- Native flag gating, timing, mixed work areas/scales, float remap, transients,
  removal/partial writes, game refusal, history and hotplug remain user-owned
  pending live checks. No native acceptance claimed. D1-D9 review and Windows
  implementation remain open; no new product decision was made in completion.
