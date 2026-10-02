# Windows Group Underlay

## Goal And Scope

- Windows parity item 2: configurable-alpha filled group underlay beneath the
  lowest member of the focused window's immediate-parent group, below the active
  border. Reuse the owned layered click-through carrier and shared visual policy.
- Default enable/colour/extension match KDE: enabled, `#40808080`, extension -1
  resolves to border width. Geometry is the Engine-projected group union, never
  the live dragged frame. Hide for maximise/fullscreen, floating and root leaf.
- User decision 2026-10-02, accepted for now: movement-oriented staged lifetime
  from `group-underlay-move-trigger.md`: A Win+Shift (extras/either order allowed),
  B focused interactive move, C unfocused dragged subject if simple. Resize is
  not a trigger; the chord remains independent during resize. Hard-coded trigger.
- KDE behaviour, parity item 3 and Win+drag implementation (item 7) are outside
  this change. Shared trigger policy must allow item 7 to feed movement later.

## Approach And Units

1. Bright-yellow Windows border default, separately delivered as `3fcc953`;
   native gates and active-border mock passed. Hosted CI 37008924374 green.
2. Implement carrier, projected group query, shared trigger policy and stages
   A/B with unit coverage. Verify pending/drag gates before movement-time queries.
3. Assess C at the simplicity checkpoint; park if it needs subject-query
   framework, focus side effects or new lifecycle machinery. Never substitute
   dragged subject for Engine `focused_window`.
4. Independent review of live/public behaviour; native gates and bounded live
   proof of geometry, z-order, chord/move lifetime and clean teardown.
5. Promote durable decisions, record evidence/outcome and archive this note.

## Acceptance And Verification

- Immediate-parent projected union plus shared border/extension expansion;
  premultiplied-alpha fill and actual native stacking beneath members/border.
- Modifier matrix, move/resize identity/lifetime, exclusion and teardown tests.
- Four-package native locked build/test, strict all-target Clippy, rustfmt,
  whitespace checks, applicable harness parser/mock and hosted CI green.
- Synthetic live proof on identified helpers or approved ordinary apps; physical
  appearance/input acceptance remains user-owned. Follow the live Windows guide.
- End every live run with no project actor/overlay/ledger/hidden-window residue;
  arranging readback 1 and pen visualization 35.

## Status

- Unit 1 delivered. A/B implemented with additive shared trigger policy,
  premultiplied-alpha carrier reuse and Engine ActiveGroup geometry. Native
  gates passed; KDE callers remain unchanged.
- Independent review: hidden border excluded from anchor candidates; native
  member anchors filtered for managed, visible, nonminimised/noncloaked state.
  ActiveGroup's focus sync is retained intentionally with the actual eligible
  managed foreground, never an unfocused dragged subject. Shell/unmapped focus
  is rejected before the query.
- C parked at the simplicity checkpoint: a distinct unfocused subject needs
  new Engine routing/resolution and invalidation lifetime. Activation from an
  unfocused native title bar is not proven here; the scope decision is justified
  independently by framework growth. No C machinery is introduced.
- First live report `target/windows-group-underlay/20261002-233628-16776/`
  supports exact 8px expansion, z below both members/border, source union held
  during move, resize exclusion, maximise suppression, off and crash cleanup.
  Its composed-pixel readings lack a blend assertion and chord-only refresh
  can wait for the 2s slow poll; this report is partial evidence, not acceptance.
- Failed fixture approaches: spaced synthetic chord downs and Win-tap release
  allowed Start to steal foreground. Back-to-back downs plus Escape/refocus
  repaired the fixture; these runs do not prove normal-hook Start suppression.
- Corrected chord edges to wake before idle skip on the existing 100ms pump;
  steady holds do not introduce continuous reconciliation. Corrected carrier
  cache validation to repair an underlay displaced above its nonforeground
  anchor. CLI extension maximum 32 matches `unifiedsettings.ui`.

## Accepted Evidence And Limits

| Evidence under `target/windows-group-underlay/` | Accepted scope |
|---|---|
| `20261003-002739-8208/group-underlay-report.json` | Current chord-edge path: default grey, both modifier orders/extras/either release, exact projected union+8px at DPI120, below both members/border, stable foreground and click-through flags; 8/8 actual member displacements with fixed source footprint; resize exclusion/chord during resize; stationary move, Escape cancel, brief chord-to-move handoff, focus retarget, maximise/root-leaf/off; graceful/crash cleanup. Distinctive `#80ff0000` blend passed 4/4 hidden-vs-shown gap-strip points with shadow tolerance and meaningful delta; explicit extension32 produced pad44. |
| `20261003-004003-27540-zproof/group-underlay-zproof.json` | Latest carrier: deliberately raised owned underlay above lowest member at equal geometry; recovered below both members/border, unchanged outer rectangle. Graceful teardown verified. |
| Native four-package gates after final range correction | Locked build/test, strict all-target Clippy, rustfmt and whitespace checks green. Portable chord/OR matrix, hit-test classification, exclusion, fill raster and flags; existing Engine nested-group coverage retained. Harness mock/parser green. |

- Latest audits: zero run actors, border/underlay HWNDs and ledger/request
  residue; arranging raw1 and pen visualization raw35. No live actor remains.
- The chord show receipt includes a 600ms fixture sleep (617ms sampled total);
  hide receipts also follow fixture sleeps. These are eventual-state evidence,
  not exact latency measurements. Source establishes the 100ms edge sampling.
- Fullscreen and floating exclusions have offline/source evidence; no dedicated
  new live fullscreen/floating fixture. Topmost/mixed-DPI and nested-parent
  live geometry remain user checks. Moving-subject removal was not separately
  exercised; idle member removal yielded root leaf. Nonstandard/keyboard-only
  move hit zones and very fast START delivery may classify unknown; chord
  remains the fallback, with no speculative machinery.
- Additional failed fixture approaches: long Win-hold across drop in hookless
  `tile-proof` allowed shell foreground theft, so sustained hold through END is
  not accepted; brief handoff and sequential END-then-chord are accepted.
  Mark-after-hold missed the first shown event (repaired by mark-before-action).
  Z probe reused HWND as height (repaired by distinct variables); its retry
  passed. No product workaround masks these fixture failures.
- Remaining user-owned physical checks: appearance/input and Start coexistence
  with production hook, sustained chord through move finish, unfocused caption
  activation/C relevance, fast/custom-frame/keyboard move fallback, fullscreen,
  topmost and other outputs/DPI. The scoped hookless proof does not prove Snap
  takeover or physical shortcut delivery.
- A/B accepted; C parked. Durable choices promoted to `docs/decisions.md`.
  Implementation delivered as `cb790d9`; hosted CI 37022363374 passed Windows,
  Rust, KWin and shell jobs. This record is archived at scoped completion.
- Backlog handoff: mark Windows parity item 2 A/B delivered, retain C parked
  for reassessment with parity item 7; add parity item 11 reminder to decide
  accent/configured colour and remove the temporary yellow development default.
  Physical follow-ups above remain explicit. Next implementation action: none
  for this change; the next parity item belongs to a fresh Lead.
