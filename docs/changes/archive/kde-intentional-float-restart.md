# Q3: intentional floats across KDE owner restart (R-RST-01)

## Goal and scope

- Preserve intentional-float identity when the KDE script and/or Linux planner
  owner restarts with the same live clients in the same login session.
- Implement the accepted 2026-10-07 R-RST-01 decision; existing native sticky
  behavior and Q2 automatic-fixed restart recomputation remain authoritative.
- Scope: shared core, Linux planner, KDE adapter and native code if needed.
  Windows behavior changes belong to Windows handoff item 8.
- No live KWin/Plasma or Windows testing, dependency installs, adapter
  extraction, commits, pulls or mutations of other agents' work. Initial tree
  clean; root guidance and live KWin testing guide read.

## Acceptance and approach

- Settle marker lifetime, client identity, cleanup, failure recovery, privacy
  and geometry semantics through source research before implementation.
- Persist intentional identity only; automatic fixed floats and Q2 tile
  overrides must not gain persistence. Avoid writes to otherwise untouched
  clients; exclude native IDs and application content from logs.
- One sequential muse-spark Worker at a time. Lead reviews actual evidence;
  Workers do not maintain project records.
- Research unit: current sticky/float mechanisms and pinned reference restart
  behavior. Follow-up unit: correct and substantiate marker feasibility.
- Stop before implementation and send one batched decision package to the
  Orchestrator for unrecorded design/behavior choices.
- After resumption: implementation and offline regression units, required npm,
  Rust, portable and affected shell gates; native Nix gates if native code
  changes; matrix/spec/decision/trace/backlog records and staged ASCII checks.

## Research review (2026-10-08)

- KDE ordinary float identity is the script-local `floatingIds` set
  (`kwin/src/plan-adapter-entry.ts:3327,3677-3683`). Native sticky is the live
  `onAllDesktops` flag; a separate marker is unnecessary for that flag.
- Windows `STICKY_PROP` is a live-window property consumed as an ordinary
  float today (`crates/tiler-windows/src/model.rs:19-27`); accepted sticky
  retention is still pending Windows work, not already implemented.
- The Linux planner is a retained D-Bus service, not a per-request subprocess
  (`crates/omnitiler/src/planner_service.rs:1-14,132-156`). Memory-only
  storage cannot survive that service's own restart; its current boundary
  explicitly excludes persistence.
- Initial Worker suggestions lacked source proof for script file I/O or
  durable dynamic properties and proposed an already-used matrix ID. Lead
  requested corrected feasibility evidence before choosing a recommendation.

## Accepted research evidence

- KDE entry startup observes foreground and hidden clients before its first
  resync (`kwin/src/plan-adapter-entry.ts:4006-4058`). Hydration must precede
  planning, not restore identity after a startup tile write.
- `setFloating` changes local identity mid-apply, before later sticky/focus
  work (`kwin/src/plan-adapter.ts:8797,8813,8830,8847`). The successful terminal
  and Q2 staged-metadata commit are at :9131-9146. The native-sticky-off
  adoption path also marks an intentional ordinary float at :5713-5719.
  Do not confuse planned intent with native application or assume all these
  setter sites are committed commands.
- KWin v6.6.0 source `src/effect/effectwindow.h` exposes `internalId`,
  `setData` and `data`; its .cpp stores data in the EffectWindow, not the
  effect. Source URLs:
  https://github.com/KDE/kwin/blob/v6.6.0/src/effect/effectwindow.h and
  https://github.com/KDE/kwin/blob/v6.6.0/src/effect/effectwindow.cpp.
  A native namespaced QObject property is another store with object lifetime;
  script-side durable dynamic-property access was not established.
- Additional inspected KWin source at the upstream checkout (6.7.3) has unverified
  pin provenance: `src/scene/windowitem.cpp:67,94-96` owns EffectWindow;
  `src/effect/effecthandler.cpp:1181-1198` unloads the effect, not the window;
  `src/window.cpp:62` creates a fresh UUID for a new window. This is supporting
  API/lifetime research, not evidence for the project's exact packaged ABI
  or renderer reinitialization. Native headers/build would verify applicability.
- Exposing a native marker through the existing effect creates an availability
  dependency: the effect remains disabled-by-default
  (`docs/decisions.md:802-809,2085-2089`), whereas automatic tiling can run
  independently. Making it mandatory would change recorded product intent.
- Runtime files cannot rely on XDG_RUNTIME_DIR or the session bus alone as a
  login boundary. Proposed namespace: bus ID plus current KWin unique owner;
  marker keys: live normalized internalId only. A new bus/compositor must
  never import an older namespace. No app-name/content matching or logged IDs.
- Reference pins checked read-only against checkout HEAD. COSMIC @3d55cba0
  `src/shell/mod.rs:849,863,894-895` restores pinned workspace configuration,
  not live-client float identity; its owner-restart counterpart stays TBD.
- bspwm @e11eff4 `src/restore.c:453-466` restores state and floatingRectangle;
  i3 @903bcd51 `src/load_layout.c:578-595` restores sticky/percent and the
  existing R-RST-01 floating-layout evidence stands; xmonad @284dd52c
  `src/XMonad/Operations.hs:646-711` serializes/resumes the windowset.
- awesome @0a5e50cf `lib/awful/client.lua:1430-1483,1957` persists explicit
  floating in an X property and reloads it. This directly supports the
  live-client marker pattern. None of these sources establishes moving F
  during a stopped-owner gap; R-RST-03 reference drift cells remain TBD.
- Added R-RST-03 for live-frame vs saved-frame adoption and R-RST-04 for
  intentional vs automatic fixed origins after hints change while stopped.
  R-RST-01/02 already cover basic restart and logout boundaries. Matrix now
  149 scenarios, restart area 14 scenarios; both new rows have 14 Then cells.

## Autonomous provisional selections (2026-10-08)

- Orchestrator resumed the Lead with D1-D4, all PROVISIONAL and not user
  decisions. Simplicity overrides the original D4 hold recommendation and
  D3 staging suggestion: no recovery scheduler, retry ledger or hold machinery.

| ID | Selected clause / review consequence |
|---|---|
| D1 storage | Rust-owned private runtime membership file, 0700 dir/0600 file, atomic/versioned/bounded/nofollow; namespace bus ID + current KWin unique owner. Review flag: architecture boundary: planner gains a session-scoped runtime store. Narrow persistence exception only; effect optional, no extraction. |
| D2 geometry | Membership only, current live frame; no stored rect/focus/stacking/pre-sticky history or hydration writes to recovered floats. Sticky semantics unchanged; automatic fixed origin and tile overrides do not persist. |
| D3 settlement | Persist native-applied explicit float/unfloat at the existing Q2 commit-after-success point, plus confirmed adopted-sticky-off ordinary intent. Clear settled unfloat/verified close; prune only complete live inventory. Full snapshots, separate store ACK, no atomicity claim or new command staging. |
| D4 availability | Missing empty; unreadable/corrupt/mismatched store diagnoses and proceeds empty, so restart can lose intent. Write failure keeps native/local intent; next settled membership update rewrites the full set. No automatic retry/hold machinery. |

## Delivered implementation

- Linux `float_intent_store.rs` stores only membership and namespace/version.
  Each runtime-path component opens through an anchored nofollow directory fd;
  final files open nonblocking/nofollow, then uid/type/mode gates and bounded
  reads apply. Exclusive private temp creation, anchored rename and exact-own
  cleanup never remove an occupied temp path. No chmod of unexpected paths.
- Existing Planner1 gains `ReadFloatIntent` and `WriteFloatIntent`; same-UID
  plus current-KWin-owner authentication derives namespace from the serving
  bus. The optional intent lock is independent of DescribePlan, so store
  credential/I/O work cannot make regular planning busy. No new system or
  crate dependency; existing rustix enables its filesystem feature.
- KDE `startIntentBootstrap` performs one bounded read before plan/send
  admission. Entry hydration fills ordinary float tracking before observation;
  stored floats outrank automatic fixed classification. Complete unscoped
  inventory alone prunes returned membership; every live inventoried ref is
  recorded in the existing nativeOwners map, including excluded clients.
- The existing native-success/Q2 commit point updates the settled intent set.
  One in-flight write plus one latest coalesced snapshot preserves write order;
  failed writes are not retried autonomously. Verified close clears by live-time
  exact-ref identity, never reading a dead object's id. A temporary bootstrap
  close fence prevents a stale read reply from reviving a closed client.
- Scoped hidden omissions retire per-domain applied evidence only; they never
  globally evict intent/provenance/native float state for a relocating survivor.
  Sticky adoption/origin rules remain unchanged; confirmed unknown-origin
  sticky-off ordinary intent also persists.
- Normal logs carry bounded intent read/write terminal counts, correlation and
  fixed reasons, with separate storage acknowledgement. No application content,
  native IDs, bus owners, geometry or raw payloads. Trace tokens in dev-loop.
- Windows files are untouched: no compile fixes required and behavior unchanged.
  Handoff item 8 records ordinary/sticky marker work, fixed-origin separation,
  membership-only safety and independent recovery authority. Post-restart
  Windows un-stick outcomes stay TBD.

## Reviewed evidence and corrective work

- Lead reviewed actual store/auth/transport, entry observation/removal/send
  routes, success point and real Planner fixtures. A separate Worker reviewed
  security, public IPC and lifecycle correctness once.
- Initial path-check/read and temp-collision cleanup defects were repaired with
  anchored nofollow handles and cleanup only after successful exclusive create.
  Runtime ancestors also reject symlinks; planted FIFOs refuse without blocking.
- Independent review found scoped departure eviction, close-during-read
  resurrection, unguarded bootstrap sends and partial-inventory pruning. All
  were corrected with per-domain retirement, a bootstrap-only close fence,
  common send guard and strict inventory proof; no new recovery architecture.
- Lead then required live-time ownership registration for inventoried excluded
  clients and counted entry setters. Geometry equality alone is not no-write
  evidence: foreground/hidden/frame-drift/fixed-intersection fixtures now assert
  zero recovered-client setters and zero focus writes under real Planner replies.
- Mutation checks reproduced the scoped/close defects and excluded-owner bug;
  fixed fixtures pass. R-RST-04 now has the exact two-owner hint-loss fixture:
  intentional E remains slotless without writes, automatic F freshly tiles.
- A test sequencing mistake fired startup catch-up during a manual toggle and
  tripped the pre-existing epoch fence; fixtures now settle startup before user
  commands. The intent-lock std mutex failed zbus's Send bound and was replaced
  by the existing async-lock type. No unresolved failed semantic approach.
- New coverage: 49 KDE tests (one duplicate removed), 22 private store tests and
  6 service/lock/auth tests, including hermetic private-bus endpoint roundtrips.

## Verification (2026-10-08, offline)

- Latest `npm --prefix kwin test`: 1116 pass, 154 suites, zero failed/skipped;
  `npm --prefix kwin run typecheck`: source and test projects pass.
- `cargo test --workspace --offline`: 1229 pass across 46 successful suite
  results, zero failed; private-bus auth tests ran without skip messages.
- `cargo clippy --workspace --all-targets --offline -- -D warnings`,
  `cargo fmt --all -- --check`, `just check-portable`: pass.
- `cargo build -p omnitiler --offline` passes, then all nine hermetic
  shell suites pass: tray 29 fixture + 16 self-test, dev-loop 380, dogfood 572,
  native-dev 163, host-build 93, live-harness 237, Custom Tile 131, floor-ratio
  92, plus build-kpackage contracts; 1713 counted assertions.
- Tray's first default Nix invocation could not see the still-untracked new
  module; staging repaired the flake input. The final default Nix route passes
  all 29 fixture + 16 self-test checks, without a binary override.
- Native Nix checks not applicable: no native effect/KCM code touched.
- Matrix has 149 scenarios, restart area 14 scenarios / 196 Then cells;
  spec totals 74 NORMATIVE / 61 OPEN / 21 PROVISIONAL, with four Q3 clauses.
- Staged whitespace check passes and added-line ASCII scan is empty. Stock
  shell tests removed baseline release artefacts; the two tracked blobs were
  recovered exactly and `git diff --exit-code -- dist` passes. No release
  artefact update belongs to this change.
- Decisions/spec/matrix/indexes, dev-loop tokens, backlog status/Windows item 8,
  provisional review and pending native checks updated. Delivered offline and
  archived; no blocking implementation question. Orchestrator owns the commit.

## Pending review and live acceptance

- User review of every autonomous D1-D4 choice, especially the planner runtime
  store architecture boundary and diagnosed-empty availability tradeoff.
- Script reload, planner restart, stopped-owner frame drift, automatic-vs-intent
  hint loss, hidden/minimized/excluded clients, relocation, close and unfloat.
- User-owned isolated corruption/write-failure journey and separate ACK logs;
  user logout/login/new KWin namespace. No layout/workspace/focus restore claim.
- No live KWin/Plasma or Windows tests, installs, native acceptance, commits,
  pushes or extraction. Windows implementation remains handoff item 8.
