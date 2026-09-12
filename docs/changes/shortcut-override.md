# Shortcut Override

## Goal

Deliver the approved explicit KCM shortcut override table for the MVP. Explicit
KCM Apply alone resolves only the closed compiled-in rows.

## Scope And Non-Goals

- Explicit KCM Apply performs the override; explicit KCM Revert recovers it.
  Installation and startup never mutate global shortcuts.
- Non-conflicting project shortcuts register by default. The closed table is
  the only conflict allowlist and carries each project identity/chord, foreign
  identity, expected foreign preimage, and either `relocate` or `clear`.
- Layout detection, omission, opt-in configuration, migration, KGlobalAccel
  reconciliation, and complete keyboard-layout support remain deferred to the
  parked post-release record in [Shortcut Scope](shortcuts.md).
- This record covers the override contract only, not COSMIC movement, pointer
  resize, runtime, border, tray, or Nix delivery behavior.

## Acceptance

- Row 1: `kwin` / `plasma-auto-tiler-focus-right` takes `Meta+L`; `ksmserver`
  / `Lock Session` relocates `Meta+L` to `Meta+Esc`. Non-`Meta+L` lock keys
  keep their order. The row deliberately displaces System Monitor
  `org.kde.plasma-systemmonitor.desktop` / `_launch`'s declared `Meta+Esc`
  default;
  that exact target occupant is compiled into the row and is never writable.
- Row 2: `kwin` / `plasma-auto-tiler-resize-outwards-up` takes `Meta+Alt+K`;
  `KDE Keyboard Layout Switcher` / `Switch to Next Keyboard Layout` clears
  from the exact preimage `Meta+Alt+K`.
- Row 3: `kwin` / `plasma-auto-tiler-resize-outwards-right` takes
  `Meta+Alt+L`; `KDE Keyboard Layout Switcher` / `Switch to Last-Used Keyboard
  Layout` clears from the exact preimage `Meta+Alt+L`.
- Whole-table preflight fails closed for any unexpected row preimage or target
  conflict, before journal creation or mutation.
- Every KGlobalAccel reply-validation failure emits one bounded, non-reflective
  detail token identifying its exact condition. Empty cosmetic labels in a
  valid `a(ssssssaiai)` shortcut-info record are accepted; identity and all
  size/key bounds remain fail-closed.
- Revert restores only bindings still owned by that override.
- Live acceptance is one user-run Apply/Revert/interrupted-recovery gate:
  separately authorized, bounded, reversible manual confirmation with exact
  restoration under the live guide and standing live-test boundary; no live
  result is claimed by static evidence.

## Approach And Dependencies

- Minimal KCM-owned Apply/Revert path with fail-closed preflight and
  ownership-scoped revert; no install/startup mutation path.
- Depends only on the existing shortcut catalog and KGlobalAccel ownership
  checks; no settings-group, default, or unrelated binding changes.

## Verification

- Static-only complete: KCM Apply/Revert with Finish Apply/Restore recovery,
  confirmation-gated mutations, ordinary Settings Apply without shortcut
  mutation, ordered six-write Apply, ownership-scoped Revert, and private
  project journal.
- Focused static coverage in `shortcutreconciler_test.cpp` (Apply order,
  `Meta+Esc` refusal without mutation, partial-write resume, setter `a(ai)`
  reply decoding, stale-owner recovery, external-edit handling, journal/path
  safety) and `activeborderconfig_shortcut_test.cpp`
  (ordinary-save isolation, recovery routing, confirmation gates, state/error
  presentation). No live Apply/Revert/interrupted-recovery result is claimed.

## Material Decisions And Accepted Evidence

- Approved durable contract, including exact role allowlist, preserved
  non-`Meta+L` lock keys, and private project journal, is recorded in
  [decisions](../decisions.md#shortcuts); this record duplicates no decision.
- Static KCM table/recovery implementation with the focused coverage above is
  accepted as static-only. No live Apply/Revert/interrupted-recovery result is
  claimed under this record.
- Resolved Plasma 6 KGlobalAccel compatibility defect: host Plasma/KWin 6.7.4
  exposes `setShortcutKeys` as an out-first XML method: `a(ai)` out, then
  `as`, `a(ai)`, `u` inputs, with direction-relative `Out0`/`In1`
  `QSet<QKeySequence>` annotations. The validator incorrectly treated document
  order as input-first call order, rejecting this exact contract before writes.
  It now accepts the exact out-first contract and still rejects absent or
  mismatched methods.
- Resolved target-conflict blindness: Apply and KCM status now use strict
  `globalShortcutsByKey((ai)(i))` and `globalShortcutAvailable((ai)s)` checks
  for `Meta+L`, `Meta+Esc`, `Meta+Alt+K`, and `Meta+Alt+L`, including
  .desktop-declared defaults absent from the tuple enumeration. The only
  accepted foreign holder is the user-approved System Monitor `_launch` on
  row 1's `Meta+Esc` target; all other holders, malformed replies, and
  availability inconsistencies fail closed before journal creation or writes.
- Hermetic evidence: the exact captured out-first XML is accepted while absent
  and mismatched methods are rejected; keyed fake-store coverage makes a
  default-only holder (empty active keys, default `Meta+Esc`) visible despite
  its absence from `readAll`, and proves zero-write rejection for relocation
  and clear targets. It also proves the authorized System Monitor case applies
  six allowlisted writes without writing System Monitor. CTest passed 21/21;
  `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `nix flake check`, and the KWin TypeScript suite (385 tests, 47 suites)
  passed. No live Apply, setter, KWin, Plasma, or config mutation was run.
- Resolved the next masked preflight refusal: dynamic `QDBusInterface` objects
  perform implicit owner tracking and introspection at construction. In the KCM,
  that made the bus-daemon proxy invalid despite the connected session bus.
  Owner resolution now uses `QDBusConnection::interface()->serviceOwner()` and
  `serviceUid()`; KGlobalAccel reads and the pinned-owner setter use raw method
  calls, avoiding every dynamic proxy. The owner pin remains immutable and the
  write path still re-confirms it immediately before each write. Hermetic owner
  coverage accepts a valid owner, rejects an absent service before any write,
  and rejects owner drift without changing the pin. Read-only live inspection
  confirmed `org.kde.kglobalaccel` owner `:1.614`, UID `1000`, and the exact
  setter contract. No live Apply, setter, KWin, Plasma, or config mutation was
  run for this correction.
- Resolved the fourth masked preflight refusal from real session data. The
  `KDE Keyboard Layout Switcher` component supplied two valid shortcut-info
  records whose action-friendly field was empty: `Switch to Next Keyboard
  Layout` at `Meta+Alt+K`, and `Switch to Last-Used Keyboard Layout` at
  `Meta+Alt+L`. The observed tuple order is exactly `action`, `friendly`,
  `component`, `componentFriendly`, `contextUnique`, `contextFriendly`,
  `active`, `defaults`, matching `a(ssssssaiai)`. `friendly` is cosmetic and
  is not used for allowlisting, owner checks, or occupancy decisions, so it
  may be empty while retaining the 256-character bound. `action` and
  `component` remain nonempty and bounded; every key list remains bounded and
  limited to nonnegative values. The capture had 20 components and 349 tuples;
  maxima were 3 keys, key value 503316512, and string length 65, all within the
  existing bounds. No session payload fixture is committed: the regression
  test uses the captured `a(ssssssaiai)` shape with generic identifiers, so no
  application/activity data needed redaction.
- The raw all-shortcut-info read now validates its exact reply signature and
  preserves a fail-fast 16,384-tuple wire bound. Owner pinning, exact write
  allowlist, the setter validator, keyed `.desktop` occupancy checks, and the
  six-write Apply cap are unchanged.
- Verification for this correction: 78 of 78 bounded preflight detail tokens
  have an exact-equality producing-condition test. The count is 50 static
  production literals plus 14 field suffixes under each of the two reply
  prefixes. The captured-shape fixture proves the empty-friendly record is
  accepted; malformed type/signature/arity/shape, all key/string bounds,
  wire/collection bounds, keyed consistency, and owner drift remain refusing.
  CTest passed 21/21; `cargo fmt --check`, `cargo clippy --all-targets
  --all-features -- -D warnings`, `nix flake check`, and the KWin TypeScript
  suite passed (386 tests, 47 suites). No live mutation was run.
- A follow-up read-only capture re-queried all 20 KGlobalAccel components and
  349 `a(ssssssaiai)` records. The same two Keyboard Layout Switcher records
  have an empty `friendly` field; all identity fields are nonempty. The largest
  record has 3 keys, the largest key is 503316512, and the longest string is
  65 characters, so no configured bound refuses this session data. The tuple
  order is `action`, `friendly`, `component`, `componentFriendly`,
  `contextUnique`, `contextFriendly`, `active`, `defaults`, matching the
  decoder.
- The rows that clear Keyboard Layout Switcher intentionally send an empty
  `QSet<QKeySequence>`, encoded as a well-formed empty `a(ai)` array. A
  nonempty sequence is always encoded as `(ai)` with four integer slots,
  including zero padding. Therefore this path cannot emit the malformed D-Bus
  type framing from the retained KWin abort; no write guard is needed. This was
  established without a setter or live Apply. Native CTest passed 21/21, and
  `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D
   warnings`, and `nix flake check` passed.
- Resolved the KCM crash during an actual Apply. `writeKeys` received the
  setter reply as `a(ai)` (`QSet<QKeySequence>`) but put its reply argument in
  write mode and read an `int` where the next value was the inner `ai` array.
  It now reads the nested array in read mode with array, structure, inner-array,
  and basic-type guards before each descent. Unexpected framing and invalid
  slot sets refuse the write confirmation without reaching a basic read. The
  same audit guarded every other reply decoder that descends from a container
  to a basic value. Hermetic coverage encodes exact empty and two-sequence
  `a(ai)` sets, accepts both decoded slot sets, and rejects short, long,
  out-of-range, and over-limit shapes.
- A journal records a D-Bus unique owner only as provenance. On Finish Apply or
  Restore, a dead prior unique name with the same verified UID now rebinds to
  the current pinned owner after the recorded image is validated and before
  recovery writes. Owner drift during the current recovery remains fail-closed.
  Focus-applied Finish Apply and Restore coverage both use stale `:1.1191` and
  verify the expected postimage or restored preimage respectively. The real
  crash left a `focus-applied` journal; no live recovery result is claimed yet.
- Read-only keyed KGlobalAccel getters confirmed the exact whole-key holders:
  `Meta+Esc` has only `org.kde.plasma-systemmonitor.desktop` / `_launch`;
  `Meta+L` has `kwin` / `plasma-auto-tiler-focus-right` and `ksmserver` /
  `Lock Session`; `Meta+Alt+K` has its `kwin` project action and `KDE Keyboard
  Layout Switcher` / `Switch to Next Keyboard Layout`; and `Meta+Alt+L` has
  its `kwin` project action and `KDE Keyboard Layout Switcher` / `Switch to
  Last-Used Keyboard Layout`. Every key reported unavailable, consistently
  with its nonempty holder set. The System Monitor component is hyphenated and
  has the `.desktop` suffix, so the row-owned authorized-target identity now
  matches it exactly. It remains outside the write allowlist. The Switcher
  action-friendly labels are empty in the same live payload; write validation
  now treats both friendly fields as bounded cosmetic data, as read validation
  already did. Component/action identity and key validation remain strict.
- Current full read-only enumeration returned 20 components and 349 tuples.
  Every identity was nonempty; maximum string length was 65, active/default
  key-list maxima were 3, and the maximum key was 503316512, within all
  configured bounds. The six allowlisted tuples have the closed-table expected
  preimages. CTest passed 21/21; `cargo fmt --check`, `cargo clippy
  --all-targets --all-features -- -D warnings`, and `nix flake check` passed.
  No live mutation was run.

## Diagnostic Token Map

All details below are static ASCII text. `Shortcut state unavailable:` is the
KCM wrapper; no token includes foreign reply values.

| Token | Producing condition |
| --- | --- |
| `unexpected allComponents reply: wrong message type` | Reply is not a D-Bus reply message. |
| `unexpected allComponents reply: wrong signature` | Reply signature is not `ao`. |
| `unexpected allComponents reply: wrong arity` | Reply does not have exactly one argument. |
| `unexpected allComponents reply: wrong variant shape` | Argument is neither the typed object-path list nor a D-Bus argument. |
| `unexpected allComponents reply: wrong array framing` | D-Bus argument is not an array. |
| `unexpected allComponents reply: empty object path in typed list` | Typed object-path list contains an empty path. |
| `unexpected allComponents reply: empty object path in argument array` | D-Bus object-path array contains an empty path. |
| `unexpected allComponents reply: too many components` | Component count exceeds 1024. |
| `unexpected allShortcutInfos reply: wrong message type` | Per-component reply is not a reply message. |
| `unexpected allShortcutInfos reply: wrong signature` | Per-component reply signature is not `a(ssssssaiai)`. |
| `unexpected allShortcutInfos reply: wrong arity` | Per-component reply does not have exactly one argument. |
| `unexpected allShortcutInfos reply: wrong variant shape` | Per-component argument is not a D-Bus argument. |
| `unexpected allShortcutInfos reply: wrong array framing` | Per-component D-Bus argument is not an array. |
| `unexpected allShortcutInfos reply: too many wire tuples` | One D-Bus array exceeds 16,384 decoded records. |
| `unexpected allShortcutInfos reply: too many tuples` | Shared record mapping receives more than 16,384 records. |
| `unexpected allShortcutInfos reply: too many collected tuples` | Cross-component collection exceeds 16,384 records. |
| `unexpected globalShortcutsByKey reply: wrong message type` | Keyed reply is not a reply message. |
| `unexpected globalShortcutsByKey reply: wrong signature` | Keyed reply signature is not `a(ssssssaiai)`. |
| `unexpected globalShortcutsByKey reply: wrong arity` | Keyed reply does not have exactly one argument. |
| `unexpected globalShortcutsByKey reply: wrong variant shape` | Keyed argument is not a D-Bus argument. |
| `unexpected globalShortcutsByKey reply: wrong array framing` | Keyed D-Bus argument is not an array. |
| `unexpected globalShortcutsByKey reply: too many wire holders` | One keyed D-Bus array exceeds 16,384 decoded records. |
| `unexpected globalShortcutsByKey reply: too many holders` | Shared keyed-record mapping receives more than 16,384 records. |
| `unexpected globalShortcutAvailable reply: wrong message type` | Availability reply is not a reply message. |
| `unexpected globalShortcutAvailable reply: wrong signature` | Availability reply signature is not `b`. |
| `unexpected globalShortcutAvailable reply: wrong arity` | Availability reply does not have exactly one argument. |
| `unexpected globalShortcutAvailable reply: wrong variant shape` | Availability argument is not a bool. |

The following field suffixes each produce two distinct full tokens, prefixed by
either `unexpected allShortcutInfos reply: ` or `unexpected globalShortcutsByKey
reply: `: `empty action`, `oversized action`, `empty component`, `oversized
component`, `oversized friendly`, `oversized component friendly`, `oversized
context unique`, `oversized context friendly`, `too many active keys`,
`negative active key`, `oversized active key`, `too many default keys`,
`negative default key`, and `oversized default key`. They identify the one
failed field predicate in the fixed validation order.

| Token | Producing condition |
| --- | --- |
| `unexpected globalShortcutsByKey reply: negative key` | Keyed lookup input is negative. |
| `unexpected globalShortcutsByKey reply: non-positive key` | Keyed lookup input is zero. |
| `unexpected globalShortcutsByKey reply: oversized key` | Keyed lookup input exceeds the key bound. |
| `unexpected globalShortcutAvailable reply: negative key` | Availability input is negative. |
| `unexpected globalShortcutAvailable reply: non-positive key` | Availability input is zero. |
| `unexpected globalShortcutAvailable reply: oversized key` | Availability input exceeds the key bound. |
| `unexpected globalShortcutAvailable reply: oversized component` | Availability component argument exceeds 256 characters. |
| `unexpected globalShortcutsByKey reply: negative occupancy key` | Reconciler occupancy key is negative. |
| `unexpected globalShortcutsByKey reply: non-positive occupancy key` | Reconciler occupancy key is zero. |
| `unexpected globalShortcutsByKey reply: oversized occupancy key` | Reconciler occupancy key exceeds the key bound. |
| `unexpected globalShortcutsByKey reply: too many occupancy holders` | Store returns more than 16,384 holders. |
| `unexpected globalShortcutAvailable reply: empty holders report unavailable` | Empty holder list disagrees with availability. |
| `unexpected globalShortcutAvailable reply: occupied holders report available` | Nonempty holder list disagrees with availability. |

Holder revalidation likewise has one token per predicate: `empty holder
component`, `oversized holder component`, `empty holder action`, `oversized
holder action`, `too many holder active keys`, `negative holder active key`,
`oversized holder active key`, `too many holder default keys`, `negative holder
default key`, and `oversized holder default key`, each prefixed by `unexpected
globalShortcutsByKey reply: `.

## Next Action

- Separate authorization remains required for the single user-run live
  Apply/Revert/interrupted-recovery gate; rebuild the native effect first, then
  follow the [verification runbook](../live-shortcut-override-verification.md).
  No live result is claimed.

## Retained Core Triage

- PID 3568836 aborted while KWin's D-Bus server demarshalled an inbound
  `QKeySequence` argument (`deliverCall`/`activateObject`), before its target
  method ran. This is unrelated to Apply/Revert, which sends `setShortcutKeys`
  from KWin to the separate KGlobalAccel service. The stripped stack does not
  identify the inbound method or sender.
