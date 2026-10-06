# Reference matrix expansion

- Status: active; restructure through mouse accepted; batch decisions pending, special windows next.
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

- User correction (2026-10-06): answer each Observe at the semantic level first; cited pinned source reasonably establishing that predicate is evidence without every guard or native/pixel confirmation. Pixel frames, animation and incidental details are not prerequisites unless load-bearing. Keep Then outcomes to one to three lines; use TBD only for genuinely unresolved discriminatory parts. Counts below use this standard; earlier piece-B1 counts are historical.

### Insertion queue additions (piece B1)

These are applicable unknown legs or applicability/inventory checks, not
established no-ops. Resolve inventory/model applicability before arranging a
live fixture; source pins and shipped baselines stay those in the index.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-INS-03, four scrolling profiles and Ours KDE/Windows | Empty domain, ordinary first open; unresolved column width/focus or Ours native activation | Original eight semantic predicates fully sourced, no live confirmation required for those cells. PaperWM width, niri/karousel focus, paneru width/focus, and Ours activation remain unresolved |
| R-INS-04, all 14 | Pointer outside eligible windows, no refocus, C/D/E chain; record B's dimensions | Landscape output alone does not establish R-INS-01's target rectangle; repeated focus/pointer/recalc legs 2-3 complex and TBD |
| R-INS-05, Hyprland/bspwm/xmonad/qtile/awesome and four scrolling profiles plus Ours KDE/Windows | Ordinary float focused, B prior tiled focus; open C; record pointer for Hyprland | COSMIC/i3/sway B-anchor outcomes sourced. Hyprland pointer-vs-B unresolved; other reference anchors unresolved; Ours whole-root fallback sourced, native activation unresolved |
| R-INS-06, COSMIC/Hyprland/qtile/awesome and four scrolling profiles plus Ours KDE/Windows | Fresh max and full fixtures; open C; native state acknowledgements, visibility and focus | Born-max/unfloat paths are not open-over-overlay evidence; render/focus interplay TBD. paneru native-zoom and fullscreen preparation require confirmation |
| R-INS-06, bspwm/i3/xmonad/sway | Fresh fullscreen fixture only | Maximize has evidenced no-counterpart; fullscreen remains applicable and TBD, not excluded with maximize |
| R-INS-07, all 14 | One-case destination rule into inactive WS2/R; source output focused, pointer on L | niri routing and PaperWM routing/no-steal branches sourced; target anchor and full journey unresolved. Verify karousel cross-output and paneru native Space/virtual-row applicability first |
| R-INS-08, bspwm/i3/sway | Named preselect/split verb, open C then D; override and persistence | Hyprland semantic override/one-shot outcome fully sourced and removed from queue; bspwm consumption and i3/sway admission/persistence unresolved |
| R-INS-08, COSMIC/qtile/awesome/four scrolling profiles/Ours KDE/Windows | Native command inventory before any fixture | A missing search term is not absence evidence; applicability remains TBD. xmonad/Tall's fixed master/stack model has no-counterpart |
| R-INS-01 scrolling backfill, all four | Separate two-column Given; open C; stable-vs-rescaled widths, focus and viewport | Position sourced and PaperWM activate-on-show sourced; widths/viewport and other focus remainders unresolved |
| R-INS-02 scrolling backfill, niri/PaperWM/karousel | Exact tabbed-display Given and open C | niri/karousel non-join sourced; active-member/focus unresolved. PaperWM fixture applicability unresolved. Paneru exact S fixture is inapplicable per model source, not a live no-op; native-tab journey belongs to R-COL-10 |

- Source routes retained: niri `scrolling.rs`/`workspace.rs`/`xdg_shell.rs`; PaperWM `tiling.js` insertion, actor-show and inactive-space paths; karousel `Tiled.ts`/`Grid.ts`/`Column.ts`; paneru `triggers.rs` plus `layout.rs` model. Ours shared `session.rs`, `lifecycle.rs`, `world.rs` with adapter boundary citations at `9241c94`. No source branch is promoted to physical delivery evidence.

### Focus queue additions (piece B2)

14 unresolved cells (P6 + T8), grouped in four entries. Inventory/model
checks precede any live fixture; no source-confirmed outcome requires
physical confirmation merely to count as semantic evidence.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-FOC-01, Hyprland/qtile/niri/karousel/paneru (5) | Equal two-left-candidate rectangles, histories A,B,C and B,A,C; native column members for projections | Hyprland tie identity, qtile current-member mapping, niri/karousel member and paneru directional traversal unresolved |
| R-FOC-02, paneru (1) | First-column A focused, one output, focus West | Edge behavior unresolved |
| R-FOC-03, Hyprland/bspwm/xmonad/awesome/PaperWM (5) | Sequential next then previous, fresh edge legs, fresh ordinary-float leg | Hyprland previous invocation/traversal; bspwm binary embedding/internal-node matching; xmonad float position; awesome order; PaperWM cycle inventory unresolved |
| R-FOC-04, Hyprland/bspwm/paneru (3) | B leaf focused, native parent then child commands where present | Container inventory/traversal or paneru Stack/Column scope unresolved |

### Move queue additions (piece B3)

27 unresolved cells (P3 + T24), grouped in five entries. Inventory checks
precede live fixtures; source-evidenced semantic cells need no live test
solely to confirm pixels. All pins/defaults remain those in the index.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-MOV-06, COSMIC/Hyprland/PaperWM/paneru and i3/sway/qtile remainders (7) | A left of B/C group, group prior focus C; move right with a single declared native verb | C/H reinsert target, PaperWM native directional inventory, paneru peer and I/S/Q member/index unresolved |
| R-MOV-07, COSMIC/Hyprland (2) | `V[H[A,B*],C]`; move B down | Orthogonal escape/reinsert result unresolved; absent exact column fixtures are qualified, not queued |
| R-MOV-08, COSMIC/xmonad/PaperWM/paneru (4) | Output U above L; A at L's upper edge, X alone on U; move A up | Vertical fallback, same-layer swap target or native inventory unresolved; layout-driven native legs declared separately |
| R-MOV-01/02/03/05 scrolling backfill, PaperWM (4) and paneru R-MOV-01/05 (2) | Ordered single-window columns, or C/B visible column for R-MOV-02; respective down/up/right/left actions | PaperWM native move inventory and paneru edge peers unresolved; R-MOV-04 ancestry is fixture-inapplicable, not a live case |
| R-MOV-01/03 explicit swap, COSMIC/Hyprland/PaperWM/paneru (8) | Fresh original or explicitly model-qualified fixture; down/right swap with declared target resolution | Command inventory, binary fixture/target or peer resolution unresolved; targeted i3/sway exchanges evidenced without incidental focus TBD |

### Resize queue additions (piece B4)

29 unresolved cells (P9 + T20), grouped in five entries: 17 new-scenario
cells and all 12 scrolling minimum-size remainders. Inventory checks
precede fixtures. Qualified missing edge verbs, nesting and Windows
keyboard triggers are not live no-ops; no source-confirmed semantic leg
needs physical confirmation solely to count as evidence.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-RSZ-01, Hyprland/bspwm/PaperWM/karousel/paneru (5) | Declared grow/shrink pair; 50/50 tree or two 0.5W columns; pixel delta for H/B, shipped grid/context/presets for scrolling profiles | H/B neighbor/reversal, PaperWM neighbor reflow, karousel contextual step/neighbor/reversal, paneru neighbor allocation unresolved |
| R-RSZ-02, Hyprland/bspwm (2) | A at left work-area edge; actual left-edge outward resize, not generic width grow | Edge/smart distribution or outer handle result unresolved; four scrolling profiles have no edge-targeted counterpart |
| R-RSZ-03, Hyprland/bspwm (2) | `H[H[A*,B],C]`, inner/outer halves; grow right once | Inner-vs-ancestor ratio ownership unresolved; flat/column nesting qualifications excluded |
| R-RSZ-04, COSMIC/Hyprland/i3/xmonad/sway/awesome/niri/PaperWM (8) | Equalize/balance inventory first; 50/30/20 fixtures, explicit binary embedding and root target where applicable | Native verb inventory unestablished; bspwm root equalize/balance, qtile/karousel equal shares and paneru distinct height/width verbs are sourced |
| R-MIN-01..03, four scrolling profiles (12) | Exact original dimensions/hints with column Given: 1080x300 admission, 1220->1080->1220 same-fixture recovery, empty 1080x600 oversized sole | niri/karousel minimum clamp only partially establishes admission/recovery/overflow; PaperWM/paneru minimum paths untraced. Strip scrolling is not tree infeasibility; record viewport, frames and applicable focus |

### Layout-command queue additions (piece B5)

One unresolved partial cell in one entry. Qualified absent commands and
floating-workspace fixtures add no live cases; established semantic
outcomes need no pixel confirmation.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-LAY-04, Hyprland/Dwindle (1) | WS1/WS2 two-window dwindle layouts; apply WS2-only master layout override; return to WS1 | Workspace-local algorithm ownership sourced; window order through the algorithm switch unresolved |

### Workspace queue additions (piece B6)

30 unresolved cells (P22 + T4 + M4), grouped in nine entries. Inventory
and fixture checks precede live journeys. Sourced semantic transfer,
float-state and follow outcomes need no physical confirmation to count
as evidence. Qualified absent verbs never become live no-op tests.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-WS-09, Hyprland/PaperWM/karousel/Ours KDE (4) | Focus A then B on WS1, select WS2 then WS1; record pointer under shipped Hyprland follow_mouse=1; saved viewport for karousel | Hyprland final identity depends on unspecified pointer; PaperWM/KDE native return-focus and karousel viewport restoration unresolved |
| R-WS-10, Hyprland (1) | Send sole B from occupied middle WS2, then select WS3; no persistent rule | Stable IDs sourced, empty-object destruction unresolved |
| R-WS-12, COSMIC/Hyprland/bspwm/i3/sway/qtile/awesome/PaperWM (8) | Hidden WS2 on L to R, WS3 shown on R; independent selected-active legs for COSMIC/sway; matched-workspace criteria for i3 | Destination/source displaced-view or focus remainders unresolved; PaperWM hidden-target applicability must be established first |
| R-WS-14, awesome/PaperWM/karousel (3) | Fresh next-send and previous-send from occupied WS2 | awesome relative-send inventory, PaperWM completion and karousel follow unresolved |
| R-WS-01 backfill, karousel/paneru (2) | A/B source columns; sole C target; declared native send and follow policy | karousel focus and paneru target position unresolved |
| R-WS-02 backfill, four scrolling profiles (4) | Model-qualified C/A/B columns on WS1, WS2 empty; focus A then B, send, select/focus A, select/focus B, send back | A-relative return paths sourced; focus/viewport or paneru return-index remainder unresolved; exact recursive ancestry remains inapplicable |
| R-WS-04 backfill, four scrolling profiles (4) | On WS2 focus D then C, float C, select WS1/focus B, send B to WS2 | Surviving anchor or float-removal/admission legs unresolved |
| R-WS-05 backfill, PaperWM/karousel/paneru (3) | Send B to empty WS2, float, send back, select WS1; unmanaged float where native | Floating transfer untraced; tiled column transfer is not float evidence. niri float carry/follow is sourced and not queued |
| R-WS-07 backfill, niri (1) | All-workspace MRU switcher, select hidden B | Listing sourced; activation switch/focus unresolved |

### Minimize queue additions (piece B7)

31 unresolved cells (P16 + T15), grouped in three entries. Native
icon-minimize is required; hidden/scratchpad substitutes and qualified
absent paths do not become live no-op cases.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-MNZ-01, Hyprland/xmonad/sway/qtile/PaperWM/karousel/paneru/Ours KDE/Windows (9) | Middle B, history A,C,B; native minimize; model-qualified tree/column fixtures | H/X/S native tree effects, qtile and scrolling reflow/refocus, KDE production frame/Engine journey, Windows focus unresolved |
| R-MNZ-02, COSMIC/Hyprland/xmonad/sway/qtile/awesome/PaperWM/karousel/paneru/Ours KDE/Windows (11) | Restore B from actual R-MNZ-01 minimized state; leave remaining windows unchanged | COSMIC/awesome/Windows focus; qtile/scrolling slot and focus; H/X/S/KDE native restore journey unresolved |
| R-MNZ-03, COSMIC/Hyprland/xmonad/sway/qtile/awesome/PaperWM/karousel/paneru/Ours KDE/Windows (11) | Sole A on shown WS1, occupied WS2; native minimize, paneru virtual-row leg | Workspace occupancy/cleanup and focus; KDE sole-minimize active-window/Engine journey; Windows retained occupancy sourced, focus unresolved |

### Maximize/fullscreen queue additions (piece B8)

21 unresolved cells (P12 + T3 + M6), grouped in six entries. Native
maximize is distinct from a width preset. Paneru host zoom is an
owner-specific journey, not an impossible fixture proved by missing AX
observation. Only R-MAX-01 makes hinted frames/convergence load-bearing;
semantic fullscreen exit evidence needs no incidental native confirmation.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-MAX-08, COSMIC/Hyprland/qtile/karousel/paneru (5) | Maximize middle B; focus left then move actual focused window right; paneru uses a declared host-zoom fixture | C/H overlay traversal and move complex; qtile post-removal current index, karousel final order and paneru host-zoom focus/swap unresolved |
| R-MAX-09, COSMIC/Hyprland/xmonad/PaperWM/karousel/paneru/Ours KDE (7) | Fresh max/full fixtures, send B to occupied WS2; native send and follow policy named; paneru native Space vs virtual row recorded | Overlay carry/target/source remainders unresolved; xmonad full leg only; PaperWM width/full carry; paneru host zoom and fullscreen marker; KDE native same-output send outcome (dev-only project prototype is not production) |
| R-MAX-01 backfill, four scrolling profiles (4) | 2544px viewport, gap 8, min widths 401/864/627/582; native maximize then restore; model-qualified columns | niri/PaperWM/karousel membership policy sourced but exact hinted frames and convergence unresolved; paneru host-zoom sibling/restore journey unresolved |
| R-MAX-02 backfill, paneru (1) | Native fullscreen, focus A/B, exit; distinguish native fullscreen Space and virtual row | Fullscreen strip/focus branch sourced, exit journey unresolved |
| R-MAX-04 backfill, paneru (1) | Declared host-zoom shortcut, native restore, repress on same window | No paneru maximize command or AX zoom observation; host attempt-state journey unresolved |
| R-MAX-06 backfill, PaperWM/karousel/paneru (3) | First-seen maximized/host-zoomed A, B already present; admit then natively restore | PaperWM conversion and karousel force-unmaximize sourced, admission focus unresolved; paneru host-owned admission/restore unresolved |

### Groups/stacks queue additions (piece B9)

9 unresolved cells (P2 + T7), grouped in four entries. Semantic
membership and active-tab evidence needs no pixel/native confirmation;
qualified absent carriers and commands never become live no-op tests.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-GRP-02, COSMIC (1) | B focused beside stack A/C with A active; semantic join left, then move actual joined B right once | Semantic join inventory/outcome unresolved; sourced leave is conditional on actual post-join index, not an invented middle-tab fixture |
| R-GRP-02, i3/sway (2) | Same sequential join then leave with actual post-join order and active tab recorded | Directional move inventory alone does not establish membership/order or sequential leave |
| R-GRP-02, PaperWM/paneru (2) | PaperWM explicit A-focused slurp variant then barf B; paneru declared native join/leave inventory and column fixture | PaperWM selection unresolved (default slurp from B has no right neighbor); paneru peer/membership untraced |
| R-GRP-03, four scrolling profiles (4) | Close middle active B with history A,C,B; niri tabbed, karousel explicit stacked display, PaperWM/paneru visible column fixtures | Member-removal selection/focus and retained-vs-dissolved column untraced |

### Floating queue additions (piece B10)

43 applicable unresolved cells, grouped in 12 entries. Piece coverage has
P17/T20/M9, but three M cells (R-FLT-12 i3/sway/niri) have evidenced raise
plus absent lower and add no live case. Ordinary and scratch-stuck floats
are distinct; host journeys remain applicable despite absent tiler verbs.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-FLT-12, COSMIC/Hyprland/bspwm (3) | Overlapping F/G, G above F; raise F then explicit lower with declared native verb | Raise sourced; lower inventory/outcome unresolved (Hyprland Lua and bspwm client-layer paths need a declared action) |
| R-FLT-12, xmonad/PaperWM/karousel/paneru/Ours KDE/Windows (6) | F/G relative order after raise; PaperWM dialog-float variant; paneru arbitrary F rather than last-floating | xmonad relative order, dialog/host stacking and Ours activation order unresolved; absent project lower paths never become no-op tests |
| R-FLT-13, Hyprland/niri/PaperWM/karousel/paneru/Ours KDE/Windows (7) | Switch WS2 then WS1 with F initially focused; paneru virtual rows, PaperWM dialog; record Hyprland pointer | Reference return-focus/frame remainders, Windows reveal-frame retention and KDE native visibility/frame/focus journey unresolved |
| R-FLT-14, PaperWM/karousel/paneru/Ours KDE/Windows (5) | Host pointer drag (+100,+50), then bottom-right resize (+100,+50), releases away from boundaries | Host free-frame/layer/focus journeys untraced; Ours project float resize refuses as NotTiled, not evidence that native gestures fail |
| R-FLT-01 backfill, niri/karousel/paneru (3) | A/B/C columns, float B then unfloat | Unfloat position/focus (niri viewport, paneru survivor allocation) unresolved |
| R-FLT-02 backfill, PaperWM/karousel/paneru (3) | PaperWM scratch-stuck on/off; KWin onAllDesktops or macOS host assignment journey | PaperWM re-tile placement and host sticky visibility/off placement unresolved |
| R-FLT-03 backfill, paneru (1) | Three independent column widths 960/576/384 in 1920px viewport; float A | Survivor width path untraced; niri/karousel stable widths are sourced and not queued |
| R-FLT-05 backfill, PaperWM/karousel/paneru (3) | Scratch-stuck or host-sticky B; declared owner restart then WS2 | Sticky/float carry, visibility and origin restoration untraced |
| R-FLT-06 backfill, niri/karousel/paneru (3) | Float B then native maximize/host zoom, toggle float | niri/karousel state-toggle interplay and paneru host-zoom journey unresolved; PaperWM ordinary toggle has no counterpart |
| R-FLT-07 backfill, paneru (1) | Exact original tile/float rectangles; tiled B focus left | Tiled-origin traversal with unmanaged float untraced |
| R-FLT-08/09 backfill, PaperWM/paneru (4) | Exact original F/G frames; float focus right; record PaperWM remembered tiled selection | PaperWM switches from remembered tile, not focused float; final target and paneru unmanaged search unresolved |
| R-FLT-10/11 backfill, PaperWM/paneru (4) | Free F at (1000,500,300,200); semantic right, then up | Float-subject move result and snap-state journey untraced |

### Close queue additions (piece B11)

24 applicable unresolved cells (P21 plus three applicable-TBD M legs),
grouped in seven entries. Two M cells (bspwm/i3 R-CLOSE-05) have an
evidenced full leg and absent max leg, adding no live case. Native close
of responsive clients is required; owner observation commands are not
substituted for the host close action.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-CLOSE-03, Hyprland/Ours KDE/Windows (3) | Close sole A on shown WS1; WS2 occupied | Hyprland shown-empty retention/focus and Ours native empty-focus journey unresolved; Engine collapse is sourced |
| R-CLOSE-03, bspwm/xmonad/paneru (3) | Same fixture; paneru Space1 VW row 0, second native Space occupied | Desktop/workspace/row retention sourced; actual focus fallback untraced |
| R-CLOSE-04, Hyprland/xmonad/PaperWM/karousel/paneru/Ours KDE/Windows (7) | Tiles A/B plus focused F at (500,300,400,300); history A,B,F; close F | Separation/removal sourced; spatial/positional/shell/KWin/geometry target or adapter focus delivery unresolved |
| R-CLOSE-05, COSMIC/PaperWM/Ours KDE/Windows (4) | Fresh native max and full fixtures; close B, sole survivor A | Allocation/removal sourced in part; overlay cleanup or surviving focus/native journey unresolved |
| R-CLOSE-05, xmonad/sway/paneru (3) | Fresh full fixture; paneru host-zoom leg separately | xmonad final focus, sway fullscreen-pointer teardown and paneru close-from-fullscreen/host-zoom journey untraced |
| R-CLOSE-01 backfill, paneru (1) | Three columns; history A,C,B; close middle B; record rectangles | Nearest-center fallback sourced but identity geometry-dependent |
| R-CLOSE-02 backfill, niri/karousel/paneru (3) | Manual 50/30/20 column widths; close B, focus C, reopen new B | Independent survivor widths and fresh admission sourced; reopened focus unresolved. PaperWM activate-on-show is sourced and not queued |

### Multi-output queue additions (piece B12)

22 applicable unresolved cells (P7 + T15), grouped in five entries.
Directional edge movement and explicit monitor transfer are different
actions. Qualified single-screen fixtures and absent project send verbs
never become no-op votes. Source-evidenced carry/follow needs no exact
column attachment or physical confirmation.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-OUT-03, COSMIC/Hyprland (2) | Focus left from A with L sole X; shipped workspace layout/default monitor fallback | Fall-through/fallback sourced; COSMIC branch and Hyprland target unresolved |
| R-OUT-03, paneru (1) | Focus West from A on D2, separate occupied D1/D2 strips | Cross-display focus traversal untraced |
| R-OUT-04, xmonad (1) | Explicit windowToScreen A to L; record source refocus | Carry and target-stack focus sourced; source delete fallback unresolved |
| R-OUT-05, Hyprland/niri/paneru/Ours KDE/Windows (5) | Focused L, pointer on R; ordinary C opens without rules | Cursor-vs-active/display routing and Ours routing/native activation unresolved |
| R-OUT-06, all but karousel (13) | Occupied R focused; disconnect/reconnect same identity; user host only | sway evacuation and bspwm default retention/same-id reuse sourced; focus/visibility/affinity remainders and other migration journeys unresolved |

### Mouse queue additions (piece B13)

56 applicable unresolved cells (P33 + T22 + one applicable-TBD M leg),
grouped in 11 entries. i3/PaperWM R-MOU-03 have evidenced cross-output
legs and qualified switcher legs, adding no live case. Host producers
remain applicable despite absent tiler commands. No agent live tests.

| IDs / profiles | Required discriminator / state | Why source evidence stops |
|---|---|---|
| R-MOU-01, COSMIC/bspwm/PaperWM/karousel/paneru/Ours KDE/Windows (7) | Named enabled hover variant, fresh click-focus leg; ordinary A/B; click delivery | COSMIC/bspwm hover, PaperWM/KWin/Windows host producers and paneru host click-focus remain unresolved; niri opt-in hover and plain-click activation/delivery are sourced |
| R-MOU-02, COSMIC/Hyprland/niri/PaperWM/paneru/Ours KDE/Windows (7) | Shared edge right 100px; native client request vs named modifier or border-enabled variants | Actual dragged width/share or native-host journey unresolved; command/adapter inventories alone do not establish pointer outcomes |
| R-MOU-03, all except i3/PaperWM (12) | B to C's edge on R; fresh WS3 switcher drop; karousel single-screen switcher-only leg | Cross-output or switcher remainders unresolved; resolve host target/producer applicability first. Exact index is not needed merely to establish insertion/follow |
| R-DRAG-01 backfill, niri/PaperWM/paneru (3) | B onto C centre in three-column fixture | Actual insertion target/row or host journey unresolved; karousel untile/no-join/no-restore is sourced |
| R-DRAG-02 backfill, all four (4) | A/B/C 640px columns at 1920, existing N outside; between-A/B bar drop | Index/share or N initial-layer remainder unresolved |
| R-DRAG-03 backfill, all four (4) | Fresh titlebar and Mod+Left drags to A's top edge | Producer parity/click delivery/host initiation unresolved; niri client titlebar supports viewport scrolling unlike Mod+Left |
| R-DRAG-04 backfill, all four (4) | Start B drag, Esc, release; record hover/drop point | Commit vs restoration or host cancellation remainders unresolved; pointer-grab inventory alone does not establish native host cancellation |
| R-DRAG-05 backfill, niri/karousel/paneru (3) | Zero-move press/release using declared producer | Preview, host session-start or host reshuffle effects unresolved; PaperWM unchanged topology/activation is sourced |
| R-DRAG-06 backfill, all four (4) | B focused, panel/taskbar outside work area; release over panel | Final placement/restoration unresolved; PaperWM temporary scratch is explicitly undone after animation, not a proved final float |
| R-DRAG-07 backfill, all four (4) | Mod+Left B to A edge, pause mid-hold | Preview/final-placement or host frame journey unresolved where load-bearing |
| R-DRAG-08 backfill, all four (4) | A focused, B unfocused; Mod+Left B to A edge | Press/drop focus or delivery unresolved; niri press activation and paneru hover activation are sourced |

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
- Insertion semantic correction: six scenarios and two scrolling backfills tightened from 365 to 239 lines. Coverage now E12/P30/T44/Q2/M4 (92 cells; M = qualified maximize + applicable-TBD fullscreen). Original-eight E12/P12/T19/Q1/M4; scrolling new P6/T18; backfill P6/T1/Q1; Ours P6/T6. First-window tile/full-area/focus is unanimous 8/8 across four families; Ours allocation/desired focus match, native activation unknown. Float-focused admission differs: COSMIC/i3/sway use B, Ours wraps the whole root, Hyprland pointer-vs-active-tile is config-qualified; no strong anchor consensus or product decision. Hyprland preselect fully evidenced. Queue narrowed, no additions.
- Correction review: initial Worker accounting still treated fully semantic outcomes as partial; resumed once to align E/P classes and consensus with Observe. Lead checked actual diff, Ours insertion/eligible-focus code, count consistency and cited routes; removed unsupported side-by-side claim when B's dimensions are unstated. Accepted verification: GWT profile counts, citation resolution, ASCII, original wide-row preservation, whitespace; no live tests.
- Insertion correction commit: `b2ae405` (`Tighten insertion outcome evidence`), pushed to `origin/main`.
- Focus outcome: R-FOC-01..04 added, 14 Then profiles each; no existing focus-area rows to backfill (0 cells), R-FLT-07..09 reused in place. Matrix 68 scenarios. Coverage E27/P6/T8/Q15/M0 (56 cells); original-eight E18/P4/T4/Q6, scrolling E5/P2/T4/Q5, Ours E4/Q4. Single-output edge retain is strong 5/8 across three families and Ours matches. Tie-MRU (3/4ev), cycle-order (4/4ev), parent/child scope (3/3ev) meet the numerical rule but only two-family breadth: W, not strong. Ours stable tie choice matches COSMIC; Ours cycle/container verbs have no counterpart, not agreeing rejection. No strong consensus conflict or product behavior selected.
- Focus review: resumed Worker to repair sequential next/previous outcomes, missing edge-wrap legs, fixture qualification, semantic Ours adapter evidence and missed stay-5/8 consensus. Independent source reviewer confirmed outcome evidence/counts and found one causal wording error: COSMIC equal-distance selects first minimum, not strictly nearer A; Lead corrected it. Lead reconciled per-predicate W classifications, kept scrolling outside the eight-profile voter table, and repaired table continuity. Verification: 4x14 Then, source keys/pins, ASCII/local links, whitespace; source/offline only. Queue adds 14 unresolved cells in four groups.
- Review reconciliation: follow-up verified the latest focus edits and counts. Its proposed COSMIC empty-admission downgrade required native confirmation despite a sourced active-workspace focus target; rejected under the user's semantic evidence standard. Table B's COSMIC cell is sourced yes, while Ours admission/native activation remains partial. Stop at the focus committed boundary as Lead context is crowded; no blocking product decision.
- Move outcome: R-MOV-06..08 added as three 14-profile GWT scenarios; R-MOV-01..05 each assessed for four scrolling profiles; explicit-swap fresh legs reuse R-MOV-01/03. Matrix now 71 scenarios. Coverage over 90 cells: E41/P3/T24/Q22/M0. New 42: E21/P3/T10/Q8 (original-eight E12/P3/T6/Q3, scrolling E3/T4/Q5, Ours E6); backfill 20: E10/T6/Q4; swap 28: E10/T8/Q10. Qualifications never vote as no-ops.
- Move review: implementation Worker resumed for semantic-only evidence, faithful fixture/action definitions and actual applied Ours topology; independent Worker found bspwm leaf-selection/cross-output errors, PaperWM viewport-vs-membership mismatch and qtile's unexposed internal swap helper. Lead resolved these against pinned source, removed incidental swap-focus TBD and the non-equivalent R-MOV-04 pseudo-escape, and reconciled counts. Reviewer's awesome tie objection was withdrawn: the actual metric uses top-left y, so B is strictly nearer, not a center-distance tie. No live tests or product changes.
- Move consensus: R-MOV-06 has enter/leaf-swap/carry conflict, and R-MOV-07 escape-vs-swap conflict. Ours midpoint insert shares enter-V with i3/sway (their index TBD); Ours perpendicular wrap differs from both R-MOV-07 classes. R-MOV-08 crosses in H/B/I/S/A: strong 5/8 across binary/tree/layout-driven families; qtile stays, COSMIC/xmonad TBD. Ours KDE/Windows stay under the existing Up/Down-excluded R4. Consensus Table A grows 11 to 12; B remains 16, W remains 6.
- User decision needed: retain V-R4-DIR's vertical exclusion or revise Up/Down to cross after local movement is exhausted? Recommendation: revise vertical fallback to match strong cross-family consensus; no product behavior or selected hook changed here. Stop after the move commit boundary for this decision and context handover.
- Move verification: 3x14 new Then entries, 5x4 scrolling assessments, 2x14 swap legs; original wide rows preserved; source keys/pins, ASCII, local links and whitespace checked. Queue adds 27 unresolved cells in five groups; inventory/model checks first.
- Resize outcome: R-RSZ-01..04 added as four 14-profile GWT scenarios; R-MIN-01..03 each assessed for four scrolling profiles, preserving original wide rows. Matrix now 75 scenarios. Coverage over 68 cells: E21/P9/T20/Q18/M0. New 56: E21/P5/T12/Q18 (original-eight E15/P2/T10/Q5; scrolling E3/P3/T2/Q8; Ours E3/Q5); backfill 12: P4/T8. No product behavior or pins changed.
- Resize review: sequential implementation and independent source review corrected generic-width substitutes for edge actions, qtile reversal/weight units, niri reverse verb, PaperWM grid rounding, karousel contextual reversal, missing minimum geometry and same-fixture recovery, and bspwm root-targeted binary balance. Explicit root `-E` yields 50/25/25; `-B` yields thirds; paneru Equalize leaves single-column widths unchanged while Balance copies A's width. Ours Windows keyboard cells are qualified absent triggers, not shared-Engine delivery claims. Lead reconciled the final fixtures, citations, cell counts and per-predicate votes against actual source.
- Resize consensus: explicit pixel path is strong 5/8 (C/H/B/I/S), three families; partial H/B cells vote only for their established pixel leg. i3/sway use declared 10px commands here, not their bare ppt defaults; qtile transfers weights, not pixels. KDE matches. Windows' missing keyboard trigger is a strong-leg inventory gap, not a rejecting policy; recommendation for batch review: implement keyboard-resize parity through the shared Engine. Outer-edge no-op is weak 3/4ev across two families; nearest-inner split weak 3/3ev across two. No strong equalize choice. Table B grows 16 to 17 and W 6 to 8; A remains 12, U 6, C 15.
- Resize verification: 4x14 Then entries and 3x4 scrolling assessments; original R-MIN wide rows preserved; citation keys, local links, unchanged pins, ASCII and whitespace checked. Source/offline only, no live tests. Queue adds 29 unresolved cells in five groups. Pending move/resize recommendations stay collected for Orchestrator batch review and do not block later areas.
- Layout-command outcome: R-LAY-01..04 added as four 14-profile GWT scenarios; R-FLT-04/R-WS-06 each assessed for all four scrolling profiles in place, preserving historical rows. Matrix now 79 scenarios. Coverage over 64 cells: E15/P1/T0/Q48/M0. New 56: E15/P1/Q40 (original-eight E15/P1/Q16, scrolling Q16, Ours Q8); backfill 8: Q8. No product behavior or pins changed.
- Layout-command review: implementation Worker corrected split-preparation substitutes to i3/sway's native parent-layout toggle, traced runtime per-workspace alternatives instead of inferring absence from global defaults, and qualified impossible scrolling floating-workspace targets. Independent source review confirmed count classes and historical-row preservation. Lead removed incidental Hyprland master geometry TBD under the semantic evidence standard and found its immediate geometry recalculation overrides toggle/rotation bits at shipped defaults; repaired the outcome/citation and consensus without changing counts. Workers ran sequentially; no live tests.
- Layout-command consensus: parent-axis toggle is strong 4/5 evidenced (C/B/I/S vs Hyprland geometry-reset no-op), three families under the settled all-but-one rule; workspace-local alternative layout is strong 6/8 (B/I/S/X/Q/A), three families, with i3/sway parent scope disclosed. Both Ours platforms lack these commands, evidenced by shared Engine plus separate adapter inventories, not agreeing rejection. Recommendations for batch review: add parent-axis toggle and workspace-local layout selection. Root rotation/mirror has only bspwm evidence; master promotion is layout-driven, while Hyprland's nearest verb is a tree operation. Table A grows 12 to 14; B17/U6/C15/W8 unchanged.
- Layout-command verification: 4x14 Then entries, 2x4 scrolling assessments; source keys, local links, unchanged pins, ASCII and whitespace checked. Source/offline only. Queue adds one unresolved partial cell in one group (Hyprland alternative-layout order).
- Workspace outcome: R-WS-08..14 added as seven 14-profile GWT scenarios; R-WS-01..05/07 each assessed for all four scrolling profiles, R-WS-06 retained from piece B5. Historical wide rows and pins preserved. Matrix now 86 scenarios. Coverage over 122 cells: E58/P22/T4/Q34/M4. New 98: E55/P11/T1/Q27/M4 (original-eight E38/P7/T1/Q8/M2; scrolling E14/P4/Q9/M1; Ours E3/Q10/M1); backfill 24: E3/P11/T3/Q7. M denotes mixed qualified and applicable-TBD legs, not agreeing no-ops.
- Workspace review: sequential implementation and independent source-review Workers corrected history-toggle labels, trailing/static workspace fixtures, hidden-vs-active transfer verbs, pointer-driven Hyprland return-focus, absent-WS9 static inventories, return-anchor history and C membership, and tiled-vs-floating transfer evidence. Lead checked pinned Hyprland/niri/COSMIC and Ours source, corrected native command wording and five partial-cell accounting errors, and reconciled actual consensus table rows. No live tests or product changes.
- Workspace consensus: previous-view toggle is strong 5/8 (B/I/S/Q/A), native-edge wrap 6/8 (C/B/I/S/Q/A), whole-hidden-domain reassignment 5/8 (H/B/I/Q/A, destination/focus partial), relative send inventory 5/8 (C/H/B/I/S), all spanning at least three original families. Both Ours platforms lack these verbs. Recommendations for batch review: add previous toggle, wrapping relative switch, whole-workspace output transfer and relative send. Remembered return-focus is strong 7/8; Windows matches, KDE shell-driven return TBD. Hyprland pointer policy and named no-mouse variant differ. No strong cleanup or absent-workspace creation choice. Table A18/B18/U6 full rows plus one KDE leg/C17/W8; scrolling stays non-voting.
- Workspace verification: 7x14 new Then entries, 6x4 new scrolling assessments, original R-WS-06 backfill and wide rows preserved; citation resolution, ASCII, local links, pinned source spot checks and whitespace checks. Source/offline only. Queue adds 30 unresolved cells in nine groups; current source-evidenced legs excluded.
- Minimize outcome: R-MNZ-01..03 added as three 14-profile GWT scenarios; no existing minimize rows to backfill. Matrix now 89 scenarios. Coverage over 42 cells: E2/P16/T15/Q9/M0 (original-eight E2/P7/T9/Q6; scrolling P6/T3/Q3; Ours P3/T3). Native host minimize/restore remains applicable on both Ours platforms; missing tiler commands are not absence evidence.
- Minimize review: implementation Worker corrected an initial command-inventory-only draft; independent source review found unsupported bspwm focus and citation ranges. Lead found KDE evidence came from the send observer, not the production observer, and bspwm HIDDEN was being substituted for icon-minimize. Final correction uses production KDE observation (no minimized filter; actual native/Engine journey TBD), Windows retained-slot evidence, and bspwm's absent iconic client-message path. i3 refusal and niri protocol no-op are qualified non-voters; generic null-observation guards do not establish sole-minimize outcomes. No live tests or product changes.
- Minimize consensus: allocation release is weak 3/3ev (C/Q/A), and old-slot restore weak 2/2ev (C/A), both only two families. Windows retains its slot against the weak release direction; KDE is TBD. No Ours-vs-strong conflict or new behavior recommendation. Table A18/B18/U6 plus KDE leg/C17 unchanged; W grows 8 to 10.
- Minimize verification: 3x14 Then profiles, all new citation keys resolve, local links/ASCII/unchanged pins and whitespace checked; source/offline only. Queue adds 31 unresolved cells in three groups. Workers ran sequentially; Lead reconciled counts and table entries.
- Maximize/fullscreen outcome: R-MAX-08..09 added as two 14-profile GWT scenarios; R-MAX-01..07 each assessed for four scrolling profiles, historical wide rows preserved. Matrix now 91 scenarios. Coverage over 56 cells: E25/P12/T3/Q10/M6. New 28: E12/P6/T3/Q4/M3 (original-eight E6/P3/T2/Q4/M1; scrolling E3/P3/M2; Ours E3/T1); backfill 28: E13/P6/Q6/M3. Host-owned and missing-command qualifications never vote as agreement.
- Maximize/fullscreen review: implementation Worker resumed to replace inventory-only placeholders with pinned native-state evidence; independent source reviewer corrected paneru host-zoom qualification, absent project fullscreen toggles, and the false KDE no-send claim. Lead preserved R-MAX-01's load-bearing minimums/geometry, removed incidental fullscreen-exit TBDs, corrected PaperWM native-restore vs width-toggle semantics, and checked the dev-only KDE send prototype. Workers ran sequentially; no live tests or product changes.
- Maximize/fullscreen consensus: full-state carry is strong 5/8 (B/I/S/Q/A), three original families; Ours Windows refuses fullscreen sends but carries maximized sends. Recommendation for batch review: carry fullscreen state across workspace send. KDE host-native same-output send remains TBD; establish that outcome before proposing its change. niri window-send strips the state while column-send preserves it; PaperWM converts native maximize into width changes and karousel clears overlays on focus change. R-MAX-08 has no strong consensus; Ours accesses A and wraps its retained tree slot. Table A grows 18 to 19; B18/U6 plus KDE leg/C17/W10 unchanged.
- Maximize/fullscreen verification: 2x14 new Then entries, 7x4 scrolling assessments, unchanged historical rows/pins; citation resolution, local links, ASCII, whitespace and pinned-source spot checks. Documentation/source reading only. Queue adds 21 unresolved cells in six groups. Stop at this area's committed boundary because Lead context is crowded after source reconciliation.
- Groups/stacks outcome: R-GRP-02..03 added as two 14-profile GWT scenarios; R-GRP-01 assessed for four scrolling profiles, historical wide row preserved. Matrix now 93 scenarios. Coverage over 32 cells: E9/P2/T7/Q14/M0. New 28: E7/P2/T7/Q12 (original-eight E5/P1/T2/Q8, scrolling E2/P1/T5, Ours Q4); backfill 4: E2/Q2. Missing carriers/verbs are qualified non-voters.
- Groups/stacks review: implementation Worker corrected fresh-fixture substitution for the sequential join/leave, PaperWM's focused-column slurp target, inventory-only partial counts, and native/pixel confirmation overreach. Independent pinned-source review passed the corrected fixtures, membership/focus paths and consensus math. Lead spot-checked niri consume/expel and karousel move handlers and reconciled accepted counts. Workers ran sequentially; no live tests or product changes.
- Groups/stacks consensus: R-GRP-03 retains two tabs and selects C in C/H/I/S, strong 4/4 evidenced across n-ary/binary/tree families (neighbor and MRU coincide in this history). Ours KDE/Windows have no tab carrier, an inventory gap under standing V-GROUP-STACK deferral. Recommendation for batch review: retain the current refuse-closed deferral while recording the strong foreign close behavior for any future tab implementation. R-GRP-02 has no strong consensus. Table A grows 19 to 20; B18/U6 plus KDE leg/C17/W10 unchanged.
- Groups/stacks verification: 2x14 Then profiles, 1x4 scrolling assessment, original row/pins unchanged; citation resolution, ASCII, local links, whitespace and pinned-source review passed. Source/offline only. Queue adds 9 unresolved cells in four groups.
- Groups/stacks commit: `00f970f` (`Expand groups reference scenarios`), pushed to `origin/main` after `git pull --rebase`.
- Floating outcome: R-FLT-12..14 added as three 14-profile GWT scenarios; R-FLT-01..03/05..11 assessed for four scrolling profiles, preserving R-FLT-04 and historical wide rows. Matrix now 96 scenarios. Coverage over 82 cells: E31/P17/T20/Q5/M9. New 42: E18/P10/T6/M8 (original-eight E17/P5/M2, scrolling E1/P4/T5/M2, Ours P1/T1/M4); backfill 40: E13/P7/T14/Q5/M1. Mixed cells include known raise plus qualified absent lower, not necessarily unknowns.
- Floating review: first inventory-only draft corrected through pinned handlers, native pointer producers and actual production Engine/adapter paths. Independent review found qtile X11 lower and citation gaps. Lead checked the X11 same-layer lower path and PaperWM focus handler, corrected falsely inferred float-selected switch aborts, restored exact backfill fixtures and removed incidental viewport/focus unknowns from the widths-only discriminator. Follow-up source/count verification passed; two minor scope/variant wording findings corrected. Workers ran sequentially; no live tests or product changes.
- Floating consensus: raise-7/8 (C/H/B/I/S/Q/A), ordinary-hidden-8/8 and free-pointer-frame-8/8 are strong across all four families. Windows hides/reveals ordinary floats; KDE native select remains TBD. Ours relative F/G activation order and host free-pointer journeys are unresolved; project float resize refuses as NotTiled. Recommendation for batch review: establish KDE native visibility/return, both platforms' relative raise order and host float gestures before proposing behavior changes. No evidenced Ours-vs-strong conflict is established. Explicit layer-bottom lower is weak Q/A 2/2 in one family. Table B grows 18 to 19; U grows 6 to 8 full rows plus two KDE legs; W grows 10 to 11; A20/C17 unchanged.
- Floating verification: 3x14 Then profiles, 10x4 new scrolling assessments and preserved R-FLT-04; original wide rows/pins unchanged. Citation resolution, ASCII, local links, whitespace, pinned-source review and final count verification passed. Source/offline only. Queue adds 43 applicable unresolved cells in 12 groups.
- Close outcome: R-CLOSE-03..05 added as three 14-profile GWT scenarios; R-CLOSE-01/02 assessed for four scrolling profiles, historical rows/pins preserved. Matrix now 99 scenarios. Coverage over 50 cells: E24/P21/T0/Q0/M5. New 42: E20/P17/M5 (original-eight E14/P6/M4; scrolling E6/P5/M1; Ours P6); backfill 8: E4/P4. M includes absent max plus evidenced or unresolved full, not agreeing rejection.
- Close review: sequential implementation and independent source review corrected missing native close verbs, paneru row-0 retention precondition, an imprecise bspwm citation and consensus table continuity. Lead removed incidental unmap/width unknowns, corrected COSMIC's already-detached fullscreen fixture and repaired unsupported manual-width absence claims against PaperWM grid resize, paneru SetWidth and karousel host interactive resize. These failed width-inventory inferences were resolved with positive pinned source; no blocker or product behavior change remains.
- Close consensus: shown-empty retention is strong 7/8 across four families; float close leaves tiles untouched and focuses B in C/B/I/S/Q/A (6/8, four families); full close refills/refocuses A in H/B/I/Q/A (5/8, three families). Ours Engine collapse, exception removal and desired focus are sourced, native close journeys unresolved: no evidenced Ours-vs-strong mismatch. Recommendation for batch review: establish empty-focus, float-focus and overlay cleanup on both platforms before proposing behavior changes. Karousel's middle-column close selects left neighbor A vs niri/PaperWM C; scrolling comparisons remain non-voting. Table U grows 8 to 11 full rows plus two KDE legs; A20/B19/C17/W11 unchanged.
- Close verification: 3x14 Then profiles, 2x4 scrolling assessments, historical rows/pins preserved; citation resolution, local links, ASCII, whitespace and pinned-source review passed. Source/offline only. Queue adds 24 unresolved cells in seven groups. Stop at the close committed boundary because Lead context is crowded after evidence reconciliation.
- Multi-output outcome: R-OUT-03..06 added as four 14-profile GWT scenarios; R-OUT-01/02 assessed for four scrolling profiles, historical rows/pins preserved. Matrix now 103 scenarios. Coverage over 64 cells: E34/P7/T15/Q8/M0. New 56: E28/P7/T15/Q6 (original-eight E20/P5/T7; scrolling E6/T6/Q4; Ours E2/P2/T2/Q2); backfill 8: E6/Q2. Qualified single-screen fixtures and absent explicit send verbs never vote as rejection.
- Multi-output review: implementation Worker resumed to replace inventory-only placeholders, whole-workspace substitutions and incidental geometry TBDs with pinned semantic evidence. Independent source review corrected over-lumped carry/follow votes. Lead found bspwm's direct monitor-destruction helper was not the shipped hotplug journey: remove-unplugged defaults false, same RandR id reuses the retained monitor, and the named true variant merges desktops before removal. Lead corrected that causal path, citation ranges, table/index summaries and niri's incidental attachment TBD; narrow follow-up review passed. Workers ran sequentially; no live tests or product changes.
- Multi-output consensus: exhausted horizontal focus crosses in B/I/X/S/A plus H's sourced cross leg (6/8, three families); Ours crosses to sole X and matches. Explicit output transfer carries in 8/8, with visible follow in declared C/H/B/I/S/Q/A forms (7/8, four families); xmonad keeps the source view. Ours lacks an explicit output-send counterpart. Recommendation for batch review: add an explicit output-send verb through the shared Engine. Focused-output ordinary admission with newcomer focus is strong 7/8 (C/B/I/X/S/Q/A, four families); Ours routing/native activation unresolved. Recommendation: establish Ours admission/hotplug journeys before proposing changes there. niri/PaperWM/paneru directional edge moves stay local; explicit monitor transfers are separate verbs. Table A grows 20 to 21, B19 to 20, U11 to 12 full rows plus two KDE legs; C17/W11 unchanged.
- Multi-output verification: 4x14 new Then profiles, 2x4 scrolling assessments, historical rows/pins preserved; citation resolution, local links, ASCII, whitespace and pinned-source review passed. Source/offline only. Queue adds 22 unresolved cells in five groups. Stop at this area's committed boundary because Lead context is crowded after evidence reconciliation.
- Mouse outcome: R-MOU-01..03 added as three 14-profile GWT scenarios; R-DRAG-01..08 assessed for four scrolling profiles, historical rows/pins preserved. Matrix now 106 scenarios. Coverage over 74 cells: E15/P33/T22/Q1/M3. New 42: E13/P13/T12/Q1/M3 (original-eight E11/P9/T2/Q1/M1; scrolling E2/P4/T4/M2; Ours T6); backfill 32: E2/P20/T10. Mixed cells include evidenced cross-output plus absent switcher targets, not necessarily applicable unknowns.
- Mouse review: initial inventory-heavy draft corrected against actual pinned pointer handlers; independent review corrected unsupported PaperWM click evidence and misleading paneru test claims. Lead positively sourced niri opt-in hover/plain-click delivery and client titlebar/edge requests, corrected PaperWM temporary scratch vs final re-admission, and karousel untile-at-session-start vs zero-motion host initiation. Narrow final independent verification accepted the latest source paths, counts and fixtures. Workers ran sequentially; no live tests or product changes.
- Mouse consensus: plain click focuses B in 8/8 across four original families; Ours host click/hover journeys remain TBD, not generic focus-actuator evidence. No evidenced Ours-vs-strong mismatch. Recommendation for batch review: establish native click/hover, shared-edge shares and cross-output/switcher drops on both platforms before proposing changes. Share-changing edge resize is 4/8 with xmonad no-share counter-vote; no strong choice. niri named hover variant activates without raising; PaperWM viewport modes are not pointer-focus modes; karousel drag untiles at shipped defaults. Table U grows 12 to 13 full rows plus two KDE legs; A21/B20/C17/W11 unchanged.
- Mouse verification: 3x14 Then profiles, 8x4 scrolling assessments, historical rows/pins preserved; citation resolution, local links, ASCII, whitespace and pinned-source review passed. Source/offline only. Queue adds 56 applicable unresolved cells in 11 groups. Stop at the mouse committed boundary because Lead context is crowded after evidence reconciliation.
- Exact next action: expand special windows R-SPC-01..05 as five 14-profile GWT scenarios (no existing rows to backfill); update consensus/live-test queue, verify, then commit/push after git pull --rebase. Continue activation, restart/persistence, then R-COL; collect product differences for batch review.
