# Research: Q1 Frame-Presentation Capture Attempt (unit-E)

Status: Live-session attempt, authorized, user present and ready to
interact with the KDE ScreenChooserDialog. The dialog was never reached.
Negotiation stalled at the first portal call (`ScreenCast.CreateSession`),
before any script was loaded, before any test window was spawned, and
before the user was ever interrupted. **Q1 answer: NOT MEASURABLE by this
method, on this host, with the tooling available.** This is a tooling
limitation, not a finding about whether pop-in occurs -- it must not be
read as, or substituted for, a negative pop-in observation.

## Method attempted

Per `research/capture-method.md` Section 9 and the Lead's brief: negotiate
the PipeWire ScreenCast portal (`CreateSession` -> `SelectSources` ->
`Start`, all via `busctl --user call` with ASCII-alphanumeric-only
`handle_token`/`session_handle_token` values, to avoid repeating unit-01's
`xdg-desktop-portal` 1.20.4 SEGV on a malformed token), obtain a PipeWire
node id from the `Start` response, then attach `gst-launch-1.0 pipewiresrc`
directly to that node (no `OpenPipeWireRemote` fd-passing attempt, on the
theory that a local unsandboxed client may already have PipeWire access).
Only after a live portal session existed would `variant-a.js` be loaded
(plugin name `plasma-auto-tiler-variant-a`, `managedResourceClass` set to
the sentinel `plasma-auto-tiler-test`, matching unit-D's already-verified
Wayland-native `konsole --separate --desktopfile plasma-auto-tiler-test`
spawn pattern) and exactly one test window spawned mid-recording.

None of the capture, script-load, or window-spawn steps were reached.

## What was actually run and observed

A background broad listener was started first and kept running for the
whole attempt (no path filter, so no race against not yet knowing the
request path):

```
dbus-monitor --session "type='signal',interface='org.freedesktop.portal.Request',member='Response'"
```

Then, two `CreateSession` attempts, both well short of the crashing pattern
from unit-01 (that call used a hyphenated `handle_token`; both calls here
used plain alphanumeric tokens):

```
busctl --user call org.freedesktop.portal.Desktop \
  /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast \
  CreateSession a{sv} 1 handle_token s cst1
```
Result: D-Bus error "Missing token" -- this portal build requires both
`handle_token` (for the Request object) and `session_handle_token` (for the
Session object) in `CreateSession`'s options dict, not `handle_token` alone.

```
busctl --user call org.freedesktop.portal.Desktop \
  /org/freedesktop/portal/desktop org.freedesktop.portal.ScreenCast \
  CreateSession a{sv} 2 handle_token s cst2 session_handle_token s cst2
```
Result: succeeded at the D-Bus method-call level -- returned a request
object path (`/org/freedesktop/portal/desktop/request/1_691/cst2`) with no
error. But:

- **No `Response` signal for this request ever arrived** on the broad
  `dbus-monitor` listener (verified running before the call, no path
  restriction, so this is not a path-registration race).
- Re-introspecting the returned request object path afterward found it
  empty / already gone -- consistent with the object having been destroyed,
  not with a pending request still waiting for the user.
- `xdg-desktop-portal` did not crash (no `journalctl` entries for the unit
  in the relevant window; `ScreenCast.version` and both `Ping` checks
  succeeded throughout and after).
- The `ScreenChooserDialog` never appeared. The user was never interrupted
  and never needed to click anything.

No `SelectSources` or `Start` call was ever issued (both depend on a
`session_handle` this flow never produced). No script was loaded. No test
window was spawned. No `gst-launch-1.0` process ever ran.

## Diagnosis (reasoned, not byte-verified against xdg-desktop-portal-kde's source)

The specific symptom -- a `CreateSession` call that returns a valid request
object path with no error, but for which the `Request.Response` signal
never fires and the object subsequently disappears -- matches a
well-documented general property of the `org.freedesktop.portal.Request`
interface across xdg-desktop-portal implementations: a pending Request's
lifetime is tied to the D-Bus connection of the client that created it, so
that a portal backend can clean up requests whose caller crashed or
disconnected without ever seeing a response. `busctl call` opens a **new**
D-Bus connection for each invocation and disconnects immediately after
printing the synchronous method reply -- i.e., the calling connection is
already gone, likely within milliseconds, well before the portal backend
would have finished any asynchronous processing needed to emit `Response`.
This is consistent with, and was anticipated in general terms by,
`research/capture-method.md` Section 8's own conclusion after the unit-01
crash: "hand-rolled raw D-Bus portal calls are fragile on this host... A
real portal client library... is required." That caution is now confirmed
to extend beyond the token-validation crash to this separate
connection-lifetime failure mode.

This diagnosis was not independently confirmed by reading
`xdg-desktop-portal-kde`'s C++ source for this exact code path in this
attempt (unlike, e.g., `research/geometry-batching.md`'s byte-verified KWin
source citations) -- it is the most plausible explanation for the observed
symptom (object present then gone, no signal, no error, no crash), applied
here for the sake of an honest record rather than presented as a
line-verified fact.

## Why no further live attempt was made

Completing the negotiation requires a client whose D-Bus connection stays
open across `CreateSession` -> `SelectSources` -> `Start` and the
associated `Response` signals -- i.e., an actual persistent D-Bus client,
not a sequence of one-shot CLI invocations. This host has no scripting
language D-Bus binding available to build one without installing a new
package: `python3` has no `dbus`, `pydbus`, or `gi.repository.Gio` module;
`perl` has no `Net::DBus`; `ruby` is not present at all; `node` has no
`dbus-next` (checked live, all four negative). Writing a dedicated client
in Rust (this repo already has a `Cargo.toml`) was considered and rejected:
`spec.md`'s Non-Goals explicitly state "no Rust code in this change" --
building one, even as throwaway measurement tooling, would contradict the
spec's own scope boundary. Installing a new system or language-binding
package is a dependency change outside a Lead's standing authorization
(repo `AGENTS.md`: system/toolchain dependencies belong in `devenv.nix`,
which requires a session restart; no ad hoc installs) and was not sought
from the Orchestrator given the marginal value described below. Retrying
`CreateSession` itself repeatedly was avoided per the live-session brief's
instruction not to retry the interactive portal path aggressively, and
because it would not address the actual blocker (the tooling gap, not a
transient failure).

Given `spec.md`'s own reasoning that "Q1 is not a differentiator for the
native-vs-JS decision" (it is an independent lifecycle finding that applies
identically to JS and native, since `windowAdded` fires after placement for
both), and given the change's context budget, further investment in
building or acquiring a persistent-connection D-Bus client for this one
observation was judged disproportionate to its evidentiary value and was
not pursued further in this stint.

## Verdict

**NOT MEASURABLE**, for a specific, stated tooling reason: the
`xdg-desktop-portal` ScreenCast negotiation requires a persistent D-Bus
client connection across an async multi-step request/response flow, and no
tool on this host (`busctl`, `qdbus`, `dbus-send`, nor any available
scripting-language D-Bus binding) can hold a connection open across
separate method calls without either a new dependency (out of a Lead's
standing authorization) or new Rust code (explicitly excluded by
`spec.md`'s Non-Goals). This is a tooling-availability negative, not a
pop-in observation of any kind: it says nothing about whether KWin
presents an intermediate incorrect-placement frame. It must not be
conflated with, or substituted by, a timing-based proxy, per the spec's
own constraint against silent substitution.

Per `spec.md`'s own framing, this finding does not weaken the overall
milestone: Q1's answer, whenever and however obtained, applies identically
to a JS and a native implementation (both observe an already-placed window
at `windowAdded`), so it was never a differentiator for the native-vs-JS
question that is this change's central purpose.

## Live-session safety (reversal verification)

No script was ever loaded and no test window was ever spawned, so there
was nothing invasive to reverse. Verified directly by the Lead after this
attempt (not assumed from the Worker's own report):

- `busctl --user call org.kde.KWin /KWin org.freedesktop.DBus.Peer Ping` --
  exit 0.
- `busctl --user call org.freedesktop.portal.Desktop
  /org/freedesktop/portal/desktop org.freedesktop.DBus.Peer Ping` -- exit 0.
- `qdbus org.kde.KWin /Scripting isScriptLoaded plasma-auto-tiler-variant-a`
  and `...-variant-b` -- both `false`.
- `pgrep -x dbus-monitor`, `pgrep -x gst-launch-1.0`, `pgrep -f
  'konsole.*plasma-auto-tiler'` -- all no match (no leaked processes).
- `busctl --user tree org.freedesktop.portal.Desktop` -- no `request`
  objects remain; the portal object tree is clean.
- No repository file other than this one was modified by this attempt; no
  `devenv.nix` change; no package installed.
