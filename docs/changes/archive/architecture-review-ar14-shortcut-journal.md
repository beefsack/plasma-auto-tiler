# AR14: Shortcut Override Journal Simplification

## Goal and scope

- Review architecture-review recommendation 11 after a focused source read and
  reduce incidental journal code while retaining every approved shortcut
  override and recovery guarantee. No live session or host mutation.
- Preserve the exact v2/v3 on-disk journal images and host-independent canonical
  path. Do not discard or rewrite the user's existing preimages.

## Findings and constraints

- `shortcutreconciler.cpp` is 3,684 lines and its focused test is 5,006 lines.
  Only five compiled rows are writable, but each has an independently verified
  KGlobalAccel owner, exact allowlisted tuple, keyed target occupancy (including
  `.desktop` defaults), persisted journal pre/post, ordered setter confirmation,
  and ownership-scoped reverse restore. `collectLiveSnapshot` and the setter
  contract/strict reply checks fail closed before mutation; these protect the
  approved exact-conflict and readback requirements (`docs/decisions.md`,
  Shortcuts; `docs/changes/shortcut-override.md`).
- The phases `apply-pending`, `focus-applied`, `apply-complete` provide
  persist-before-write interruption recovery. Focus takes `Meta+L` before Lock
  Session drops it; project bindings precede each foreign clear. Revert restores
  only a still-owned postimage, in reverse order, and retains the journal if
  restoration is incomplete. Same-UID stale unique-owner rebinding permits
  Finish Apply / Restore after a service restart. These are required for the
  reversible Apply/Revert contract.
- A v2 journal records the first three rows; v3 records all five. Existing v2
  journals must Revert using their original six entries or upgrade on Apply by
  preserving the six recorded preimages and adopting new live rows before any
  setter write. A completed v2 upgrade demotes to the resumable phase only
  after old rows match their postimage. This cannot simply be deleted while an
  existing three-row journal may remain (`decisions.md` Shortcuts).
- The canonical journal is in `GenericConfigLocation/plasma-auto-tiler`, not a
  KCM-host-specific directory. The single old `kcmshell6` location is consulted
  read-only for preview and copied after a confirmed mutation, with path, UID,
  validity and readback checks. Removing the migration would strand an existing
  legacy journal; retaining a minimal on-demand compatibility path is necessary.
- Force Apply is confirmed only for compiled foreign clear-row third images.
  It rechecks the entire live and journal image and owner before writing and
  records the confirmed actuals as reversible preimages. The operation and
  failure logs on `plasmaautotiler.shortcut op=` are required observability.
  Neither Force nor its full-image fence may be removed.
- Incidental code includes repeated v2-to-v3 entry construction and persistence,
  and manually expanded 10-entry journal readback equality. The path-based
  legacy copier and injectable store-based copier differ in observable error
  tokens and same-path handling; retain both. Detailed reply validators also
  contribute size, but their diagnostic tokens are an existing documented
  contract; do not weaken them as part of a journal-only change.

## Approach and acceptance

1. Keep v2/v3 disk schemas, phase transitions, destination path, confirmed
   migration timing, live checks, diagnostics, Force snapshot fence and exact
   per-row operations unchanged. Use one exact ordered journal-entry comparison
   for persist readback, including all ten entries even for v2 and all schema,
   phase, owner, UID and row-kind scalars. Keep `journal readback failed` and
   `journal readback mismatch` distinct, and cover single-field tampering.
2. Consolidate repeated v2 upgrade construction into one persist path only
   after retaining completed-old-row postimage checks, new-row eligibility,
   completed-to-focus-applied demotion, pending-phase preservation, original
   six preimages, the same error tokens and persist-before-write. Preserve
   v2-only-six-entry Revert and the entire v3 recovery path. No KCM UI change.
3. Independent Worker reviewed the plan before implementation. If a proposed
   deletion changes user-visible behavior or recovery, stop rather than make
   that cut. Verify each green slice with focused hermetic native tests, then
   run the documented host-matched
   `just build-native-effect` and native tests after the last source change.

Initial estimate: 35-70 production lines net removable. The actual reduction
is six production lines after exact comparison and phase behavior were
factored into shared code; focused regression coverage adds 132 test lines.
The two migration paths remain because their diagnostic and same-path semantics
differ. The result is a smaller number of recovery paths, not a material
reduction in total code size. Larger line reduction would require a separate
decision to change approved recovery or diagnostics; dropping Force, v2 or
kcmshell6 recovery contradicts current approvals.

## Evidence and outcome

- Focused investigation: `shortcutreconciler.cpp:1889-2150,2259-2554,2641-2859,3160-3401,3449-3682`;
  `shortcutreconciler.h:161-235,485-506`; `docs/decisions.md:629-701`;
  `docs/changes/shortcut-override.md:216-281`.
- Independent plan review: retain both migration paths (path-based versus
  store-seam error/identity differences); accept readback and v2 construction
  dedup only with full-field/v2-phase/error-token proof and existing Force,
  stale-preimage, ownership-scoped Revert, and legacy fixtures.
- Implemented readback comparison shared with Force's journal-entry equality,
  and a single v2-to-v3 construction/persist path. Current journal schema,
  canonical/legacy migration, Force full-image recheck, operation logs, KCM
  behavior and v2/v3 Revert remain unchanged. No recorded mechanism changed,
  so `docs/decisions.md` needs no update.
- Focused hermetic coverage: readback failure versus mismatch, late v3
  `monocle.post` and v2 unused new-row readback tampering, both non-completed
  v2 phase paths retaining their recorded old preimages. Existing native
  cases cover fresh Apply, reverse Revert of v3 and v2, Force, stale full
  snapshot and journal, interrupted resume, and deferred legacy migration.
- Independent implementation review found no behavioral regression and
  recommended keeping the scoped code without expanding to removal of an
  approved recovery mechanism. It called out the initial reduction estimate
  as unsupported: `git diff --numstat` is 62 added / 68 removed production
  lines (net -6), plus 132 added test lines; no test count changed.
- Host-matched verification after the source change: `just build-native-effect`
  passed for host KWin 6.7.5 (derivation
  `zvakw8z637f9ppaqlfwwp2z2566xn5wv-kwin-6.7.5`); the Worker built the
  shortcut test in the matching derivation shell and ran focused
  `ctest -R native-effect-shortcut` (9/9); the Lead rebuilt the entire native
  test target set with `nix develop /nix/store/zvakw8z637f9ppaqlfwwp2z2566xn5wv-kwin-6.7.5.drv --command bash -c 'cmake --build target/kwin-native-test-build && ctest --test-dir target/kwin-native-test-build --output-on-failure'`
  (27/27). `git diff --check` passed. No live KWin/Plasma testing or host
  configuration mutation occurred.
- Outcome: AR14's focused read and compatible narrow deduplication are
  complete. The review's broad journal simplification is incompatible with
  current v2/legacy undo recovery and Force authorization unless those
  user-approved guarantees change. No such change was made.
