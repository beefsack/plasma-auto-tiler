# Capture-Method Research (unit-01)

Status of this unit: research/validation only. No test window was spawned, no
KWin script was loaded, no capture was started, and no consent dialog was
interacted with. Everything below was performed against a live Plasma 6.7.3
Wayland session using only read-only introspection, tool help output, source
code analysis, and one non-interactive portal negotiation call that crashed
the portal frontend (documented in section 3 and section 8).

## 1. Feasibility verdict

**VIABLE WITH CAVEATS.** A PipeWire ScreenCast stream through
`xdg-desktop-portal-kde` can observe a single transient incorrect-placement
frame, but it is NOT startable fully unattended from a cold start. The
specific caveats:

- (a) One-time interactive consent is required to mint a "restore" token.
  The very first capture for a given app identity must be confirmed by a
  human in KWin's ScreenChooserDialog (with the "Allow restoring on future
  sessions" checkbox checked). After that single click, subsequent captures
  for the same app identity skip the dialog entirely and can run unattended.
  This is proven from the installed backend source (section 4).
- (b) The PipeWire consumer on this host must be `gst-launch-1.0`
  (`pipewiresrc`). `ffmpeg` 8.1.2 on PATH has NO PipeWire support in its
  build, and `pw-record`/`pw-cat` are audio-only tools. Both are ruled out
  (section 5).
- (c) The portal frontend `xdg-desktop-portal` 1.20.4 crashes (SEGV) when
  a raw hand-driven D-Bus `ScreenCast.CreateSession` is made with a
  handle token whose resulting object path fails validation. This is a
  known upstream bug (flatpak/xdg-desktop-portal#1747, fixed after 1.20.4).
  The system self-recovered (systemd auto-restart). A real portal client
  library (or a token that passes validation) is required; hand-rolled
  raw D-Bus portal calls are fragile on this host (section 8).
- (d) The capture is bounded to the output's presentation rate (60 Hz),
  so it can only ever see frames KWin actually presented. If KWin coalesces
  the incorrect placement and the corrective moveResize into a single
  composited frame, no incorrect frame exists to capture - which is a
  valid negative finding, not a tooling failure, PROVIDED the recording is
  proven to be gap-free (section 9).

So: the mechanism is technically workable for unit-05, with one human
interaction up front and a carefully-built client. Fully unattended,
zero-interaction capture from a pristine session is NOT achievable on this
stack.

## 2. What is needed for the pop-in question (Q1)

The question is whether a frame showing KWin's own (uncorrected) placement
ever reaches the display between `windowAdded` and the tiler's corrective
`moveResize`. A PipeWire ScreenCast from KWin mirrors exactly the frames the
compositor presents, at the output's own rate. If an incorrect frame is
presented, it appears in the recording as one (or more) frames showing the
new window at a position that is not the tiled position, followed by frames
at the tiled position. If placement and correction are coalesced into one
composited frame, the recording shows only the corrected position - a true
negative. The remaining work is to prove the recording is gap-free so the
two cases are not conflated (section 9).

## 3. Environment (verified, read-only)

- Session: Plasma / KWin 6.7.x Wayland, live and otherwise untouched.
- `xdg-desktop-portal` frontend: 1.20.4
- `xdg-desktop-portal-kde` backend: 6.7.3
- `xdg-desktop-portal-gtk` backend: 1.15.3
- PipeWire: 1.6.8 (`pw-cli`, `pw-record`, `pw-cat`)
- GStreamer: 1.28.4 (`gst-launch-1.0`, `gst-inspect-1.0`)
- `ffmpeg`: 8.1.2
- `obs`: present on PATH
- `qdbus`, `busctl`, `dbus-send`, `timeout`: present

## 4. Portal ScreenCast: reachable, and how the consent flow works

`org.freedesktop.portal.Desktop` is present on the session bus and exposes
both `org.freedesktop.portal.ScreenCast` (version 5) and
`org.freedesktop.portal.RemoteDesktop`. Introspected interface:

```
.CreateSession        method   a{sv}     o
.OpenPipeWireRemote   method   oa{sv}    h
.SelectSources        method   oa{sv}    o
.Start                method   osa{sv}   o
.AvailableCursorModes property u         7
.AvailableSourceTypes property u         7
.version              property u         5
```

The installed backend is `xdg-desktop-portal-kde` 6.7.3. Reading its source
(`src/screencast.cpp`, tag v6.7.3, verified against the installed version):

- `CreateSession` (L133-172): no dialog. Creates the session and a system
  tray "media-record" item. Returns error only if the `zkde_screencast`
  Wayland protocol is unavailable (it is available on KWin 6.7).
- `SelectSources` (L174-208): no dialog. Stores options (`multiple`,
  `cursor_mode`, `types`, `persist_mode`, `restore_data`) on the session.
- `Start` (L303-393): THIS is where the interactive dialog lives. A
  `ScreenChooserDialog` is shown UNLESS both conditions hold:
    1. `session->persistMode() != NoPersist`, and
    2. `session->restoreData().isValid()`.
  (6.7.3-specific: master has since relaxed the `persist != NoPersist`
  guard, but the installed version requires both.)
- `restore_data` is only ever produced by `continueStartAfterDialog`
  (L282-294) with `allowRestore == true`, which happens on the dialog path
  after a human confirms a selection with a non-NoPersist persist mode, or
  on an already-valid restore path. `ScreenChooserDialog.qml` (v6.7.3,
  L191) contains the checkbox literally labeled "Allow restoring on future
  sessions".

Conclusion from source: there is NO code path that starts a first capture
without the human picking a source in the dialog once. There IS a code path
(`Start` with valid `restore_data` + non-NoPersist persist mode) that
restores and starts a capture with zero interaction afterwards. The restore
token is a client-held blob returned in the `Start` reply; it survives
reboots as long as the client stores it. This matches how real clients
(RustDesk, etc.) reuse capture sessions on KDE.

The PermissionStore has no pre-existing grants for any screencast/screenshot
table (`screencast`, `screen`, `screenshot`, `screensharing`,
`portal-remote-desktop`, `screencast-sources` all return empty), so there is
no remembered grant to lean on today.

## 5. PipeWire consumer tooling on this host

- `ffmpeg` 8.1.2: NO PipeWire input. `ffmpeg -devices` lists only `kmsgrab`
  and `video4linux2`; there is no `pipewire` device/demuxer, and
  `-buildconf` shows no `--enable-pipewire`. `ffmpeg -h demuxer=pipewire`
  returns "Unknown format 'pipewire'". RULED OUT as the PipeWire client on
  this host.
- `pw-record` / `pw-cat`: audio-oriented (`--media-type` defaults to
  "Audio", node properties target audio media classes). They cannot consume
  a `Video/Source` screencast node. RULED OUT for video frame capture.
- `gst-launch-1.0` 1.28.4: `pipewiresrc` element is present (Klass
  Source/Audio/Video, rank primary+1), with `name`, `path`, and
  `target-object` (source name/serial) properties. VIABLE PipeWire
  consumer. A pipeline such as
  `gst-launch-1.0 pipewiresrc target-object=<nodeid> ! ... ! filesink`
  is the intended capture command for unit-05.
- `obs`: present, with `--startrecording`, `--profile`, `--scene`,
  `--collection` options. Its Wayland "Screen Capture (PipeWire)" source
  also goes through the same portal consent flow, so OBS does not bypass
  the dialog. OBS is GUI-oriented and heavier than gst for a scripted
  sweep; not chosen.
- PipeWire node state: `pw-cli ls Node` shows only audio nodes and 66
  webcam/`v4l2_input`/`libcamera` `Video/Source` nodes. There is NO
  existing screencast node. Direct `pw-record`/`gst` attach to a screencast
  node without first starting a portal session is therefore impossible
  today; a node only exists while a screen-share session is active.

## 6. KWin's own capabilities (not the portal)

- `org.kde.KWin.ScreenCast` does NOT exist on the session bus (absent from
  `busctl --user list` and from `busctl --user tree org.kde.KWin`). In
  Plasma 6 the compositor's screencast is reached only via the portal
  backend over a private connection, not via a public D-Bus interface.
  There is no direct non-portal screencast D-Bus to call.
- `org.kde.KWin.ScreenShot2` exists at `/org/kde/KWin/ScreenShot2`
  (version 5): `CaptureActiveScreen`, `CaptureActiveWindow`,
  `CaptureArea(iiuua{sv}h)`, `CaptureInteractive`, `CaptureScreen`,
  `CaptureWindow`, `CaptureWorkspace`. These are SINGLE-SHOT screenshots
  that return pixels into a caller-supplied fd. Assessment for Q1:
  - Not usable for continuous/transient observation: each call returns one
    frame with no streaming and no presentation timing; polling would miss
    a one-frame transient with high probability and cannot be synchronized
    to the compositor's presentation.
  - It requires passing a shared-memory fd over D-Bus, which `busctl`,
    `qdbus`, and `dbus-send` cannot do; a small fd-passing client helper
    would be needed just to call it.
  - It is therefore useful as a cross-check (e.g. a "was the window
    visibly misplaced at any sampled instant" spot-check) but is NOT the
    primary method and cannot answer Q1 alone. The continuous PipeWire
    stream is the right instrument.
- No other compositor capability relevant to continuous frame observation
  was found on the bus (the object tree was enumerated; the only capture
  interfaces are ScreenShot2 and the portal ScreenCast path).

## 7. Commands actually run (exact command lines and outcomes)

Read-only discovery:

```
for b in ffmpeg obs gst-launch-1.0 pw-record pw-cat qdbus busctl timeout; do command -v "$b" >/dev/null 2>&1 && echo "OK $b -> $(command -v $b)" || echo "MISSING $b"; done
```
Outcome: success; all binaries resolve on PATH.

```
busctl --user list | grep -iE 'portal|pipewire|kwin'
```
Outcome: success; shows the portal frontend, kde/gtk backends,
PermissionStore, pipewire, and the org.kde.KWin services.

```
busctl --user introspect org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop | grep -iE 'ScreenCast|RemoteDesktop|PermissionStore'
busctl --user introspect org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast
```
Outcome: success; ScreenCast interface fully introspected (section 4).

```
timeout 5s busctl --user get-property org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast version
xdg-desktop-portal --version; xdg-desktop-portal-kde --version; xdg-desktop-portal-gtk --version
pw-cli --version; pw-cat --version
```
Outcome: success; versions as listed in section 3.

```
timeout 5s busctl --user introspect org.freedesktop.impl.portal.PermissionStore /org/freedesktop/impl/portal/PermissionStore
timeout 5s busctl --user call org.freedesktop.impl.portal.PermissionStore /org/freedesktop/impl/portal/PermissionStore org.freedesktop.impl.portal.PermissionStore List s screencast
```
and the same `List` call for tables `screen`, `screenshot`, `screensharing`,
`portal-remote-desktop`, `screencast-sources`.
Outcome: success; every table returns `as 0` (empty).

```
timeout 5s busctl --user introspect org.kde.KWin /KWin
timeout 5s busctl --user tree org.kde.KWin
timeout 5s busctl --user introspect org.kde.KWin /org/kde/KWin/ScreenShot2
timeout 5s busctl --user introspect org.kde.KWin /ScreenShot2
```
Outcome: success for the first three (ScreenShot2 fully introspected;
no ScreenCast interface anywhere in the tree); the `/ScreenShot2` path
returns "No such object path" - the object lives at
`/org/kde/KWin/ScreenShot2`.

```
timeout 10s pw-cli ls Node
```
Outcome: success; only audio nodes and webcam/`v4l2`/`libcamera` video
source nodes; no screencast node (section 5).

Tool capability checks:

```
ffmpeg -hide_banner -devices 2>/dev/null | grep -iE 'pipewire|kmsgrab|x11grab|video'
ffmpeg -hide_banner -filters 2>/dev/null | grep -iE 'pipewire'
ffmpeg -hide_banner -buildconf 2>/dev/null | grep -iE 'pipewire|enable-libpulse'
ffmpeg -hide_banner -h demuxer=pipewire
ffmpeg -version
```
Outcome: no PipeWire support anywhere in the ffmpeg build; kmsgrab and
v4l2 only; `-h demuxer=pipewire` prints "Unknown format 'pipewire'";
version 8.1.2.

```
timeout 5s gst-inspect-1.0 pipewiresrc
gst-launch-1.0 --version
```
Outcome: success; `pipewiresrc` present with `name`/`path`/`target-object`
properties; GStreamer 1.28.4.

```
pw-record --help 2>&1 | head -30
pw-cat --help 2>&1 | head -15
```
Outcome: success; both are audio-oriented (media-type defaults to Audio);
assessed as not usable for video screencast nodes.

```
obs --help 2>&1 | grep -iE 'startreplaybuffer|startrecording|headless|profile|scene|portable|minimize|novsync|disable-shm'
```
Outcome: success; OBS supports `--startrecording`, `--profile`, `--scene`,
`--collection`; noted as GUI-oriented and portal-dependent, not chosen.

```
kscreen-doctor -o
```
Outcome: success; single active output eDP-1, active mode 1920x1280@60.00,
logical geometry 1536x1024 at scale 1.25.

Non-interactive portal negotiation attempt (this is what crashed the
portal frontend - see section 8):

```
timeout 8s busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast CreateSession oosa{sv} "/org/freedesktop/portal/desktop/request/research/one" "/org/freedesktop/portal/desktop/session/research/two" org.plasmaautotiler.research 0
```
Outcome: method error "Type of message, (oosa{sv}), does not match expected
type (a{sv})" - signature mismatch, no effect (modern frontend exposes the
simplified `a{sv} -> o` CreateSession).

```
timeout 8s busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast CreateSession a{sv} 0
```
Outcome: method error "Call failed: Missing token" - clean D-Bus error
return, no crash, no session created.

```
timeout 8s busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast CreateSession a{sv} 1 handle_token s "research-session-001"
```
Outcome: "Call failed: Remote peer disconnected" - the portal frontend
process segfaulted (section 8). This was the only live portal call beyond
read-only introspection, and the only command that affected the system
beyond pure reads; the portal auto-recovered.

Post-crash verification:

```
ps aux | grep -E 'xdg-desktop-portal'
journalctl --user -u xdg-desktop-portal --no-pager
```
Outcome: frontend was restarted by user systemd (new PID); journal shows
`xdg-desktop-portal.service: Main process exited, code=dumped, status=11/SEGV`
with a coredump, preceded by
`g_dbus_connection_signal_subscribe: assertion 'object_path == NULL || g_variant_is_object_path (object_path)' failed`,
and the crashing thread stack
`xdp_request_export <- handle_create_session <- _g_dbus_codegen_marshal_BOOLEAN__OBJECT_VARIANT`.

```
timeout 5s busctl --user get-property org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast version
timeout 5s busctl --user tree org.freedesktop.portal.Desktop
```
Outcome: portal alive again (version property returns `u 5`); no leftover
session/request objects in the portal object tree.

```
timeout 5s busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.DBus.Peer Ping ""
timeout 5s busctl --user call org.kde.KWin /KWin org.freedesktop.DBus.Peer Ping ""
timeout 5s busctl --user call org.freedesktop.impl.portal.desktop.kde /org/freedesktop/portal/desktop org.freedesktop.DBus.Peer Ping ""
```
Outcome: all three exit 0 - portal, KWin, and the KDE portal backend are
healthy. `kwin_wayland` was never touched by any command in this unit.

Also attempted (marshalling syntax exercises, no effect):

```
timeout 8s busctl --user call org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast.OpenPipeWireRemote oa{sv} /foo 0
```
Outcome: "Invalid member name: oa{sv}" - argument-placement mistake in the
command, nothing was sent.

```
timeout 8s dbus-send --session --print-reply --dest=org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast.CreateSession objpath:/org/freedesktop/portal/desktop/request/research/one objpath:/org/freedesktop/portal/desktop/session/research/two string:org.plasmaautotiler.research dict:0
timeout 8s dbus-send --session --print-reply --dest=org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast.CreateSession objpath:/org/freedesktop/portal/desktop/request/research/one objpath:/org/freedesktop/portal/desktop/session/research/two string:org.plasmaautotiler.research dict:string:variant:0
```
Outcome: "Data item '0' is badly formed" / "Malformed dictionary" - `dbus-send`
cannot construct empty or nested containers (its man page states this
explicitly), so it cannot drive the portal's `a{sv}` options at all. No
effect.

## 8. The portal frontend crash (finding, self-recovered)

A single non-interactive `ScreenCast.CreateSession` D-Bus call with
`handle_token` of "research-session-001" caused `xdg-desktop-portal`
1.20.4 to SEGV in `xdp_request_export` (called from `handle_create_session`),
after a GLib assertion that the derived request object path was not a valid
object path. systemd auto-restarted the portal; no lasting damage; KWin and
the KDE backend were unaffected; the portal object tree is clean afterwards.

Attribution: this matches the known upstream bug
`flatpak/xdg-desktop-portal#1747` ("xdp_request_export() crashes when handle
token contains '-'", reported against 1.20), fixed by upstream PR #1748
which added `xdp_is_valid_token` validation and returns an error instead of
crashing. The installed 1.20.4 predates that fix.

Implication for unit-05: the harness must NOT hand-roll raw D-Bus portal
calls with arbitrary tokens. It should use a proper portal client (a small
dedicated program using a D-Bus library, or a tool that already speaks the
portal protocol) and/or a token that satisfies object-path validity checks.
The crash bug itself is a documented environmental hazard on this host, not
a blocker, and does not change the feasibility verdict.

## 9. Sketch: pointing the capture at a real windowAdded pop-in (unit-05)

Deferred work - this unit must not spawn windows or load the script. The
procedure below is what unit-05 would execute (after Orchestrator
authorization of the live-session units).

Setup (one-time, human interaction, outside the sweep):

- For a fixed app identity for the harness (for example
  `org.plasmaautotiler.measurement`), run a portal client once, select the
  eDP-1 output in the ScreenChooserDialog, and check "Allow restoring on
  future sessions". Save the `restore_data` blob and `persist_mode`
  returned by `Start`. This is the only human click the whole measurement
  needs.

Per-tier unattended capture (unit-05, per window-count tier 5/20/50/100):

1. Create a ScreenCast session; `SelectSources` with
   `types = Monitor`, `persist_mode` = the saved value, and
   `restore_data` = the saved blob.
2. `Start` on the session; on 6.7.3 the restore path (persist != NoPersist
   AND valid restore_data) bypasses the dialog and returns stream metadata
   including the PipeWire node id. `OpenPipeWireRemote` returns the fd.
3. Launch `gst-launch-1.0 pipewiresrc target-object=<node-id> ! <encode> !
   filesink location=<tier>.mkv` before any window is spawned; allow a
   short warm-up so the first frames are recorded. Captured size is the
   output's native pixel size (1920x1280) at 60 fps.
   Encoding: a lossless or near-lossless codec (for example `ffv1enc` or a
   high-bitrate `x264enc`) so pixel-accurate window-position analysis is
   possible; raw is 1920x1280x4x60 ~= 590 MB/s and is only acceptable for
   short bursts.
4. Spawn the tier's windows via the unit-04 harness (this triggers
   `windowAdded` and the corrective moveResize). Record harness-side
   timestamps for each spawn.
5. Stop the pipeline after the layout is stable.

Distinguishing "an extra frame was presented" from "placement and
correction were coalesced into one frame":

- Frame-integrity gate: expected frame count = recording duration x 60 Hz
  (the measured output rate). If the recorded count (from PTS/frame
  metadata) is short by more than a small tolerance, the recording dropped
  frames and the tier's Q1 observation is flagged INCONCLUSIVE, not a
  negative. This is the check that keeps a true negative from being
  confounded by a missed transient.
- Per-window analysis: for each spawn, locate the first frame containing
  the new window and compare its geometry to the final tiled geometry. A
  presented incorrect-placement frame shows up as >= 1 frame where the
  window is at KWin's own placement (cascade/center), followed by frames at
  the corrected position.
- Correlation with the variant timing log: if the handler's
  trigger-to-last-moveResize wall time (from the variant scripts) is small
  relative to one 16.67 ms frame period and began before the compositing
  deadline of the window's first-presented frame, then placement and
  correction plausibly landed within a single composited frame, explaining
  a clean negative. If the handler time spans multiple frame periods and
  still no incorrect frame is seen, then either KWin suppressed the
  incorrect frame or the capture missed it; frame-integrity plus this
  timing cross-check is the honest discriminator. Where the two cannot be
  separated, report the tier as "not measurable" per spec rather than
  force an answer.
- Validity limits to state in the findings: at high window counts KWin
  itself may coalesce composited frames under load (which is itself
  relevant to the pop-in question), and the screencast can only mirror what
  the compositor presents; it cannot invent a frame KWin never showed.

## 10. Commands deliberately NOT run, and why

- No `gst-launch-1.0 pipewiresrc ...` capture: there is no screencast node
  to attach to without first starting a portal session, and starting one
  pops the interactive consent dialog on the user's live desktop (proven
  from source, section 4). The brief forbids spawning windows and requires
  stopping on any interactive consent; running it would have created a new
  on-screen dialog requiring a human click I am not permitted to give.
- No `ScreenCast.Start` call: same reason - it is the step that shows the
  ScreenChooserDialog.
- No further `CreateSession` calls after the crash: re-triggering a
  known-crashing path on the live portal adds no information and risks
  another service restart.
- No attempt to call `org.kde.KWin.ScreenShot2.CaptureArea/CaptureScreen`:
  these require passing a shared-memory fd, which `busctl`/`qdbus`/
  `dbus-send` cannot do (no fd passing), and they would capture live screen
  pixels. ScreenShot2 is single-shot anyway and cannot answer Q1
  (section 6), so building an fd-passing helper was judged out of scope for
  this unit.
- No `obs` run: GUI-oriented and portal-dependent (same consent flow); no
  unattended advantage over gst; starting it could also present capture UI
  on the live desktop.
- No `spectacle` or other screenshot tool: single-shot and would write
  arbitrary live-desktop pixels to a file without a bounded target.
- No KWin script was loaded and no window was spawned by any command in
  this unit (explicitly prohibited).

## 11. Open items deferred to live-session units

- Whether KWin ever presents a placement-only frame depends on the real
  windowAdded lifecycle; that is unit-05/unit-06 work and requires a window
  to exist. Not investigated here.
- Whether the restore token survives the harness's exact app identity and
  session lifetime needs a live test (unit-05), with the crash caveat from
  section 8 addressed by using a proper portal client.
- Whether the gst pipeline's frame count is actually gap-free under load
  can only be measured with a live stream (unit-05).
