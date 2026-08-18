# Specification: Workspace Management Fixes

Ownership and approval:
- Owner: Lead
- Status: Diagnosis complete, spec drafted 2026-08-18. Awaiting Orchestrator
  approval before any implementation.

## Intent and Desired Outcome

Two workspace-management features previously marked statically delivered fail
live acceptance on the user's real KDE Wayland dogfooding session:

- Bug 1: `Meta+Shift+<number>` (move focused window to workspace N;
  `Meta+Shift+0` to a newly appended workspace) does nothing observable.
- Bug 2: empty, invisible workspaces accumulate indefinitely instead of being
  cleaned up on switch. The user has 12 workspaces open with windows only on
  1 and 2; workspaces 3-12 are never removed despite repeated switching.

This document records the diagnosed root cause of each, the user's corrected
empty-workspace rule (authoritative, superseding the originally delivered
rule), and verifiable acceptance criteria for the implementation stint that
follows this one. **This stint performed diagnosis and specification only; no
production code was changed.**

## Bug 1: Meta+Shift+<number> move-to-workspace

### Diagnosis method

Live, read-only evidence gathered against the user's actual running session
(KWin PID 23049, `plasma-auto-tiler-kwin` installed and enabled via
`scripts/dogfood-install.sh`, installed bundle byte-identical to
`kwin/contents/code/main.js` at the tip of `main`):

1. `qdbus --literal org.kde.kglobalaccel /component/kwin
   org.kde.kglobalaccel.Component.allShortcutInfos` shows
   `plasma-auto-tiler-move-workspace-1` through `-9` and
   `plasma-auto-tiler-move-workspace-append` registered with unique active key
   sequences (`Meta+Shift+1` = `301989937` through `Meta+Shift+9` =
   `301989945`, `Meta+Shift+0` = `301989936`). Every one of KWin's 19
   KGlobalAccel components was enumerated and cross-checked: **no other
   component's active sequence collides with any `Meta+Shift+0..9`
   combination.**
2. `journalctl --user _PID=23049` for the full current session (KWin started
   15:20:58, 25+ minutes of live use including real key presses) shows
   `plasma-auto-tiler:shortcut-registered` and
   `plasma-auto-tiler:startup-handlers-ready` at startup. Registration in
   `controller.ts` (`start()`) only emits `shortcut-registered` when **every**
   `registerShortcut()` call in the session, including all ten
   `move-workspace-*` rows, returned `true`
   (`kwin/src/controller.ts:2117-2136`) - so registration genuinely succeeded
   for every move-to-workspace action, not just an aggregate best-effort.
3. The same session's journal contains **zero** occurrences of
   `workspace-move-invoked` - the fixed first statement inside
   `moveActiveToWorkspace()`'s `gate.run()` callback
   (`kwin/src/controller.ts:7852-7854`), which runs unconditionally before any
   guard or eligibility check. Its total absence proves the callback body
   never executed for any key press classified as a move-to-workspace
   shortcut during this session.
4. By contrast, the sibling actions `Meta+0` (`workspace-zero-invoked`,
   `workspace-navigate-set`) and `Meta+<n>` (`workspace-navigate-set`) **did**
   fire multiple times in the same session, proving the general
   `registerShortcut()` -> KGlobalAccel -> JS-callback pipeline is live and
   working for this exact script instance, and specifically for other
   digit-keyed workspace shortcuts.
5. `KDE_Keyboard_Layout_Switcher`'s bound sequences and the host's `kxkbrc`
   layout/options were checked and do not use any `Meta+Shift` combination,
   ruling out a keyboard-layout-switch modifier interception.

### Root cause status: narrowed, not fully closed

Registration, KGlobalAccel key-sequence uniqueness, deployment freshness, and
general script liveness are all eliminated as causes. The remaining
possibility is a physical key-delivery gap specific to the `Meta+Shift+<digit>`
combination between the Wayland compositor's global-shortcut grab and the
registered KWin action - a live-only failure mode that cannot be distinguished
from "the user's most recent test predates this 25-minute-old KWin session"
using read-only evidence alone. **This is not the backlog's flagged PARKED-3
capability spike** (creating/removing desktops and writing `Window.desktops`
via the scripting API) - `Meta+0`'s append/create path exercises the same
`VirtualDesktopManager`-backed capabilities live in this same session and
works, so the underlying scripting capability is not blocked. The unresolved
question is purely about global-shortcut key delivery for this one modifier
combination, and it needs one more live check (see Unresolved Questions and
`plan.md` Unit 1) before a fix is authored, because we do not yet know what to
fix.

### Non-goal for this stint

No fix, key-rebind, or code change was made. The `Meta+N`
(focus-workspace) shortcuts were also found to have stale KGlobalAccel
residue from unrelated pre-existing native KWin actions (`Switch to Desktop
N`, itself bound to `Meta+N` on this host) sharing the same active sequence in
`allShortcutInfos`; live evidence shows the script's action still wins the
physical key (its own `workspace-navigate-set` diagnostic fires), so this is
recorded as a benign residue observation only, not a defect, and is out of
scope for the implementation stint unless later evidence contradicts this.

## Bug 2: Empty workspace cleanup

### Diagnosed root cause: confirmed, two compounding causes in the original design

The switch-triggered cleanup hook itself fires correctly:
`handleCurrentDesktopChanged` -> `handleScopeChange(true)` ->
`cleanupDesktops(switchCleanup=true)` -> `cleanupAfterWorkspaceSwitch()`
(`kwin/src/controller.ts:4195-4217`, `8306-8355`) runs on every observed
desktop switch in the live journal (`workspace-cleanup-deferred:*` diagnostics
are present at several switches, proving the code path executes). The defect
is not a missing trigger; it is the eligibility rule itself, as originally
specified and delivered in `d6d52a5`
(`docs/changes/archive/2026-08-15-empty-workspace-switch-cleanup/spec.md`):

1. **Ownership-only eligibility.** `planDesktopCleanup()`
   (`kwin/src/logic.ts:852-875`) hard-filters candidates to
   `request.ownedIds.has(id)` before any other check. The archived spec
   explicitly scoped cleanup to "controller-owned empty desktops" and treated
   "preserve unowned desktops" as a **non-goal boundary**, not an oversight.
2. **Ownership is session-local, in-memory, and non-persistent.**
   `ownedDesktopIds` is a plain `Set<string>` field
   (`kwin/src/controller.ts:1628`) populated only by `appendDesktop()` at
   creation time, with the code comment "recorded script-owned for **this
   session only**" (`kwin/src/controller.ts:7808`). It is never persisted to
   config or reconstructed from any durable identity. Any KWin/script restart
   (logout/login, KWin crash, plugin disable/enable, `reconfigure`) resets it
   to empty, permanently orphaning every previously-owned desktop from cleanup
   consideration even though nothing about those desktops actually changed.

Live evidence corroborating this on the user's host: `VirtualDesktopManager`
reports exactly 12 desktops now, named `Desktop 1`..`Desktop 4` (KDE's default
naming for pre-existing/manually-added desktops) followed by `5`..`12` (bare
numeric strings, exactly matching this script's own creation naming
convention `String(before.length + 1)` at `kwin/src/controller.ts:7823`). This
is strong circumstantial evidence that desktops 5-12 were created by the
script in an earlier session and then orphaned by a later restart - the exact
failure mode above - compounded by the ownership-only rule that would exclude
them from cleanup even if they were never orphaned, once occupancy briefly
touched them. The current session's journal never logs
`workspace-cleanup-removed` even once, consistent with `cleanupDesktops`
finding zero eligible (owned) candidates among the 12 live desktops.

### Corrected rule (authoritative, from the user, supersedes the delivered rule)

> The only time an empty workspace should be open is if the workspace is
> visible on one of the displays/outputs.

This replaces ownership as the eligibility gate. The new rule for every
workspace mode (`per-output-local`, `global-unique`, `shared`):

- A desktop is a cleanup candidate if and only if it is **empty** (no
  occupying window by the existing occupancy definition: sticky/`onAllDesktops`
  windows do not count as occupying, per the unchanged existing semantics in
  `occupiedDesktopIds()`) and **invisible on every currently connected
  output** (not the `currentDesktopForScreen` of any output).
- Ownership (`ownedDesktopIds`) is no longer part of the removal-eligibility
  predicate. Whether a given empty, invisible desktop was created by this
  script, by KDE defaults, by the user through System Settings, or by any
  other tool is irrelevant to whether it is removed. This is a deliberate,
  user-directed scope expansion beyond the archived spec's "preserve unowned
  desktops" non-goal, and it intentionally removes any "the user might want to
  keep a manually-created empty desktop around" carve-out - there is none
  under this rule.
- The always-keep-one-global-desktop floor (never remove the last remaining
  desktop) is a basic sanity constraint, not something the user's correction
  addresses, and is preserved unchanged.
- `ownedDesktopIds` bookkeeping itself is not necessarily deleted outright: it
  may still be relevant to other unrelated concerns (e.g. per-output/
  global-unique logical-number mapping bookkeeping, replenishment/creation
  tracking). The implementation stint must audit each of the current
  `ownedDesktopIds` call sites in `controller.ts` (creation tracking,
  `trailingOwnedEmptyId`, the three `removeOwnedEmpty*` functions, and
  `planDesktopCleanup`'s `ownedIds` parameter) and change only the
  removal-eligibility predicate's dependency on it; this specification does
  not mandate deleting the field or its other uses.

### Consequential decision this rule implies (flagged, not assumed)

The archived spec's "trailing empty" concept reserved **one** owned empty
desktop per mode/domain at all times specifically so `Meta+0` /
`Meta+Shift+0` always had an already-existing target to jump to or move into,
without needing to create one synchronously on every invocation when one
already existed. Under the corrected rule as stated, that reserved spare is
itself an empty, invisible desktop and therefore no longer protected - it
would be removed by the next switch-triggered cleanup just like any other
empty invisible desktop. The literal, direct implication is that `Meta+0` and
`Meta+Shift+0` must fall back to *creating* a desktop on demand every time no
suitable target currently exists, rather than relying on a permanently
pre-reserved spare. This is not an ambiguity in the user's rule - it is a
logical consequence of it - but it is a real behavioral change to the
`Meta+0`/`Meta+Shift+0` affordance (create-on-demand instead of
already-there) beyond the literal "cleanup doesn't remove enough" complaint,
so it is recorded under Unresolved Questions below for explicit
Orchestrator/user confirmation before the implementation stint builds it
either way.

## Scope

In scope:
- Diagnose both bugs with live evidence (this document).
- Specify the corrected empty-workspace-visibility rule and its acceptance
  criteria for the implementation stint.
- Identify the exact code stations both bugs touch, for the follow-up plan.

Non-goals for this stint:
- No production code changes. No shortcut re-registration, no cleanup
  predicate changes, no tests added or modified.
- No live shortcut invocation (`invokeShortcut` or physical key simulation)
  was performed; only registration/state was queried read-only.
- No change to `docs/backlog.md` or `docs/decisions.md` (escalated to the
  Orchestrator instead where a change is needed - see Unresolved Questions).
- No change to occupancy semantics (sticky/`onAllDesktops` exclusion) beyond
  what is already implemented.
- No live/session-boundary testing of the multi-output modes
  (`global-unique`, `shared`); the live host currently has a single output
  (`eDP-1`), so only `per-output-local`'s single-output degenerate path was
  observed live. The corrected rule is specified mode-agnostically, but live
  multi-output acceptance remains separately gated exactly as before.

## Acceptance Criteria (for the implementation stint)

Bug 1 (blocking on Unresolved Questions Q1 below before any fix is written):
- [ ] A live, journal-observed repro or non-repro of `workspace-move-invoked`
  for at least one `Meta+Shift+<digit>` press in a fresh KWin session is
  recorded before any fix is attempted.
- [ ] If reproduced: a fix (or a documented, evidence-backed platform
  limitation escalation if delivery genuinely cannot be made to work) is
  implemented, and a live `workspace-move-invoked` plus the expected
  desktop-membership change is observed for at least `Meta+Shift+1` and
  `Meta+Shift+0` on the live host, per the standing live-testing safety
  boundary in `docs/live-kwin-testing.md`.
- [ ] If not reproduced (i.e. the feature already works and the prior report
  predates this session): report this plainly rather than speccing a fix for
  a non-reproducing defect.

Bug 2:
- [ ] `planDesktopCleanup` (or its replacement) accepts an empty, invisible
  desktop as a removal candidate regardless of `ownedIds` membership.
- [ ] A desktop that is empty but currently visible on any connected output is
  never removed.
- [ ] The last remaining global desktop is never removed.
- [ ] Focused unit tests demonstrate: an unowned (not script-created) empty
  invisible desktop is now removed; an owned empty invisible desktop is still
  removed (regression); an empty desktop visible on any output is preserved
  in every mode; occupancy (including the existing sticky exclusion) is
  unchanged.
- [ ] Live acceptance: on the user's host, starting from the current 12-desktop
  state, repeated switching between desktops 1 and 2 converges to no more
  empty invisible desktops accumulating (does not need to assert an exact
  terminal desktop count, since the currently-owned/orphaned desktops 3-12 are
  real user-visible state this stint must not destroy without the user's own
  interaction triggering cleanup).
- [ ] The `Meta+0`/`Meta+Shift+0` consequential decision (see above) is
  resolved by explicit Orchestrator/user ruling before implementation, and
  the resolution is recorded in this spec or superseding decision record.

## Unresolved Questions

- **Q1 (Bug 1, blocking):** Is `Meta+Shift+<digit>` genuinely never delivered
  to the registered KWin script action on this host, or did the user's report
  predate the current 25-minute-old KWin session? Needs one live,
  journal-tailed repro attempt (user presses the combo once while an agent
  reads `journalctl --user _PID=<current kwin pid>` read-only) before any fix
  is designed. No mutation authorization is needed for this check.
- **Q2 (Bug 2, blocking on the consequential decision above):** Should
  `Meta+0`/`Meta+Shift+0` move to strict create-on-demand (no reserved spare
  desktop, consistent with the corrected rule's literal text), or does the
  user want a narrow, explicit exception that keeps exactly one reserved
  empty desktop protected from the new rule for those two shortcuts
  specifically? The literal reading of the user's rule implies the former;
  this needs an explicit ruling because it is a real behavioral change to an
  already-shipped affordance, not just a cleanup-aggressiveness change.
- **Q3 (non-blocking, informational):** The `Meta+N` (focus-workspace,
  non-Shift) KGlobalAccel residue collision with native `Switch to Desktop N`
  actions observed during Bug 1 diagnosis is not currently causing a defect
  (this script's action demonstrably wins the physical key), but it is
  unexplained residue on this host (a native KWin action bound to `Meta+N` is
  not standard default KDE behavior) worth a one-line mention to the user;
  it does not need spec/plan work unless it starts causing problems.

## Consequential Decisions

- Bug 1's fix (if any) cannot be designed yet: root cause is narrowed to a
  live-delivery question that must be answered first (Q1).
- Bug 2's fix removes `ownedIds` from the removal-eligibility predicate only;
  other uses of `ownedDesktopIds` are preserved pending the implementation
  stint's own audit, per the corrected rule's scope above.
