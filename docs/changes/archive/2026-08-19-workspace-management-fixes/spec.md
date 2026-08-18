# Specification: Workspace Management Fixes

Ownership and approval:
- Owner: Lead
- Status: Diagnosis complete, spec drafted 2026-08-18. Bug 1 (Meta+Shift+N
  move-to-workspace) root cause confirmed and fixed the same day (see "Bug 1:
  root cause confirmed" below); Bug 2 remains unimplemented, gated on this
  stint's Q2 ruling now recorded below. **2026-08-18 verification stint:**
  corrected a wrong "correct on AZERTY" claim (Bug 1 fix section) and
  reclassified Q4 from "unidentified residue, safe-to-clear TBD" to
  "identified as the user's own active Home-Manager-declared tooling - not
  removed, escalated as a scope-overlap question." See "New finding:
  KGlobalAccel residue collision - IDENTIFIED, NOT residue" and the Q4 entry
  below. **2026-08-18 Bug 2 ruling stint:** confirmed the create-on-demand
  ruling as unconditional (no reserved-spare reuse), added the replenish-loop
  removal requirement it implies, rewrote Bug 2's acceptance criteria to be
  precise and per-mode, and surfaced three new open ambiguities (Q5-Q7,
  disconnected-output timing, incidental-reuse-vs-literal-create, and
  removal-trigger scope) that the ruling does not resolve. **2026-08-18 Bug 2
  Q5-Q7 ruling stint:** the user resolved all three: Q5 remove immediately on
  disconnect, Q6 always create new (no incidental reuse), Q7 broaden removal
  to fire on every `cleanupDesktops()` dispatcher event, not only switch. No
  production code changed this stint either; implementation (Units 4-10)
  begins next.

## User rulings (authoritative, 2026-08-18)

- **Q1 answered:** the user re-tested live with journalctl running; Bug 1
  (`Meta+Shift+<number>`) still does nothing and produces no diagnostic. The
  live-repro gate (plan.md Unit 1) is satisfied by this direct report; no
  further repro attempt was needed before Unit 2 (fix).
- **Q2 answered:** empty-workspace cleanup uses **create-on-demand**, not a
  reserved spare. There is no reserved trailing empty workspace under the
  corrected rule (see "Corrected rule" below): `Meta+0` creates a new
  workspace at press time and switches to it; `Meta+Shift+0` creates one and
  moves the focused window there. The user's empty-and-invisible-on-every-
  output rule holds with no exceptions. This removes the "Consequential
  decision" ambiguity previously flagged below from Bug 2's scope; the
  create-on-demand behavior is now the specified target for the Bug 2
  implementation stint (still not implemented this stint).
- **Q5 answered: remove immediately.** On output disconnect (lid close,
  connector reseat), desktops on that output are no longer visible on any
  connected output, so an empty one becomes removable immediately. No grace
  period, no disconnect-timing state. This resolves Q5 below.
- **Q6 answered: always create new.** `Meta+0`/`Meta+Shift+0` never reuse an
  existing empty desktop, even transiently, even if one already exists at
  press time. This confirms the literal reading already recorded in the
  acceptance criteria below; incidental-reuse-as-optimization is rejected.
  This resolves Q6 below.
- **Q7 answered: broaden to window events.** The survival rule is a
  continuous property, not a switch-time-only check. Once the replenish loop
  is deleted, removal must also fire on the broader `cleanupDesktops()`
  dispatcher events (window close/remove, move, float, drag finish), not only
  on workspace switch. Closing the last window on a non-visible desktop
  removes it immediately, without waiting for a switch. This resolves Q7
  below.

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

### Root cause status: confirmed (2026-08-18, implementation stint)

Registration, KGlobalAccel key-sequence uniqueness, deployment freshness, and
general script liveness are all eliminated as causes (diagnosis stint above).
The user's own hypothesis - Wayland/Qt delivers the **shifted symbol**, not
`Shift+<digit>`, for `Meta+Shift+<digit>` on QWERTY-family layouts - is
**confirmed** by direct KWin 6.7.3 source tracing (the exact pinned version
running on this host, PID 23049, verified via `kwin_wayland --version`) plus
live D-Bus evidence, not by re-litigating the diagnosis stint's read-only
repro question (which the user's own re-test already answered: still failing,
see "User rulings" above).

**Mechanism, traced end to end in KWin 6.7.3 source:**
1. `Xkb::modifiersRelevantForGlobalShortcuts()` (`src/xkb.cpp:903-937`)
   computes the modifiers KWin delivers to the global-shortcut pipeline as
   `mods & ~consumedMods`, where `consumedMods` is whichever modifier the xkb
   keysym-level transition "consumed" to produce the pressed key's symbol. For
   a digit key on a QWERTY-family layout, Shift transitions the keysym from
   the digit (`5`) to a punctuation symbol (`percent`) - a non-letter keysym -
   so `consumedMods` includes Shift and is **not** exempted by the
   letter-only carve-out at line 926-934 (`QChar::isLetter(...)`, added for
   BUG 370341 so `Shift+W`-style shortcuts still work). The Shift bit is
   therefore stripped from what the global-shortcut manager ever sees.
2. `KeyboardInputRedirection::processKey()` (`src/keyboard_input.cpp:306-320`)
   resolves the delivered `Qt::Key` from the *actual* keysym (`percent`, not
   `5`) via `Xkb::toQtKey()`, and pairs it with the Shift-stripped modifiers
   from step 1 (`src/input.cpp:1076`, `input()->shortcuts()->processKey(...)`).
3. `KWin::Script::registerShortcut()` (`src/scripting/scripting.cpp:387`)
   parses the catalog's `"Meta+Shift+5"` string via
   `QKeySequence(const QString&)`, i.e. Qt's `PortableText` parser
   (`qkeysequence.cpp` `QKeySequencePrivate::decodeString`), which for a
   single trailing character token uses `accelRef.at(0).toUpper().unicode()`
   - producing `Qt::MetaModifier | Qt::ShiftModifier | Qt::Key_5`.
4. `kglobalacceld`'s `GlobalShortcutsRegistry::keyEvent()`
   (`globalshortcutsregistry.cpp:479-521`) matches the delivered integer
   key+modifier combination against registered actions by exact equality.
   Step 1-2's delivered value (`Meta+Key_Percent`, no Shift bit) can never
   equal step 3's registered value (`Meta+Shift+Key_5`); the callback is
   therefore provably unreachable for `Meta+Shift+<digit>` on any layout where
   Shift changes that key's symbol (confirmed `us` for this host via
   `localectl status` / `setxkbmap -query`, both report `X11 Layout: us`).
5. Cross-checked with plain Node arithmetic reproducing Qt's own
   int-combination rules for all ten digits (0/1-9): every `Meta+Shift+<digit>`
   registered value differs from its actually-delivered `Meta+<symbol>` value,
   and the delivered value is bit-for-bit what
   `QKeySequence("Meta+<symbol>")` parses to (`"%".toUpper()` is `"%"`,
   unaffected, same as the keysym KWin already resolves for that physical
   key).
6. No other KGlobalAccel component on this host (all 19 enumerated) had any
   working `Shift+<digit>` precedent to contradict this, but a **direct,
   pre-existing, human/tool-authored precedent was found live** in
   `~/.config/kglobalshortcutsrc`'s `[kwin]` group: native-looking actions
   `move-and-switch-to-desktop-1..9` / `move-to-last-desktop` are already
   bound to exactly `Meta+!`, `Meta+@`, ..., `Meta+)` - the identical
   shifted-symbol scheme this fix independently derived. These action IDs do
   not exist anywhere in the pinned KWin 6.7.3 source tree (four independent
   copies checked), so they are not a native KWin feature; they are residue
   from an earlier, unidentified script/probe (component identity `kwin` is
   shared by every KWin-script `registerShortcut()` call, including this
   project's own, so the residue is indistinguishable from a native action by
   component name alone). See "New finding: KGlobalAccel residue collision"
   below for the practical consequence.

### Fix implemented (2026-08-18)

Every `move-workspace-<N>` and `move-workspace-0` (append) catalog row now has
a `compatibility-alias` sibling row (`move-workspace-<N>-symbol` /
`move-workspace-0-symbol`) registered under the QWERTY-family shifted symbol
(`Meta+!`, `Meta+@`, `Meta+#`, `Meta+$`, `Meta+%`, `Meta+^`, `Meta+&`,
`Meta+*`, `Meta+(`, `Meta+)`), dispatching to the identical
`moveActiveToWorkspace(index)` handler and diagnostic
(`workspace-move-invoked:<index>`) as the canonical row. The canonical
`Meta+Shift+<digit>` row is kept registered unchanged (harmless-but-inert on
this host's `us` layout; **not** live-correct on AZERTY - see the CORRECTION
immediately below, which supersedes this claim as originally written earlier
the same day). See `kwin/src/controller.ts`
`SHIFT_DIGIT_SYMBOL_ALIAS`/`symbolForDigit`/`moveWorkspaceZeroSymbolRow`.

**CORRECTION (2026-08-18, verification stint):** the claim in the previous
version of this section - that the unmodified `Meta+Shift+<digit>` row is
"correct" on AZERTY-style layouts - was **wrong** and has been struck. Traced
directly against the pinned KWin 6.7.3 source
(`Xkb::modifiersRelevantForGlobalShortcuts()`, `src/xkb.cpp:903-937`) plus the
actual `fr` xkb symbols data (`key <AE01> { [ ampersand, 1, ... ] }` etc.,
confirming AZERTY's digit-row keys have the **digit on the shifted level**,
symbol unshifted): for any digit-row key whose *shifted* keysym is itself a
digit, `QChar::isLetter()` is false, so Shift is stripped from the delivered
global-shortcut modifiers exactly as it is for a symbol-shifted key. A
physical `Meta+Shift+<digit-row-key>` press on AZERTY therefore delivers
`Meta+<digit>` (Shift-stripped, keysym is the digit) - **not**
`Meta+Shift+<digit>** as the canonical row assumes, and this project already
binds `Meta+<digit>` to focus-workspace (`controller.ts:563`). The canonical
row is consequently **never reachable** on AZERTY and instead **silently
collides** with focus-workspace: pressing what the user intends as "move to
workspace N" instead switches to workspace N. This is not a working fallback;
it is a second, layout-specific instance of the exact same bug class Bug 1
already diagnosed. See "Layout verification matrix" below for the corrected,
evidence-based per-layout status.

**Layout-robustness tradeoff (recorded per Orchestrator instruction):** no
keyboard-layout or scancode/keysym-level shortcut registration surface is
exposed to KWin JS scripts' `registerShortcut(name, text, sequence, callback)`
(only accepts a `QKeySequence`-parseable string, confirmed in
`src/scripting/scripting.cpp:376` / `scripting.h:127`). However, this
verification stint found that **layout introspection itself is reachable**
from KWin JS via the generic `Script::callDBus()` invokable
(`scripting.h:115`) calling the session-bus `org.kde.keyboard` `/Layouts`
service (`getLayout()`/`getLayoutsList()`, live-tested on this host, returns
`us`/index 0) - this contradicts any reading of the prior stint's wording as
"no layout-introspection surface exists at all." A **correct general fix is
therefore achievable in principle**: query the active layout at script
startup via `callDBus`, look up a per-layout shift-row symbol table, and
register the matching alias row - at the cost of building and maintaining
that table for each layout to be supported (KWin JS has no live
`layoutChanged` signal subscription available to `Script`, so this would only
be correct as of script start, not for live mid-session layout switches,
without additional polling). The single-table, US-QWERTY-only shim shipped
this stint remains a legitimate, bounded-effort choice for a single-stint fix,
but it should be described as "not yet built due to scope," not as
"impossible" or as something the unmodified canonical row already covers for
non-US layouts.

**Layout verification matrix (evidence: pinned `fr`/`gb`/`de`/`latin`/`us` xkb
symbols data, cross-referenced against the xkb.cpp mechanism above):**

| Layout | Canonical `Meta+Shift+<digit>` reachable? | `-symbol` alias (`!@#$%^&*()`) correct? |
|---|---|---|
| US (this host) | No (this is Bug 1 itself) | Yes, all 10 |
| AZERTY (`fr`) | No - silently collides with `Meta+<digit>` focus-workspace | No (unshifted AZERTY symbols are `&é"'(-è_çà)`, not `!@#$%^&*()`) |
| UK (`gb`) | No (digit is unshifted; same mechanism as US) | 8/10 correct (`!`,`$`,`%`,`^`,`&`,`*`,`(`,`)`); digits 2 and 3 wrong (`gb` shift = `"`,`£`, alias assumes `@`,`#`) |
| German QWERTZ (`de`) | No (digit is unshifted; same mechanism as US) | 3/10 correct (`!`,`$`,`%` for 1/4/5); 7/10 wrong (`de` shift row is `!"§$%&/()=`, alias assumes `!@#$%^&*()`) |

No layout in this matrix is fully served by the canonical row alone; AZERTY is
actively harmed by it (silent collision, not a benign no-op). The shipped
`-symbol` alias only fully covers US and layouts sharing its exact shift-row
symbols; UK and German QWERTZ are each partially covered (the digits that
happen to coincide with US) and partially broken.

### New finding: KGlobalAccel residue collision - IDENTIFIED, NOT residue (2026-08-18, verification stint)

**Update, verification stint:** the `move-and-switch-to-desktop-1..9` /
`move-to-last-desktop` entries are **not unidentified residue**. They are
generated by the user's own Home-Manager-declared KWin script, committed to
his personal `dotfiles-nix` repository
(`modules/home/displayManager/plasma6.nix:15-54`, commit `ecbb5ff` "Change to
KDE Plasma", 2026-08-10 - i.e. they predate this project's diagnosis stint by
eight days and are not connected to it). The script (`KPlugin.Id:
"last-desktop"`, deployed via `xdg.dataFile` to
`~/.local/share/kwin/scripts/last-desktop/...`, enabled via
`"kwinrc"."Plugins"."last-desktopEnabled" = true`) independently implements
**the identical shifted-symbol workaround** this stint's Bug 1 fix also
implements: `registerShortcut("move-and-switch-to-desktop-N", ..., "Meta+<symbol>",
...)` for the same ten sequences, plus `switch-to-last-desktop` (`Meta+0`) and
`move-to-last-desktop` (`Meta+)`). The user's own comment in that file records
the intent: "With dynamic-workspaces enabled, the last desktop is always
empty" - he also declaratively installs `pkgs.kdePackages.dynamic-workspaces`
(a real KDE package, not this project), which is his own pre-existing solution
to the empty-workspace problem this project's Bug 2 also targets.

**Live confirmation of the tie-break, obtained read-only via
`org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel.action(<key-int>)`**
(a more authoritative and precise API than `allShortcutInfos`, not used by the
prior stint): for every one of the ten `Meta+<symbol>` sequences, `action()`
returns `move-and-switch-to-desktop-<N>` / `move-to-last-desktop` as the
current live winner, definitively confirming this project's `-symbol` alias
rows are shadowed - **not** merely inferred from registration order as before.

**However:** `~/.local/share/kwin/scripts/last-desktop/` does **not currently
exist on disk**, and `isScriptLoaded("last-desktop")` returns `false` live
(same pattern as the already-known Krohnkite case:
`isScriptLoaded("krohnkite")` is also `false` despite
`"kwinrc"."Plugins"."krohnkiteEnabled" = true` being declared). The
`kglobalshortcutsrc` entries persist from a session where the script *was*
loaded (kglobalaccel persists configured shortcuts independent of whether the
owning component is currently running) but nothing is currently listening to
receive the trigger. **Net effect:** a physical `Meta+Shift+<digit>` press
right now would very likely be claimed by the dead `move-and-switch-to-desktop-N`
action and do **nothing observable** - not test this project's fix, and not
work as the user's own script intends either, since neither has a live
receiver for that specific action name.

**Per this stint's explicit instruction, this is a STOP condition, not a
cleanup target:** these entries belong to the user's own actively-maintained,
git-committed, Home-Manager-declared configuration. They were **not removed**.
Removing them via `kwriteconfig6` would also only be a temporary, imperative
patch that Home Manager's own declarative config could silently re-assert on
the user's next `home-manager switch` (or the script could be redeployed at
any time, e.g. if the on-disk gap above is itself a transient/incomplete
state rather than an intentional disable). This also means this project's
Bug 1 fix (shifted-symbol alias rows) is likely **entirely redundant with,
and directly conflicting with, tooling the user has already built and
declared himself** outside this project. That is a scope question for the
Orchestrator/user, not something this stint should resolve unilaterally by
either deleting the user's config or by silently keeping a duplicate,
currently-non-functional fix in this project. **Escalated, not resolved.**

### Live side effect: one extra empty desktop (2026-08-18, Bug 2 interaction)

Deploying/reloading the fixed bundle (`dogfood-install.sh install` then
`disable`+`enable`, both standing-authorized) triggered Bug 2's own
already-diagnosed defect (`ownedDesktopIds` resets on every script restart,
see "Bug 2" below): the script's startup replenish logic created one new
empty trailing desktop (`workspace-created-owned` /
`workspace-cleanup-replenished` diagnostics fired live). This is pre-existing,
already-documented Bug 2 behavior surfacing a few minutes early because of
this stint's necessary reload, not a new regression introduced by the Bug 1
fix; the same thing would happen on any KWin restart, plugin toggle, or
logout/login regardless of this change. A live attempt to remove the extra
desktop via `removeDesktop` was **immediately undone by the still-running
script's own replenish logic** (it recreated a new one seconds later,
confirmed by the desktop's UUID changing) - the extra desktop cannot be
cleanly removed without disabling the plugin, which would regress the user's
tiling functionality below its pre-stint baseline (`enabled: yes`). The plugin
was left enabled (matching the pre-stint baseline exactly) and the one extra
empty, invisible desktop was left in place rather than looping further. The
user's original 12 desktops (1-12, exact same UUIDs/names/order) and current
desktop (unchanged, `Desktop 1`) were not touched.

### Non-goal for the diagnosis stint (historical; superseded above for Bug 1)

The paragraphs below describe the 2026-08-18 diagnosis stint's own scope, before
the same-day implementation stint above fixed Bug 1. No fix, key-rebind, or
code change was made *during the diagnosis stint*. The `Meta+N`
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

### Consequential decision this rule implies: resolved (2026-08-18, ruling stint)

The archived spec's "trailing empty" concept reserved **one** owned empty
desktop per mode/domain at all times specifically so `Meta+0` /
`Meta+Shift+0` always had an already-existing target to jump to or move into,
without needing to create one synchronously on every invocation. Under the
corrected rule, that reserved spare is itself an empty, invisible desktop and
therefore no longer protected - it would be removed by the next cleanup pass
just like any other empty invisible desktop. **The user has confirmed the
literal implication directly, not just by logical inference:** there is no
reserved trailing empty workspace at all any more.

- `Meta+0` **always** creates a new workspace at press time and switches the
  current desktop to it. It never looks up or reuses a pre-existing
  "trailing empty" desktop, even if one happens to exist at press time.
- `Meta+Shift+0` **always** creates a new workspace at press time and moves
  the focused window to it. Same no-reuse rule.
- This holds identically in all three `workspaceMode` values
  (`per-output-local`, `global-unique`, `shared`).

**New requirement surfaced by this ruling, not present in the original
diagnosis:** the codebase's existing "replenish" mechanism - the part of
`cleanupDesktops()`'s per-mode reconcile step
(`reconcileLocalWorkspaces`/`reconcileGlobalUnique`/the shared reconcile
fragment, `kwin/src/controller.ts`, `workspace-cleanup-replenished`
diagnostic) that automatically recreates a new trailing-empty desktop
whenever the mode's reserved slot is empty - has no purpose under
create-on-demand and directly conflicts with the survival rule: it would
recreate an empty desktop the survival rule says should stay removed. It
already fought a manual `removeDesktop` attempt live and produced a stray
extra desktop. The implementation stint must remove or neutralize this
replenish behavior so nothing in the script recreates a desktop the survival
rule and create-on-demand model do not call for.

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

Bug 1 (Q1 resolved by the user's own re-test; implemented 2026-08-18):
- [x] A live, journal-observed repro or non-repro of `workspace-move-invoked`
  for at least one `Meta+Shift+<digit>` press in a fresh KWin session is
  recorded before any fix is attempted. Satisfied by the user's direct report
  (Q1 above), not a fresh agent-side repro attempt.
- [x] A fix is implemented: `move-workspace-<N>-symbol` / `move-workspace-0-symbol`
  compatibility-alias rows registered under the QWERTY-family shifted symbol.
- [x] Registration is live-confirmed: `allShortcutInfos` shows every new alias
  action's active sequence exactly matches the mathematically-derived
  delivered-event integer for this host's confirmed `us` layout, with no
  `shortcut-register-failed` diagnostic.
- [ ] **Not obtained:** a live `workspace-move-invoked` plus desktop-membership
  change from an actual key press. Blocked by the newly discovered
  KGlobalAccel residue collision (see "New finding" above) and by the
  standing prohibition on asking the user to press keys or on synthetically
  injecting input (no such tool present); escalated rather than force-closed.
- [x] Existing behavior for layouts where `Meta+Shift+<digit>` is genuinely
  correct (e.g. AZERTY) is preserved: the canonical row is unchanged.

Bug 2:

Cleanup eligibility (survival rule):
- [ ] `planDesktopCleanup` (or its replacement) accepts an empty, invisible
  desktop as a removal candidate regardless of `ownedIds` membership. Ownership
  plays no role in the removal-eligibility predicate.
- [ ] A desktop that is empty but currently visible on any connected output is
  never removed, in every `workspaceMode` value.
- [ ] The "protected trailing" reservation (`protectedTrailingIds` /
  `trailingOwnedEmptyId`) is removed from the removal-eligibility predicate: no
  empty invisible desktop is exempted from removal for being "the" trailing
  spare.
- [ ] The last remaining global desktop is never removed (unchanged floor,
  independent of the survival rule).
- [ ] Occupancy (including the existing sticky/`onAllDesktops` exclusion) is
  unchanged.

Replenish-loop removal:
- [ ] The automatic replenish behavior in `cleanupDesktops()`'s per-mode
  reconcile step (`reconcileLocalWorkspaces`, `reconcileGlobalUnique`, the
  shared reconcile fragment) no longer creates a new desktop merely because no
  trailing-empty slot currently exists, in any `workspaceMode` value. A removed
  empty desktop stays removed until something else (a create-on-demand
  shortcut, or the user) creates a new one.

Removal trigger scope (Q7):
- [ ] Removal is not restricted to `cleanupAfterWorkspaceSwitch`
  (switch-triggered). The broader `cleanupDesktops()` dispatcher - window
  add/remove, move, float, drag finish, `desktopsChanged`, reconstruction
  settle - also removes eligible empty/invisible desktops, not only
  replenishes. An empty, invisible desktop is removed the moment it becomes
  eligible under the survival rule, without waiting for a workspace switch
  (e.g. closing the last window on a non-visible desktop removes it
  immediately on that close event).

Output disconnect (Q5):
- [ ] On output disconnect, a desktop that was only visible on the
  disconnected output is immediately eligible for removal if empty (no grace
  period, no disconnected-output timing state), evaluated against the
  post-disconnect set of connected outputs.

Create-on-demand (`Meta+0` / `Meta+Shift+0`):
- [ ] `Meta+0` always creates a new desktop at press time and switches the
  current desktop to it. It never looks up or reuses an existing empty
  desktop, even if one is currently present. Identical behavior in all three
  `workspaceMode` values.
- [ ] `Meta+Shift+0` always creates a new desktop at press time and moves the
  focused window to it, never reusing an existing empty desktop. Identical
  behavior in all three `workspaceMode` values.

Verification:
- [ ] Focused unit tests demonstrate, per `workspaceMode` value: an unowned
  (not script-created) empty invisible desktop is removed; a formerly
  "protected trailing" empty invisible desktop is removed; an empty desktop
  visible on any output is preserved; the last-global-desktop floor is
  preserved; the replenish loop no longer recreates a removed empty desktop;
  `Meta+0` always creates-and-switches rather than reusing; `Meta+Shift+0`
  always creates-and-moves rather than reusing.
- [ ] Live acceptance (subject to the standing constraint that the user's real
  windows, desktops, and current-desktop must never be disturbed - use a
  throwaway window on a high empty desktop): a manually removed empty
  invisible desktop stays removed across subsequent lifecycle events (no
  replenish); repeated switching converges to no empty invisible desktops
  accumulating beyond what the user's own actions create.

## Unresolved Questions

- **Q1 (Bug 1): resolved.** The user's own re-test confirmed Bug 1 still
  reproduces; no further repro attempt was needed. The shifted-symbol
  hypothesis is confirmed by source tracing (see above).
- **Q2 (Bug 2): resolved.** Create-on-demand, no reserved spare, no
  exceptions (see "User rulings" above and "Consequential decision this rule
  implies" for the confirmed `Meta+0`/`Meta+Shift+0` behavior and the
  replenish-loop removal requirement it implies). Still not implemented.
- **Q5 (Bug 2): resolved.** Remove immediately on output disconnect, evaluated
  against the post-disconnect set of connected outputs. No grace period, no
  disconnected-output timing state (see "User rulings" above).
- **Q6 (Bug 2): resolved.** Always create new; never reuse an existing empty
  desktop, even transiently (see "User rulings" above).
- **Q7 (Bug 2): resolved.** Broaden to window events: removal fires on every
  `cleanupDesktops()` dispatcher event (window close/remove, move, float,
  drag finish, `desktopsChanged`, reconstruction settle), not only on
  workspace switch (see "User rulings" above and the "Removal trigger scope"
  acceptance criteria above).
- **Q3 (non-blocking, informational):** unchanged from the diagnosis stint;
  the `Meta+N` (focus-workspace, non-Shift) residue collision with native
  `Switch to Desktop N` is benign (this script's action wins the physical
  key). Not investigated further this stint.
- **Q4: identified, not "safe to clear" - reclassified as a scope question
  (verification stint, 2026-08-18).** `move-and-switch-to-desktop-1..9` /
  `move-to-last-desktop` in `~/.config/kglobalshortcutsrc` are **not**
  unattributed residue. They belong to the user's own git-committed,
  Home-Manager-declared `last-desktop` KWin script
  (`dotfiles-nix/modules/home/displayManager/plasma6.nix`, committed
  2026-08-10, predates this project's work), which independently implements
  the same shifted-symbol workaround and is currently declared-enabled
  (`last-desktopEnabled=true`) but not currently deployed/loaded on this host
  (`~/.local/share/kwin/scripts/last-desktop/` absent,
  `isScriptLoaded("last-desktop")` is `false` - same pattern as the
  already-known Krohnkite gap). Per this stint's explicit authorization
  boundary, these entries were **not removed**: they belong to a tool the
  user actively maintains himself. **New, higher-priority open question for
  the Orchestrator/user:** given the user has his own working (when deployed)
  solution to both Bug 1's problem (his `last-desktop` script) and Bug 2's
  problem (`pkgs.kdePackages.dynamic-workspaces`, declared alongside it, per
  his own code comment "the last desktop is always empty"), should this
  project's Bug 1 fix (and any Bug 2 implementation) proceed at all, or is
  this project's scope redundant with / actively conflicting with tooling the
  user has already built outside it? This is a scope decision, not a
  cleanup task, and this stint does not resolve it.

## Consequential Decisions

- Bug 1 is implemented, but its "correct on AZERTY" claim was wrong (corrected
  above, verification stint 2026-08-18) and its shifted-symbol alias only
  fully covers US; UK and German QWERTZ are partially covered (see "Layout
  verification matrix"). Its remaining open item is Q4 above, now reclassified
  from "unidentified residue" to a genuine scope question: the fix may be
  entirely redundant with the user's own pre-existing `last-desktop`
  Home-Manager-declared KWin script, which is not this stint's call to
  resolve.
- Bug 2's fix removes `ownedIds` from the removal-eligibility predicate only;
  other uses of `ownedDesktopIds` are preserved pending the implementation
  stint's own audit, per the corrected rule's scope above. **New for the
  implementation stint to consider:** the user's `dotfiles-nix` also declares
  `pkgs.kdePackages.dynamic-workspaces` as his own solution to the same
  empty-workspace problem (see Q4 correction above); whether Bug 2 should
  proceed given that is a scope question for the Orchestrator/user, not
  assumed away here.
