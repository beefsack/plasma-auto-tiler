# Group Underlay Restart Visibility

## Goal

Fix the user-reported underlay disappearance on the laptop (2026-09-29):
workspace 2 only in `FeTnf4`, nowhere after a `just dev` restart in `y3jVs3`.
Preserve the current group membership, stacking, colour, and visibility
semantics. Add bounded effect-side group apply/anchor evidence without raw IDs.

## Scope and acceptance

- Correct the group effect stream across script/Planner restarts in the same
  KWin process without changing the fixed Planner generation or allowing stale
  delayed setters to overwrite newer state. Keep D-Bus method and payload
  fields, Meta/fullscreen/maximize policy, and native window selection intact.
- Effect records bounded accepted/rejected and selected/no-anchor outcomes
  with counts/reasons, redacted and transition-oriented; logging never gates
  painting. No new timers, polling, private API, or fallback path.
- Host-matched native build/CTest, KWin tests/typecheck, Rust checks if changed,
  diff/line deltas and a concise user-owned laptop live check. No agent live
  testing; leave `devenv.nix` and `docs/backlog.md` untouched.

## Investigation and approach

- Long trace `~/Downloads/plasma-auto-tiler-dev.FeTnf4.log:3308-3312`
  ends with a group setter submitted at native revision 60. After a `just dev`
  restart, `y3jVs3.log:848-852` still submits but reaches revision 19. Both
  script runs use the fixed `plan-1` generation from `kwin/src/entry.ts:55`.
  Rust `group_highlight.rs:410-448` compares monotonic revision for the same
  owner/generation; clearing display does not reset its high-water mark. The
  persistent effect would therefore reject the newer script's lower revision.
- Use a per-script-instance effect stream generation for group payloads only;
  keep the fixed Planner request/reply generation. Reuse the existing bounded
  script generation source. Existing Rust native order policy already resets
  on generation change; no native ordering rewrite.
- The first workspace-only symptom is not proven by the traces: they contain
  script `setter-submitted` but no native receipt, Meta or anchor outcome.
  Effect-side diagnostics will distinguish rejection from a missing/hidden
  anchor or visibility gate on the next laptop run.

## Outcome and offline evidence

- Effect payload now carries a fresh bounded per-script group generation from
  the existing tray token source, minted once per adapter entry. Planner
  `kwin-plan-adapter` / `plan-1` requests and replies are untouched. The native
  Rust new-stream branch already accepts a lower revision after the explicit
  clear while preserving within-stream stale rejection; its existing test now
  covers that exact restart sequence.
- Effect info logs one redacted `group-highlight:setter` line per setter with
  outcome, member count, anchor reason and the Meta/focus/endpoint/visibility
  bits. `group-highlight:transition` logs only anchor-reason or visibility
  changes from stack, member visibility, focus, Meta and clear events. Logging
  failures cannot change rendering. No native membership or rendering policy
  was changed.
- `just build-native-effect` staged the effect and both KCMs. Host-matched
  native CTest 29/29, KWin typecheck and tests 805/805, Rust workspace tests,
  fmt and strict clippy pass; `git diff --check` passes. Production delta
  +127/-6 lines; test delta +140/-8. No agent ran live KWin/Plasma testing.
- The same-KWin observation does not prove the same effect instance survived
  the restart; neither old trace recorded a native setter outcome. The fixed
  stream was a real source-level bug and the new lines will distinguish it
  from the remaining workspace-specific possibilities.

## Laptop live check (user-owned)

| Step | Expected `[kwin]` evidence and visual result | Red flag |
| --- | --- | --- |
| After a fresh Plasma session delivering the rebuilt effect, run `just dev`; focus a nested group on workspace 1 and hold Meta | `group-highlight:setter outcome=accepted members=<n> anchor=selected ...` and either `vis=1` there or `group-highlight:transition anchor=selected ... meta=1 ... vis=1`; underlay appears | `setter-submitted` without native `setter`, or `stale`, `parse-rejected`, `focus-mismatch`, `no-member-match`, `all-items-hidden`, `first=0`, `meta=0`, `foc=0`, or `ep=0` when expected visible |
| Repeat on workspace 2, then return to workspace 1 | Both workspaces show the underlay for eligible focused groups; each setter has a native outcome line | One workspace only, or accepted/selected/visible diagnostics with no pixels |
| Stop and restart `just dev` in the same Plasma session, repeat both workspaces | Fresh group submissions yield `outcome=accepted` even when revision starts below the previous run's high-water mark; underlay remains visible on both | Repeated `outcome=stale` on the new run, or new `anchor=all-items-hidden` / `no-member-match` on one workspace |

Native `vis=1` proves item selection, not composited pixels; compare each
diagnostic with what is actually on screen. Avoid sharing raw window IDs from
the surrounding trace.

## Bounded units

1. Give the effect payload a fresh script-instance group stream while keeping
   Planner authority/binding unchanged; update existing bridge tests.
2. Add one bounded native group apply result line and anchor outcome/visibility
   transition evidence, with focused existing test coverage.
3. Verify offline, update the accepted archived underlay note, and archive this
   change note with the result and live-check table (complete).
