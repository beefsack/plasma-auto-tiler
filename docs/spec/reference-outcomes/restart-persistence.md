# Restart / persistence (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. Scenarios below are GWT with one Then bullet per profile (14). Startup-adoption and owner-controls sections preserved as subsections.

## 6. Startup adoption

Column Given bullets are separate fixtures, never H/V ancestry claims. R-START-01..03 assess the original enable-tiling action only; no restart leg is substituted. Where the exact enable toggle has no counterpart the cell is qualified with pinned model/inventory evidence and needs no live test. PaperWM extension enable and karousel script enable over unmanaged free fields count as native enable journeys and are assessed as such; mere owner restart or full session adoption is never substituted. R-CTL-01/02/05/06/07 settings journeys are owner-specific throughout: no first-run/preset/staging model exists in any scrolling inventory, so those cells are qualified owner-specific with pinned inventory evidence and outcome TBD. R-CTL-03 is owner-specific by fixture (Windows TaskbarCreated, owner GUID icon and menu Stop have no constructible counterpart on scrolling hosts). R-CTL-04 uses the established floating-workspace backfill citations: no workspace floating toggle or mode exists to hold a floating default.


### R-START-01: enable over a 2x2 float field

- Given (tree profiles): Tiling off; 2560x1380 work area, gaps 8; A(8,8,1268,678), B(1284,8,1268,678), C(8,694,1268,678), D(1284,694,1268,678); focus A,B,C,D; minima fit

- Given (scrolling): four unmanaged ordinary floats A(8,8,1268,678), B(1284,8,1268,678), C(8,694,1268,678), D(1284,694,1268,678) under the scrolling model at shipped defaults; focus A,B,C,D; viewport recorded. Action: the original enable (extension/script enable over these free fields), then disable/re-enable.

- When: Enable tiling; disable/re-enable

- Observe: Identity/order/topology vs sequential remap; second-enable stability

- Then COSMIC: Fixture focus A->D raises each floater in turn, so D is topmost regardless of map order; enable admits front-to-back (D,C,B,A), each fresh at focus-MRU long-edge anchors. D seeds the root (empty tree, output-dimension fallback); C/B/A each split D's leaf under the frozen MRU: first split side-by-side `H` (`Orientation::Vertical` on the 2544-wide area), then alternating long-edge bisection, so the 2x2 becomes a nested chain. Disable/re-enable roundtrips (tiling order out, reverse-z back in), identity not guaranteed; `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-seq)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)`; realized pixel rects TBD
- Then Hyprland/Dwindle: Unsupported action parameter here: no tiling-off/workspace-enable toggle in source (workspaces always carry both algorithms; admission is per-window Dwindle anchor, no centre-cut inference); 2x2/nested-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-hyp-float)` + `S(S-hyp-ins)`
- Then bspwm: Unsupported action parameter here: no tiling-off/enable toggle in source (desktops always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD; `S(S-bsp-layout)`
- Then i3: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-i3-wsmode)`
- Then xmonad/Tall+Navigation2D: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always tile via layout plus floating layer; admission is per-window `insertUp`, no centre-cut inference); 2x2/nested-chain outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-ins)`
- Then sway: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); 2x2/nested-chain outcome TBD (no built-in equivalent); `S(S-sway-wsmode)`
- Then qtile/Columns: Unsupported action parameter here: no tiling-off/enable toggle in source (Columns always tiles plus a floating layer; admission is per-window at the live focus anchor); 2x2/nested-chain outcome TBD; `S(S-qti-add)` + `S(S-qti-float)`
- Then awesome/tile: Supported as a per-tag layout switch (floating<->tile via layout.set, no global flag): the floating layout arranges nothing, so A/B/C/D keep frames with c.floating unset; re-tile partitions retained global-client order statelessly (nmaster master, rest stack; no rectangle inference), so the 2x2 is not rebuilt as nested splits; re-tile is deterministic recalc over the same order; exact identity order TBD (fixture gives focus order, not manage/swap list order); `S(S-awe-layout)` + `S(S-awe-tile)` + `S(S-awe-float)`
- Then niri: no-counterpart (compositor is always scrolling; the full Action inventory lists no tiling enable/disable verb); 2x2 outcome TBD with no applicable journey. `S(S-nir-acts)`.
- Then PaperWM: extension enable adopts the four free windows through the existing-window path at open position; exact 2x2 order TBD, and second-enable stability TBD (no substituted journey). `S(S-pap-ins)` + `S(S-pap-rst)`; queued.
- Then karousel/Lazy: script enable constructs the World and re-admits the four free windows via addExistingClients as fresh columns; exact order/widths TBD, and second-enable stability TBD. `S(S-kar-ins)` + `S(S-kar-start)`; queued.
- Then paneru: no-counterpart (the Operation inventory lists no tiling enable verb; startup matching is session restore, not enable, and is never substituted here). `S(S-pan-cmds)`.
- Then Ours KDE: Clean/tolerance-valid recursive-cut adoption preserved; `D(D-dec-x)` provisional; exact fixture TBD
- Then Ours Windows: Clean/tolerance-valid recursive-cut adoption preserved; `D(D-dec-x)` provisional; exact fixture TBD
- Variant hook: V-START-SEED.

### R-START-02: enable over a cascade

- Given (tree profiles): Tiling off; 2560x1380 work area, gaps 8; A(80,80,1000,700), B(120,120,1000,700), C(160,160,1000,700), D(200,200,1000,700); focus A,B,C,D; minima 400x200 each

- Given (scrolling): four overlapping unmanaged ordinary floats A(80,80,1000,700), B(120,120,1000,700), C(160,160,1000,700), D(200,200,1000,700) at shipped defaults; focus A,B,C,D; viewport recorded. Action: the original enable over these free fields.

- When: Enable tiling

- Observe: Centre-cut inference vs long-edge seed; final axes and identity order

- Then COSMIC: No centre-cut inference in source. Same mechanism: focus raises make D topmost and MRU, so D seeds the root and C/B/A each split D's leaf at its long edge (frozen MRU), yielding a nested bisection chain, not a 2x2; `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-last)` + `S(S-cos-axis)` + `S(S-cos-newgroup)`; exact axes/rects TBD
- Then Hyprland/Dwindle: Unsupported enable action as above (no tiling-off toggle; per-window Dwindle anchor, no centre-cut inference); cascade-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-hyp-float)` + `S(S-hyp-ins)`
- Then bspwm: Unsupported action parameter here: no tiling-off/enable toggle in source (desktops always lay out tiles; float is per-window); cascade-chain outcome TBD; `S(S-bsp-layout)`
- Then i3: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); cascade-chain outcome TBD (no built-in equivalent for the enable toggle); `S(S-i3-wsmode)`
- Then xmonad/Tall+Navigation2D: Unsupported enable action as above (no tiling-off toggle; per-window `insertUp` anchor, no centre-cut inference); cascade-chain outcome TBD; `S(S-xmo-layout)` + `S(S-xmo-ins)`
- Then sway: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); cascade-chain outcome TBD (no built-in equivalent); `S(S-sway-wsmode)`
- Then qtile/Columns: Unsupported enable action as above (no tiling-off toggle; per-window anchor, no centre-cut inference); cascade-chain outcome TBD; `S(S-qti-add)`
- Then awesome/tile: Same per-tag switch mechanism (no centre-cut inference): the floating layout holds the cascade frames with c.floating unset; re-tile partitions retained global-client order by master/stack shares, not a nested bisection chain; exact axes/identity order TBD; `S(S-awe-layout)` + `S(S-awe-tile)`
- Then niri: no-counterpart (no tiling enable/disable verb in the full Action inventory); cascade outcome TBD with no applicable journey. `S(S-nir-acts)`.
- Then PaperWM: extension enable adopts the four free windows through the existing-window path; no centre-cut inference established; exact order TBD. `S(S-pap-ins)` + `S(S-pap-rst)`; queued.
- Then karousel/Lazy: script enable re-admits the four free windows via addExistingClients as fresh columns; cascade-chain outcome TBD. `S(S-kar-ins)` + `S(S-kar-start)`; queued.
- Then paneru: no-counterpart (no tiling enable verb; startup matching is session restore, never substituted). `S(S-pan-cmds)`.
- Then Ours KDE: Decline centre splits to deterministic long-edge bisection chain, not guaranteed 2x2; `D(D-place)` provisional, shared KDE+Windows; exact fixture TBD
- Then Ours Windows: Decline centre splits to deterministic long-edge bisection chain, not guaranteed 2x2; `D(D-place)` provisional, shared KDE+Windows; exact fixture TBD
- Variant hook: V-START-SEED.

### R-START-03: enable with infeasible minima

- Given (tree profiles): As START-02 plus E(240,240,1000,700); A/B/C minima 401x246, D(Paint) 864x617, E(Calc) 402x627; focus A,B,C,E,D; usable inner 2544x1364, gap 8

- Given (scrolling): the R-START-02 cascade plus E(240,240,1000,700) with A/B/C minima 401x246, D(Paint) 864x617, E(Calc) 402x627 at shipped defaults; focus A,B,C,E,D; viewport recorded. Action: the original enable over these free fields.

- When: Enable tiling

- Observe: Feasibility fallback, skipped/floated/clamped writes, final origins, overlap/overflow

- Then COSMIC: Same admission mechanism (focus raises make D topmost/MRU, admitted first); tiling allocation/cropping ignores minima and admission maps once at the resolved anchor with no alternative search; fixed-size (min==max) admits floating instead. Whether native clients overlap, overflow, clamp, or misrender in response is not established by allocation source; `S(S-cos-min)` + `S(S-cos-wstile)` + `S(S-cos-raise)` + `S(S-cos-axis)`; exact origins/frames/response TBD
- Then Hyprland/Dwindle: Unsupported enable action as above; tiled limits default off (unclamped, no auto-float) but the admission anchor for this fixture is unevidenced; exact origins/frames TBD; `S(S-hyp-float)` + `S(S-hyp-min)` + `S(S-hyp-ins)`
- Then bspwm: Unsupported enable action as in START-01/02 (no tiling-off toggle; desktops always lay out tiles, float is per-window); hints off by default (opt-in leaf clamp on every reflow); exact origins/frames/fence wiring TBD; `S(S-bsp-layout)` + `S(S-bsp-hint)` + `S(S-bsp-min)`
- Then i3: Unsupported action parameter here: no tiling-off/enable toggle in source (workspaces always lay out tiles; float is per-window); tiled render ignores size hints while float clamps, exact origins/frames TBD; `S(S-i3-wsmode)` + `S(S-i3-min)`
- Then xmonad/Tall+Navigation2D: Unsupported enable parameter as above (no tiling-off toggle); Tall sizing is unconditional (no minimum clamp in the tile path; fixed-size floats separately); exact origins/frames TBD; `S(S-xmo-layout)` + `S(S-xmo-admit)`
- Then sway: Unsupported enable parameter as above (no tiling-off toggle); tiled arrange ignores client hints (fraction normalize + 10px zeroing bound; `MIN_SANE` 100x60 gap-reservation only, no hint consult) while float clamp is config min/max (client hints on floating resize only); fixed-size min==max admits floating instead; exact origins/frames TBD; `S(S-sway-wsmode)` + `S(S-sway-min)` + `S(S-sway-max)`
- Then qtile/Columns: Unsupported enable action as above; exact origins/frames TBD (tiled size-hint handling unevidenced in the inspected path); `S(S-qti-add)` + `S(S-qti-float)`
- Then awesome/tile: Same per-tag switch; on re-tile the tile consults size hints when arranging and fixed-size floats instead (MIN policy), explicit floats preserved; exact origins/frames/response TBD; `S(S-awe-layout)` + `S(S-awe-tile)` + `S(S-awe-float)`
- Then niri: no-counterpart (no tiling enable/disable verb in the full Action inventory); minimum handling TBD with no applicable journey. `S(S-nir-acts)`.
- Then PaperWM: extension enable adopts the five free windows through the existing-window path; minimum handling and exact origins TBD. `S(S-pap-ins)` + `S(S-pap-rst)`; queued.
- Then karousel/Lazy: script enable re-admits the five free windows via addExistingClients; minimum handling and exact origins TBD. `S(S-kar-ins)` + `S(S-kar-start)`; queued.
- Then paneru: no-counterpart (no tiling enable verb; startup matching is session restore, never substituted). `S(S-pan-cmds)`.
- Then Ours KDE: KDE still skips; `D(D-place)` provisional divergence; exact fixture TBD
- Then Ours Windows: tile origin, extent at least declared minimum (overlap/overflow possible); `D(D-place)` + `D(D-dec-win)` provisional divergence; exact fixture TBD
- Variant hook: V-START-MIN.

## 11. Owner controls and startup settings

### R-CTL-01: first-run preset choice

- Given: Windows settings absent

- Given (scrolling): owner settings absent; shipped profile defaults apply. The prompt/preset journey is the same owner-specific fixture as this scenario.

- When: Start owner; choose Compatible; stop; restart

- Observe: Preset persists; first-run prompt does not recur

- Then COSMIC: Not applicable to the pinned compositor source: no first-run prompt or preset writer in cosmic-comp; tiling default is the `autotile` config key (`S(S-cos-ctl-tile)`); preset/prompt journey TBD (owner-specific)
- Then Hyprland/Dwindle: No counterpart in source: dispatcher inventory at pin lists no first-run/preset/prompt actions; outcome TBD (owner-specific); `S(S-hyp-shortcut)`
- Then bspwm: No counterpart in source: wm command inventory lists dump/load-state/add-monitor/reorder-monitors/adopt-orphans/get-status/record-history/restart only, no first-run/preset/prompt writer; outcome TBD (owner-specific); `S(S-bsp-ctl)`
- Then i3: No Compatible preset/prompt model in inspected source: closest writer `i3-config-wizard` exits when a config exists (no overwrite, fresh-write only); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-i3-wiz)`
- Then xmonad/Tall+Navigation2D: No counterpart in source: key inventory at pin lists spawn/kill/layout/focus/swap/sink/quit/restart only, no first-run/preset/prompt writer; preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-xmo-ctl)`
- Then sway: No counterpart in source: command inventory at pin lists `reload`/`exit`/`bindsym`/`bindcode`/`unbindsym`/`unbindcode` but no first-run/preset/prompt actions and no `restart` verb (in-place reload only); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-sway-reload)` + `S(S-sway-bind)`
- Then qtile/Columns: No counterpart in source: no first-run prompt or preset writer (static Keys/config loaded at startup; restart only dumps group/layout/screen state, reload rebuilds from config); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-qti-keys)` + `S(S-qti-state)`
- Then awesome/tile: No counterpart in source: no first-run prompt or Compatible preset writer in the inspected inventory (static keys/config; restart is in-place awesome.restart preserving client order, tags recreated from rc); preset choice/restart persistence TBD (owner-specific, no counterpart); `S(S-awe-ctl)` + `S(S-awe-keys)`
- Then niri: owner-specific (no first-run/preset/prompt writer in the full Action inventory); outcome TBD. `S(S-nir-acts)`.
- Then PaperWM: owner-specific (no first-run/preset/prompt writer in the inspected keybinding inventory); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (no first-run/preset/prompt writer in the inspected Actions inventory); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no first-run/preset/prompt Operation in the command inventory); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: KDE first-run TBD
- Then Ours Windows: authentic default offered, compatible saves 35 disabled rows; existing-file startup skips prompt; synthetic/native proof [tray record](../../changes/archive/windows-tray-first-run.md)
- Variant hook: V-FIRST-RUN.

### R-CTL-02: stale prompt choice

- Given: Owner's first-run prompt open, settings absent

- Given (scrolling): owner first-run prompt open with settings published by another writer; shipped profile defaults apply. Same owner-specific fixture as this scenario.

- When: Publish settings from another writer; accept stale prompt choice

- Observe: Preserve newer settings vs overwrite

- Then COSMIC: Not applicable to the pinned compositor source: no prompt/settings-race UI in cosmic-comp; `system_actions`/shortcut maps merge system then user config (`S(S-cos-syscmd)`); stale-choice outcome TBD (owner-specific)
- Then Hyprland/Dwindle: No counterpart in source: no prompt/settings-race UI or stale-choice path; outcome TBD (owner-specific); `S(S-hyp-shortcut)`
- Then bspwm: No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-bsp-ctl)`
- Then i3: No settings-race/stale-choice path in inspected source: wizard guard exits on existing config without comparing writers; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-i3-wiz)`
- Then xmonad/Tall+Navigation2D: No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected key inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-xmo-ctl)`
- Then sway: No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected command/config inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-sway-reload)` + `S(S-sway-bind)`
- Then qtile/Columns: No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected key/config inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-qti-keys)`
- Then awesome/tile: No counterpart in source: no prompt/settings-race UI or stale-choice path in the inspected inventory; stale-choice preserve/overwrite TBD (owner-specific, no counterpart); `S(S-awe-ctl)`
- Then niri: owner-specific (no prompt/settings-race path in the full Action inventory); outcome TBD. `S(S-nir-acts)`.
- Then PaperWM: owner-specific (no prompt/settings-race path in the inspected keybinding inventory); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (no prompt/settings-race path in the inspected Actions inventory); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no prompt/settings-race Operation in the command inventory); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: Windows: discard stale choice, load authoritative file, bytes unchanged; same record; other platforms TBD
- Then Ours Windows: Windows: discard stale choice, load authoritative file, bytes unchanged; same record; other platforms TBD
- Variant hook: V-FIRST-RUN.

### R-CTL-03: notification icon lifecycle

- Given: Running owner with notification icon

- Given (scrolling): running owner with notification icon under the scrolling host; shipped profile defaults apply. Same owner-specific fixture as this scenario: Windows TaskbarCreated re-registration, one owner GUID icon, and menu Stop.

- When: Lose icon registration; post TaskbarCreated; stop from menu

- Observe: Exactly one icon returns; Stop removes icon and owner effects

- Then COSMIC: Not applicable to the pinned compositor source: no tray icon lifecycle in cosmic-comp; outcome TBD (owner-specific)
- Then Hyprland/Dwindle: No counterpart in source: no tray icon lifecycle (only unrelated xwayland tray atoms); outcome TBD (owner-specific); `S(S-hyp-shortcut)`
- Then bspwm: No counterpart in source: no tray icon lifecycle in the inspected inventory (wm verbs as in CTL-01); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-bsp-ctl)`
- Then i3: No owner notification-icon lifecycle in inspected source: tray inventory is bar-hosted XEMBED (`tray_output`/`tray_padding`, selection window, trayclients); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-i3-tray)`
- Then xmonad/Tall+Navigation2D: No counterpart in source: no tray icon lifecycle in the inspected key/mouse inventory; single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-xmo-ctl)`
- Then sway: No owner notification-icon lifecycle in inspected source: tray inventory is bar-hosted (`tray_output`/`tray_padding`/`tray_bindcode`/`tray_bindsym`, `HAVE_TRAY`); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-sway-tray)`
- Then qtile/Columns: No owner notification-icon lifecycle in inspected source: tray inventory is the bar-hosted X11-only Systray widget (hosts client icons); single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-qti-tray)`
- Then awesome/tile: No owner notification-icon lifecycle in inspected source: tray inventory is the bar-hosted wibox.widget.systray hosting client icons, not an owner icon; single-icon return/Stop cleanup TBD (owner-specific, no counterpart); `S(S-awe-ctl)`
- Then niri: owner-specific by fixture (TaskbarCreated, owner GUID icon and menu Stop are Windows-owner objects with no constructible counterpart on this host); outcome TBD. `D(D-tray-task)`.
- Then PaperWM: owner-specific by fixture (same Windows-owner objects; no scrolling-host counterpart assessed); outcome TBD. `D(D-tray-task)`.
- Then karousel/Lazy: owner-specific by fixture (same Windows-owner objects; no scrolling-host counterpart assessed); outcome TBD. `D(D-tray-task)`.
- Then paneru: owner-specific by fixture (same Windows-owner objects; no scrolling-host counterpart assessed); outcome TBD. `D(D-tray-task)`.
- Then Ours KDE: KDE lifecycle is separate
- Then Ours Windows: GUID-delete fixture then posted message re-adds one icon; actual menu Stop cleans up; same record. Real Explorer restart TBD
- Variant hook: V-TRAY-LIFECYCLE.

### R-CTL-04: workspace tiling default

- Given: Existing tiled workspace, new-workspace default Tiled

- Given (scrolling): existing tiled columns plus a saved floating default for new workspaces; shipped profile defaults apply. Same owner-specific fixture as this scenario.

- When: Save Floating default; create new workspace; restart owner

- Observe: Existing override stays, new workspace floating, startup saved default

- Then COSMIC: Tiling default is the `autotile` config: new workspaces inherit the set's `tiling_enabled`; `Global` behavior retoggles existing workspaces, `PerWorkspace` applies to new windows/workspaces only; `S(S-cos-ctl-tile)`; saved-default restart journey and per-workspace override persistence TBD
- Then Hyprland/Dwindle: Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; workspace rules carry no tiling default); new workspaces admit per-window, existing overrides N/A; saved-default restart journey TBD (owner-specific); `S(S-hyp-wsrule)`
- Then bspwm: Unsupported action parameter here: no workspace tiling flag or floating default in source (desktop layout tiled/monocle only; float is per-window); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-bsp-layout)` + `S(S-bsp-ctl)`
- Then i3: Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; `workspace_layout` default/stacked/tabbed only); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-i3-wsmode)`
- Then xmonad/Tall+Navigation2D: Unsupported action parameter here: no workspace tiling flag or floating default in source (layout always tiles plus a floating layer; float is per-window); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-xmo-layout)` + `S(S-xmo-ctl)`
- Then sway: Unsupported action parameter here: no workspace tiling flag or floating default in source (float is per-window; `workspace_layout` default/stacked/tabbed only); new-workspace/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-sway-wsmode)`
- Then qtile/Columns: Unsupported action parameter here: no per-group tiling flag or floating default in source (static groups, one global floating_layout, float is per-window); new-group/existing-override/saved-default restart TBD (no built-in equivalent); `S(S-qti-wsdef)`
- Then awesome/tile: Unsupported action parameters here: layout is per-tag (set/inc, no global tiling flag or floating-default writer); tags are static 1-9 with rc initial floating (layouts[1]); new-workspace/create and saved-default writers have no counterpart, and restart recreates tags from rc (only floating property plus client order persist); existing-override/new-floating/saved-default restart TBD; `S(S-awe-layout)` + `S(S-awe-default)` + `S(S-awe-ctl)`
- Then niri: owner-specific (no workspace floating toggle or mode exists to hold the default; `ToggleWindowFloating` is per-window only); outcome TBD. `S(S-nir-float)`.
- Then PaperWM: owner-specific (no floating workspace mode and no workspace toggle in the registered action inventory to hold the default); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (float is per-window only with no floating desktop mode to hold the default); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no floating workspace mode; `Manage` is per-window); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: selected `D(D-dec-ww)`, default live proof TBD
- Then Ours Windows: tray/UI file readbacks, owner adoption, existing tiled/new floating checks and saved-default startup native proof [record](../../changes/archive/windows-workspace-tiling.md); physical restart journey TBD
- Variant hook: V-WS-TILING.

### R-CTL-05: shortcut staging and apply

- Given: KDE focus-right kept; Lock Session on Meta+L

- Given (scrolling): staged Compatible choice with native shortcut state present; shipped profile defaults apply. Same owner-specific fixture as this scenario.

- When: Stage Compatible; ordinary settings Save; Apply Shortcuts; reopen; restart session

- Observe: Staging/Save leave shortcuts untouched; Disable survives; Lock Session unchanged

- Then COSMIC: Closest COSMIC equivalent: shortcut state is system `defaults` plus user `custom`, `Disable` masks a default binding, and the compositor hot-reloads on config change; there is no staging/Compatible/Force model in the sourced components, so Save/Apply/restart semantics have no counterpart here; `S(S-cos-shortcut)`; owner-specific outcome TBD
- Then Hyprland/Dwindle: Closest Hyprland equivalent: conflict lookup plus `unbind` exist, but no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-hyp-shortcut)`
- Then bspwm: Closest bspwm equivalent: node `-t` state (incl `~` alternate) and `-g` flags exist, but no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-bsp-ctl)`
- Then i3: Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`, applied on reload/restart; no Compatible staging/Save/Apply/Force model in the inspected command/config inventory, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-i3-bind)`
- Then xmonad/Tall+Navigation2D: Closest xmonad equivalent: keys/mouseBindings define bindings applied on restart/recompile; no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-xmo-ctl)`
- Then sway: Closest sway equivalent: `bindsym`/`bindcode` defines bindings, applied on reload; no Compatible staging/Save/Apply/Force model in the inspected command inventory, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-sway-bind)` + `S(S-sway-reload)`
- Then qtile/Columns: Closest qtile equivalent: static Key bindings grabbed at startup and re-grabbed on reload (ungrab/clear/regrab, no staging/Compatible/Apply/Force model); Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-qti-keys)`
- Then awesome/tile: Closest awesome equivalent: global/client keys defined via append keybindings applied on restart/reload; no Compatible staging/Save/Apply/Force model in source, so Save/Apply/restart semantics have no counterpart here; owner-specific outcome TBD; `S(S-awe-keys)` + `S(S-awe-ctl)`
- Then niri: owner-specific (no staging/Compatible/Apply model in the full Action inventory); outcome TBD. `S(S-nir-acts)`.
- Then PaperWM: owner-specific (no staging/Compatible/Apply model in the inspected inventory); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (no staging/Compatible/Apply model in the inspected Actions inventory); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no staging/Compatible/Apply model in the command inventory); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: KDE selected: explicit own-action clear, native storage authoritative, no Lock relocation while disabled; live restart/physical delivery TBD [record](../../changes/kde-shortcut-conflicts.md)
- Then Ours Windows: KDE selected: explicit own-action clear, native storage authoritative, no Lock relocation while disabled; live restart/physical delivery TBD [record](../../changes/kde-shortcut-conflicts.md)
- Variant hook: V-SHORTCUT-CONFLICT.

### R-CTL-06: conflict preview and disable

- Given: KDE foreign action has a project chord plus an unrelated chord

- Given (scrolling): conflicting shortcut row with preview/Force semantics; shipped profile defaults apply. Same owner-specific fixture as this scenario.

- When: Keep conflicting row; Apply; preview Force; edit row to Disable; try Force; Apply

- Observe: Draft edit invalidates preview; disabled row causes no foreign clearing; unrelated chord survives

- Then COSMIC: Closest COSMIC equivalent: writing `Disable` for one binding in `custom` masks only that default while unrelated chords keep resolving from `defaults`; there is no preview/Force step in the sourced components; `S(S-cos-shortcut)`; owner-specific outcome TBD
- Then Hyprland/Dwindle: Closest Hyprland equivalent: conflict lookup plus `unbind` exist, but no preview/Force/draft step in source; owner-specific outcome TBD; `S(S-hyp-shortcut)`
- Then bspwm: Closest bspwm equivalent: node `-t`/`-g` exist, but no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-bsp-ctl)`
- Then i3: Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-i3-bind)`
- Then xmonad/Tall+Navigation2D: Closest xmonad equivalent: `keys` defines bindings; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-xmo-ctl)`
- Then sway: Closest sway equivalent: `bindsym`/`bindcode` defines bindings, `unbindsym`/`unbindcode` removes; no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-sway-bind)`
- Then qtile/Columns: Closest qtile equivalent: Key definitions only, no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-qti-keys)`
- Then awesome/tile: Closest awesome equivalent: key definitions only, no preview/Force/draft/Disable-masking model in the inspected inventory; draft/Disable/unrelated-chord outcome TBD (owner-specific, no counterpart); `S(S-awe-keys)`
- Then niri: owner-specific (no preview/Force/draft model in the full Action inventory); outcome TBD. `S(S-nir-acts)`.
- Then PaperWM: owner-specific (no preview/Force/draft model in the inspected inventory); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (no preview/Force/draft model in the inspected Actions inventory); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no preview/Force/draft model in the command inventory); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: KDE selected: exact draft/owner/presence/active-image revalidation, no disabled-key holder mutation; live outcome TBD [record](../../changes/kde-shortcut-conflicts.md)
- Then Ours Windows: KDE selected: exact draft/owner/presence/active-image revalidation, no disabled-key holder mutation; live outcome TBD [record](../../changes/kde-shortcut-conflicts.md)
- Variant hook: V-SHORTCUT-CONFLICT.

### R-CTL-07: revert restores defaults

- Given: KDE Force previously cleared a noncompiled foreign default chord

- Given (scrolling): previously cleared foreign default chord with staged Compatible choice; shipped profile defaults apply. Same owner-specific fixture as this scenario.

- When: Stage Compatible; Apply; Revert Shortcuts

- Observe: Default conflict still disabled; no automatic restore; separate Revert restores foreign defaults and retains own Disable

- Then COSMIC: Closest COSMIC equivalent: removing a `custom` entry re-exposes the system default (no separate restore action in the sourced components); there is no preimage/automatic-restore model here; `S(S-cos-shortcut)`; owner-specific outcome TBD
- Then Hyprland/Dwindle: Closest Hyprland equivalent: `unbind`/conflict lookup exist, but no preimage/automatic-restore or separate Revert model in source; owner-specific outcome TBD; `S(S-hyp-shortcut)`
- Then bspwm: Closest bspwm equivalent: node `-t`/`-g` exist, but no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-bsp-ctl)`
- Then i3: Closest i3 equivalent: `bindsym`/`bindcode` defines bindings via `configure_binding`; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-i3-bind)`
- Then xmonad/Tall+Navigation2D: Closest xmonad equivalent: `keys` defines bindings; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-xmo-ctl)`
- Then sway: Closest sway equivalent: `bindsym`/`bindcode` plus `unbindsym`/`unbindcode`; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-sway-bind)`
- Then qtile/Columns: Closest qtile equivalent: Key definitions only; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-qti-keys)`
- Then awesome/tile: Closest awesome equivalent: key definitions only; no preimage/automatic-restore or separate Revert model in the inspected inventory; default-conflict restore outcome TBD (owner-specific, no counterpart); `S(S-awe-keys)`
- Then niri: owner-specific (no preimage/restore model in the full Action inventory); outcome TBD. `S(S-nir-acts)`.
- Then PaperWM: owner-specific (no preimage/restore model in the inspected inventory); outcome TBD. `S(S-pap-acts)`.
- Then karousel/Lazy: owner-specific (no preimage/restore model in the inspected Actions inventory); outcome TBD. `S(S-kar-acts)`.
- Then paneru: owner-specific (no preimage/restore model in the command inventory); outcome TBD. `S(S-pan-cmds)`.
- Then Ours KDE: KDE selected: compiled plus discovered defaults/current holders; Revert remains default restoration, not preimage recovery; live outcome TBD [record](../../changes/kde-shortcut-conflicts.md)
- Then Ours Windows: KDE selected: compiled plus discovered defaults/current holders; Revert remains default restoration, not preimage recovery; live outcome TBD [record](../../changes/kde-shortcut-conflicts.md)
- Variant hook: V-SHORTCUT-CONFLICT.

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the index. Each scenario below has exactly one Then bullet per profile (14). `S()` tags attach only to the established sub-leg; anything else on that line stays TBD. Column Given bullets are separate fixtures, never H/V ancestry claims. Ours cells cite Engine + adapter source at `6da3d86` plus the new `S(S-ours-kde-rst)` / `S(S-ours-win-rst)` platform keys; selected intent and doc assertions are never evidence.

Restart journeys (config reload is not owner restart):

- COSMIC: client-preserving native journey unestablished; pinned workspace config alone is not restart evidence (`S(S-cos-persist)`).
- Hyprland/sway/niri: reload and exit inventories provide no native client-preserving re-exec (`S(S-hyp-reload)` + `S(S-hyp-shortcut)` + `S(S-sway-reload)` + `S(S-nir-rst)`).
- bspwm: `wm -r` dumps and re-execs with restore (`S(S-bsp-restore)`).
- i3: `restart` saves the layout and re-execs with `--restart` (`S(S-i3-restart)`).
- xmonad: `restart prog True` writes and resumes the windowset; `False` is a separate fresh-start variant (`S(S-xmo-restart)`).
- qtile: `restart` saves metadata on X11; Wayland disables restart support (`S(S-qti-state)`).
- awesome: `awesome.restart()` re-execs, saving order and floating state (`S(S-awe-ctl)`).
- PaperWM/karousel: disable+enable the extension/script with the host session retained (`S(S-pap-rst)` + `S(S-kar-start)`).
- paneru: orderly daemon exit/relaunch; AppExit saves the state and startup loads it for grace-windowed matching (`S(S-pan-rst)`).
- Ours KDE: script stop/start, with a fresh observation and intentional-float id set (`S(S-ours-kde-rst)`).
- Ours Windows: orderly `tile` stop/start; standalone `restore` is a separate journey (`S(S-ours-win-rst)`).

### R-RST-01: orderly owner restart with apps kept alive

- Given (tree profiles): `WS1=H[A,B*]` 70/30, `WS2=H[C]`, ordinary float F on WS1. Ordinary windows, no rules, scale 1.
- Given (column profiles): `WS1=COL[C1[A],C2[B*]]` with 70/30 widths, `WS2=COL[C3[C]]`, ordinary float F on WS1; shipped defaults apply; viewport recorded.
- Given (paneru): `Space1:{VW1=COL[C1[A],C2[B*]],VW2=COL[C3[C]]}` with 70/30 widths plus ordinary F on VW1; shipped defaults apply.
- When: orderly owner restart with apps kept alive, using the profile's native journey from the inventory above (plain config reload is explicitly not this journey).
- Observe: layout/ratios/workspaces/float/focus recovered vs fresh adoption.
- Then COSMIC: no client-preserving re-exec contract found at pin (persist covers pinned workspaces only); whether an orderly restart keeps apps alive with layout is TBD. `S(S-cos-persist)`; queued.
- Then Hyprland/Dwindle: no-counterpart for this owner restart with clients alive (no re-exec verb in the dispatcher inventory; reload keeps the live tree only and exit stops the compositor). `S(S-hyp-reload)` + `S(S-hyp-shortcut)`.
- Then bspwm: 70/30 ratios, WS1/WS2 membership, F float frame, sticky flags and B focus all recovered (split ratios, focused node, history/stack and float rectangles round-trip the dump). `S(S-bsp-restore)`.
- Then i3: 70/30 percents, WS1/WS2 membership, F floating frame and B focus all recovered (percents, focused flag with focus activation, and floating geometry round-trip the layout file). `S(S-i3-restart)`.
- Then xmonad/Tall+Navigation2D: window order, floating map, layout ratio and stack focus all resumed from the file with Tall rendering recalculated. `S(S-xmo-restart)`.
- Then sway: no-counterpart for this owner restart with clients alive (command inventory carries `reload` and `exit` with no restart verb; reload is in-place config only). `S(S-sway-reload)`.
- Then qtile/Columns: group/layout names, screen assignment and current screen restored while widths reset to config and windows re-admit; exact window placement, F handling and focus TBD. `S(S-qti-state)` + `S(S-qti-reload)`; queued.
- Then awesome/tile: client order and floating state restored with tags recreated from rc so tile shares recalculate at mwfact; exact frames and B focus TBD. `S(S-awe-ctl)`; queued.
- Then niri: no-counterpart for this owner restart with layout recovery (Quit exits and LoadConfigFile reloads config only; no layout dump or re-exec verb). `S(S-nir-rst)`.
- Then PaperWM: controlled disable+enable stages SaveState and re-adds existing windows with prevSpace layout restored where present; exact widths, F placement and B selection TBD. `S(S-pap-rst)`; queued.
- Then karousel/Lazy: no layout restore exists (live-only Grid state); script disable+enable re-admits existing windows via addClient as fresh columns; exact order/widths/focus TBD. `S(S-kar-rst)` + `S(S-kar-start)`; queued.
- Then paneru: startup windows match SessionRestore within grace from the durable state file; exact strips/widths, F handling and focus TBD. `S(S-pan-rst)`; queued.
- Then Ours KDE: freshly re-observes/adopts windows; intentional F loses its ordinary-float status because its id set resets. Native sticky/overlay flags remain observed; restored memberships and native focus TBD. `S(S-ours-kde-rst)`; queued.
- Then Ours Windows: freshly observes/adopts windows; intentional F loses its ordinary-float status because its runtime store resets. Settings persist but do not restore the layout; restored memberships and native focus TBD. `S(S-ours-win-rst)`; queued.
- Variant hook: provisional/TBD (restart recovery hook, to discuss).

### R-RST-02: end session, restore session and apps

- Given (tree profiles): saved session with A/B tiled, ordinary F and `B:max` across WS1/WS2. Ordinary windows, no rules, scale 1.
- Given (column profiles): saved session with A/B columns, ordinary F and a maximized column member across WS1/WS2; shipped defaults apply; viewport recorded.
- Given (paneru): saved `Space1:{VW1,VW2}` session with A/B columns, ordinary F and a host-zoomed member; shipped defaults apply.
- Max prep: B enters through the profile-native route named here (maximize where the model owns one, host zoom or width conversion where that is the native form, fullscreen where the profile is maximize-stateless); maximize-stateless profiles run the max leg as a fresh `B:full` journey. Prep citations establish the route only, never the post-session outcome: COSMIC `maximize_request` (`S(S-cos-maxpolicy)`); Hyprland `MAXIMIZED` (`S(S-hyp-fs)`); bspwm none, EWMH fullscreen ADD/REMOVE/TOGGLE (`S(S-bsp-fs)`); i3 none, client FULLSCREEN message (`S(S-i3-max)` + `S(S-i3-fs)`); xmonad none, `fullscreenEventHook` (`S(S-xmo-layout)` + `S(S-xmo-ewmh)`); sway none, workspace/global fullscreen (`S(S-sway-max)` + `S(S-sway-full)`); qtile maximized float state (`S(S-qti-fs)`); awesome maximized boolean (`S(S-awe-fs)`); niri maximized flag (`S(S-nir-maxfs)`); PaperWM width conversion plus fullscreen re-show (`S(S-pap-widthmax)`); karousel host-driven maximize observation (`S(S-kar-maxfs)`); paneru host zoom plus AX fullscreen marker (`S(S-pan-axfs)`); Ours host-owned maximize classification (KDE exceptions, Windows retained).
- When: end session; restore session and apps (session manager plus apps participate; native IDs are replaced and startup order may differ).
- Observe: layout/workspace/native state persisted vs apps freshly admitted.
- Then COSMIC: pinned workspaces are recreated from config; app-window placement and overlay state after session restore TBD. `S(S-cos-persist)`; queued.
- Then Hyprland/Dwindle: post-session app and layout recovery TBD (session manager plus app relaunch order untraced at pin); queued.
- Then bspwm: no maximize state exists, so the max leg runs as a fresh `B:full` EWMH journey; the dump file persists but old-ID rematch across sessions is untraced, so session restore is TBD. `S(S-bsp-fs)` + `S(S-bsp-restore)`; queued (full leg).
- Then i3: no maximize verb exists, so the max leg runs as a fresh `B:full` client-message journey; the layout file path covers in-place restart only and fresh-login consumption is untraced, so session restore is TBD. `S(S-i3-max)` + `S(S-i3-fs)` + `S(S-i3-restart)`; queued (full leg).
- Then xmonad/Tall+Navigation2D: no maximize state exists, so the max leg runs as a fresh `B:full` event-hook journey; StateFile freshness past its resume-only read is untraced, so session restore is TBD. `S(S-xmo-layout)` + `S(S-xmo-ewmh)` + `S(S-xmo-restart)`; queued (full leg).
- Then sway: no maximize verb exists, so the max leg runs as a fresh `B:full` journey; no restart or session-restore path is established, so session restore is TBD. `S(S-sway-max)` + `S(S-sway-full)` + `S(S-sway-reload)`; queued (full leg).
- Then qtile/Columns: restart state covers in-place restart only; post-session group/window recovery TBD (session wiring untraced at pin). `S(S-qti-state)`; queued.
- Then awesome/tile: atexit order covers hard restarts within the X session; post-session membership and layout recovery TBD (session wiring untraced at pin). `S(S-awe-ctl)`; queued.
- Then niri: Quit plus config reload cover the running session only; post-session app and layout recovery TBD (session wiring untraced at pin). `S(S-nir-rst)`; queued.
- Then PaperWM: SaveState covers controlled restarts only; ended-session topology recovery TBD (session wiring untraced at pin). `S(S-pap-rst)`; queued.
- Then karousel/Lazy: Actions plus live Grid cover the running session only; post-session app and layout recovery TBD (session wiring untraced at pin). `S(S-kar-rst)`; queued.
- Then paneru: strip/column metadata persists in the state file; cross-session window-identity rematch, host-zoom state and resulting layout are TBD. Host zoom remains an applicable host-owned state. `S(S-pan-rst)`; queued.
- Then Ours KDE: host-maximized members classify as tile exceptions while settings/gaps restore at startup; windows freshly re-admit and host-max restore is TBD. `S(S-ours-kde-rst)`; queued.
- Then Ours Windows: the settings file carries gaps/preset durably while the ledger is runtime with explicit standalone restore; restart freshly observes and host-max restore is TBD. `S(S-ours-win-rst)`; queued.
- Variant hook: provisional/TBD (session restore hook, to discuss).
