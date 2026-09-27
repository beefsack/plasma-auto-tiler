# Drag-and-drop reorganisation (option A)

## Goal and scope

User decision 2026-09-27: tiled interactive move drops use the existing Rust core drop resolver and topology policy as-is. Window edges split; group edges insert first/last or wrap perpendicular; group interiors insert by the current rule. Center/stack and unresolved or refused targets snap back. Drop only, no live preview or live sibling writes. Preserve resize-edge drags, floating Meta+drag and cross-domain refusal. No live KWin tests.

## Approach and acceptance

- Trace the move finish, oracle, protocol and Planner path, then connect the smallest existing drop operation to the normal correlated plan application and stale-replan fences. Remove interim paths that become dead; keep failed-drop recovery through observation and snap-back.
- Add lean behavior regressions for accepted placements, refusal and unchanged other drag routes. Keep correlated lifecycle logs and document tokens in `docs/dev-loop.md`.
- Identify, without implementing, the live preview path, observation/size-hint requirements, overlay integration, rough size, risks and any decision needed.
- Verify `kwin/` tests and typecheck, Rust workspace tests and format if Rust changes, native build and full CTest if native changes, and `git diff --check`.

## Bounded units

1. Inspected core/protocol: `Session::begin_drag`/`drop_drag` exist but no Planner command existed. Inspected KWin: tiled move finish currently arms a coalesced restore marker; native verdict supplies geometry and script reads finish pointer.
2. Added synchronous Rust `drag-drop` request: one complete observation, begin/drop, existing acknowledge/verify, full geometry reply; refusals leave the canonical tree intact. KWin now captures finish pointer before oracle pull and sends drop through ordinary Plan flight; failures use the existing one-shot restore marker and stale prewrite replan. Removed the superseded move-drop-only marker entry point and replaced its test with behavior coverage for the new route.
3. Reviewed core, protocol, adapter and test changes; verified offline, documented policy and logs, researched preview, and archived this note. Cross-domain product choice remains with the user.

## Outcome and evidence

Shipped offline pending live check. KWin 773 tests + typecheck;
Rust workspace 617 tests, `cargo fmt --all -- --check`, strict workspace
clippy and `git diff --check` pass. Native files unchanged; no native build or
CTest needed. No live KWin testing. Tiled
move-finish now dispatches one synchronous `drag-drop` Plan intent through
the shared single flight (finish-captured pointer + verdict identity);
refused or failed drops converge through the existing coalesced one-shot
restore marker. Tokens and lifecycle in `docs/dev-loop.md`.

## Cross-domain behavior: before / after

Before (HEAD `4090e79`): a tiled move finish called `noteMoveDropped` with
the drag correlation, window identity, and *reply-time observed* domain.
That armed a coalesced one-shot marker to reconcile that domain, rather than
requesting placement. If the window remained on the source output, the
marker could restore its source geometry. If KWin had already reassigned it
to another output and the foreground observation followed, the marker used
the destination domain; it could not return the native assignment or restore
source membership. If that observation omitted the dragged window, the
entry returned `drag-unknown-window` before arming a marker. Subsequent
ordinary observations could reconcile source departure/destination arrival.

After: the finish context captures `workspace.cursorPos` synchronously at
FINISH before the async oracle pull; the entry calls
`adapter.requestDragDrop` with that point plus the verdict identity. The
adapter validates (disabled/identity/coords/observe/absent/fullscreen/
maximize/floating), then compares the fresh foreground domain to the domain
bound with the window at Started. A mismatch refuses
`drag-drop-refused-cross-domain` and scopes the restore marker to the
Started source, without sending a destination-scoped `drag-drop`. When no
Started binding is supplied to the adapter, retained `appliedById` evidence
provides the guard; stale retained evidence never overrides a valid Started
binding. If the
foreground observation excludes the window, the entry still returns
`drag-unknown-window` before this guard. Neither the drop request nor its
marker writes native output/workspace assignment or returns the window.
Ordinary later observations can still reconcile departures and admissions
in their respective domains; the cross-output regression verifies that a
subsequent ordinary reconcile dispatch remains possible.

Uncertainties: whether KWin actually reassigns output/workspace during a
given drag, which domain is foreground at reply, and when both domains are
observed are not proven offline. The source marker alone cannot return the
native assignment and may settle unavailable if its domain is not observable;
no cross-output snap-back is claimed. Once complete observations arrive,
ordinary per-domain convergence can update tiling membership, but the exact
live result needs manual confirmation.

Options: (1) add a narrow native return transfer with exact source binding
and settlement fences, preserving snap-back (recommended if full option A
snap-back is wanted); (2) explicitly accept cross-domain native movement
with new-domain admission (changes requested behavior). Held for the user;
no feature implementation in this change.

## Live acceptance (user-owned)

Check tiled same-domain window-edge splits, group-edge first/last and
perpendicular wrap, group-interior insert, center/unresolved snap-back,
resize-edge unchanged, floating Meta+drag unchanged, held drag without
mid-move writes, and correlated `drag-drop` terminal/restore logs. Check a
cross-output tiled move with both outputs visible: record whether native
assignment changes, the refusal token, ordinary source/destination tiling
after observations, and whether the window returns. No live checks were run.

## Option B: read-only live preview path (not implemented)

The script can sample `workspace.cursorPos` and receive `interactiveMoveResizeStepped` during a tiled move; the native effect currently observes start/finish only, while its passive press spy captures a single press and `mouseChanged` only tracks Meta. Throttle script samples and send a read-only `drag-preview` request with fresh complete observation and `min_size/max_size` hints over the existing `DescribePlan` boundary. Clone the retained Session, `begin_drag` then `preview_drag`, discard the clone without commit/revision change; drop continues to call the same `resolve_drag_shared`. A separate effect preview setter could render `proposed_rect` using the outline overlay machinery; the existing group outline is Meta-gated, so sharing it requires independent lifetime/visibility rules (or a third item).

Exactness work is necessary: `preview_drag` currently projects with empty hints while `drop_drag` uses fresh observed hints. It must accept observation-derived hints. The 80px sticky group-edge hover is stored as prior in a live Session drag but discarded by single-shot Planner clones; forwarding prior hover between preview samples **and into the final drop**, with revision/source validation, or explicitly dropping sticky behavior on both preview and drop would be needed for exact agreement. The latter changes existing core policy and is outside A. Preview traffic must drop or back off on Planner single-flight contention, fence late overlay replies, clear on finish/loss, and never delay the drop. Roughly 400-600 production lines plus tests before prior-state/renderer complications, possibly more; this is feasible but not a trivial or currently exact preview. Product choice: overlay's always-visible drag lifetime/appearance and interaction with the Meta-held group outline (reuse its item vs a separate item). No preview code in A.
