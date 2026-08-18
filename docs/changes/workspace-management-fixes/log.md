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
