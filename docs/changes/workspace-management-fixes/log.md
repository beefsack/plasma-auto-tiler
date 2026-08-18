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
