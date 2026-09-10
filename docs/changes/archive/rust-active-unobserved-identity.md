# Rust Active-Unobserved Identity

## Goal

Resolve the static root cause of Rust authority adapters refusing a valid active
window with `scope:active-unobserved`.

## Scope And Non-Goals

- Compare the current eligible-window and active-window identity derivations,
  then make them identical if source establishes an unambiguous mismatch.
- Add focused identity-mismatch coverage without a native QList/QObject harness.
- Preserve fail-closed eligibility and identity validation behavior.
- Do not run live KWin/Plasma actions, alter the existing readiness/diagnostic
  changes, or update backlog and decisions records.

## Acceptance

- The `active-unobserved` membership guard and both identity paths are traced
  from current source.
- A canonical single-braced QUuid and bare UUID identify the same window only
  when both normalize validly; malformed or duplicate identities remain refused.
- Focused static tests cover the previously unrepresentable identity mismatch.

## Approach

1. Inspect current adapter entry paths, normalization call sites, and the
   ineligibility branch.
2. Apply the smallest consistent identity normalization fix if evidence is
   conclusive, with focused tests.
3. Review the diff, run focused static tests, record outcome, and archive this
   note.

## Verification

- No focused test was run: there is no source change, and the available focused
  adapter commands bundle into `dist/`. No build, D-Bus, script loading, or
  live KWin/Plasma action was performed.

## Outcome

- Current source retains `active-unobserved` in all four entries. It compares
  `entry.ref === activeRef`, not normalized IDs. The prior QUuid normalization
  runs only while adding eligible `windowList()` entries, so braced-versus-bare
  ID text cannot affect this predicate.
- The cause is not unambiguous from source. An active window filtered from the
  eligible list and a distinct QV4 wrapper for an otherwise matching active
  window both produce this token. No eligibility relaxation, identity change,
  or focused regression test is valid without distinguishing those cases.
- Required discriminator for a separately authorized live capture: the active
  window's common eligibility properties, normalized internal ID, and whether a
  `windowList()` entry with that normalized ID is the same JS object.
