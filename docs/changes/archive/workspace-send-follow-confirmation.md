# Workspace Send Follow Confirmation

## Goal

- Ensure a committed workspace send reports follow completion only when KWin
  immediately exposes the selected target desktop.

## Scope

- Confirm the existing KWin desktop switch with one direct current-desktop read.
- Preserve commit, follow ordering, exact Rust transaction checks, and later
  send usability when that read fails.

## Non-Goals

- No native retry, polling, rollback, owner rebind, queueing, topology recovery,
  focus policy change, or border diagnosis.

## Acceptance

- A no-op native switch cannot log completed follow after a committed send.
- A later distinct same-instance send can still commit, switch, and focus.
- Existing busy isolation and same-target behavior remain covered.

## Evidence

- `F2A19Z` lines 94-106 reach acknowledged, committed, and logged completed
  follow, so it is not a pre-ack or verify failure. The void KWin setter made
  that completion claim unverified.

## Outcome

- `switchToTarget` now reads `currentDesktopForScreen` once after the existing
  setter. A missing, throwing, or mismatched read skips focus and completed
  follow while retaining the committed transaction and allowing later sends.
- The production-entry regression fails when the old unconditional success is
  restored, then passes with full planned/ack/verify replies, native echoes,
  failed-switch truthfulness, and a later committed/followed/focused send.
- Focused TypeScript typecheck, production coordination, workspace-send adapter,
  Rust lifecycle, and KWin script bundle checks pass. No live acceptance is
  claimed; first-send, rapid, and same-target physical journeys remain pending.
