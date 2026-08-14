# Specification: Reference Profile Invariants

Ownership and approval:
- Owner: Lead `lead-openai`
- Status: Approved 2026-08-15 by autonomous-mode instruction

## Intent and Desired Outcome

Keep the reference profile catalog traceable to the source tags declared by
`docs/reference-wm-comparison.md` so catalog evidence cannot silently outgrow
its documented sources.

## Scope and Non-Goals

In scope:

- Declare the existing bspwm `[B1-EX]` source tag and correct the stale fixture
  availability statement.
- Add a maintainable test requiring every catalog reference source tag to be
  declared in the comparison document.

Non-goals:

- Runtime or catalog behavior changes, catalog expansion, and reference-WM
  execution.
- Live KWin/Plasma validation.

## Applicable Principles and Decisions

- No project `docs/principles.md` is present.
- The comparison document remains research-only and labels KWin behavior as
  `unproven-until-live`.

## Constraints

- Never claim that a reference WM was run.
- Distinguish retrieved static fixtures from live validation.
- Limit implementation edits to the comparison document and the smallest
  relevant existing test file.

## Acceptance Criteria

- [x] The comparison document declares `[B1-EX]` as the bspwm
  `examples/sxhkdrc` pinned static fixture and removes only the stale
  not-fetched statement.
- [x] A regression test fails for a catalog source tag not declared by the
  comparison document and passes with the corrected document.
- [x] The focused test, typecheck, and `git diff --check` pass.

## Unresolved Questions

- None.

## Consequential Decisions

- Static fixture retrieval is documentation evidence only; no reference WM or
  live KWin/Plasma session is represented as having run.
