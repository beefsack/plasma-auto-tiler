# Reference matrix expansion

- Status: active; step 1 approved; restructure and insertion complete; focus next.
- Date: 2026-10-06. Planning baseline: `6848054`.
- Goal: broaden reference-WM evidence end to end for the cross-platform functional spec, including scrollable columns.
- Scope: restructure the matrix, then expand all 67 approved candidates in priority order; assess all 58 existing rows for four scrolling profiles; update consensus and the live-test queue. Source/docs evidence only; no product behavior changes, live tests or VM design.
- Inputs: [matrix](../spec/reference-outcomes.md) (58 original rows, now area files), [consensus](../research/reference-wm-consensus.md) (A/B/U/C/W), root `AGENTS.md`, local pinned reference checkouts.
- Acceptance: content-preserving split and valid links; every new scenario uses GWT with 14 Then profiles; source-cited outcomes including separate Ours code evidence; applicable unknowns stay TBD; qualified cells do not vote as no-ops; one commit/push per piece; durable format decision promoted. Do not edit principles/backlog or repin the existing eight references.
- Bounded units accepted: step 1 coverage/model investigation; piece A split and independent migration review; insertion implementation, source-assessment correction, and independent evidence review. Workers loaded `processed-beef-work-unit` and ran sequentially. Lead reviewed diffs, reconciled evidence/counts and maintained this record.
- Verification: step 1 candidate review passed. Piece-specific checks and accepted evidence are below; documentation/source reading only, no application or live tests.
- Lifecycle: keep this one record active through review and later expansion pieces; archive after the whole change is accepted.

## Candidate conventions

- Each row below is a proposal, not a new matrix row. Discriminators list alternatives to investigate, not established WM outcomes.
- Keep existing `H[]`, `V[]`, `S[]`, `*`, ratios, workspace/output notation. `WS1=H[]` means empty; `L`/`R` are left/right outputs, `U` is an output above `L`.
- Additional fixture annotations: `F* (x,y,w,h)` is a focused ordinary float; `B:max`, `B:full`, `B:minimized` are native states, not promises that B retains a tile slot. Prepare the ordinary tree first, enter the state, and record the actual pre-action topology per profile.
- Unless load-bearing: ordinary resizable windows, no rules/preselection, equal shares, scale 1, zero gaps for reference geometry. Record actual gaps, decorations, hints and work area before comparing pixels; keep existing Ours profile assumptions.
- Histories are explicit preparation, not inferred from `*`. Repeat alternative histories or commands from fresh fixtures; do not chain independent variants into an ambiguous journey.
- Actions are semantic. Step 2 must name each native verb/profile parameter; a missing verb is not a no-op, and a layout approximation is not an exact fixture.
- Evidence routes are estimates: `SC` = source likely clear; `LT` = source complex -> live-test candidate. A route never supplies an outcome or an `S()` tag. Stop tracing any SC case that becomes hard and retain `TBD`.
- New icon-minimize prefix: `R-MNZ`, because existing `R-MIN` means minimum sizes.

## Counts and coverage reuse

| Priority | Area | New candidates | Existing coverage / disposition |
|---|---|---:|---|
| 1 | Insertion | 6 | Reuse R-INS-01 ordinary third-window axis/order; R-INS-02 stack admission; R-START-01/02 startup seeding is a different trigger |
| 2 | Focus | 4 | Reuse R-FLT-07..09 tile/float directional layers; workspace-return focus belongs to R-WS-09 below |
| 3 | Move | 3 | Reuse R-MOV-01..05 restructuring/swap/wrap/escape/no-op; R-OUT-01/02 horizontal output fallback |
| 4 | Resize (new section) | 4 | Reuse R-CLOSE-02 ratio persistence through close/open; R-FLT-03 removal ratios; R-MIN-01..03 hint limits |
| 5 | Layout commands (new section) | 4 | Reuse R-FLT-04 and R-WS-06 for tiled/floating mode; proposed layout selection is not that toggle |
| 6 | Workspaces | 7 | Reuse R-WS-01..07 sends, anchors, trailing-empty admission, float transfer, mode and shell switcher |
| 7 | Minimize (new section) | 3 | No icon-minimize coverage; R-MIN-01..03 are unrelated size constraints |
| 8 | Maximize/fullscreen | 2 | Reuse R-MAX-01..07, especially fullscreen focus in R-MAX-02; new-over-overlay belongs to R-INS-06; close belongs to R-CLOSE-05 |
| 9 | Groups/stacks | 2 | Reuse R-INS-02 new tab; R-GRP-01 manual creation/flattening and tab focus; R-DRAG-01 centre-join gesture |
| 10 | Floating | 3 | Reuse R-FLT-01 first float/unfloat placement, reflow and focus; R-FLT-02/05 sticky switch/restart; R-FLT-10/11 semantic float moves |
| 11 | Close | 3 | Reuse R-CLOSE-01 refocus and R-CLOSE-02 fresh reopen; tab close belongs to R-GRP-03 |
| 12 | Multi-output | 4 | Reuse R-OUT-01/02 moves; explicit nonfocused-output admission belongs to R-INS-07; cross-output drag belongs to R-MOU-03 |
| 13 | Mouse | 3 | Reuse R-DRAG-01..08 zones/producers/cancel/threshold/frame/press focus; float drag/resize belongs to R-FLT-14 |
| 14 | Special windows (new section) | 5 | Existing admission citations mention types/fixed sizes, but no dedicated action fixtures discriminate them |
| 15 | Activation (new section) | 2 | R-WS-07 is user-selected shell activation, not an application's unsolicited request |
| 16 | Restart/persistence | 2 | Reuse R-FLT-05 sticky restart, R-START-01..03 adoption and R-CTL-01..07 owner settings |
| Added | Scrollable-column mechanics | 10 | Distinct strip/viewport operations; shared lifecycle actions use model-qualified existing/new IDs |
| Total | | 67 | 57 cross-model/tree candidates plus 10 column-specific candidates; format examples excluded |

## Candidate action list

### 1. Insertion

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-INS-03 | `WS1=H[]`, no focused window | Open A | First tile size/anchor and focus vs leaving the app unmanaged/floating | SC: empty-admission branches; contrast ordinary admission with R-MIN-03's oversized minimum |
| R-INS-04 | `H[A,B*]`, landscape work area, pointer fixed outside eligible windows | Open C, then D, then E; do not refocus | Topology after each admission: spiral/orientation alternation, current-leaf long edge, flat insertion or master/stack; column sizes stable vs reflow | LT: admission plus pointer/focus updates and repeated geometry recalculation; R-INS-01 supplies the first leg |
| R-INS-05 | `H[A,B]` plus ordinary `F*`; prior tiled focus B | Open C | Float focus as anchor, fallback to last tile, root or pointer target; newcomer layer/focus | SC: admission's eligible-anchor filtering; do not assume floats split |
| R-INS-06 | `H[A,B*]`; prepare `B:max`; fresh variant `B:full` | Open C | Overlay retained, cleared or covering a newly admitted window; newcomer focus/visibility and underlying layout | LT: overlay admission/render/focus paths; maximize and fullscreen are separate fresh legs, not synonyms |
| R-INS-07 | Active `L:WS1=H[A*]`; inactive `R:WS2=H[B,C]`, WS2 prior focus C; pointer on L | Open D with an explicit one-case destination rule for WS2/R | Target-local anchor vs global focus; target admission without stealing source focus or switching output | LT: destination routing plus inactive-workspace admission; rule is fixture-only and must be recorded |
| R-INS-08 | `H[A,B*]`, B landscape, no existing preselection | Preselect a vertical split at B; open C, then D without refocus | Explicit direction overrides auto axis vs unsupported; consumed one-shot vs persistent direction on the next admission | SC: preselection command/admission branches; record actual admission focus/anchor; keep this distinct from an automatic chain |

### 2. Focus

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-FOC-01 | `H[V[A,B],C*]`, equal halves, C spans full height; history A,B,C; fresh run B,A,C | Focus left once in each run | Two equally placed directional candidates: MRU-sensitive choice vs stable tree/order/geometric tie; no one-candidate pseudo-tie | LT: tie metrics differ by layout/layer; compare source selector with exact rectangles and histories |
| R-FOC-02 | Single output `H[A*,B]`, no adjacent output | Focus left | Edge wrap within workspace, stay, or workspace fallback; independent of move edge policy | SC: focus wrapping/fallback branches and declared config |
| R-FOC-03 | `H[A,B,C]`, history A,C,B; plus ordinary F in a fresh layer variant | Next window; previous window | Structural/spatial order vs MRU, wrap and float inclusion; record focus after each step | SC: cycle command inventory and list traversal; external shell Alt+Tab remains R-WS-07 |
| R-FOC-04 | `H[V[A,B*],C]`, leaf focus | Focus parent; focus child | Group focus scope and child selection vs leaf-only/no counterpart; does not duplicate tab stepping | SC: focus-tree descent/history or explicit lack of container-focus verb |

### 3. Move

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-MOV-06 | `H[A*,V[B,C]]`, V prior focused child C | Move A right | Enter nested neighbor at remembered child vs swap whole neighbor, wrap beside it or geometric leaf swap | SC: directional descent/reparent path; keep group history explicit |
| R-MOV-07 | `V[H[A,B*],C]` | Move B down | Escape across an orthogonal parent vs move into C, swap or carry group; R-MOV-04 already covers same-axis escape | SC: orientation-specific ancestor promotion and destination attachment |
| R-MOV-08 | `U=H[X]`, `L=V[A*,B]`; U directly above L | Move A up | Exhausted vertical move crosses output vs stays/restructures locally; fresh mirrored down-edge leg only if asymmetric | SC: directional output fallback; existing R4 hook excludes Up/Down for Ours |

- Move vs explicit swap: reuse R-MOV-01/03 and replay the explicit swap verb from the same fixture; add qualified outcome legs there rather than duplicating a start/action row.

### 4. Resize

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-RSZ-01 | `H[A*,B]` 50/50, no limiting hints | Keyboard grow A toward B one declared step; shrink one step | Ratio vs pixel increment, neighbor allocation and reversibility; no keybinding assumptions | SC: resize verb and configured delta; settled native frames can become LT |
| R-RSZ-02 | `H[A*,B]`, A touches left work-area edge | Request outward resize at A's left edge | Clamp/no-op, opposite-edge redistribution or overflow; edge-targeted verb absence is not a no-op | LT: native resize semantics and limits; fixture must distinguish edge resize from generic width grow |
| R-RSZ-03 | `H[H[A*,B],C]`, inner/outer halves | Grow A right one step | Nearest split vs ancestor redistribution; which ratio changes | LT: nested ratio ownership and minimum propagation differ across models |
| R-RSZ-04 | `H[A,B,C]` 50/30/20 | Equalize/balance once | Equal sibling shares vs recursive tree balance, preserved ratios or missing command | SC: inventory and balance implementation; binary embedding must distinguish equalize from equal leaf area |

### 5. Layout commands

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-LAY-01 | `H[A,B*]`, parent selected where necessary | Toggle parent split orientation | Same children on new axis vs wrapping a leaf/new group; scope of layout command | SC: split/layout dispatch and target resolution |
| R-LAY-02 | `H[A,V[B*,C]]` | Rotate 90 degrees; independent fresh fixture: mirror left/right | Axis/order/geometry transform, focus preservation or missing transform; rotate and mirror are separate legs | SC: command inventory then explicit transform path; do not substitute layout cycling |
| R-LAY-03 | Model-qualified three-window layout A,B*,C; A master where supported | Promote B to master | Master identity change/reorder vs focus-only, tree operation or no master concept | SC: master-promote command and layout ordering |
| R-LAY-04 | WS1 and WS2 each A/B-style two-window tiled layouts, native layout L1 | Select native alternative layout L2 on WS2; return to WS1 | Per-workspace vs global layout selection and preserved window order; L1/L2 named per profile | SC: layout-state ownership; tile/floating toggle stays R-FLT-04 |

### 6. Workspaces

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-WS-08 | Occupied WS1,WS2,WS3; visit WS1,WS2,WS3 | Back-and-forth workspace twice | Last-view history toggle vs numeric previous/MRU-list traversal or absent verb | SC: workspace history and switch command; shortest three-WS history separates the notions |
| R-WS-09 | `WS1=H[A,B*]`, `WS2=H[C]`; WS1 history A,B | Select WS2; select WS1 | Remembered window focus vs first/master/root; column profiles additionally observe saved viewport | SC: activation focus restoration; no sends/refocus on return, unlike R-WS-02 |
| R-WS-10 | Occupied WS1,WS2,WS3; shown `WS2=H[B*]` | Send B to WS1; select WS3 | Empty middle workspace retained vs removed/renumbered; active-empty protection vs immediate cleanup | SC: workspace maintenance and native ownership; trailing-empty creation is already R-WS-03 |
| R-WS-11 | WS1..WS3 occupied, WS3 shown; other outputs absent | Next workspace; previous workspace | Wrap vs stop, ordered vs visible-only domain; observe both steps | SC: relative workspace command and scope; config-dependent wrap must be explicit |
| R-WS-12 | L shows WS1; occupied WS2 belongs to L; R shows WS3 | Move whole WS2 to R | Whole-workspace reassignment vs view switch/window-only transfer, displaced destination view and focus | LT: native workspace/output ownership differs, especially shared vs per-output models |
| R-WS-13 | WS1 occupied; target name/ordinal absent | Select absent WS9 | Create/select vs refusal/no-op; static workspace inventories vs dynamic creation | SC: lookup/create and invalid-target branches; do not infer from a send |
| R-WS-14 | Occupied WS1..WS3, `WS2=H[A,B*]` shown | Send B to next workspace; fresh run send B to previous | Relative target resolution and follow policy vs explicit-only inventory; edge wrap is a later qualified leg of R-WS-11 | SC: relative-send resolver plus R-WS-01 transfer path |

### 7. Minimize

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-MNZ-01 | `H[A,B,C]`, history A,C,B | Native minimize B | Slot/placeholder retained vs reflow/removal; source MRU vs positional refocus or no minimize capability | LT: actual icon-minimize path, hidden/scratchpad are not substitutes; float/vacant evidence does not prove minimize |
| R-MNZ-02 | Actual minimized state produced by R-MNZ-01, remaining windows unchanged | Native restore B | Old slot/ratio vs fresh admission; focus and layer restoration | LT: unminimize/remap, backend and taskbar restore routes may differ |
| R-MNZ-03 | `WS1=H[A*]`, WS2 occupied | Native minimize A | Empty workspace cleanup vs retained minimized occupancy; focus fallback/no focus | LT: native hidden state plus workspace occupancy/focus cleanup |

### 8. Maximize/fullscreen

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-MAX-08 | `H[A,B*,C]`; prepare `B:max` | Focus left; move focused window right | Overlay focus fence vs access to siblings; hidden-tree move, refusal, overlay clearing and actual focused mover | LT: open focus/move-while-maximized concern; source state and visible/input focus can diverge |
| R-MAX-09 | `WS1=H[A,B*]`, WS2 occupied; prepare `B:max`; fresh variant `B:full` | Send B to WS2 | State carried vs restored before transfer; source slot/reflow, target overlay and follow | LT: transfer, overlay ownership and restore entries; normal/float sends do not establish this |

### 9. Groups/stacks

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-GRP-02 | `H[S[A,C],B*]`; A is the left stack's active tab | Semantic join/move B into left stack; move B out right | Join vs swap, membership/order/active tab; leave as new tile vs dissolve whole group | SC: explicit join/leave verbs; pointer centre-join already R-DRAG-01 |
| R-GRP-03 | `S[A,B*,C]`, history A,C,B | Close active tab B | Neighbor/MRU tab focus, retained group vs flattening and tab-bar update | SC: member removal + active-index/focus fixup; visuals may become LT |

- New-window join and manual create/flatten/internal focus reuse R-INS-02 and R-GRP-01. Add no second stack-admission or tab-step row.

### 10. Floating

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-FLT-12 | `H[A*,B]` plus overlapping ordinary F,G; G currently above F | Raise F; lower F | Z-order changes vs focus-only, automatic re-raise, explicit lower absence; tile/float layer boundary | LT: stacking order, focus and compositor rendering must agree |
| R-FLT-13 | `WS1=H[A,B]` plus ordinary `F* (500,300,400,300)`; WS2 occupied | Select WS2; select WS1 | Ordinary float hidden vs sticky-like visibility; retained frame/z-order/focus on return | SC: workspace visibility and saved float state; not sticky-on/off or send |
| R-FLT-14 | `H[A,B]` plus ordinary `F* (500,300,400,300)` | Drag F by (+100,+50); resize bottom-right by (+100,+50); release after each | Free frame retention vs snap/clamp/tiling; layer, sibling stability and focus | LT: float-specific pointer producers, hints and client acknowledgement; semantic snap stays R-FLT-10/11 |

- First-float geometry and unfloat z-order belong to R-FLT-01's existing observations; qualify its missing frame/layer evidence rather than duplicate it.

### 11. Close

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-CLOSE-03 | `WS1=H[A*]` shown, WS2 occupied | Close A | Empty shown workspace retained vs view changed/removed; focus none vs another domain | SC: last-window removal and workspace focus/retention; middle-workspace cleanup remains R-WS-10 |
| R-CLOSE-04 | `H[A,B]` plus ordinary F*; history A,B,F | Close F | Float removal leaves tiles untouched vs reflow; last tiled MRU vs other focus fallback | SC: float removal/refocus path; tile close consensus is not float proof |
| R-CLOSE-05 | `H[A,B*]`; prepare `B:max`; fresh variant `B:full` | Close B | Overlay cleanup, remaining tile allocation and focus; no native restore action is available after destruction | LT: overlay teardown/restore-state cleanup plus actual visible focus |

### 12. Multi-output

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-OUT-03 | `L=H[X]`, `R=H[A*,B]`, equal aligned outputs | Focus left from A | Cross-output target/focus history vs local wrap or stay; compare geometry with target workspace MRU | SC: focus output fallback; move-crossing rows are not focus evidence |
| R-OUT-04 | `L=H[X]`, `R=H[A*,B]` | Explicitly send A to L | Carry/re-admit vs cross-output swap; follow vs retain source focus; action differs from edge move | SC: explicit output-transfer verb and attachment, reusing R-WS-01 focus vocabulary |
| R-OUT-05 | L focused `H[A*]`, R `H[B]`; pointer on R, no destination rules | Open C | Focused output vs pointer output vs app/startup assignment; newcomer focus and source view | LT: launch routing crosses shell/protocol/WM admission; contrast rule-targeted R-INS-07 |
| R-OUT-06 | L and R occupied with distinct workspaces; R focused | Disconnect R; reconnect same output | Window/workspace evacuation, destination/focus and return affinity vs fresh reassignment | LT: host topology, stable output identity and session policy; no agent hotplug |

### 13. Mouse

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-MOU-01 | `H[A*,B]`, pointer on A; declared focus-follows-mouse mode; fresh click-focus mode | Move pointer into B; click B | Hover vs click focus, delayed/sloppy policy and click delivery vs focus-only consumption | LT: input/backend timing and profile config; modifier-drag press focus is already R-DRAG-08 |
| R-MOU-02 | `H[A*,B]` 50/50, fixed work area | Drag shared edge right 100px; release | Ratio/share change vs frame-only/no resize, sibling clamp and ratio retention | LT: edge hit-testing, interactive resize and client geometry |
| R-MOU-03 | `L:WS1=H[A,B*]`, `R:WS2=H[C]`, hidden WS3 exists | Drag B to C's edge on R; fresh fixture drag B onto WS3 switcher/overview target | Cross-output insertion/follow vs float/cancel; hidden-workspace hover-switch/drop vs unavailable target | LT: drag/output/shell workspace-target cooperation; two explicit targets, not a generic off-area drop |

### 14. Special windows

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-SPC-01 | `H[A*]`, A parent; transient D not yet mapped | Open D; request focus A; fresh modal-D variant | Transient float/tile, parent-relative placement and modal focus fence; dialog and modal flags recorded separately | LT: admission likely source-clear, but parent/input focus and modal handling cross protocol/toolkit paths |
| R-SPC-02 | `H[A*]`, no custom rules | Open typed splash U; fresh utility-U variant | Excluded/unmanaged vs floating/tiled, focus steal and task-switcher presence | SC: native window type/admission filters; utility and splash are separately flagged fixtures |
| R-SPC-03 | `H[A*]`, playing media app | Enter app PiP mode | Separate float/topmost vs ordinary tile; app-rule vs native window-type distinction | LT: PiP has no universal window type; record toolkit/app/version, actual flags and rules |
| R-SPC-04 | `H[A*]`, no custom rules | Open E with min=max 640x480 | Fixed-size admission exception vs forced tile/size-only clamp; different from an oversized resizable minimum | SC: fixed-size filters already cited in minimum rows, now a dedicated discriminating fixture |
| R-SPC-05 | `H[A,B*]`, B initially resizable | B requests 900x700; fresh run B changes minimum hints above its allocation | App-owned resize vs tile-authoritative allocation; reactive clamp/reflow/float vs ignored request/hint | LT: configure/request/hint event paths and asynchronous app response; not an output-shrink test |

### 15. Activation

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-ACT-01 | Hidden `WS1=H[B]`, shown `WS2=H[A*]`; no recent user action in B | B sends native activation/focus request | Switch-to-B, pull-B, urgency-only or denial; request token/user timestamp qualification | LT: app focus-stealing policy differs from shell selection R-WS-07; keep request origin explicit |
| R-ACT-02 | `H[A*,B]`, B not urgent | B sets urgency/demands-attention; user focuses B | Focus stolen vs attention marker only/ignored; clearing on focus | SC: urgency handling and clear path; marker visibility can become LT |

### 16. Restart/persistence

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-RST-01 | `WS1=H[A,B*]` 70/30, `WS2=H[C]`, ordinary float F on WS1 | Orderly owner restart with apps kept alive | Layout/ratios/workspaces/float/focus recovered vs fresh adoption; reload is not restart | LT: compositor replacement, WM re-exec and script restart have different contracts; declare native journey |
| R-RST-02 | Saved session with A/B tiled, ordinary F and B:max across WS1/WS2 | End session; restore session and apps | Layout/workspace/native state persisted vs apps freshly admitted; native IDs replaced and startup order may differ | LT: session manager and apps participate; do not infer from owner restart or startup-enable rows |

## Scrollable-WM representation proposal

### Inclusion and source anchors

- Add niri, PaperWM and karousel profiles to the same evidence corpus now; use a separate column-mechanics section in `reference-outcomes.md`, not an assumed H/V split-tree equivalence.
- Include paneru: virtual workspace rows inside a native macOS Space and native-tab/stack nesting add distinct model predicates (`README.md`, `src/ecs/layout.rs`). It is another profile in the scrolling family, not an independent consensus family vote.
- Exclude PaperWM.spoon as a separate input profile for this expansion: its ordered columns, slurp/barf and accordion stack duplicate the PaperWM model (`README.md`, `windows.lua`, `tiling.lua`). Platform Space/focus options alone do not meet the requested distinct-model test. Keep its checkout as optional corroboration.
- Current Deferred wording excludes scrolling models; propose revising that exclusion in step 2 after format review. No change to it in this step.

| Checkout under `/home/beefsack/Development` | Planning source pin | Proposed baseline and source route |
|---|---|---|
| niri | `ed22699d99462f61ab171472d3ea67e844ea580d` | Shipped `resources/default-config.kdl`: half-width default, 1/3-1/2-2/3 presets, centering never; `docs/wiki/Configuration:-Layout.md`; record display mode/rules before fill |
| PaperWM | `8bf6dd264f60d6c0c402b63df7b424b888959a48` | Shipped extension preferences, ordinary right insertion and default focus mode as a proposed baseline; verify schema values in step 2. `README.md`, `tiling.js` Space/insertion/slurp/barf/FocusModes, `settings.js` |
| karousel | `8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b` | Shipped `src/lib/config/definition.ts`: widths 50%/100%, Lazy scrolling, no default stack; explicit Centered/Grouped variants only for scrolling discriminator. `layout/{Grid,Column,Desktop}.ts`, scrollers/clampers; single-screen profile per README |
| paneru | `b1b6abbd3f1a4be138152b6f0389c9ff1b27a269` | Shipped settings/no custom rules; freeze virtual-workspace/native-tab options per case. `CONFIGURATION.md`, `ARCHITECTURE.md`, `src/ecs/{layout,layout_ops,triggers,focus}.rs`; macOS live evidence unavailable on this host |
| PaperWM.spoon (screened out) | `82f5dde20d40cf1bdef18ab92b2b847f16f368a3` | `README.md`, `config.lua`, `windows.lua`, `tiling.lua`, `space.lua`; source corroboration only |

- Pins and clean source worktrees checked locally. These are source-read anchors, not retroactive user-test versions. Existing eight-WM pins remain the matrix's pins; do not silently repin them to current checkout HEAD.

### Proposed notation and fixture applicability

- `COL[C1[A],C2[B*,C],C3[D]]`: ordered columns, with C2's B/C vertically visible. Column identifiers persist through reordering.
- `COL[C1[A],C2[S[B*,C]]]`: tabbed-display column, distinct from both vertical visible stacking and a tree's tab group. Accordion/overlapping display is an explicit profile-qualified rendering, not silently called tabs.
- Widths: `w(C1)=0.5W`, where W is viewport work-area width; absolute pixels only when load-bearing. Internal heights use ratios when needed.
- Viewport: `VP(x=0,W=2400)` is the strip-coordinate interval `[0,2400)`. State column positions/widths and gaps when clipping/ties matter; focus and viewport are separate state variables. No ambiguous inline `|` boundary marker.
- Workspaces/outputs reuse `L:WS1=COL[...]`; paneru adds `Space1:{VW1=COL[...],VW2=COL[...]}`. Native Space and virtual row are separate domains.
- H/V fixtures remain exact split-tree fixtures. A flat H may have a matching *projection* to columns only if widths, visible windows and viewport match; that proves rectangle-level behavior, not a split-tree. V can map to a visible multi-window column under the same qualification. Recursive H/V ancestry usually has no column counterpart.
- S can map only to a supported tabbed-display fixture with stated membership/active tab; PaperWM accordion and visible vertical columns are not exact S equivalents. Do not flatten nesting just to obtain a result.
- Backfill recommendation: assess all 58 existing rows for every included scrolling profile in step 2, but do not demand 58 fabricated outcomes. Reuse IDs for model-neutral actions (focus, close, float, workspace, activation/restart) with a separately stated column Given; mark projections explicitly and link any distinct column candidate.
- Keep `TBD` for unknown applicable outcomes. Proposed qualifiers: `fixture-inapplicable` (no faithful start), `no-counterpart` (evidenced missing action/state), `owner-specific` (external journey). Absence needs pinned inventory evidence; none of these counts as an agreeing no-op. Applicable unknown outcomes remain TBD. Do not change existing cells' vocabulary now.

### Additional column-specific candidates

| Proposed ID | Start | Shortest action sequence | Discriminates | Evidence route |
|---|---|---|---|---|
| R-COL-01 | `COL[C1[A],C2[B*],C3[C]]`, each 0.5W; VP shows C1/C2 | Open D | New column before/after focus or append vs same-column admission; existing widths stable vs rescaled; new focus viewport | SC: insertion-index/rule and column allocation paths; link R-INS-04 rather than duplicate its chain |
| R-COL-02 | `COL[C1[A*],C2[B]]`, C1 at smallest declared preset | Cycle column width through one full preset cycle, then reverse once | Ratio/pixel presets, wrap/stop and window vs column scope; oversized-column support only if a native preset exists | SC: width preset parser and cycle command; record actual preset list, not an assumed universal list |
| R-COL-03 | `COL[C1[A*],C2[B]]`, separate equal-width columns | Consume B into C1; expel B | Which adjacent window/column is consumed, visible vertical allocation vs tabs, new column side and width recovery | SC: consume/expel or slurp/barf paths; exact native verbs named per profile |
| R-COL-04 | `COL[C1[A],C2[B*],C3[C],C4[D]]`, each 0.5W; VP shows A/B, D off-screen | Focus D by identity | Minimal scroll vs centering/grouped scroll, partial-visibility threshold and offscreen input focus; fresh named policy variants | LT: scroller/visibility/focus and animation; measure final VP rather than assume focus implies centering |
| R-COL-05 | `COL[C1[A],C2[B*],C3[C],C4[D]]`, each 0.5W, zero gaps; `VP(x=0,W=2400)`, B fully visible off-center | Explicitly center focused column/window | One-shot viewport change vs persistent centering policy, whole-column vs single-window target | SC: center command and clamp path; keep focus unchanged as an observation, not a premise of outcome |
| R-COL-06 | `COL[C1[A],C2[B*,C]]`, B/C both visible | Toggle column tabbed/stacked display; select C | Display-only membership/height retention vs actual grouping, single-visible tabs vs accordion; unsupported display is qualified | LT: column display/layout plus active-member visibility; differs from tree group creation R-GRP-01 |
| R-COL-07 | WS1 has `COL[C1[A],C2[B*,C]]`, WS2 has one occupied column | Send whole C2 to WS2 | Atomic column transfer vs one-window send/no verb, membership/width preservation and target column position | SC: whole-column workspace command; workspace domain declared per profile, ordinary send reuses R-WS-01 |
| R-COL-08 | Four 0.5W columns, focus A, VP at strip start | Scroll viewport right by one native step without a focus command | Viewport independent of focus vs automatic refocus; clamp and offscreen-focused-window policy | LT: manual-scroll/gesture interaction; keyboard step first, gesture leg only if source remains unclear |
| R-COL-09 | Paneru `Space1:{VW1=COL[C1[A*]],VW2=COL[C2[B]]}` | Send A to VW2 without changing native Space | Native Space vs internal workspace-row membership, empty-row reaping and append vs positional admission | LT: virtual workspace routing/maintenance and macOS visibility; other profiles get qualified no counterpart only after inventory |
| R-COL-10 | Paneru `COL[C1[A*,B]]`, B ordinary visible stack item; same app supports native tabs | App creates a native tab for A; then select B | Native tabs nested inside a vertical stack vs all windows as peers, ownership/focus and column width stability | LT: toolkit/native macOS tab identity and AX/event integration; do not equate niri display tabs with app tabs |

- Shared close/reflow, workspace return/viewport memory, float/unfloat, fullscreen, restart and output hotplug use model-qualified R-CLOSE/R-WS/R-FLT/R-MAX/R-RST/R-OUT scenarios. No second column lifecycle inventory.
- Added only column algebra/viewport operations and paneru's two distinct predicates. Offscreen slivers are a host workaround, so observe them in R-COL-04/08 rather than add a separate product-model row.

## Format proposal (no migration in this piece)

- Use one scenario ID regardless of representation; retain notation, profile pins, real evidence tags, legend and variant hooks.
- GWT blocks for journeys or model/config-dependent fixtures: insertion chain/overlays, nested moves/resize scope, layout scope, workspace lifecycle/return, minimize/restore, maximize navigation/transfer, group membership, float switch/drag, hotplug/cross-domain drag, special modal/self-resize, activation, persistence, and viewport/consume/display/virtual-row actions.
- Give each profile its own Then bullet. Model-specific Given bullets and independently reset variant legs avoid pretending every WM can instantiate one H/V fixture. Ours KDE and Ours Windows have separate Then entries, never a combined verdict.
- Compact table rows for single-step comparable predicates: empty insertion, edge focus, explicit output send, last/float close, equalize/command inventory, urgency. Replace additional horizontal WM columns with a narrow outcome table keyed by ID and WM/profile, plus a short fixture/action index. One outcome row per profile; no wide 14-outcome-column tables.
- Keep the 58 existing rows unchanged in step 1. In step 2 add reviewed candidates using the chosen form; decide migration of existing wide tables separately.

### GWT example (placeholder template, not outcome evidence)

```markdown
### R-INS-06: open over an overlay
- Given: H[A,B*]; prepare B:max; record actual pre-action tree per profile.
- Given (column profiles): COL[C1[A],C2[B*]]; prepare B:max; record applicability.
- When: open C.
- Observe: admission, overlay state, focus, visibility and remaining allocations.
- Then COSMIC: TBD.
- Then Hyprland/Dwindle: TBD.
- Then bspwm: TBD.
- Then i3: TBD.
- Then xmonad/Tall+Navigation2D: TBD.
- Then sway: TBD.
- Then qtile/Columns: TBD.
- Then awesome/tile: TBD.
- Then niri: TBD.
- Then PaperWM: TBD.
- Then karousel/Lazy: TBD.
- Then paneru: TBD.
- Then Ours KDE: TBD.
- Then Ours Windows: TBD.
- Variant hook: link an applicable existing hook; otherwise provisional/TBD.
```

### Narrow-table example (illustrative slice, all outcomes placeholders)

```markdown
| ID | Given | When | Observe |
|---|---|---|---|
| R-FOC-02 | H[A*,B], single output, declared wrap policy | Focus left | Focus target and domain |

| ID | WM/profile | Then | Evidence | Hook |
|---|---|---|---|---|
| R-FOC-02 | COSMIC | TBD | TBD | TBD |
| R-FOC-02 | niri (separate COL fixture required) | TBD | TBD | TBD |
| R-FOC-02 | Ours KDE | TBD | TBD | TBD |
| R-FOC-02 | Ours Windows | TBD | TBD | TBD |
```

- Expand the example's outcome table to every included profile when recording evidence; it is abbreviated only for this proposal.
- Add `S(real-key)`, `D(real-key)`, `UT(actual-date)` to the specific established Then predicate/cell only. Partial evidence qualifies its leg; `TBD` remains on the unsupported part. Never attach invented citation keys to placeholders.
- User-test version/config remains independently recorded; source pins are not applied retroactively. Ours outcomes also need actual evidence, separately from selected intent in decisions/hooks. A new column capability is not selected by adding foreign evidence.

## Step 2 evidence policy and live-test queue

- Read local source at the existing/new pinned commits; cite repo/path/line and native verb/config. If the checkout differs, read the pin or explicitly propose a new source baseline instead of combining versions.
- Apply consensus A/B/U/C/W's fixture/partial-leg discipline; correlations (i3/sway, master/stack families, scrolling lineage) are disclosed. Expanding the inputs does not silently redefine consensus denominators or select behavior.
- Stop when source is complex or insufficient. Leave outcome TBD and collect ID, WM/profile, discriminating predicate, required native state/config and reason for user testing in this record; no forced inference from adjacent paths.
- No live KWin/Plasma or Windows testing by agents; this piece used source/offline reads only. User runs later live cases. macOS-derived candidates likewise require a suitable user host. No VM design, dependency installation or session mutation in scope.
- Concern: a VM may not represent host hotplug, fractional-scale/client frame convergence, gesture devices, modal input or app-native tabs. Capture environment requirements now; decide VM coverage later.
- Concern: restart must distinguish WM re-exec, compositor/session restart, script-owner restart and reload. A missing journey or state is not evidence of rejection/no-op.
- Concern: configuration-dependent action inventory, PiP/app protocols, and unmatched tree fixtures can be genuinely inapplicable; user tests cannot make an absent native command or unsupported model equivalent.

| Expected live-test-heavy family | Candidate IDs | User-test evidence needed |
|---|---|---|
| Admission/overlays | R-INS-04/06/07, R-MAX-08/09, R-CLOSE-05 | Real focus/visibility, destination routing, native max/full acknowledgements |
| Direction/resize/stacking | R-FOC-01, R-RSZ-02/03, R-FLT-12/14, R-COL-04/06/08 | Exact geometry/history, edge hit, layer order, viewport and settled frames |
| Workspace/output/input | R-WS-12, R-OUT-05/06, R-MOU-01..03 | Shell/output ownership, pointer behavior and disconnect/reconnect identity |
| Minimize/special/activation | R-MNZ-01..03, R-SPC-01/03/05, R-ACT-01 | Native minimize vs hide, modal/app flags, configure events and activation token/timestamp |
| Persistence/macOS models | R-RST-01/02, R-COL-09/10 | Correct restart boundary, app/session restoration, virtual rows and native tabs |

- SC candidates become live-test candidates whenever only policy, not the discriminator's requested outcome, is established. Source estimates do not promise all-WM coverage.

### Insertion queue additions (piece B1)

These are applicable unknown legs or applicability/inventory checks, not
established no-ops. Resolve inventory/model applicability before arranging a
live fixture; source pins and shipped baselines stay those in the index.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-INS-03, all 14 | Empty domain, ordinary first open; actual frame, focus and viewport | Admission/position policy is partial; physical focus and settled geometry unestablished. i3/xmonad empty fallback remains untraced |
| R-INS-04, all 14 | Pointer outside eligible windows, no refocus, C/D/E chain; record B's dimensions | Landscape output alone does not establish R-INS-01's target rectangle; repeated focus/pointer/recalc legs 2-3 complex and TBD |
| R-INS-05, all 14 | Ordinary float focused, B prior tiled focus; open C and observe anchor/layer/focus | Eligible-anchor branches do not establish the actual float-focused resolution, including Ours |
| R-INS-06, COSMIC/Hyprland/qtile/awesome and four scrolling profiles plus Ours KDE/Windows | Fresh max and full fixtures; open C; native state acknowledgements, visibility and focus | Born-max/unfloat paths are not open-over-overlay evidence; render/focus interplay TBD. paneru native-zoom and fullscreen preparation require confirmation |
| R-INS-06, bspwm/i3/xmonad/sway | Fresh fullscreen fixture only | Maximize has evidenced no-counterpart; fullscreen remains applicable and TBD, not excluded with maximize |
| R-INS-07, all 14 | One-case destination rule into inactive WS2/R; source output focused, pointer on L | niri routing and PaperWM routing/no-steal branches sourced; target anchor and full journey unresolved. Verify karousel cross-output and paneru native Space/virtual-row applicability first |
| R-INS-08, Hyprland/bspwm/i3/sway | Named preselect/split verb, open C then D; axis/order and persistence | Hyprland forced direction/one-shot reset sourced, exact geometry TBD; bspwm consumption and i3/sway admission/persistence not traced confidently |
| R-INS-08, COSMIC/qtile/awesome/four scrolling profiles/Ours KDE/Windows | Native command inventory before any fixture | A missing search term is not absence evidence; applicability remains TBD. xmonad/Tall's fixed master/stack model has no-counterpart |
| R-INS-01 scrolling backfill, all four | Separate two-column Given; open C; sizes/focus/viewport | Position-policy branches sourced, settled viewport/frames and focus remainder TBD |
| R-INS-02 scrolling backfill, all four | Exact tabbed-display Given and open C; preserve app-native-tab distinction | niri/karousel new-column non-join branch sourced; active-member/focus remainder TBD. PaperWM accordion and paneru vertical Stack are not exact S; native-tab variant applicability unresolved |

- Source routes retained: niri `scrolling.rs`/`workspace.rs`/`xdg_shell.rs`; PaperWM `tiling.js` insertion, actor-show and inactive-space paths; karousel `Tiled.ts`/`Grid.ts`/`Column.ts`; paneru `triggers.rs` plus `layout.rs` model. Ours shared `session.rs`, `lifecycle.rs`, `world.rs` with adapter boundary citations at `9241c94`. No source branch is promoted to physical delivery evidence.

## Settled review and execution

| User decision | Recommendation |
|---|---|
| Format and split (user 2026-10-06) | All new scenarios use GWT, one Then bullet per 14 profiles; split by area with the current path as index; existing wide tables migrate separately |
| Include paneru; omit PaperWM.spoon as a separate profile? | Yes: paneru adds virtual rows/native-tab nesting; spoon repeats PaperWM's algebra |
| Assess all 58 rows for new scrolling profiles? | Yes, with qualified per-model Given and explicit inapplicable/no-counterpart/owner-specific vs applicable TBD; never force H/V ancestry into columns |
| Freeze shipped baselines or chosen comparative configs? | Shipped baseline per pin; only named discriminator-specific variants (wrap, scroll policy, modal/request origin) and necessary fixture destination rules |
| Scope/priority of 67 proposed candidates and user live queue? | Keep all 16 areas; source-trace in the approved priority order, reuse first; collect difficult cells for later user tests rather than block on them |

- Merges/drops: workspace-return focus consolidated under R-WS-09; new-over-max/full under R-INS-06; max/full close under R-CLOSE-05; float drag/resize under R-FLT-14; workspace/output drag under R-MOU-03. Existing manual group roundtrip/new-tab, float/unfloat, ratio close/open and move-vs-swap reuse their original IDs. No approved area dropped.
- Additions: column-mechanics section and ten candidates; paneru's distinct predicates only. Omit PaperWM.spoon profile and a separate sliver scenario with the reasons above. No crash-recovery, styling or VM-setup expansion.
- Step 1 outcome (`2447bed`): approved candidate inventory; the earlier format examples above are historical proposals, superseded by the settled GWT-only choice.
- Piece A outcome: 58 original rows moved to area files, unchanged except relative-link depth; approved priority-order index, separate focus/restart/column areas, retained minimum-size supplement. Four scrolling baselines read at the recorded pins, including PaperWM schema and paneru defaults; existing eight profile rows/pins preserved. Independent Worker migration review passed; Lead removed a leftover narrow-table instruction after review. Format promoted in `docs/decisions.md`.
- Piece A verification: exact original row/ID comparison, all area targets and moved links checked, pinned baseline source review, ASCII and `git diff --check`. Documentation-only; no application/live tests. No new live-test cases in this piece.
- Piece A commit: `9241c94` (`Split reference matrix into area files`), pushed to `origin/main`.
- Insertion outcome: R-INS-03..08 added as six 14-profile GWT scenarios; R-INS-01/02 each has four scrolling backfill entries, original tables preserved. Matrix now 64 scenarios. New pinned admission/preselection/model and Ours code keys resolve in the index; consensus gains all six rows plus backfill comparison without changing the original-eight strength rule.
- Insertion coverage (92 cells = 84 new + 8 backfill): 0 fully evidenced, 36 partial-source with TBD remainders, 51 TBD-only, 1 qualified (xmonad R-INS-08), 4 mixed qualified maximize/applicable-TBD fullscreen cells. Original-eight 48: P18/T25/Q1/M4; scrolling new 24: P6/T18; backfill 8: P6/T2; Ours 12: P6/T6. Counts measure coverage, not votes. No new strong consensus or product choice established.
- Insertion review: initial branch-only draft rejected for insufficient pinned admission assessment; corrected with actual source routes and inventory evidence. Independent evidence review exposed mixed-leg count errors and unsupported COSMIC absence. Lead corrected these, the sway split binding and paneru Stack/native-Tabs distinction; no evidence is inferred from search absence. Geometry, actual focus and difficult source routes stay TBD and queued above.
- Insertion verification: six IDs with 14 Then entries each, two backfills with four each, original row preservation, all source keys resolved, unchanged original pins, pinned source spot review, ASCII and whitespace checks. No live tests.
- Exact next action: focus, R-FOC-01..04; reuse directional floating-layer coverage without changing it, add pinned outcomes/qualifications and consensus entries, queue difficult ties, then commit/push that area.
