# Activation (reference outcomes)

Part of the [outcome matrix index](../reference-outcomes.md). Notation, profiles, evidence legend, and variant hooks live in the index; `S()`/`D()` keys below resolve there. No existing activation rows to backfill (0 existing rows, 0 cells). R-WS-07 is user-selected shell activation, not an application's unsolicited request, and is reused by citation only.

## New scenarios (GWT; fixtures/actions/discriminators per the approved expansion record)

Notation, profiles, baselines, legend, and projection rules live in the
index. Each scenario below has exactly one Then bullet per profile (14).
`S()` tags attach only to the established sub-leg; anything else on that
line stays TBD. Column Given bullets are separate fixtures, never H/V
ancestry claims. Ours cells cite current actual Engine + adapter source
at `29bc4d9` via the new `S(S-ours-act)` model key; selected intent and
doc assertions are never evidence. Generic focus actuators (directional
focus ops, shell-selected activation) are never request evidence; only
the native activation/urgency handler paths below count.

Request/urgency handler inventory (one path per profile; each When below
uses the profile's native request route, no forced kill, no shell
switcher): COSMIC xdg-activation token/context branches (ordinary
unsandboxed clients get Workspace tokens; sandboxed serial-less tokens
are urgency-only and stale-serial tokens are denied at creation);
Hyprland `CWindow::activate` reached both by the X11
`onActivationRequest` path and the Wayland xdg-activation dispatch;
bspwm `_NET_ACTIVE_WINDOW` client message plus hint-urgency flags; i3
`_NET_ACTIVE_WINDOW`/configure handlers plus urgency client messages;
xmonad EwmhDesktops `_NET_ACTIVE_WINDOW` via the default `doFocus`
activate hook (`doAskUrgent` is an opt-in alternative; native hint
handling untraced); sway xdg-activation plus `focus_on_window_activation`
policy (tokens from a focus-less client mark urgent); qtile X11
urgency hints plus focus-time clear; awesome `request::activate`
filter plus `request::urgent` handler; niri `request_activation`
plus `on-xdg-activate` rules (serial-less tokens mark only;
invalid-serial tokens are denied unless the debug flag is set);
PaperWM/karousel/paneru have no traced activation/urgency handler at
the pins (host journeys only). Ordinary unsandboxed COSMIC clients
take the privileged branch to Workspace tokens; the declared
sandboxed route exposes the workspace-level marker only.

### R-ACT-01: hidden window sends an unsolicited activation request

- Given (tree profiles): hidden `WS1=H[B]`, shown `WS2=H[A*]`; no
  recent user action in B, so B holds no qualifying user serial.
  Ordinary windows, no rules, scale 1.
- Given (column profiles): hidden `WS1=COL[C1[B]]`, shown
  `WS2=COL[C1[A*]]`; same serial condition; shipped defaults apply.
- Given (COSMIC sandboxed variant): same fixture with B sandboxed
  under a non-panel security context, so the privileged token
  branch does not apply; a stale-serial token attempt is the second
  leg of this variant.
- When: B sends its native activation request. Primary variant: the
  ordinary unsandboxed request (X11 `_NET_ACTIVE_WINDOW` on X11
  profiles, serial-less token request where xdg-activation owns
  the route, owned Wayland dispatch where traced). COSMIC
  sandboxed variant: serial-less token request plus stale-serial
  token attempt as its second leg.
- Observe: switch-to-B vs pull-B vs urgency-only marker vs denial;
  request token/user-timestamp qualification.
- Then COSMIC: switches to WS1 and focuses B. Ordinary unsandboxed
  B takes the privileged branch to a Workspace token, and shipped
  `Focus` drives `activate_surface` across workspaces. Sandboxed
  variant: serial-less stays `UrgentOnly` (marker only, no switch);
  stale-serial tokens are denied at creation. `S(S-cos-act)`.
- Then Hyprland/Dwindle: urgency mark only; stays on WS2 with A
  focused at shipped default. Both the X11 request path and the
  Wayland xdg-activation dispatch funnel into `activate()`, which
  always sets the urgent hint but focuses only under
  `misc:focus_on_activate` (default false).
  `S(S-hyp-act)`.
- Then bspwm: switches to WS1 and focuses B. The
  `_NET_ACTIVE_WINDOW` message (honored at shipped
  `ignore_ewmh_focus=false`) calls `focus_node` on the hidden
  desktop, which shows that desktop and focuses the node.
  `S(S-bsp-act)`.
- Then i3: urgency mark only; stays on WS2 with A focused at shipped
  default. Default `smart` marks hidden-workspace requesters urgent
  instead of showing their workspace.
  `S(S-i3-act)`.
- Then xmonad/Tall+Navigation2D: switches to WS1 and focuses B.
  The profiled `ewmh` composite handles `_NET_ACTIVE_WINDOW`
  through the default `doFocus` activate hook, which focuses
  immediately, switching workspace if necessary.
  `S(S-xmo-act)`.
- Then sway: urgency only; stays on WS2 with A focused at shipped
  default. A token from a client holding no focus reaches neither
  the internal-seat nor the focused-surface branch, so it falls to
  `view_request_urgent`; the shipped `focus_on_window_activation=urgent`
  marks without focusing.
  `S(S-sway-act)`.
- Then qtile/Columns: TBD (native activation-request routing for a
  hidden-group window untraced; hint handling belongs to R-ACT-02).
  Queued.
- Then awesome/tile: TBD (the `request::activate` filter outcome for
  a hidden-tag B, switch vs marker, untraced). Queued.
- Then niri: urgency-only marker; no switch or focus at shipped
  default. With no `on-xdg-activate` rule in the shipped config, a
  serial-less token takes the `UrgentOnlyMarker` branch and only
  sets urgent; invalid-serial tokens are denied instead (separate
  no-op leg unless the debug flag is set).
  `S(S-nir-act)`.
- Then PaperWM: TBD (Shell/extension activation journey for a
  hidden-space window untraced). Queued.
- Then karousel/Lazy: TBD (host KWin activation journey and
  focus-passer behavior for a hidden-desktop window untraced).
  Queued.
- Then paneru: TBD (no activation/urgency request path traced).
  Queued.
- Then Ours KDE: TBD (Engine `sync_focus_from_window` covers
  ordinary activation of a known window; unsolicited
  cross-workspace request routing, switch vs marker, untraced;
  native journey TBD). `S(S-ours-act)`; queued.
- Then Ours Windows: TBD (same Engine observation path; host
  foreground-request journey and marker policy untraced).
  `S(S-ours-act)`; queued.
- Variant hook: provisional/TBD (activation-routing hook, to discuss).

### R-ACT-02: urgency marker set, then user focuses the window

- Given (tree profiles): `H[A*,B]`, B not urgent. Ordinary windows,
  no rules, scale 1.
- Given (column profiles): `COL[C1[A*],C2[B]]`; same legs; shipped
  defaults apply.
- Given (COSMIC): B runs sandboxed with a non-panel security context, so the
  marker leg uses the serial-less workspace-marker route; an ordinary
  request would steal focus and cannot substitute for it.
- When: B sets urgency via its native mark path, then the user
  focuses B. Native mark paths: urgency hint (bspwm/qtile/awesome),
  demand-attention client message (i3), serial-less activation request
  (sandboxed COSMIC/niri), native activation request through `activate`
  (Hyprland), focus-less-client xdg request under policy `urgent`
  (sway). Mark and clear are separate sub-legs; a sourced mark never
  implies a sourced clear.
- Observe: focus stolen vs attention marker only/ignored while
  unfocused; marker cleared on focus vs retained.
- Then COSMIC: WS1 marked without stealing focus; same-workspace
  focus clear TBD. The declared route exposes the workspace-level
  marker only. `S(S-cos-act)`; queued.
- Then Hyprland/Dwindle: B marked urgent without stealing focus;
  focusing B clears the hint. `activate()` marks unconditionally
  while focus stays gated, and taking focus strips the urgent bit.
  `S(S-hyp-act)`.
- Then bspwm: B flagged urgent without stealing focus; focusing B
  clears the flag. Hint urgency sets the client flag, and the focus
  path clears it.
  `S(S-bsp-act)`.
- Then i3: B marked urgent without stealing focus; focusing B
  clears the leaf, parents, and workspace flags. Demand-attention
  messages and hidden-requester policy set urgency; the focus path
  resets leaf urgency.
  `S(S-i3-act)`.
- Then xmonad/Tall+Navigation2D: TBD (native hint mark/clear
  untraced; `doAskUrgent` is an opt-in alternative). Queued.
- Then sway: B marked urgent without stealing focus; focusing B
  clears it (immediately, or via the `urgent_timeout` timer when
  the focus arrives with a workspace switch). Shipped
  `focus_on_window_activation=urgent` marks; the seat focus path
  unsets or arms the timer.
  `S(S-sway-act)`.
- Then qtile/Columns: B marked urgent without stealing focus;
  focusing B clears the hint and strips `_NET_WM_STATE_DEMANDS_ATTENTION`.
  Hint updates set the flag off-focus; the focus path resets it.
  `S(S-qti-act)`.
- Then awesome/tile: B marked urgent without stealing focus;
  clearing on focus TBD. The `request::urgent` handler sets
  `c.urgent` off-focus; no focus-time clear traced.
  `S(S-awe-act)`; queued.
- Then niri: B marked urgent without stealing focus; focusing B
  clears it. `set_urgent` refuses while focused, and taking focus
  resets the flag.
  `S(S-nir-act)`.
- Then PaperWM: TBD (no urgency mark/clear path traced). Queued.
- Then karousel/Lazy: TBD (no urgency mark/clear path traced).
  Queued.
- Then paneru: TBD (no urgency mark/clear path traced). Queued.
- Then Ours KDE: TBD (the Engine resyncs focus on ordinary
  activation of a known window; the KDE observer exposes no
  attention/urgency signal and the adapter actuates `setActive`
  only, so both the native mark and the focus-time clear are
  untraced). `S(S-ours-act)`; queued.
- Then Ours Windows: TBD (same Engine observation path; the
  Windows adapter records foreground observation only, with no
  flash/marker path, so both the native mark and the focus-time
  clear are untraced). `S(S-ours-act)`; queued.
- Variant hook: provisional/TBD (urgency hook, to discuss).
