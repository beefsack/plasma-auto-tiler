# Log: Workspace Management Fixes

Append-only. Append after a meaningful checkpoint: an accepted semantic unit,
verified partial result, blocker, pending user decision, unsuccessful host
attempt, context handover, semantic or governance change, independent review
finding, commit, or approved plan change. Each entry records timestamp, role
and work unit and attempt, result, changed files or commit, verification, and
any discovery, blocker, or required decision. No narration, copied output, or
speculation.

## 2026-08-18 (Lead diagnosis stint)

- Role / unit: Lead / diagnosis / -
- Result: accepted. Created `spec.md`, `plan.md`, `log.md` for this change.
  Diagnosis only; no production code changed.
- Files / commit: `docs/changes/workspace-management-fixes/spec.md`,
  `plan.md`, `log.md` (all new, uncommitted)
- Verification: n/a (record-keeping); underlying diagnosis evidence below.
- Notes / Bug 1 (`Meta+Shift+<number>` move-to-workspace):
  - Confirmed installed bundle
    (`~/.local/share/kwin/scripts/plasma-auto-tiler-kwin/contents/code/main.js`)
    is byte-identical to `kwin/contents/code/main.js` at the tip of `main`
    (`diff -q`), so this is not a stale-deployment defect.
  - `qdbus --literal org.kde.kglobalaccel /component/kwin
    org.kde.kglobalaccel.Component.allShortcutInfos` confirms
    `plasma-auto-tiler-move-workspace-1..9` and `-append` are registered
    with unique active key sequences; cross-checked against all 19
    KGlobalAccel components on the host, zero collisions on any
    `Meta+Shift+0..9` sequence.
  - `journalctl --user _PID=23049` (current live KWin process, started
    15:20:58, session 25+ minutes old at diagnosis time) shows
    `shortcut-registered`/`startup-handlers-ready` at startup (proves every
    `registerShortcut()` call succeeded, including all move-workspace rows,
    per the aggregate gate at `controller.ts:2117-2136`), but contains
    **zero** occurrences of `workspace-move-invoked` across the full session,
    despite the sibling `Meta+0`/`Meta+N` actions firing their own
    diagnostics multiple times in the same session. This is the decisive
    evidence: registration/collision/deployment are eliminated, but physical
    key delivery for this specific combination is unproven live.
  - Ruled out keyboard-layout-switch modifier interception
    (`KDE_Keyboard_Layout_Switcher` component bound to `Meta+Alt+...`, not
    `Meta+Shift+...`; `kxkbrc` has no layout-switch options set).
  - Watched the live journal for a bounded ~20s window for any real-time user
    activity; none observed (user not actively pressing shortcuts during that
    window). Did not ask the user synchronously (no channel to do so mid-stint);
    recorded as spec.md Q1, blocking Bug 1's fix design.
  - Also observed (non-blocking, informational): `Meta+N` (focus-workspace)
    shares its active KGlobalAccel sequence with a pre-existing native KWin
    action `Switch to Desktop N` on this host, but live evidence
    (`workspace-navigate-set` firing) shows the script's action still wins
    the physical key. Recorded as spec.md Q3, not a defect.
- Notes / Bug 2 (empty workspace cleanup):
  - Confirmed live: `VirtualDesktopManager.count` = 12 on the host right now,
    matching the user's report exactly.
  - Confirmed the switch-triggered cleanup hook fires correctly
    (`handleCurrentDesktopChanged` -> `handleScopeChange(true)` ->
    `cleanupDesktops(true)` -> `cleanupAfterWorkspaceSwitch()`); journal shows
    `workspace-cleanup-deferred:*` diagnostics at observed switches, proving
    the code path executes. This is not a missing-trigger bug.
  - Root cause is the eligibility predicate: `planDesktopCleanup`
    (`kwin/src/logic.ts:852-875`) hard-filters to `ownedIds.has(id)`, and
    `ownedDesktopIds` (`controller.ts:1628`) is an in-memory-only
    `Set<string>`, explicitly commented "recorded script-owned for this
    session only" (`controller.ts:7808`), reset to empty on every
    script/KWin restart. This exactly matches the archived
    `empty-workspace-switch-cleanup` spec's own delivered non-goal
    ("preserve unowned desktops") plus a session-persistence gap neither
    spec nor tests covered.
  - Corroborating live evidence: current desktop names are `Desktop 1..4`
    (KDE default naming) then bare `5..12`, matching this script's own
    creation-naming convention (`String(before.length + 1)`,
    `controller.ts:7823`) - consistent with desktops 5-12 having been
    script-created in an earlier session and then orphaned by a restart.
  - Journal for the full current session shows zero
    `workspace-cleanup-removed` occurrences, consistent with zero owned
    candidates existing in this session's fresh `ownedDesktopIds` state.
  - Received and encoded the user's corrected rule verbatim in spec.md:
    empty-and-invisible-on-every-output is the sole eligibility condition;
    ownership is no longer part of it. Flagged one consequential decision
    (spec.md Q2) rather than assuming it: the corrected rule, taken
    literally, also removes the "one reserved trailing empty" affordance
    `Meta+0`/`Meta+Shift+0` relied on, meaning those shortcuts would need to
    create a desktop on demand rather than jump to an always-available
    spare. This is a real behavioral change beyond "clean up more
    aggressively" and needs an explicit ruling before Unit 4 (plan.md)
    implements it either way.
- Blocker / required decision: spec.md Q1 (Bug 1 live repro) and Q2 (Bug 2
  `Meta+0` consequential decision) both block their respective implementation
  units and need Orchestrator/user rulings before dispatch.
- Live-session safety: only read-only D-Bus queries (`qdbus` against
  `org.kde.kglobalaccel`, `org.kde.KWin` `/VirtualDesktopManager`,
  `/Effects` was not touched), `journalctl --user` reads, `ps`/`pgrep`, and
  the already-standing-authorized `dogfood-install.sh status` were performed.
  No shortcut was invoked, no desktop was created or removed, no window was
  moved or focused, and no KWin mutation (`reconfigure`, script
  enable/disable, effect load/unload) occurred. The user's live 12-desktop,
  2-occupied-desktop session was left exactly as found.

## 2026-08-18 (Lead implementation stint, Bug 1 only)

- Role / unit: Lead / Unit 1 + Unit 2 / attempt-1. Done directly by the Lead
  (no `worker-anthropic` dispatch this stint).
- User rulings received before this stint: Q1 (Bug 1 confirmed still failing,
  user re-tested live) and Q2 (Bug 2's `Meta+0`/`Meta+Shift+0` is
  create-on-demand, no reserved spare, no exceptions) - see spec.md "User
  rulings". Q2 recorded in spec.md; Bug 2 itself not implemented this stint.
- N1 hypothesis verification (before any fix written):
  - Confirmed host layout is `us` (`localectl status`: `X11 Layout: us`;
    `setxkbmap -query`: `layout: us`).
  - Traced KWin 6.7.3 source (the exact pinned version running, PID 23049,
    confirmed via `kwin_wayland --version`) end to end:
    `Xkb::modifiersRelevantForGlobalShortcuts()` (`src/xkb.cpp:903-937`)
    strips Shift from the delivered global-shortcut modifiers whenever the
    keysym transition it caused isn't a letter (BUG 370341's exemption is
    letter-only); a digit's Shift-level symbol (`5` -> `percent`) is not a
    letter, so Shift is always stripped for `Meta+Shift+<digit>` on this
    layout. `KeyboardInputRedirection::processKey()`
    (`src/keyboard_input.cpp:306-320`) resolves the delivered `Qt::Key` from
    the actual keysym (`percent`), pairing it with the Shift-stripped
    modifiers. `KWin::Script::registerShortcut()`
    (`src/scripting/scripting.cpp:387`) parses `"Meta+Shift+5"` via
    `QKeySequence`'s `PortableText` parser
    (`qkeysequence.cpp::decodeString`), producing
    `Meta+Shift+Key_5` - never equal to the delivered `Meta+Key_Percent`.
    `kglobalacceld`'s `GlobalShortcutsRegistry::keyEvent()`
    (`globalshortcutsregistry.cpp:479-521`) matches by exact integer
    equality, so the callback is provably unreachable.
  - Cross-checked with Node arithmetic reproducing Qt's int-combination rules
    for all ten digits: every registered `Meta+Shift+<digit>` value differs
    from its actually-delivered `Meta+<symbol>` value; the delivered value
    exactly equals what `QKeySequence("Meta+<symbol>")` parses to.
  - Checked all 19 live KGlobalAccel components for `Shift+<digit>` precedent:
    none, except a pre-existing residue discussed below (found only after the
    fix's own live registration, not before).
  - **Verdict: hypothesis confirmed**, not force-fit; matches every piece of
    prior read-only evidence (registration succeeds, handler never invoked,
    sibling `Meta+N`/`Meta+0` fire normally in the same session).
- N2 fix implemented (`kwin/src/controller.ts`):
  - Added `SHIFT_DIGIT_SYMBOL_ALIAS` (digit -> QWERTY shift-row symbol map),
    `symbolForDigit()`, and a `compatibility-alias` catalog row per digit
    (`move-workspace-<N>-symbol`, shortcut ID
    `plasma-auto-tiler-move-workspace-<N>-symbol`) plus
    `move-workspace-0-symbol` (`moveWorkspaceZeroSymbolRow()`), each
    dispatching to the identical `moveActiveToWorkspace(index)` handler and
    keeping the unconditional `workspace-move-invoked:<index>` diagnostic.
    The canonical `Meta+Shift+<digit>` rows are unchanged and stay registered
    (correct on AZERTY-style layouts).
  - `REGISTERED_PROFILE_ACTION_IDS` and the `profileActions` dispatch map in
    `start()` updated to include the new action IDs for all three profiles
    (cosmic, hyprland, bspwm all call `workspaceRows()`/`moveWorkspaceZeroRow()`
    and now get the alias rows automatically).
  - Layout-robustness tradeoff recorded in spec.md: no layout-introspection
    or scancode-level registration surface exists in the KWin JS scripting
    API; a full per-layout symbol table was evaluated and rejected as
    over-engineering. The `!@#$%^&*()` alias is correct for US and most
    QWERTY-family layouts; layouts whose shift-row symbols differ (e.g. UK
    GB's `Shift+3` = `£`) are not covered by the alias and still depend on
    the canonical row, which is correct precisely for AZERTY-style layouts.
  - `docs/reference-wm-comparison.md`'s Primary source list gained one new
    `[PAT-Shift]` tag (project-internal, not an external WM reference)
    documenting the mechanism, satisfying the project's own catalog-reference
    tag test.
- N2 tests: `kwin/tests/controller.test.ts` and
  `kwin/tests/artifact-smoke.test.ts` updated - three profile-catalog pinned
  fixtures (cosmic/hyprland/bspwm) gained the new alias rows in their
  `compatibility-alias` projections; `REGISTERED_PROFILE_ACTION_IDS`
  derivation test updated; `EXPECTED_SHORTCUT_COUNT` 52 -> 62; two new
  focused tests added confirming `plasma-auto-tiler-move-workspace-2-symbol`
  and `plasma-auto-tiler-move-workspace-append-symbol` dispatch identically
  to their canonical siblings (`workspace-move-invoked:<index>` emitted,
  desktop membership/creation identical). **Test count: 805 -> 807, all
  passing.** `npm --prefix kwin run typecheck` and
  `npm --prefix kwin run build` both clean.
- N3 live verification:
  - Confirmed same KWin PID (23049) as the diagnosis stint.
  - `dogfood-install.sh install` (rebuild + copy, standing-authorized):
    installed bundle byte-identical to repo tip after.
  - `dogfood-install.sh disable` then `enable` (standing-authorized) to force
    a live reload. Journal (`_PID=23049`, after-cursor bounded read) showed
    `shortcut-registered` and `startup-handlers-ready` with **zero**
    `shortcut-register-failed` entries.
  - `qdbus --literal org.kde.kglobalaccel /component/kwin
    .../allShortcutInfos`: all ten new `-symbol` actions' active sequences
    match the mathematically-derived delivered-event integers exactly (e.g.
    `move-workspace-5-symbol` = 268435493 = `Meta+Key_Percent`, matching
    Shift+5's actual delivered keysym on this layout).
  - **New finding, not resolved this stint:** `~/.config/kglobalshortcutsrc`'s
    `[kwin]` group already contains a pre-existing, unidentified residue -
    `move-and-switch-to-desktop-1..9` / `move-to-last-desktop` - bound to the
    **identical** ten `Meta+<symbol>` sequences this fix's aliases use. These
    action IDs exist nowhere in four independently pinned KWin source trees
    (not native), and the only installed KWin script is this project's own
    (Krohnkite is present on the host but its `main.js`/`script.js` never
    call `registerShortcut`) - so this is unattributed residue from an
    unidentified earlier probe/script, predating this stint (its origin was
    not created by anything done this stint). Per KWin's own
    `GlobalShortcutsRegistry::registerKey()`/`activeShortcutByKey()`
    (`globalshortcutsregistry.cpp:869-925,408-446`), multiple actions can
    share one physical key; on an actual press only the lowest-`serial()`
    (earliest-registered) action fires. The residue predates and thus
    out-registers this stint's freshly (re)created alias actions, so **this
    project's new alias shortcuts are currently shadowed on this host** even
    though they registered correctly. Did not attempt to clear this residue:
    its origin is unverified, clearing an unidentified action's shortcut is
    outside this stint's granted authorization, and stopping-to-report is the
    documented safety response to a baseline surprise. Escalated as spec.md
    Q4.
  - Consequently, **could not obtain live proof of an actual key press
    triggering the handler and moving a window.** Did not attempt to trigger
    via `invokeShortcut` (bypasses the real xkb delivery path entirely, so it
    would prove nothing about the actual bug) or via any window/desktop
    manipulation that could touch the user's real active window (unsafe:
    `moveActiveToWorkspace()` operates on whatever window is currently
    focused in the real session and switches the current desktop - with the
    user "actively working," `activeWindow()` could easily be one of his real
    windows). Did not ask the user to press a key during this stint (not
    requested as a blocking dependency; noted as a follow-up he can do
    himself once Q4 is resolved).
  - **Side effect discovered and handled:** the `disable`+`enable` reload
    triggered Bug 2's own already-diagnosed defect live
    (`ownedDesktopIds` resets on every script restart) - the script's startup
    replenish logic created one new empty trailing desktop (`Desktop 13`,
    journal: `workspace-created-owned`, `workspace-cleanup-replenished`).
    Attempted a read-only-safe `removeDesktop` via `qdbus` on the new,
    provably-empty (created seconds earlier, never visible) desktop; the
    still-running script's own replenish logic recreated a new one within
    the same second (confirmed by a changed UUID). Did not loop further.
    Left the plugin enabled (matching the exact pre-stint baseline,
    `enabled: yes`) rather than disabling it (which would have regressed the
    user's tiling functionality below baseline). The user's original 12
    desktops (1-12, identical UUIDs/names/order) and current desktop
    (`Desktop 1`, unchanged) were not touched; only one new empty, invisible,
    harmless desktop remains as a known Bug 2 artifact that would occur on
    any restart of this already-installed, already-enabled plugin regardless
    of this stint's work.
- N4: this entry plus spec.md/plan.md updates constitute the unit record.
- Files / commit: `kwin/src/controller.ts`, `kwin/tests/controller.test.ts`,
  `kwin/tests/artifact-smoke.test.ts`, `kwin/contents/code/main.js` (rebuilt
  bundle), `docs/reference-wm-comparison.md`,
  `docs/changes/workspace-management-fixes/{spec.md,plan.md,log.md}`. Not
  committed (per instruction: the user commits himself).
- Verification: `npm --prefix kwin run typecheck` clean;
  `npm --prefix kwin test` 807/807 passing (up from 805); live registration
  confirmed via `journalctl`/`qdbus` as above; live callback/window-move
  proof not obtained (blocked by Q4, see above).
- Blocker / required decision: spec.md Q4 (KGlobalAccel residue origin and
  whether it is safe to clear) blocks full live proof of Bug 1's fix on this
  host. Fix design itself is not blocked and is considered complete.

## 2026-08-18 (Lead verification stint: AZERTY claim check, residue
identification, live-firing check)

- Role / unit: Lead / verification, no implementation unit; done directly
  (`worker-anthropic` not needed for read-only investigation). No production
  code changed.
- T1 (AZERTY claim, false - corrected): traced
  `Xkb::modifiersRelevantForGlobalShortcuts()` (`xkb.cpp:903-937`) again
  specifically for the AZERTY digit-row case, and pulled the actual `fr` xkb
  symbols data (`/tmp/opencode/kwin-src`, plus standard xkeyboard-config data
  present on this host under a nix-store fhsenv path):
  `key <AE01> { [ ampersand, 1, onesuperior, exclamdown ] }` etc. confirms
  AZERTY's digit-row keys have the digit on the *shifted* level, symbol
  unshifted - the reverse of US. Since `QChar::isLetter(<digit>)` is false,
  Shift is stripped exactly as for a symbol-shifted key; the delivered event
  for `Meta+Shift+<AZERTY-digit-key>` is `Meta+<digit>` (Shift gone), which
  collides with this project's own `Meta+<digit>` focus-workspace binding
  (`controller.ts:563`). **Verdict: the prior stint's "correct on AZERTY"
  claim was wrong.** AZERTY is not a working case for the canonical row; it is
  a second silent collision. Also checked `gb` and `de` xkb symbols data:
  UK's `-symbol` alias is correct for 8/10 digits (`gb` shift row differs from
  US only at 2/3: `"`,`£` vs `@`,`#`); German QWERTZ's alias is correct for
  only 3/10 (`de` shift row `!"§$%&/()=` vs US `!@#$%^&*()`). Corrected
  spec.md/plan.md in place (struck the wrong claim, added a "Layout
  verification matrix", did not soften the correction).
- T1d (layout-introspection reachability, prior claim overstated - corrected):
  confirmed `registerShortcut()` itself has no scancode/layout parameter
  (`scripting.cpp:376`, `scripting.h:127`), but found `Script::callDBus()`
  (`scripting.h:115`, a generic D-Bus invokable available to every KWin JS
  script) can reach the session-bus `org.kde.keyboard` `/Layouts` service
  (`getLayout()`/`getLayoutsList()`, live-tested, returns `us`/index 0 on this
  host). A correct general fix (query layout at script start, look up a
  per-layout shift-row table, register the matching alias) is therefore
  achievable in principle, at the cost of building/maintaining that table (no
  live `layoutChanged` subscription is available to `Script`, so it would only
  be correct as of script start). Recorded this precisely in spec.md rather
  than accepting the prior "no such surface" framing at face value.
- T2 (residue identification): searched this repo's git history
  (`git log --all -S`) for the residue's action-ID strings - zero hits, ruling
  out this project as the origin. Found the strings in
  `/home/beefsack/Development/dotfiles-nix/modules/home/displayManager/plasma6.nix`
  (lines 15-54), the user's own Home-Manager config repo, git-committed
  2026-08-10 (`ecbb5ff` "Change to KDE Plasma") - **predates this project's
  diagnosis stint by 8 days, unrelated to it.** This is a custom KWin script
  (`KPlugin.Id: "last-desktop"`) deployed via `xdg.dataFile`, enabled via
  `"kwinrc"."Plugins"."last-desktopEnabled" = true`, independently
  implementing the identical shifted-symbol workaround for
  `Meta+Shift+<digit>`, plus a comment recording that
  `pkgs.kdePackages.dynamic-workspaces` (also declared there) is the user's
  own solution to "the last desktop is always empty" - i.e. his own answer to
  Bug 2's problem too. Cross-checked: not native KWin (`useractions.cpp` /
  `virtualdesktops.cpp` use `Window to Desktop %1` / `Switch to Desktop %1`,
  a different naming scheme, confirmed directly in source, not just trusted
  from the prior stint); not Krohnkite (its 35 `kglobalshortcutsrc` entries
  are all `Krohnkite*`-prefixed, none desktop-switching); not declared in the
  user's `/home/beefsack/Development/home-manager` checkout (that is upstream
  home-manager source, not his personal config - ruled out by grep, zero
  hits). **T2a verdict: these entries belong to a tool the user actively
  maintains himself (git-committed, declaratively deployed). Per the explicit
  stop condition, they were NOT removed.** No backup was taken and no
  `kwriteconfig6` mutation was performed (T2b/T2c not executed - correctly
  gated by T2a's own outcome).
- T3 (live-firing proof, read-only): used
  `org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel.action(<key-int>)`
  (a more precise, authoritative API than `allShortcutInfos`, not used by the
  prior stint) to query, per digit, which action currently wins each
  `Meta+<symbol>` sequence. Result for all ten tested (1,2,3,4,5,6,7,8,9,0):
  `move-and-switch-to-desktop-<N>` / `move-to-last-desktop` (the user's
  `last-desktop` script's actions), never this project's
  `plasma-auto-tiler-move-workspace-<N>-symbol` rows - **definitively
  confirmed shadowed, not just inferred from registration order.** Also
  confirmed `~/.local/share/kwin/scripts/last-desktop/` does not currently
  exist on disk and `isScriptLoaded("last-desktop")` is `false` live (same
  gap pattern as the already-known Krohnkite case). Net conclusion: a
  physical `Meta+Shift+<digit>` press right now would almost certainly be
  claimed by the dead `move-and-switch-to-desktop-N` action and do nothing
  observable - it would not test this project's fix, and it would not work as
  the user's own script intends either, since neither has a live receiver for
  that action name right now. **Did not ask the user to press a key**: a
  keypress in this state would not produce evidence distinguishing "this
  project's fix works" from "nothing is currently wired up," and doing so
  serves no diagnostic purpose until the Q4 scope question is resolved.
- Safety: read-only D-Bus queries only (`qdbus` against
  `org.kde.kglobalaccel`/`org.kde.keyboard`/`org.freedesktop.locale1`),
  `localectl`/`setxkbmap` reads, file reads (KWin source, xkb symbols data,
  `dotfiles-nix`, `kglobalshortcutsrc`), `git log`/`git status`/`git diff`
  (read-only) in both this repo and `dotfiles-nix`. No shortcut invoked, no
  window moved or focused, no desktop created/removed, no config file
  written, no KWin mutation (`reconfigure`, enable/disable, `loadScript`) 
  performed. The user's windows and 13-desktop layout were not touched.
- Files / commit: `docs/changes/workspace-management-fixes/{spec.md,plan.md}`
  edited (corrections, not append-only); this log entry appended. Not
  committed (per instruction: the user commits himself).
- Verification: source-trace and xkb-symbols-data-based (not assumption) for
  T1/T1d; git-history-based (not assumption) for T2's origin identification;
  live read-only D-Bus query (`KGlobalAccel.action()`) for T3's shadowing
  confirmation.
- Blocker / required decision (escalated, not resolved): whether Bug 1's fix
  (and any Bug 2 implementation) should proceed at all, given the user has his
  own pre-existing, git-committed, Home-Manager-declared solution to both
  problems (`last-desktop` script, `dynamic-workspaces` package) that this
  project's work is currently redundant with and shadowed by. This is a scope
  decision for the Orchestrator/user, recorded in spec.md Q4 and plan.md
  Residual Risks, not resolved this stint.

## 2026-08-18 (Lead stint: Q4 resolved by user - remove competing tooling,
clear residue, backlog the layout-introspection fix)

- Role / unit: Lead / Q4 resolution / -. Done directly; no `worker-anthropic`
  dispatch needed (small, bounded, mostly read-only-then-precise-write work).
- User ruling received: proceed with Bug 1's shipped fix as-is (US table);
  layout-introspection generalization is explicitly deferred, not built this
  stint, and recorded as a backlog LAUNCH BLOCKER instead. The user's own
  competing tooling (`last-desktop` script, `dynamic-workspaces` package) is
  to be removed from his `dotfiles-nix` config (a separate repo this Lead was
  newly authorized to edit but not commit/push in), and the orphaned
  `kglobalshortcutsrc` residue it left behind is to be cleared.
- `dotfiles-nix` edit (not committed/pushed, per standing prohibition;
  `nix-instantiate --parse` confirms the file still parses):
  removed `pkgs.kdePackages.dynamic-workspaces` from `home.packages`, the
  entire `xdg.dataFile."kwin/scripts/last-desktop/..."` script declaration
  (metadata + `main.js`, ~42 lines), and `dynamic_workspacesEnabled`/
  `"last-desktopEnabled"` from `"kwinrc"."Plugins"`. Nothing else touched:
  the `shortcuts.kwin."switch-to-last-desktop" = "Meta+0";` binding and the
  comments referencing "last-desktop"/"the last desktop is always empty" in
  the `shortcuts` block were deliberately left untouched (entangled with the
  user's own `Meta+0` intent, out of this stint's precise two-item removal
  scope; not silently resolved).
- `kglobalshortcutsrc` residue clearance: backed up to
  `/tmp/plasma-auto-tiler-kglobalshortcutsrc-backup-20260818-195648.ini`
  (sha256 `f0f9c902e21785e2772bf83a27a48182c2337f9b846d6cf89faeb1a1b6c79e0`)
  before any mutation. Cleared exactly the ten named entries
  (`move-and-switch-to-desktop-1..9`, `move-to-last-desktop`) via
  `org.kde.KGlobalAccel.setShortcutKeys` (`SetPresent|NoAutoloading`, empty
  key-sequence array) rather than direct `kwriteconfig6` file editing, per
  `docs/live-kwin-testing.md`'s own documented contract for releasing a
  conflicting disabled component's shortcut (`kglobalaccel` owns and can
  rewrite this file live; a direct file edit risked being silently
  overwritten or not taking effect until a daemon reload). Verified via
  `allShortcutInfos` (all ten now show an empty active-sequence array) and
  via a `diff` against the pre-mutation backup (exactly those ten lines
  changed from `Meta+<symbol>` to `none`; `switch-to-last-desktop`, not in
  the named list, left untouched as instructed).
- Live-firing confirmation: `org.kde.KGlobalAccel.action(<key-int>)` for all
  ten previously-shadowed `Meta+<symbol>` sequences now returns this
  project's own `plasma-auto-tiler-move-workspace-<N>-symbol` /
  `-append-symbol` actions (previously returned the dead
  `move-and-switch-to-desktop-<N>` actions per the prior verification
  stint). The shadowing is resolved.
- T3 (prove the fix fires): **not attempted, stopped per the task's own
  branching rule.** `invokeShortcut` was rejected again for the same reason
  the prior implementation stint rejected it: Bug 1's defect is specifically
  in the xkb keysym-delivery layer that `invokeShortcut` bypasses entirely,
  so it would prove nothing about the actual bug. A safe live proof requires
  the tested window to be a disposable throwaway made active on a high empty
  desktop (per instruction), which itself requires switching the visible
  current desktop away from wherever the user is working - a real-time,
  synchronous disturbance this stint has no channel to coordinate with an
  actual keypress moment for. No window was launched, no desktop was
  switched, no client focus was changed. Exact keypress and exact journal
  line to request are reported to the Orchestrator/user directly (not
  repeated here; see chat output), rather than guessed or attempted
  unsupervised.
- `docs/backlog.md`: added one new entry (LAUNCH BLOCKER, P1) recording the
  layout-introspection generalization Q4 deferred: `Xkb::modifiersRelevantForGlobalShortcuts()`
  strips Shift from global shortcuts when the shifted keysym isn't a letter
  (`src/xkb.cpp:903-937`); the shipped alias table is correct only for US,
  8/10 on UK, 3/10 on German QWERTZ, and silently collides with this
  project's own `Meta+<digit>` focus-workspace binding on AZERTY; the general
  fix is achievable via `Script.callDBus()` against `org.kde.keyboard`
  `/Layouts`. Linked to this change directory.
- Safety: KWin PID unchanged (23049) throughout; no shortcut invoked, no
  window created/moved/focused, no desktop created/removed/switched, no KWin
  mutation (`reconfigure`, enable/disable, `loadScript`) performed. Only the
  ten named `kglobalshortcutsrc` entries were touched, via the documented
  D-Bus setter contract, with a pre-mutation backup retained. The user's
  windows, 13-desktop layout (12 real + 1 stray empty), and all other
  shortcuts/config were not touched.
- Files / commit: `docs/backlog.md` (new entry),
  `docs/changes/workspace-management-fixes/log.md` (this entry, appended);
  `~/Development/dotfiles-nix/modules/home/displayManager/plasma6.nix`
  edited but **not committed** (separate repo, user commits himself);
  `~/.config/kglobalshortcutsrc` mutated live via D-Bus (not a repo file).
- Verification: `nix-instantiate --parse` clean for the dotfiles-nix edit;
  `allShortcutInfos`/`action()` D-Bus queries and a diff against the retained
  backup for the shortcut clearance; `npm --prefix kwin run typecheck` and
  `npm --prefix kwin test` (807/807) re-run clean before this stint's commit
  to confirm no drift.
- Blocker / required decision: T3's live proof remains outstanding, exact
  keypress and journal line reported to the Orchestrator/user for a future
  interactive stint. Bug 2 remains unimplemented (unchanged, out of scope).

## 2026-08-18 (Lead succession: Q5-Q7 ruling + Bug 2 Unit 4)

- Role / unit: Lead (successor, lead-anthropic) / spec-plan amendment + Unit 4
  / attempt-1 + 1 correction.
- User rulings received (via Orchestrator dispatch brief, pre-approved edit
  authorization): Q5 remove immediately on output disconnect, no grace period;
  Q6 always create new, never reuse even transiently; Q7 broaden removal to
  fire on every `cleanupDesktops()` dispatcher event, not only workspace
  switch. Encoded into spec.md ("User rulings", Bug 2 acceptance criteria
  "Removal trigger scope"/"Output disconnect", Unresolved Questions) and
  plan.md (Pending Decisions, Unit 4 row scope, Status).
- Pre-dispatch reconciliation (Lead, direct read, not delegated - scoping
  only): confirmed via grep/read that `cleanupAfterWorkspaceSwitch`'s
  `protectedTrailingIdsForSwitchCleanup`/`trailingOwnedEmptyId` helpers have
  no callers outside that one call site (dead-code-on-removal); confirmed
  `cleanupDesktops`'s ~10 call sites (`handleWindowRemoved`,
  `handleWindowAdded`, `reevaluateDesktopScope`, `handleInteractiveFinished`,
  `dropPendingRebuild`, `handleDesktopsChanged`, `moveFloatingWindow`,
  `adoptMovedWindow`, `handleScopeChange` via both `handleScreensChanged` and
  `handleCurrentDesktopChanged`, `disabled`); confirmed `handleScreensChanged`
  already routes through `handleScopeChange` -> `cleanupDesktops`, so
  broadening the trigger (Q7) automatically also satisfies Q5 (output
  disconnect) without separate disconnect-timing state.
- Unit 4 dispatched to `worker-anthropic`: `planDesktopCleanup`
  (`kwin/src/logic.ts:823-868`) drops `ownedIds`/`protectedTrailingIds` from
  `DesktopCleanupRequest` and the predicate; `cleanupAfterWorkspaceSwitch`
  renamed `cleanupEligibleDesktops`, its `planDesktopCleanup` call updated,
  now called unconditionally at the end of every `cleanupDesktops` branch
  (the four `if (switchCleanup)` gates removed); dead
  `protectedTrailingIdsForSwitchCleanup`/`trailingOwnedEmptyId` deleted;
  `switchCleanup` parameter removed from `cleanupDesktops`/`handleScopeChange`.
  Generic (mode-independent) tests updated in `logic.test.ts` and the
  "TileController dynamic virtual desktops" block of `controller.test.ts`
  only; per-mode blocks explicitly left untouched per brief.
- Lead inspection (direct diff read, not the Worker's summary): `git diff`
  confirmed the change matches the brief exactly - clean removal of the two
  eligibility fields/checks, clean gate removal at all four sites, dead-code
  deletion confirmed correct (no other callers). Found one issue: the doc
  comment above `cleanupDesktops` still claimed "Pre-existing and user-owned
  desktops are never removed" - stale, contradicts the unit's own change.
  Returned one same-scope correction (comment-only); Worker fixed it, diff
  re-inspected directly, confirmed isolated to that one comment.
- Verification (Lead-run directly, not just Worker-reported):
  `npm --prefix kwin run typecheck` clean (twice - post-implementation and
  post-correction). Full `npm --prefix kwin test`: 795/805 pass, 10 fail, all
  confined to the `Unit 05`/`Unit 06`/`Unit 07` per-mode describe blocks
  (still asserting the superseded ownership/reserved-spare model) plus one
  `Unit 04` seam test - independently confirmed via the log's own
  `✖`/"failing tests:" list, matching the Worker's reported count and named
  blocks exactly. `logic.test.ts` (80 tests) and the generic dynamic-desktops
  block independently green.
- Files / commit: `kwin/src/logic.ts`, `kwin/src/controller.ts`,
  `kwin/tests/logic.test.ts`, `kwin/tests/controller.test.ts`,
  `kwin/contents/code/main.js` (rebuilt bundle),
  `docs/changes/workspace-management-fixes/{spec.md,plan.md,log.md}`. Not
  committed (queued for the completion-transaction commit after Units 5-10).
- Blocker / required decision: none. Units 5-7 (per-mode replenish deletion +
  create-on-demand) next, each depends on Unit 4 (accepted).

## 2026-08-19 (Lead succession 3: unit-05 investigation, plan restructure)

- Role / unit: Lead (successor, lead-anthropic) / unit-05 attempt-1 (still
  open) / architectural discovery + plan amendment.
- Created `state.md` on this succession (second Lead succession on this
  change, per the Expanded-trigger rule in `artifacts.md`).
- Dispatched `worker-anthropic` on unit-05 (`per-output-local`). Across five
  same-session rounds, the Worker: (1) correctly identified its brief's
  stated 795/805 baseline as stale/wrong via direct measurement, prompting a
  Lead-directed re-isolation that confirmed the true baseline actually
  matched plan.md exactly (10 failures: 6/2/2 across Units 05/06/07); (2)
  implemented the core per-output-local no-replenish/always-create change
  cleanly; (3) on Lead authorization to widen test scope to the legacy
  `dynamic virtual desktops` and `Unit 04` blocks (discovered to also
  exercise per-output-local's single-output degenerate case), found a
  genuine shared-code defect: `removeOwnedEmptyDesktop`/
  `removeOwnedEmptyGlobalUnique`/`removeOwnedEmptyShared` share a
  `position === lastIndex` guard that blocks removing the positionally-last
  desktop - safe only because reconcile always replenished a new one behind
  it; (4) on Lead authorization to remove that guard (reasoning:
  `planDesktopCleanup`'s own last-desktop floor should be sufficient), found
  it made things worse (42 failures) because the three reconcile functions
  independently still protect one "kept" trailing desktop (a reserved-
  capacity pattern Q6 already rejected) with nothing else backstopping it;
  (5) on Lead authorization to also strip that reserved-capacity/trim-to-one
  logic from all three reconcile paths, found the *fourth* compounding
  issue and correctly stopped without guessing further: global-unique's and
  shared's own `Meta+0`/`Meta+Shift+0` logic still assumes reconcile
  guarantees a trailing empty exists to reuse (that assumption is unit-06/07
  territory, explicitly out of this dispatch's scope), so removing
  replenish from their reconcile paths broke their own previously-passing
  tests, not just the known 4.
- Lead conclusion (architectural, not a new product decision - directly
  implied by the already-approved Q6/Q7 rulings, not escalated): Units 5-7
  are not independently implementable at the code level as originally
  planned. The reconcile-removal unification (no replenish, no
  reserved-capacity trim-to-one, `cleanupEligibleDesktops` as sole removal
  authority) is one atomic shared-foundation change across all three modes,
  and each mode's `Meta+0`/`Meta+Shift+0` always-create change must land
  together with it or the intermediate state breaks the other two modes.
  plan.md amended: Units 6 and 7 marked superseded/merged into an expanded
  Unit 5 covering all three modes at once. Recorded under autonomous-mode
  authority (no acceptance criteria changed, only the internal work
  breakdown); to be reported prominently to the Orchestrator on return
  rather than treated as silently resolved.
- Current working-tree state: `kwin/src/controller.ts` holds only the
  smallest safe slice - per-output-local no-replenish + always-create
  `Meta+0`/`Meta+Shift+0` - with every broader attempt (guard removal,
  reconcile unification) cleanly reverted and Lead/Worker-verified via
  direct diff comparison after each revert. No test files modified yet.
  `npm --prefix kwin run typecheck` clean throughout.
- Files / commit: none yet for this unit's substantive change (still
  in-flight); `docs/changes/workspace-management-fixes/{plan.md,log.md}`
  updated this stint. Not committed.
- Verification: each of the Worker's four escalating attempts was
  independently confirmed reverted-and-clean before the next authorization
  (typecheck + diff-against-saved-patch each time, Worker-reported, not
  re-verified redundantly by the Lead per corpus-ownership - the Worker
  already held and had just produced this evidence).
- Blocker / required decision: none for the Lead to escalate further - the
  path forward (consolidated Unit 5 covering all three modes) is clear and
  authorized. Next action: dispatch a fresh `worker-anthropic` with the full
  consolidated brief (this session's Worker has now run five long rounds;
  starting fresh with a compressed, complete brief per
  `references/scheduling.md`'s reassessment rule is preferred over a sixth
  round on the same session).
- **Lead return-threshold note:** this Lead is at its own return threshold
  (~20 tool calls) after this investigation and plan-restructure work, with
  zero units accepted this stint (unit-05/expanded is still open, not yet
  dispatched to a fresh Worker). Returning `handover` now per the
  scheduling rule ("reaching one is the normal end of a bounded stint... the
  role reports handover and stops, and never schedules more tasks to fit")
  rather than starting a sixth investigation round or a fresh dispatch this
  stint.

## 2026-08-19 (Lead succession 4: unit-05 source-change dispatch and accept)

- Role / unit: Lead (successor, lead-anthropic) / unit-05 attempt-1, source-
  change half.
- Read `state.md`'s fully-specified next-dispatch brief (left by the prior
  Lead) plus `plan.md` and `spec.md`'s governing clauses; did not re-derive
  the discovery chain.
- Before dispatch, read the actual current `kwin/src/controller.ts` directly
  (reconcile functions, `removeOwnedEmpty*`, `cleanupDesktops`,
  `cleanupEligibleDesktops`, all `Meta+0`/`Meta+Shift+0` call sites) to write
  a precise, code-level brief with exact target snippets rather than a
  restated narrative, given this unit's history of imprecise-scope failures.
- Dispatched one `worker-anthropic` (confirmed correct type in its own
  report) with a `kwin/src/controller.ts`-only brief: gut all three reconcile
  paths to mapping-rebuild only; remove the `position === lastIndex` guard
  and its parameter from all three `removeOwnedEmpty*` functions; convert
  `global-unique`/`shared` `Meta+0`/`Meta+Shift+0` handling to always-create
  across four call-site groups, matching `per-output-local`'s already-
  converted pattern; delete now-dead helpers only after confirming zero
  callers; fix the resulting unused-local fallout; sweep seven specific stale
  doc comments; typecheck as the sole gate; explicit stop-on-surprise for a
  fifth compounding issue. Attempt-1, 0 corrections, `review-ready` on first
  return.
- Lead review (not just the Worker's summary): ran `npm --prefix kwin run
  typecheck` directly (clean, both configs); read the full `git diff` for
  `kwin/src/controller.ts` (896 lines) end to end; cross-checked one apparent
  discrepancy (the diff appeared to show Unit 4's already-accepted
  `switchCleanup`/`protectedTrailingIdsForSwitchCleanup` removal happening
  "now") against a direct read of `kwin/src/logic.ts`'s diff and resolved it
  correctly as an artifact of `git diff` comparing against `HEAD` (nothing
  committed since Unit 1-2's commit `538ad7f`), not a real discrepancy - Unit
  4's `logic.ts` change is intact and unaffected. Grep-confirmed zero
  remaining occurrences of `workspace-cleanup-replenished`, `trailingOwnedEmpty`,
  `protectedTrailingIds`, `switchCleanup`, `position === lastIndex`, or
  `ownedIds` as a `planDesktopCleanup` argument in `controller.ts`. Accepted
  the source-change half of unit-05.
- Minor residual noted, not a blocker: two stale "trailing-empty replenish"
  doc-comment mentions survive (`appendDesktopForOutputKey`,
  `appendDesktopForGlobalUnique`), and the `already-trailing-empty` no-op
  diagnostic branches in `focusTrailingEmpty`/`finishSharedWorkspaceZero` are
  now practically unreachable under always-create. Flagged for unit-08 or a
  future dead-code pass, not worth a correction round.
- `state.md` and `plan.md` (Progress, Acceptance-Criterion Evidence)
  rewritten to record this and specify the exact next dispatch (test-update
  half of unit-05: `controller.test.ts`'s five affected blocks) in full,
  since this Lead has not read `controller.test.ts` and cannot pre-specify
  individual test bodies.
- Blocker / required decision: none. Files / commit: none yet (still
  uncommitted, queued for the eventual Bug-2 completion-transaction commit
  once units 5 (both halves), 8, 9, 10 are all accepted).
- **Lead return-threshold note:** at/past this Lead's own ~20-tool-call
  return threshold after the dispatch, direct review, and record-keeping
  above. One unit's source-change half accepted this stint (test-update half
  intentionally not dispatched, to avoid starting a new bounded piece of work
  this late in the stint per the scheduling rule). Returning `handover` now.

## 2026-08-19 (Lead succession 5: unit-08)

- Role / unit: Lead (successor, lead-anthropic) / unit-08 / attempt-1, 0
  corrections.
- Dispatched `worker-anthropic` on unit-08 (Bug 2 full-suite reconciliation),
  scoped from state.md's residuals list: (1) fix two stale "replenish" doc
  comments (`appendDesktopForOutputKey`, `appendDesktopForGlobalUnique`); (2)
  independently re-verify and, if genuinely unreachable, remove the
  `already-trailing-empty` no-op branches in `finishSharedWorkspaceZero` and
  `focusTrailingEmpty`; (3) fresh content-based sweep of `controller.test.ts`/
  `logic.test.ts` for any remaining removed-model reference (old plan.md line
  numbers 12530/12539/12967/14499 explicitly discarded as stale, per state.md
  instruction); (4) typecheck, full suite, build-twice reproducibility.
- Worker result: both doc comments rewritten to describe current always-create
  behavior (two other "replenish" hits inspected and confirmed already
  accurate, left alone). Both no-op branches confirmed unreachable (`target`
  in both cases is always a freshly-created id from `appendDesktop()`/
  wrappers, which cannot equal a pre-existing current-desktop id; single call
  site each; zero test references to `already-trailing-empty` in either test
  file) and removed, with the now-unconditional `else` behavior kept.
  Cascading `noUnusedLocals`/`noUnusedParameters` cleanup followed
  mechanically: `currentDesktopIdForOutput`/`currentDesktopIdGlobal` (only
  callers were the removed branches) and the now-unused `output` parameter of
  `finishSharedWorkspaceZero` were removed. Content sweep of both test files
  found no remaining stale reference to the removed model (all `ownedIds`/
  `protectedTrailingIds`/reuse/replenish-adjacent hits were either
  already-accurate current-behavior descriptions, the unrelated
  `configureSwitchCleanupScenario` helper name, or unrelated "reuses" hits in
  decode-cache/geometry code) - no test deletions required.
- Lead inspection (direct diff read, not the Worker's summary): read the full
  `git diff kwin/src/controller.ts`. Confirmed the two doc-comment edits, both
  branch removals, and the cascading unused-method/parameter removal exactly
  as reported. The bulk of the remaining diff (reconcile-body reductions,
  `trailingOwnedEmpty*` helper removals, `switchCleanup` param removal) was
  cross-checked against state.md's existing unit-04/unit-05 descriptions and
  confirmed pre-existing (uncommitted cumulative diff against `HEAD` still
  `538ad7f`, not new from this dispatch) - consistent with the same
  `HEAD`-comparison artifact already documented by the prior succession.
  `git diff --stat` for `controller.test.ts` (936) and `logic.test.ts` (26)
  matched the already-known unit-05 figures exactly, confirming the Worker's
  claim of zero test edits.
- Verification (Lead-run directly, not just Worker-reported):
  `npm --prefix kwin run typecheck` clean (both configs); `npm --prefix kwin
  run test`: `tests 802`, `pass 802`, `fail 0`, shell smoke `passes: 271
  failures: 0`; `npm --prefix kwin run build` run directly by the Lead,
  `sha256sum kwin/contents/code/main.js` = `ab6ad59d43a0317835fd101bc71893e
  46585a35b23307d74180bf931b0af9735`, matching the Worker's own two-run
  reproducibility check exactly.
- unit-08 **accepted**, attempt-1, 0 corrections.
- Files / commit: `kwin/src/controller.ts`, `kwin/contents/code/main.js`
  (rebuilt). Not committed (queued for the completion-transaction commit
  after units 9-10).
- Blocker / required decision: none. Next: unit-09 (live acceptance, highest
  risk - see spec.md/plan.md live-safety constraints), then unit-10
  (independent review).

## 2026-08-19, Lead succession 6 - unit-09 attempt-1, stopped on live-safety trigger, escalated

- User authorization received directly (relayed to this Lead): "Yes, enable
  now" for the unit-08 rebuilt bundle on the live host, with explicit
  conditions (preserve desktops 1/2 and windows, capture before/after,
  read-only occupancy where possible, throwaway-window-only test subject,
  stop and disable on any populated-desktop removal/window move/visible-
  desktop switch).
- Preflight (read-only, before any mutation): `dogfood-install.sh status` -
  installed yes, enabled yes, but the **installed bundle SHA-256
  (`7b960cb1...`) did not match the working-tree unit-08 build
  (`ab6ad59d...`)** - an older build was already running live, not unit-08's.
  `start-test.sh desktops` (read-only, proven contract) captured the full
  before-state: 13 desktops - position 0 `392a73ad-0fff-4b48-bb91-1b67eb82bc49`
  "Desktop 1", position 1 `83e443a3-b84a-417c-b5d1-02199836953d` "Desktop 2",
  positions 2-12 `ec13f70f.../41cee7be.../12a1bdb8.../5dd83523.../10a400bf...
  /2c17cd3b.../8a0b8ce5.../92f710b4.../b6179ebd.../c193a7ed.../0ad21d8f...`
  named "Desktop 3", "Desktop 4", "5".."12", "14". Current desktop (via
  `VirtualDesktopManager.current`) was `392a73ad...` (Desktop 1) throughout
  this record. `kreadconfig6 workspaceMode` was unset (default
  `per-output-local`).
  **Gap, recorded honestly: this Lead did not re-capture per-desktop window
  occupancy (a fresh, read-only, non-personal-data check) as its own
  baseline before mutating - it relied on an earlier Lead succession's
  inherited dispatch-brief statement that desktops 1/2 were populated,
  without independently re-verifying it was still true at this stint's
  start.** This is a process gap against the Orchestrator's explicit
  instruction to capture "which desktops hold windows BEFORE enabling,
  read-only" - only the desktop list/ID/name set was captured, not occupancy.
- `dogfood-install.sh install` re-staged the bundle; confirmed by direct
  SHA-256 comparison that the installed `main.js` now matched the working-tree
  `ab6ad59d...` build.
- First `dogfood-install.sh enable` (config already `true`, so this only
  re-wrote the same value and called `reconfigure`) produced **zero** new
  `plasma-auto-tiler:` journal lines after a fresh cursor - a real operational
  finding: KWin's `reconfigure` does not force an already-enabled script to
  unload/reload from disk when the enabled value does not change. Confirmed
  via `start-test.sh status`/`diagnostics`: the script was still `loaded` but
  running a stale in-memory instance from a much earlier session (historical
  epoch full of unrelated drag/window diagnostics, including old
  `workspace-cleanup-replenished` tokens from before the replenish-removal
  fix).
- Corrected: `dogfood-install.sh disable` then `dogfood-install.sh enable`
  (a true `false`->`true` transition) forced a genuine reload. Fresh-cursor
  journal capture (`_PID=23049`, filtered) showed a new, ordered startup
  epoch: `shortcut-registered`, `startup-handlers-ready`, and (before shortcut
  registration, matching `controller.ts` `start()` source order) **10
  `workspace-cleanup-removed` events, 0 `workspace-cleanup-replenished`
  events** - the no-replenish half of the Q5-Q7 ruling held live. One of the
  10 removals was preceded by live `drag-attach-ok:*` diagnostics roughly 4
  seconds after startup - consistent with the user actively working on his
  own session during this window, not an action this Lead took.
- Post-reload `start-test.sh desktops` (read-only): **3 desktops remained** -
  `392a73ad...` (Desktop 1, unchanged position 0), `ec13f70f...` (renamed/
  repositioned as "Desktop 3"), `41cee7be...` ("Desktop 4"). **Desktop 2
  (`83e443a3-b84a-417c-b5d1-02199836953d`) was among the 10 removed and did
  not survive.**
- This is a literal match to the Lead's explicit stop condition ("if any
  populated desktop is removed... stop immediately, disable, escalate").
  Given the occupancy-baseline gap above, this Lead cannot currently
  distinguish two explanations: (a) desktop 2 was still genuinely populated
  at removal time and the live rule wrongly treated it as empty/invisible -
  a real defect in Bug 2's implementation or its live evaluation of
  occupancy/visibility; or (b) desktop 2 had already become empty (windows
  closed or moved by the user) since the earlier Lead succession's dispatch
  brief was written, and removal was the correct, intended behavior the user
  already authorized. Both are live possibilities and neither is
  substantiated over the other by the evidence gathered so far.
- Immediate response: `dogfood-install.sh disable` run right away (confirmed
  by `dogfood-install.sh status`: `enabled: no`). A follow-up read-only check
  confirmed the current visible desktop was still `392a73ad...` (Desktop 1)
  throughout - the visible desktop never switched. No desktop was manually
  created or removed by this Lead, no window was moved, and no visible-desktop
  switch was performed by this Lead at any point. A `4th` desktop
  (`dd68d41e-91a5-41ab-bf4b-b4b634542d23`, named "4") appeared in a
  post-disable read-only check - the script was already disabled at that
  point, so this is attributable to the user's own live activity, not this
  Lead's or the script's action.
- unit-09 **not accepted**; attempt-1 stopped on a live-safety trigger, not a
  correction round or an ordinary failure. Escalated per the dispatch brief's
  explicit instruction rather than retried or forced. **Whether this is a
  real Bug 2 defect (occupancy/visibility evaluated wrongly for a desktop
  that still held windows) is the open question requiring the Orchestrator's
  and/or the user's direct input before any further live attempt**: (1) did
  desktop 2 still hold windows at the moment of this stint's mutation, and
  (2) are the user's windows/session otherwise intact right now. This Lead
  cannot safely determine either without either the user's direct
  confirmation or a read-only, non-personal-data occupancy query this Lead
  has not yet identified a safe method for.
- Files / commit: none (no source changed this stint; only the already-staged
  unit-08 bundle was installed/enabled/disabled live, all reversible
  standing-authorized operations. The live host's installed plugin directory
  now contains the unit-08 build but is disabled).
- Blocker: **yes, escalated** - see above. Unit-10 (independent review) and
  the completion transaction are both blocked on this being resolved; per the
  governing constraints, no commit/push is authorized while unit-09 has an
  open blocker.

## 2026-08-19, Lead succession 7 - blocker re-confirmed, no live action taken

- This succession's dispatch brief (from the Orchestrator) presented unit-09
  as a fresh, not-yet-attempted live sweep, with host status framed as
  "UNKNOWN" and a user authorization ("Yes, enable now") obtained directly by
  the Orchestrator. It did not reflect succession 6's already-completed
  attempt-1 or its unresolved stop condition.
- Read `state.md` first per this Lead's own brief instruction, which revealed
  the succession-6 incident (Desktop 2 removed, occupancy at removal time
  unconfirmed, standing blocker requiring Orchestrator/user confirmation
  before any further live action).
- Independently re-verified, read-only, no mutation: `dogfood-install.sh
  status` - `enabled: no`; `start-test.sh status` - plugin not loaded;
  `start-test.sh desktops` - 4 desktops (`392a73ad` Desktop 1, `ec13f70f`
  Desktop 3, `41cee7be` Desktop 4, `dd68d41e` "4"). Matches succession 6's
  post-disable record exactly; Desktop 2 (`83e443a3...`) has not reappeared.
  No further live action taken.
- Did not re-enable the plugin, did not attempt unit-09, did not dispatch
  unit-10, did not run the completion transaction. Escalated back to the
  Orchestrator per the standing blocker rather than proceeding on the
  brief's authorization, since that authorization did not account for the
  already-occurred incident. Full evidence handed back: before/after desktop
  lists (succession 6), current desktop list (this succession), and the two
  open questions requiring the user's own confirmation.

## 2026-08-19, Lead succession 8 - Desktop 2 incident resolved (code exonerated), blocker cleared, one precondition open before unit-09 attempt-2

- User answers relayed directly by the Orchestrator: (1) all his windows are
  intact, nothing was lost; (2) he wants unit-09 retried, with the
  occupancy re-check gap fixed first. The standing "no further live action"
  blocker (state.md, succession 6/7) is hereby CLEARED per this
  confirmation.
- Read-only code inspection (Lead-direct, narrow governance-required
  evidence for a consequential ruling): `workspace-cleanup-removed`
  (`controller.ts:8259,8394,8721`) is a bare literal diagnostic string with
  no desktop-ID or other identifying payload in any of its three emission
  sites - the journal cannot map an individual removal event to a specific
  desktop ID by design. `cleanupEligibleDesktops()` (`controller.ts:
  8202-8240`) re-reads live `occupiedDesktopIds()`/`visibleDesktopIds()`
  fresh on every loop iteration immediately before selecting and removing
  one candidate, and defers via `workspace-cleanup-deferred:window-
  occupancy-unknown` (never removes) on any decode failure -
  structurally, no code path removes a desktop without that same-iteration
  occupancy read having just succeeded. `occupiedDesktopIds()`
  (`controller.ts:8770-8795`) reads `environment.windowList()` and each
  window's live `desktops` membership directly, excluding
  `onAllDesktops`/sticky windows by design (matches `spec.md:401,475` -
  pre-existing, unchanged, user-approved semantics, not something Bug 2
  altered).
- Delegated journal triage to `worker-anthropic` (read-only, PID 23049 only,
  no mutation) rather than extracting raw journal output directly. Curated
  findings: the incident epoch (2026-08-19T07:39:36-07:39:44+10:00,
  identified by its unique 10-removed/0-replenished signature among 3
  candidate startup epochs in the journal) shows **zero**
  `workspace-cleanup-deferred:window-occupancy-unknown` events across all 10
  removals - every gating occupancy read that iteration fully decoded. The
  9th and 10th removals (07:39:40.083, 07:39:43.927) occurred interleaved
  with live `workspace-move-invoked`/`drag-started`/`workspace-navigate-set`
  activity, with `workspace-cleanup-deferred:reconstruction-pending` firing
  and being obeyed multiple times in between - the guard mechanism was
  actively gating cleanup during unsettled state, not bypassed. Two
  `ownership-invariant:bijection-failed` events traced (Lead-direct,
  `controller.ts:6539-6578`, `presetEnsureInvariant`) to the unrelated
  Custom-Tile layout/reconstruction subsystem, not desktop occupancy -
  explains the observed `reconstruction-pending` defers, not a defect. No
  `kwin_scripting` warnings/errors found in the epoch. No KWin-native
  journal line (any category) referencing "desktop"/"VirtualDesktop", nor
  either Desktop 1 or Desktop 2's literal UUID, was found anywhere in the
  epoch's journal window - confirming per-desktop attribution is genuinely
  unrecoverable from the journal, not merely unsearched. No clean journal
  evidence of the exact disable timestamp was found (last project diagnostic
  at 07:40:00.445, ~16.5s after the 10th removal, is an upper-bound
  inference from silence, not a direct measurement).
- **Ruling: the script correctly saw Desktop 2 as empty (of non-sticky
  windows) at removal time. This was a stale-brief bookkeeping error (the
  succession-6 Lead relied on an inherited, unverified dispatch-brief claim
  instead of its own fresh occupancy baseline), not a defect in
  `planDesktopCleanup`'s or `occupiedDesktopIds()`'s implementation.** Per
  the dispatch brief's explicit branching instruction, this exonerates the
  code: unit-04 and unit-05 acceptance stands, no reopening needed, and
  unit-09 proceeds to a retry (attempt-2) rather than being escalated as a
  design defect.
- Standing live-test procedure added (state.md "Next action"), per the
  dispatch brief's instruction: immediately before any future live enable,
  obtain a fresh, direct, non-inherited occupancy baseline for every
  currently-existing, currently-invisible desktop before mutating, and abort
  the whole run before any mutation on any populated candidate. Applied
  concretely to the live host's current small desktop set (4 desktops: 1
  visible/protected, 3/4/"4" invisible) as one narrow open question: does
  Desktop 3, Desktop 4, or "4" currently hold any windows? No read-only
  project tooling exists to answer this without loading a script
  (`windowList()` is only reachable from inside a loaded script's JS
  context; no plain-D-Bus equivalent exists in `scripts/*.sh` today), so
  this Lead relayed the question directly to the Orchestrator/user rather
  than building new live-probing tooling mid-stint (out of a Lead's
  non-implementation role) or reusing the pre-incident inherited claim that
  caused the original gap.
- unit-09 **not yet retried this stint** - deliberately deferred rather than
  attempted without a closed occupancy-baseline gap, given the circuit
  breaker sits at attempt-2 with a third attempt tripping it. No live
  mutation of any kind performed this stint (only read-only journal
  triage via a worker-anthropic and direct source-code reading).
- Files / commit: none. Blocker: cleared (code-defect question resolved);
  one narrow precondition (occupancy baseline for 3 desktops) open pending
  the user's direct answer before unit-09 attempt-2 proceeds.

## 2026-08-19, Lead succession 9 - unit-09 attempt-2 accepted (retroactive log entry, reconstructed from plan.md/state.md, no fresh work performed by this note)

- This entry did not exist when succession 10 began (a bookkeeping gap
  consistent with a quota-cancelled session whose tool-call effects
  persisted but whose log write did not). Reconstructed here from `plan.md`'s
  already-complete Unit 9 Acceptance-Criterion Evidence entry and `state.md`,
  not from fresh work in this stint.
- User confirmed occupancy baseline (all 4 desktops populated); `worker-
  anthropic` live-tested: startup sweep removed zero of the 4 real desktops
  and never changed `current`; a throwaway empty desktop was auto-removed
  with zero `workspace-cleanup-replenished`; baseline restored byte-for-byte.
  Lead independently re-verified via direct `journalctl --user _PID=23049`
  read. unit-09 accepted, attempt-2, 0 corrections. Files/commit: none.

## 2026-08-19, Lead succession 10 - unit-10 accepted, observability fix verified, completion transaction

- Entry point: `state.md` already described "unit-10 accepted" and an
  applied observability fix, but neither `log.md` nor `plan.md` had any
  Unit-10 evidence - no inspectable Worker report existed anywhere. Treated
  as unverified rather than accepted on narrative alone (consistent with a
  quota-cancelled prior session whose edits persisted but whose final
  report/bookkeeping did not).
- Independently re-verified every concrete, reproducible claim directly
  before trusting any of it: `npm --prefix kwin run typecheck` clean;
  `npm --prefix kwin run test` 802/802 pass + 271/271 smoke; `git diff
  --check` clean; `npm --prefix kwin run build` SHA-256
  `8ee1eabb52d16c656aa022c36801b2f39543ab4c3445f849116708b2c6a3d18a`,
  matching state.md's claim exactly; the three
  `workspace-cleanup-removed:${id}` diagnostic call sites confirmed present
  at `controller.ts:8259,8394,8721`. All reproduced exactly - the underlying
  file changes are real and sound; kept as-is, not redone.
- Dispatched a genuine fresh `worker-anthropic` (no prior work on this
  change) for unit-10's independent review of the full Bug 2 diff against
  every spec.md Bug 2 acceptance criterion. Verdict:
  accept-with-non-blocking-findings, all criteria met. This Lead
  independently re-verified the report's substantive claims directly (not
  just read the report) and found two of its line-number citations wrong
  (`logic.ts` claimed 1035-1059, actual `orderedIds.length <= 1` floor is at
  850; `controller.test.ts` claimed 1371-1401, actual doubled-diagnostic-
  count assertions are at 12579/12590/12630/12641) - every underlying
  technical claim reproduced exactly once checked at its real location.
  Assessed as a citation-precision defect in the report, not a code defect;
  accepted. unit-10 accepted, attempt-1, 0 corrections. Full detail in
  `plan.md`'s Unit 10 Acceptance-Criterion Evidence entry.
- Review surfaced 7 stale doc-comment locations (one user-visible, in the
  `Meta+0` shortcut's KDE-settings description string) and one duplicated-
  diagnostic-read inefficiency, all pre-existing documentation drift from
  Units 4-10's implementation. Decision: recorded as a `docs/backlog.md`
  follow-up item, not fixed this stint, per the Orchestrator's explicit
  instruction to avoid expanding scope ahead of the imminent COSMIC-style
  trailing-empty-workspace rework.
- Every Bug 2 unit (3-10) and both Bug 1 units (1-2) are now accepted, no
  open blocker. Proceeding to the completion transaction: commit and push
  (the queue's final commit per explicit user instruction), correct
  `docs/backlog.md`/`docs/roadmap.md`'s stale trailing-empty-design
  descriptions, append the Desktop 2 incident and its resolution to
  `docs/live-kwin-testing.md`'s Attempt Lessons table, add a new backlog
  follow-up for the stale-comment/duplicated-read findings, add a new
  backlog entry for the user's next-selected COSMIC-style rework, update
  `docs/backlog.md` line 41's dependency wording, and archive this change to
  `docs/changes/archive/2026-08-19-workspace-management-fixes/`.
