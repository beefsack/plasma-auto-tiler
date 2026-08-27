# Change Log

## 2026-08-25

- The Orchestrator approved durable Standard proposal artifacts only. No product
  decision, implementation, live operation, source/test edit, or gate run is
  authorized by this approval.
- Recorded the scoped recommendation: query `org.kde.keyboard` `/Layouts`
  asynchronously at startup/reload, resolve aliases purely, retain stable IDs,
  and omit only layout-sensitive move aliases on unknown, malformed, unavailable,
  or lost replies.
- Recorded the supported-boundary limitation: no current KWin Script D-Bus signal
  subscription, therefore no dynamic layout-change claim.
- Units 01 and 02 are blocked and Unit 03 is parked pending the recorded user
  decisions. No implementation attempts, corrections, reviews, or gates exist.

## 2026-08-27

- The approved initial-release policy supersedes the fail-closed proposal: the
  existing hardcoded shifted aliases remain standard-US-only support, while
  detection, omission, opt-in configuration, migration, and reconciliation are
  not selected. The change is retained paused until initial-release completion
  and separately approved post-release complete-layout scope. No implementation,
  verification, or live work occurred; all execution counters remain zero.
