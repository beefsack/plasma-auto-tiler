# Group Underlay Cross-Domain Revision

## Goal

Fix the user-observed underlay sticking to the higher-revision workspace
after a workspace switch (`~/Downloads/plasma-auto-tiler-dev.l6uNLk.log`).
Show the current focused domain's immediate group even when that domain has
a lower retained revision. Preserve active-group single-flight, Meta, native
focus and visibility gates, and same-script late-setter protection.

## Cause and decision

- The Planner reports per-domain base revisions: workspace 1 at 23
  (`l6uNLk.log:1094,1100`), workspace 2 at 2 (`:1106-1111`). After a newer
  workspace-1 result, the script's global `lastRevision` rejects workspace-2
  replies (`:1121,1155,1189,1223,1265,1307`). This also explains the earlier
  direction-dependent observation in `FeTnf4`.
- Native Rust group policy also compares revisions globally within one script
  stream, so removing only the script gate would still reject domain B.
- Orchestrator direction: do not add domain-keyed state to both. The script's
  pending correlation/epoch and observed domain/focus fences already reject
  superseded async replies. Remove its redundant revision/correlation high-water
  gate and dead helpers. Retain native same-stream stale-setter protection by
  ordering the script's monotonic correlation (not per-domain revision); keep
  the per-script stream generation selected in the prior restart fix.

## Scope and acceptance

- Behavior test: display high-revision group A, switch to low-revision group B,
  accept and display B in both script bridge and native Rust policy; ignore a
  late older correlation. No protocol fields, new timers, polling, or gates.
- KWin tests/typecheck, native host build/CTest for FFI change, Rust workspace
  tests/fmt/strict clippy, relevant shell checks if needed; production/test
  line deltas. No live agent testing; leave `devenv.nix`, `docs/backlog.md`,
  user stashes and branches untouched. Stage only intended files when complete.
- Update the earlier archived restart note with the newly established cause,
  then archive this note with offline evidence and a user-owned live-check
  table (Meta-held and panel switches in both directions).

## Units

1. Remove the redundant script high-water gate and its dead parsing helpers;
   update existing bridge tests for cross-domain acceptance and stale replies.
2. Switch native same-stream ordering to monotonic correlation and update
   existing Rust/C++ contract tests.
3. Integrate, verify, update records and stage intended files (complete).

## Outcome and evidence

- Removed the script bridge's global `lastRevision`/`lastCorrelation` state and
  dead correlation parser. Pending correlation/epoch and focus/domain identity
  still fence superseded replies; `requestRevision` remains an advisory request
  value that the Planner does not use to gate this read-only query.
- Native Rust now orders setter calls by correlation within the existing
  per-script stream. The last accepted domain revision remains metadata in
  the unchanged POD; late older setters still refuse, even after display
  clear. No protocol, rendering, Meta, group-membership, or settings change.
- Regression failed against the original script gate (`sets.length` stayed 1
  after the low-revision reply), then passed. Current offline evidence:
  KWin typecheck and 805/805 tests; host-matched `just build-native-effect`
  staged all three plugins, CTest 29/29; Rust workspace tests, fmt and strict
  clippy passed; `git diff --check` passed. Production +23/-80 (net -57),
  tests +86/-39. No agent ran live KWin/Plasma testing.
- The earlier restart fix's archived note records this distinct follow-up.
  `docs/decisions.md` has no changed product decision: this corrects ordering
  across the already-selected single active group visual.

## Laptop live check (user-owned)

| Step after delivering the rebuilt native effect in a fresh Plasma session, then `just dev` | Expected `[kwin]` lines and visual result | Red flag |
| --- | --- | --- |
| Hold Meta on workspace 1, press `Meta+2`, then `Meta+1` | Each domain shows its own underlay. `group-highlight:setter-submitted ... revision=23` followed by `... revision=2` (actual values may change); both receive `group-highlight:setter outcome=accepted ... anchor=selected ... vis=1`, or a `group-highlight:transition ... meta=1 ... vis=1` after modifier observation | `dropped reason=stale-revision`, native `outcome=stale` on return to a lower-revision domain, or underlay stuck on the prior workspace |
| Switch both directions using the panel; hold Meta after arriving each time | `setter outcome=accepted ... anchor=selected ... meta=0 vis=0` is normal before Meta; holding Meta yields `group-highlight:transition ... meta=1 ... vis=1` and the underlay appears | `no-member-match`, `all-items-hidden`, `foc=0`, `ep=0`, or `vis=1` with no rendered underlay |

The new native setter line confirms acceptance/selection, not composited
pixels. Compare the log with the actual display on each workspace.
