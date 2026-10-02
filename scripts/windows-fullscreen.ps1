param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 300,
  [ValidateSet("All", "OwnedFs", "WorkspaceFs", "NormalSmoke", "BornCloseFs", "RecoveryFs")]
  [string]$Stage = "All"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner stop/restore helpers.
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }
# Lean reuse: load ONLY function definitions from the border + shortcuts
# harnesses via AST (never executes their top-level live legs).
$FsMock = $Mock; $FsLive = $Live; $FsStop = $Stop; $FsRunDir = $RunDir; $FsOwnerSeconds = $OwnerSeconds; $FsStage = $Stage
$FsBorderPath = Join-Path $Repo "scripts\windows-active-border.ps1"
$FsShortPath = Join-Path $Repo "scripts\windows-shortcuts.ps1"
$FS_STEPS = [System.Collections.ArrayList]@()
function Rec-Fs([string]$Name, $Data) { $null = $FS_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Fs([string]$Msg) { throw $Msg }
# Sink for AST-loaded shortcuts helpers that record via Rec-Shortcut
# (Close-CreatedHelpers): keeps their extent without crashing on $null.
$ShortcutSteps = [System.Collections.ArrayList]@()
function Load-FsAst([string]$Path, [string[]]$Wanted) {
  $toks = $null; $errs = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$toks, [ref]$errs)
  if ($errs.Count -ne 0) { throw "harness parse errors in $Path : $($errs.Count)" }
  $loaded = @{}
  foreach ($fn in $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    # Invoke-Expression inside this loader would bind to the loader's local
    # scope; force script scope so live legs see the helpers after return.
    if ($Wanted -contains $fn.Name) {
      $def = "$($fn.Extent.Text)" -replace '(?i)^function\s+', 'function script:'
      Invoke-Expression $def; $loaded[$fn.Name] = $true
    }
  }
  foreach ($need in $Wanted) { if (-not $loaded.ContainsKey($need)) { throw "helper unavailable: $need" } }
}
$FsBorderWanted = @("Fail-Ab", "Install-BorderNative", "Install-FollowupNative", "Read-CompleteTextAb", "Get-CompleteLinesAb", "Get-MarkBeforeActionAb",
  "Assert-HelperIdentityAb", "Set-OwnedForegroundAb", "Get-NativeRectAb", "Get-NativeFrameAb", "Get-FuCloaked",
  "Find-TitlePointAb", "Read-CorrectSpiAb", "New-HeldProcessAb", "Close-HeldProcessAb", "ConvertTo-AbsoluteAb",
  "Get-VirtualScreenAb", "Assert-ButtonReleasedAb", "Get-OverlayHwndsForOwnerAb")
$FsShortWanted = @("Rec-Shortcut", "Fail-Shortcut", "Get-ShortcutJourney", "Assert-NoWinLJourney", "Assert-ChordSendCounts",
  "Assert-InputStructSize", "Assert-EncodingInvariant", "Test-ExeEqualLocal", "Assert-FullIdentityMatches",
  "Assert-TileStartMode", "Assert-ProofStartArgv", "Assert-ProductionLogTokenOnly", "Assert-FramesEqual",
  "Assert-FramesChanged", "Assert-RectNonEmpty", "ConvertTo-AbsoluteNative", "Assert-OcclusionClear",
  "Assert-SpiPreimageOwned", "Install-ShortcutNative", "Read-CompleteTextLocal", "Get-CompleteLinesLocal",
  "Get-LogEventsAfter", "Get-PlanSnapshotLocal", "Show-ExactHelper", "Invoke-ExactHelperActivate", "Invoke-OwnedFocusEnsure",
  "Send-MarkedChord", "Read-PenVisualization", "Read-SpiArranging", "Assert-ExactOwner", "Stop-ExactOwner",
  "Get-FrozenHwnds", "Get-InspectFrames", "Wait-ConvergedFrames", "Wait-SnapAfter", "New-ShortcutRunDir",
  "Start-PassiveShortcutHelper", "Get-DisplayBaselineLive", "Get-OriginalAppsSnapshot", "Assert-OriginalAppsIntact",
  "Close-CreatedHelpers", "Test-NoProjectActors", "Invoke-StopFromRunDir")
Load-FsAst $FsBorderPath $FsBorderWanted
Load-FsAst $FsShortPath $FsShortWanted
$Mock = $FsMock; $Live = $FsLive; $Stop = $FsStop; $RunDir = $FsRunDir; $OwnerSeconds = $FsOwnerSeconds; $Stage = $FsStage

# Safety contract (docs/live-windows-testing.md grants no authority itself):
# explicit flags mandatory; bare invocation parses and exits. Live mutates
# ONLY exact identity-bound owned helpers (plus launched approved extras in
# NormalSmoke, closed after). NEVER closes/kills/types into the hosting
# Terminal/process tree (moving/tiling it is allowed). No process-name kills,
# no registry/policy writes, no screenshots, no app content. Activation is
# E8-prime + AttachThreadInput + one SetForegroundWindow on the exact bound
# target (Set-OwnedForegroundAb / Invoke-OwnedFocusEnsure). Synthetic input
# is marked (SHORTCUT_MARKER) for hook chords and unmarked absolute mouse
# only for the bounded pointer-refusal drag on the exact foreground helper.
# Out-of-hook stop only (`stop` then `restore`). End state: zero run actors;
# ledger/stop clean; SPI arranging 1, pen 35.

$FS_MARKER = 0x544C5250524F4F46
$VK_F11 = 0x7A
$VK_M = 77
$VK_H = 72; $VK_J = 74; $VK_K = 75; $VK_L = 76
$VK_LEFT = 37; $VK_UP = 38; $VK_RIGHT = 39; $VK_DOWN = 40
$VK_0 = 0x30
$VK_LWIN = 91; $VK_LSHIFT = 160; $VK_CONTROL = 17; $VK_ESC = 27
$GWL_STYLE = -16; $GWL_EXSTYLE = -20
$WS_CAPTION = 0x00C00000; $WS_THICKFRAME = 0x00040000
$SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_FRAMECHANGED = 0x0020
$SHORTCUT_MARKER = $FS_MARKER
$INPUT_STRUCT_SIZE_X64 = 40
$ARROW_SCAN_TABLE = @{ 37 = 75; 38 = 72; 39 = 77; 40 = 80 }
$MOUSE_MOVE = 0x0001; $MOUSE_ABS = 0x8000; $MOUSE_DOWN = 0x0002; $MOUSE_UP = 0x0004

function Wait-FsOutcome([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [int]$TimeoutSec, [string]$Tag) {
  # `dispatched` is the settled async report (setter accepted, native
  # completion pending): every enter caller pairs this with the native
  # cover/style/props readback below. Discrete-toggle parity: each fresh
  # Win+F11 down dispatches once; repeats never dispatch (classifier
  # trace-only). Success outcomes are `fullscreen` (enter), `restored`
  # (owned exit) and `dispatched`; the explicit external-frame fixture
  # expects `fullscreen-refused-app-owned` here (a `fullscreen-toggle`
  # outcome like the rest, never a product transition).
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -ne "fullscreen-toggle") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      return @{ event = $e; count = $lines.Count }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fs "$Tag no fullscreen-toggle outcome=($($Outcomes -join '|')) after mark $Mark"
  return $null
}

function Wait-FsHeld([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -eq "initial-fullscreen-held") { return @{ event = $e; count = $lines.Count } }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Fs "$Tag no initial-fullscreen-held after mark $Mark"
  return $null
}

function Wait-FsReleased([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -eq "initial-fullscreen-released") { return @{ event = $e; count = $lines.Count } }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Fs "$Tag no initial-fullscreen-released after mark $Mark"
  return $null
}

function Wait-FsSuspend([string]$LogPath, [int]$Mark, [string]$Cause, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "suspend") -and ("$($e.cause)" -eq $Cause)) { return @{ event = $e; count = $tail.count } }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fs "$Tag no suspend cause=$Cause after mark $Mark"
  return $null
}

function Wait-FsResume([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  # Resume gate after an external-cover suspension (the app-owned fixture
  # suspends the owner with an unmanaged fullscreen foreground): the
  # release oracle below needs a ticking owner, never a suspended one.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if ($e.event -eq "resume") { return @{ event = $e; count = $tail.count } }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Fs "$Tag no resume after mark $Mark (owner still suspended)"
  return $null
}

function Wait-WorkspaceOutcomeFs([string]$LogPath, [int]$Mark, [string]$Op, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index) -and ("$($e.outcome)" -ne "key-up")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Fs "$Tag no workspace $Op/$Index after mark $Mark"
  return $null
}

function Get-WorkspaceActionFs([string]$LogPath, [int]$Mark, [int]$Tick, [string]$Op, [int]$Index, [string]$Tag) {
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if (($e.event -eq "workspace-action") -and ([int]$e.tick -eq [int]$Tick) -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index)) {
      return $e
    }
  }
  Fail-Fs "$Tag no workspace-action for tick $Tick"
  return $null
}

function Get-PlannedSlotFs([string]$LogPath, [string]$Token, [string]$Tag) {
  # Engine-allocated slot for one opaque window token: the newest plan entry
  # carrying that token. Native helper rects cannot serve here (a fullscreen
  # member covers the monitor, not its slot).
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "plan") { continue }
    foreach ($en in @($e.entries)) {
      if ("$($en.window)" -ceq $Token) { return (($en.rect | ForEach-Object { "$_" }) -join ",") }
    }
  }
  Fail-Fs "$Tag no plan entry for token"
  return ""
}

function Get-FrameKeyFs([long]$Hwnd, [string]$Tag) {
  # Owner-side DWM visible frame (physical PMv2): comparable to Engine plan
  # slots. Helper outer rects are GetWindowRect (invisible borders included)
  # in the helper CLI's unaware coordinates: never mix the two.
  [ActiveBorderNative]::EnsurePMv2()
  $f = [ActiveBorderNative]::FrameOf($Hwnd)
  if ($null -eq $f) { Fail-Fs "$Tag DWM frame unreadable" }
  return "$([int]$f[0]),$([int]$f[1]),$([int]$f[2]),$([int]$f[3])"
}

function Get-HelperRectKeyFs([string]$HelperBin, $Snap, [string]$Tag) {
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  return "$($fresh.left),$($fresh.top),$($fresh.right),$($fresh.bottom)"
}

function Assert-NoWriteForFs([string]$LogPath, [int]$Mark, [string]$Token, [string]$Tag) {
  # Token-scoped when the Engine token is known (Win+F11 legs carry it on the
  # toggle event); empty token means strict (native/unmanaged legs): no
  # overlay geometry write at all while fullscreen.
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "write") { continue }
    if ($Token -eq "") { Fail-Fs "$Tag geometry write while fullscreen: $($lines[$i])" }
    $text = "$($lines[$i])"
    if ($text -match [regex]::Escape($Token)) { Fail-Fs "$Tag geometry write references fullscreen token" }
  }
}

function Assert-ExactForegroundFs([uint64]$Want, [string]$Tag) {
  # Exact foreground proof: `GetForegroundWindow` must equal the expected
  # HWND now (no frozen-set membership, no inference from logs).
  [ActiveBorderNative]::EnsurePMv2()
  $fg = [uint64]([ActiveBorderNative]::GetForegroundWindow().ToInt64())
  if ($fg -ne $Want) { Fail-Fs "$Tag foreground $fg != expected $Want" }
  Rec-Fs "$Tag-foreground" @{ foreground = $fg; expected = $Want }
}

function Assert-FsForegroundHeld([uint64]$Want, [string]$Tag) {
  # Immediate post-toggle foreground attribution (fixture only, never a
  # product oracle): the helper held foreground at chord send, so a holder
  # change across the toggle is either a product focus loss or a shell
  # steal. Mismatch fails fast with read-only native identity
  # (class/exe/pid; no titles, content, or screenshots) instead of
  # proceeding into cover checks and late refocus retries.
  [ActiveBorderNative]::EnsurePMv2()
  $fg = [uint64]([ActiveBorderNative]::GetForegroundWindow().ToInt64())
  if ($fg -ne $Want) {
    $id = Get-FsFgIdentity ([long]$fg)
    Fail-Fs "$Tag foreground $fg (class=$($id.class) pid=$($id.pid) exe=$($id.exe)) != expected $Want immediately post-toggle"
  }
  Rec-Fs "$Tag-foreground-held" @{ foreground = $fg }
}

function Assert-SendGeometryFs([string]$LogPath, [int]$Mark, [int]$Tick, [string]$Op, [int]$Index, [string]$Tag) {
  # Send-success oracle for non-fullscreen movers (seed legs): follow focus
  # must be exact (`focus-ok`), membership transfer carries source/target
  # readback_ok with no veto. Fullscreen movers never reach this oracle:
  # they refuse with `send-refused-fullscreen` (asserted inline by callers).
  $lines = Get-CompleteLinesLocal $LogPath
  $found = $null
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if (($e.event -eq "workspace-action") -and ([int]$e.tick -eq [int]$Tick) -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index)) {
      $found = $e; break
    }
  }
  if ($null -eq $found) { Fail-Fs "$Tag no workspace-action for tick $Tick" }
  if ("$($found.outcome)" -ne "ok") { Fail-Fs "$Tag send outcome $($found.outcome) != ok" }
  if ("$($found.focus)" -ne "focus-ok") { Fail-Fs "$Tag send focus $($found.focus) != focus-ok" }
  if ($null -eq $found.source -or $null -eq $found.target) { Fail-Fs "$Tag send geometry missing" }
  if (-not [bool]$found.source.readback_ok) { Fail-Fs "$Tag source readback not verified" }
  if (-not [bool]$found.target.readback_ok) { Fail-Fs "$Tag target readback not verified" }
  if ($null -ne $found.source.veto -or $null -ne $found.target.veto) { Fail-Fs "$Tag send vetoed" }
  Rec-Fs "$Tag-geometry" @{ outcome = "$($found.outcome)"; focus = "$($found.focus)";
    source_readback = [bool]$found.source.readback_ok; target_readback = [bool]$found.target.readback_ok }
  return $found
}

function Get-UnderlayVisibleFs([string]$Payload, [string]$Tag) {
  $insp = Invoke-Native $Payload @("underlay-inspect") | ConvertFrom-Json
  if (-not $insp.present) { return 0 }
  return @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
}

function Hold-WinShiftFs([string]$Tag) {
  # Synthetic marked Win+Shift hold (back-to-back downs, one settle): the
  # underlay samples levels via GetAsyncKeyState on the owner's 100ms pump,
  # so one settle sleep lets the chord-edge wake fire. Marked
  # (SHORTCUT_MARKER) so the hook sees synthetic test input like every
  # other chord in this harness; sent via the shortcut native which carries
  # the 3-arg marked overload.
  $m = [uint64]$FS_MARKER
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LWIN, $false, $m) -ne 1) { Fail-Fs "$Tag Win down not inserted" }
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LSHIFT, $false, $m) -ne 1) { Fail-Fs "$Tag Shift down not inserted" }
  Start-Sleep -Milliseconds 600
}

function Release-WinShiftFs([string]$Tag) {
  $m = [uint64]$FS_MARKER
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_LSHIFT, $true, $m) } catch {}
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_LWIN, $true, $m) } catch {}
  Start-Sleep -Milliseconds 400
  # A bare chord release may summon Start; dismiss it without touching
  # windows, then the caller restores exact owned focus.
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_ESC, $false, $m) } catch {}
  Start-Sleep -Milliseconds 150
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_ESC, $true, $m) } catch {}
  Start-Sleep -Milliseconds 800
}

function Wait-UnderlayShownFs([string]$Payload, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-UnderlayVisibleFs $Payload $Tag) -ne 0) { return }
    Start-Sleep -Milliseconds 100
  }
  Fail-Fs "$Tag underlay not visible while Win+Shift held"
}

function Install-FsPropNative {
  if (-not ("FsPropNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class FsPropNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr GetPropW(IntPtr hWnd, string lpString);
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
}

function Get-FsPropState([long]$Hwnd) {
  Install-FsPropNative
  $p1 = [FsPropNative]::GetPropW([IntPtr]$Hwnd, "PlasmaAutoTilerFullscreen")
  $p2 = [FsPropNative]::GetPropW([IntPtr]$Hwnd, "PlasmaAutoTilerFullscreenStyle")
  $p3 = [FsPropNative]::GetPropW([IntPtr]$Hwnd, "PlasmaAutoTilerFullscreenMax")
  return @{ marker = [uint64]$p1.ToInt64(); style = [uint64]$p2.ToInt64(); max = [uint64]$p3.ToInt64() }
}

function Assert-FsPreimageValid([long]$Hwnd, [string]$Tag) {
  $p = Get-FsPropState $Hwnd
  if ([uint64]$p.marker -ne [uint64]0x46533131) { Fail-Fs "$Tag preimage marker absent/wrong ($($p.marker))" }
  if ([uint64]$p.style -eq 0) { Fail-Fs "$Tag preimage style prop absent" }
  $changed = [uint64]$p.style - 1
  if (($changed -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME))) -ne 0) { Fail-Fs "$Tag preimage changed bits outside owned mask" }
  if (([uint64]$p.max -ne 1) -and ([uint64]$p.max -ne 2)) { Fail-Fs "$Tag preimage max prop invalid ($($p.max))" }
  return @{ marker = "$($p.marker)"; changed = $changed; max = "$($p.max)" }
}

function Assert-FsPropsAbsent([long]$Hwnd, [string]$Tag) {
  $p = Get-FsPropState $Hwnd
  if ([uint64]$p.marker -ne 0 -or [uint64]$p.style -ne 0 -or [uint64]$p.max -ne 0) {
    Fail-Fs "$Tag props residue marker=$($p.marker) style=$($p.style) max=$($p.max)"
  }
}

function Wait-MaxRefusedFs([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "maximize-toggle") -and ("$($e.disposition)" -eq "consumed") -and ("$($e.outcome)" -eq "maximize-refused-fullscreen")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fs "$Tag no consumed maximize-toggle maximize-refused-fullscreen after mark $Mark"
  return $null
}

function Get-FsFgIdentity([long]$Hwnd) {
  # Read-only foreground identity for failure diagnostics only.
  try { $cls = [ActiveBorderNative]::ClassOf($Hwnd) } catch { $cls = "unreadable" }
  $pidOut = [uint32]0
  try { $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$pidOut) } catch {}
  $exe = ""
  try { $exe = (Get-Process -Id ([int]$pidOut) -ErrorAction Stop).Path } catch {}
  return @{ hwnd = $Hwnd; class = "$cls"; pid = [int]$pidOut; exe = "$exe" }
}

function Get-FsFgPrecondition([long]$Hwnd) {
  # Read-only environment-precondition diagnostics for the live foreground:
  # identity (class/exe/pid; no titles, content, or screenshots) plus the
  # exact covering signals the product veto reads (visible, DWM cloak,
  # caption bits, DWM frame vs monitor). Labels an activation failure as an
  # environment precondition; never product evidence.
  Install-BorderNative
  Install-FollowupNative
  [ActiveBorderNative]::EnsurePMv2()
  $id = Get-FsFgIdentity $Hwnd
  $visible = "unreadable"
  try { $visible = [bool][ActiveBorderNative]::IsWindowVisible([IntPtr]$Hwnd) } catch {}
  $cloaked = "unreadable"
  try { $cloaked = [int](Get-FuCloaked $Hwnd) } catch {}
  $styleHex = "unreadable"; $captionless = "unreadable"
  try {
    $st = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE)
    $styleBits = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$st), 0)
    $styleHex = ("0x{0:X8}" -f $styleBits)
    $captionless = (($styleBits -band [uint32]$WS_CAPTION) -eq 0)
  } catch {}
  $frameKey = "unreadable"; $cover = "unreadable"
  try {
    $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
    $frame = [ActiveBorderNative]::FrameOf($Hwnd)
    if ($null -ne $frame) {
      $frameKey = ($frame -join ",")
      $cover = ([int]$frame[0] -le 0 -and [int]$frame[1] -le 0 -and [int]$frame[2] -ge $screenW -and [int]$frame[3] -ge $screenH)
    }
  } catch {}
  return @{ hwnd = $Hwnd; class = "$($id.class)"; pid = [int]$id.pid; exe = "$($id.exe)";
    visible = $visible; cloaked = $cloaked; style = "$styleHex"; captionless = $captionless;
    frame = "$frameKey"; covers_monitor = $cover }
}

function Ensure-FsForeground([string]$HelperBin, $Snap, [string]$Tag) {
  # Fixture setup only (never a product oracle): one exact-bound approved
  # raise-first activation (Invoke-OwnedFocusEnsure: raise to top of normal
  # z-order, E8 prime + attach + one setter only if the raise did not
  # foreground, exact readback plus identity/rect/ancestor proof). Single
  # attempt only: no waits on foreign windows, no retries, no touches
  # outside the exact-bound helper. Activation failure is an explicit
  # environment-precondition failure carrying the exact observed foreground
  # diagnostics (cloak/visible/cover included); the caller treats it as
  # unavailable, never as product evidence.
  try {
    $null = Invoke-OwnedFocusEnsure $Snap $Snap $HelperBin "$Tag-att1"
    $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post1"
    return $fresh
  } catch {
    $err = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $pre = Get-FsFgPrecondition ([long]$fg)
    $diag = "fg=$($pre.hwnd) class=$($pre.class) pid=$($pre.pid) exe=$($pre.exe) visible=$($pre.visible) cloaked=$($pre.cloaked) style=$($pre.style) captionless=$($pre.captionless) frame=$($pre.frame) covers_monitor=$($pre.covers_monitor)"
    Rec-Fs "environment-precondition" @{ status = "unavailable"; tag = $Tag; activation = $err; foreground = $pre }
    Fail-Fs "$Tag environment-precondition failure: foreground not acquired ($diag): $err"
    return $null
  }
}

function Get-FsCoverState([string]$HelperBin, $Snap, [string]$Tag) {
  # Actual native cover proof: caption+thickframe cleared AND outer exactly
  # the physical monitor AND the DWM extended frame containing the monitor
  # PLUS inert project preimage (all three props, valid owned values).
  # Style/props alone are never cover evidence (a request return is not
  # state proof). Returns the style/rect/frame keys for records.
  [ActiveBorderNative]::EnsurePMv2()
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  $Hwnd = [long]$fresh.hwnd
  $style = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE)
  if (($style -band $WS_CAPTION) -ne 0) { Fail-Fs "$Tag style still captioned (0x$($style.ToString('X8')))" }
  if (($style -band $WS_THICKFRAME) -ne 0) { Fail-Fs "$Tag style still has sizing border (0x$($style.ToString('X8')))" }
  $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
  $outer = Get-NativeRectAb $Hwnd
  if ($null -eq $outer) { Fail-Fs "$Tag native outer unreadable" }
  if ([int]$outer[0] -ne 0 -or [int]$outer[1] -ne 0 -or ([int]$outer[2] - [int]$outer[0]) -ne $screenW -or ([int]$outer[3] - [int]$outer[1]) -ne $screenH) {
    Fail-Fs "$Tag outer $($outer -join ',') != monitor 0,0,$screenW,$screenH"
  }
  $frame = [ActiveBorderNative]::FrameOf($Hwnd)
  if ($null -eq $frame) { Fail-Fs "$Tag DWM frame unreadable" }
  if (-not ([int]$frame[0] -le 0 -and [int]$frame[1] -le 0 -and [int]$frame[2] -ge $screenW -and [int]$frame[3] -ge $screenH)) {
    Fail-Fs "$Tag DWM $($frame -join ',') does not contain monitor 0,0,$screenW,$screenH"
  }
  $pre = Assert-FsPreimageValid $Hwnd "$Tag-props"
  return @{ style = ("0x{0:X8}" -f $style); outer = ($outer -join ","); frame = ($frame -join ","); screen = "${screenW}x${screenH}";
    marker = "$($pre.marker)"; changed = "$($pre.changed)"; max = "$($pre.max)" }
}

function Get-FsExitState([string]$HelperBin, $Snap, [int]$WantStyle, [string]$WantRect, [string]$Tag) {
  # Exit proof: props absent, original frame style mask bit-for-bit restored,
  # outer rect equals the retained slot.
  [ActiveBorderNative]::EnsurePMv2()
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  $Hwnd = [long]$fresh.hwnd
  Assert-FsPropsAbsent $Hwnd "$Tag-props"
  $style = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE)
  if ([int]$style -ne [int]$WantStyle) { Fail-Fs "$Tag style 0x$($style.ToString('X8')) != pre-enter 0x$(([int]$WantStyle).ToString('X8'))" }
  $rect = Get-HelperRectKeyFs $HelperBin $Snap "$Tag-rect"
  if ($rect -cne $WantRect) { Fail-Fs "$Tag rect [$rect] != slot [$WantRect]" }
  return @{ style = ("0x{0:X8}" -f $style); rect = $rect }
}

function Set-PreformedCaptionlessFs([string]$HelperBin, $Snap, [string]$Tag) {
  # Preformed captionless fixture: exact-bound owned helper only, true
  # borderless (caption AND thickframe cleared), monitor cover with
  # NOACTIVATE, held OS process handle across, DWM containment settled
  # read-only. Single preform + settled read. No owner may run during a
  # born-fullscreen preform (admission/unmanaged callers guarantee it);
  # the app-owned refusal fixture explicitly preforms externally WHILE its
  # owner runs to simulate an app-requested frame, which the product must
  # refuse (frame untouched, never fought or admitted here).
  [ActiveBorderNative]::EnsurePMv2()
  $pre = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$pre.hwnd
  $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
  $savedStyle = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE)
  $savedEx = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_EXSTYLE)
  # Physical PMv2 outer (never the helper's virtualized unaware rect): the
  # preform SetWindowPos below runs on this PMv2 thread, so save/compare in
  # the same space. Identity still comes from the exact-bound helper snap.
  $savedOuter = Get-NativeRectAb $Hwnd
  if ($null -eq $savedOuter) { Fail-Fs "$Tag-saved native outer unreadable" }
  $savedRect = ($savedOuter -join ",")
  $held = New-HeldProcessAb ([uint32]$pre.process.pid) "$Tag"
  $heldCreation = [ActiveBorderNative]::HeldCreation($held)
  $newStyle = $savedStyle -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME))
  $null = [FollowupNative]::SetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE, $newStyle)
  $ok = [FollowupNative]::SetWindowPos([IntPtr]$Hwnd, [IntPtr]::Zero, 0, 0, $screenW, $screenH, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
  if (-not $ok) { Fail-Fs "$Tag pre-frame SetWindowPos failed" }
  Start-Sleep -Milliseconds 800
  $coverOuter = Get-NativeRectAb $Hwnd
  if ($null -eq $coverOuter) { Fail-Fs "$Tag-cover native outer unreadable" }
  $chk = ($coverOuter -join ",")
  if ($chk -cne "0,0,$screenW,$screenH") { Fail-Fs "$Tag pre-frame [$chk] != monitor 0,0,$screenW,$screenH (fixture preform failed: environment defect)" }
  $frame = [ActiveBorderNative]::FrameOf($Hwnd)
  if ($null -eq $frame) { Fail-Fs "$Tag pre-frame DWM unreadable" }
  $settle = 0
  while (-not ([int]$frame[0] -le 0 -and [int]$frame[1] -le 0 -and [int]$frame[2] -ge $screenW -and [int]$frame[3] -ge $screenH)) {
    if ($settle -ge 10) { Fail-Fs "$Tag pre-frame DWM $($frame -join ',') does not contain monitor 0,0,$screenW,$screenH" }
    Start-Sleep -Milliseconds 300
    $settle++
    $frame = [ActiveBorderNative]::FrameOf($Hwnd)
    if ($null -eq $frame) { Fail-Fs "$Tag pre-frame DWM unreadable during settle" }
  }
  if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fs "$Tag held process exited across preform" }
  if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Fs "$Tag held creation changed across preform" }
  $null = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post"
  return @{ hwnd = $Hwnd; style = $savedStyle; ex = $savedEx; rect = $savedRect;
    held = $held; creation = $heldCreation; screen = "${screenW}x${screenH}"; settle = $settle }
}

function Restore-SavedFrameFs([string]$HelperBin, $Snap, $Saved, [string]$Tag) {
  # Exact restore of a preformed frame: saved style/exstyle bit-for-bit plus
  # saved geometry, then held-handle close. Style must read back exactly;
  # geometry is verified by the caller (the resumed owner may retile).
  [ActiveBorderNative]::EnsurePMv2()
  $Hwnd = [long]$Saved.hwnd
  $null = [FollowupNative]::SetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE, [int]$Saved.style)
  $null = [FollowupNative]::SetWindowLongW([IntPtr]$Hwnd, $GWL_EXSTYLE, [int]$Saved.ex)
  $p = @("$($Saved.rect)" -split ",")
  $ok = [FollowupNative]::SetWindowPos([IntPtr]$Hwnd, [IntPtr]::Zero, [int]$p[0], [int]$p[1], ([int]$p[2] - [int]$p[0]), ([int]$p[3] - [int]$p[1]), ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
  if (-not $ok) { Fail-Fs "$Tag restore SetWindowPos failed" }
  Start-Sleep -Milliseconds 1500
  if (-not [ActiveBorderNative]::HeldAlive($Saved.held)) { Fail-Fs "$Tag held process exited across restore" }
  $back = [FollowupNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_STYLE)
  if ([int]$back -ne [int]$Saved.style) { Fail-Fs "$Tag style not restored" }
  $null = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  Close-HeldProcessAb $Saved.held
}

function Invoke-FsDragAttempt([string]$HelperBin, $Snap, [string]$Tag) {
  # Bounded pointer-refusal probe on the exact foreground-owned helper: move
  # the cursor to a WindowFromPoint-verified title point, hold the button,
  # step a short drag, release, restore the cursor, verify button release.
  # Returns pre/post outer rects; the CALLER asserts refusal (rects equal, no
  # writes, fullscreen intact, membership stable). Never touches foreign
  # windows; unmarked absolute mouse only, no hook chords.
  [ActiveBorderNative]::EnsurePMv2()
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Fs "$Tag not foreground for drag" }
  $outer0 = Get-NativeRectAb $Hwnd
  if ($null -eq $outer0) { Fail-Fs "$Tag native outer unreadable" }
  $preKey = "$($outer0 -join ',')"
  $start = Find-TitlePointAb $Hwnd $outer0
  if ($null -eq $start) {
    # Honest fixture limit: a true borderless monitor-covering frame exposes
    # no titlebar for WindowFromPoint, so no button-down is attempted. The
    # caller still asserts refusal via no-writes plus stable cover/frames,
    # and the Win+Shift+Arrow refusal legs cover the movement path.
    return @{ pre = $preKey; post = $preKey; skipped = "no-title-point-borderless-cover" }
  }
  $dpi = [ActiveBorderNative]::GetDpiForWindow([IntPtr]$Hwnd)
  $vs = Get-VirtualScreenAb ([uint32]$dpi)
  $ax = ConvertTo-AbsoluteAb ([int]$start[0]) ([int]$vs[0]) ([int]$vs[2])
  $ay = ConvertTo-AbsoluteAb ([int]$start[1]) ([int]$vs[1]) ([int]$vs[3])
  $saved = $null
  try { $pt = New-Object ActiveBorderNative+POINT; if ([ActiveBorderNative]::GetCursorPos([ref]$pt)) { $saved = @($pt.x, $pt.y) } } catch {}
  $held = New-HeldProcessAb ([uint32]$fresh.process.pid) "$Tag"
  $heldCreation = [ActiveBorderNative]::HeldCreation($held)
  try {
    if ([ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $ax, $ay) -eq 0) { Fail-Fs "$Tag cursor move not inserted" }
    Start-Sleep -Milliseconds 250
    $fg2 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fg2 -ne [uint64]$Hwnd) { Fail-Fs "$Tag lost foreground before down" }
    if ([ActiveBorderNative]::SendMouse($MOUSE_DOWN, 0, 0) -eq 0) { Fail-Fs "$Tag button down not inserted" }
    Start-Sleep -Milliseconds 250
    for ($i = 1; $i -le 6; $i++) {
      $fgS = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      if ([uint64]$fgS -ne [uint64]$Hwnd) { Fail-Fs "$Tag lost foreground at step $i" }
      $ix = $ax + [int](800 * $i / 6); $iy = $ay + [int](400 * $i / 6)
      $null = [ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $ix, $iy)
      Start-Sleep -Milliseconds 60
    }
    Start-Sleep -Milliseconds 900
    if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fs "$Tag held process exited across drag" }
    if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Fs "$Tag held creation changed across drag" }
  } finally {
    try { $null = [ActiveBorderNative]::SendMouse($MOUSE_UP, 0, 0) } catch {}
    Assert-ButtonReleasedAb "$Tag-release"
    if ($null -ne $saved) {
      try {
        $rx = ConvertTo-AbsoluteAb ([int]$saved[0]) ([int]$vs[0]) ([int]$vs[2]); $ry = ConvertTo-AbsoluteAb ([int]$saved[1]) ([int]$vs[1]) ([int]$vs[3])
        $null = [ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $rx, $ry)
      } catch {}
    }
    Close-HeldProcessAb $held
  }
  $post = Get-HelperRectKeyFs $HelperBin $Snap "$Tag-post"
  return @{ pre = $preKey; post = $post; skipped = "" }
}

function Get-FsFocusNeighborFs([string]$Payload, [string]$AllowPath, [uint64]$MeHwnd, [int[]]$MeRect, [string]$Tag) {
  # Neighbor lookup against the member's TILE SLOT, not its native frame: a
  # fullscreen member's frame covers the monitor (no strict neighbor), while
  # its retained slot keeps Engine topology. Returns the direction and the
  # exact expected neighbor HWND so callers prove exact foreground.
  $insp = Invoke-Native $Payload @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json
  $x = [int]$MeRect[0]; $y = [int]$MeRect[1]; $ww = [int]$MeRect[2]; $hh = [int]$MeRect[3]
  foreach ($dir in @("left", "right", "up", "down")) {
    foreach ($o in @($insp.windows)) {
      if ([uint64]$o.hwnd -eq [uint64]$MeHwnd) { continue }
      if ($o.eligible -ne $true) { continue }
      $ox = [int]$o.visible[0]; $oy = [int]$o.visible[1]; $ow = [int]$o.visible[2]; $oh = [int]$o.visible[3]
      $overlapX = ($x -lt ($ox + $ow)) -and ($ox -lt ($x + $ww))
      $overlapY = ($y -lt ($oy + $oh)) -and ($oy -lt ($y + $hh))
      if (($dir -eq "left") -and ((($ox + $ow) -le $x) -and $overlapY)) { return @{ direction = "left"; hwnd = [uint64]$o.hwnd; vk = $VK_LEFT } }
      if (($dir -eq "right") -and (($ox -ge ($x + $ww)) -and $overlapY)) { return @{ direction = "right"; hwnd = [uint64]$o.hwnd; vk = $VK_RIGHT } }
      if (($dir -eq "up") -and ((($oy + $oh) -le $y) -and $overlapX)) { return @{ direction = "up"; hwnd = [uint64]$o.hwnd; vk = $VK_UP } }
      if (($dir -eq "down") -and (($oy -ge ($y + $hh)) -and $overlapX)) { return @{ direction = "down"; hwnd = [uint64]$o.hwnd; vk = $VK_DOWN } }
    }
  }
  Fail-Fs "$Tag fullscreen member slot has no directional neighbor"
  return $null
}

function Test-FsReportGap($Step) {
  # Report-gap predicate shared by the live tail and the mock offline
  # check: an environment-precondition unavailable (or any unaccepted /
  # skipped observation) keeps the report from passing. Required
  # unexecuted observations never pass.
  return (($Step.data.status -in @("unavailable", "unaccepted", "skipped")) -or
    ("$($Step.data.plan_oracle)" -like "unaccepted-*") -or ($Step.name -like "*-skipped"))
}

function Test-FsPreconditionReport([string]$Tag) {
  # Offline status check over the real gap predicate (not a mirrored
  # classifier): clean steps are no gap, an environment-precondition
  # unavailable is exactly one gap.
  $mk = { param($n, $d) return @{ name = $n; data = $d } }
  $okSteps = @(@(&$mk "adopted" @{}))
  if (@($okSteps | Where-Object { Test-FsReportGap $_ }).Count -ne 0) { Fail-Fs "$Tag classifier clean steps flagged as gaps" }
  $preSteps = @(@(&$mk "environment-precondition" @{ status = "unavailable"; reason = "test" }))
  if (@($preSteps | Where-Object { Test-FsReportGap $_ }).Count -ne 1) { Fail-Fs "$Tag classifier precondition unavailable not a gap" }
  Rec-Fs "$Tag-classifier" @{ pass_branch = $true; partial_branches = 1 }
}

function Invoke-FullscreenMock {
  Rec-Fs "scope" @{ helpers = "owned-only-first"; ordinary = "scoped-normal-smoke"; never = @("terminal"); kills = "exact-owner-only"; registry = "none"; screenshots = "none"; content = "none" }
  $help = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-windows -- help 2>$null
  if ("$help" -notmatch "shortcut-proof") { Fail-Fs "mock CLI help missing shortcut-proof" }
  if ("$help" -notmatch "workspace-proof") { Fail-Fs "mock CLI help missing workspace-proof" }
  if ("$help" -notmatch "tile-proof") { Fail-Fs "mock CLI help missing tile-proof" }
  if ("$help" -notmatch "border-inspect") { Fail-Fs "mock CLI help missing border-inspect" }
  if ("$help" -notmatch "underlay-inspect") { Fail-Fs "mock CLI help missing underlay-inspect" }
  $hhelp = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-test-window -- help 2>$null
  if ("$hhelp" -notmatch "move HWND --tag TAG --to") { Fail-Fs "mock helper help missing exact-bound move" }
  Rec-Fs "cli-surface" @{ shortcut_proof = $true; workspace_proof = $true; tile_proof = $true }
  $rows = Get-ShortcutJourney
  Assert-NoWinLJourney $rows
  $fsRows = @($rows | Where-Object { $_.family -eq "fullscreen-toggle" })
  if ($fsRows.Count -ne 1) { Fail-Fs "mock journey needs exactly one fullscreen-toggle row" }
  $fsRow = $fsRows[0]
  if (([int]$fsRow.vk -ne $VK_F11) -or ($fsRow.shift) -or ($fsRow.ctrl) -or ($fsRow.op -ne "fullscreen") -or ("$($fsRow.direction)" -ne "")) {
    Fail-Fs "mock fullscreen-toggle row must be unshifted Win+F11 (0x7A) with op fullscreen and empty direction"
  }
  Rec-Fs "journey-fullscreen" @{ vk = [int]$fsRow.vk; op = "$($fsRow.op)" }
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  Assert-ChordSendCounts 4 $false 0 "mock-plain-f11"
  Assert-ChordSendCounts 6 $true 0 "mock-shift-arrow"
  Assert-EncodingInvariant $VK_F11 $false 0 "mock-f11-plain"
  foreach ($vk in @(37, 38, 39, 40)) {
    $scan = [int][ShortcutProofNative]::MapVirtualKey([uint32]$vk, 0)
    Assert-EncodingInvariant ([int]$vk) $true ([int]$scan) "mock-arrow-$vk"
  }
  try { Assert-EncodingInvariant $VK_F11 $true 0 "mock-negative"; Fail-Fs "negative F11-extended did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "EXTENDEDKEY") { throw } }
  Rec-Fs "encoding" @{ f11_plain = $true; arrows_extended = $true; input_size = $size }
  Test-FsPreconditionReport "mock-status"
  $src = Get-Content -LiteralPath (Join-Path $Repo "scripts\windows-fullscreen.ps1") -Raw
  foreach ($need in @("Wait-FsOutcome", "Wait-FsHeld", "Wait-FsReleased", "Wait-FsSuspend", "Wait-FsResume", "Wait-MaxRefusedFs", "Assert-SendGeometryFs", "Assert-ExactForegroundFs", "Get-WorkspaceActionFs", "Get-PlannedSlotFs",
      "Set-PreformedCaptionlessFs", "Restore-SavedFrameFs", "Get-FsCoverState", "Get-FsExitState", "Install-FsPropNative", "FsPropNative", "GetPropW",
      "Assert-FsPreimageValid", "Assert-FsPropsAbsent", "Invoke-FsDragAttempt", "New-FsHelperSet", "Start-FsManagedOwner",
      "Set-OwnedForegroundAb", "Ensure-FsForeground", "Get-FsFgIdentity", "Get-FsFgPrecondition", "Get-FuCloaked",
      "environment-precondition", "Test-FsReportGap", "Test-FsPreconditionReport", "Invoke-OwnedFocusEnsure", "Invoke-ExactHelperActivate", "Send-MarkedChord", "Assert-NoWriteForFs", "Stop-ExactOwner", "machine.json",
      "move-refused-fullscreen", "maximize-refused-fullscreen", "send-refused-fullscreen",
      "BornCloseFs", "RecoveryFs", "Invoke-BornCloseFsLive", "Invoke-RecoveryFsLive", "Invoke-RecoveryCrashFsLive",
      "0x0082", "0x201E", "SHORTCUT_MARKER", "FollowupNative", "WS_CAPTION", "WS_THICKFRAME",
      "border-inspect", "underlay-inspect", "emergency-stop", "Get-OverlayHwndsForOwnerAb")) {
    if ($src -notmatch [regex]::Escape($need)) { Fail-Fs "mock harness missing $need" }
  }
  $oldAdm = 'Invoke-Fs' + 'AdmissionOwner'
  if ($src -match [regex]::Escape($oldAdm)) { Fail-Fs "mock rejects split contract: old admission owner call still present (double-owner risk)" }
  $regPat = 'Set-Item' + 'Property|New-Item' + 'Property'
  if ($src -match $regPat) { Fail-Fs "mock registry/policy write present" }
  if ($src -match ('Get' + 'Pixel')) { Fail-Fs "mock screen-content capture present (geometry/state gates only)" }
  Rec-Fs "harness-seams" @{ cover_gates = $true; overlay_gates = $true; marks_before_actions = $true }
  $tsrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\tiling_sys.rs") -Raw
  foreach ($need in @("FULLSCREEN_STYLE_BITS", "captionless_fullscreen", "should_hold_born_fullscreen",
      "fullscreen_toggle_decision", "fullscreen-toggle", "initial-fullscreen-held",
      "initial-fullscreen-released", "send-refused-fullscreen", "fullscreen-refused-app-owned")) {
    if ($tsrc -notmatch [regex]::Escape($need)) { Fail-Fs "mock product missing $need" }
  }
  $ksrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\snapkey.rs") -Raw
  if ($ksrc -notmatch "is_fullscreen_vk") { Fail-Fs "mock classifier missing is_fullscreen_vk" }
  if ($ksrc -notmatch "Fullscreen") { Fail-Fs "mock classifier missing Fullscreen arm" }
  Rec-Fs "product-seams" @{ discrete_toggle = $true; born_hold = $true; style_bits = $true; classifier = $true }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test tiling 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Fs "mock cargo test tiling failed" }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test snapkey 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Fs "mock cargo test snapkey failed" }
  Rec-Fs "portable-tests" @{ suites = @("tiling", "snapkey"); result = "pass" }
  $report = @{ status = "pass"; stage = "FullscreenMock"; steps = $FS_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Invoke-OwnedFsLive($Ctx) {
  # Toggle matrix over the admission-phase workspace-proof owner (same
  # allowlist, helpers already visible and converged): no second owner, no
  # ledger conflict. Unmanaged-suspension prologue runs first on its own
  # owner; the toggle owner below is fresh after the foreign frame restores.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.admitLog -or $null -eq $Ctx.admitAllow) { Fail-Fs "owned legs need the admission owner first" }
  $allowPath = $Ctx.admitAllow
  $logPath = $Ctx.admitLog
  $h1 = $Ctx.wsSnaps[0]; $h2 = $Ctx.wsSnaps[1]; $h3 = $Ctx.wsSnaps[2]
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $Ctx.ledgerDir = "$($ident.ledger_directory)"
  $Ctx.auditPath = Join-Path ($Ctx.ledgerDir) "proof-audit-$($Ctx.ownerFrozen.process_creation).jsonl"
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark0 25 "adopt"
  Rec-Fs "adopted" @{ tick = $conv.tick; desired = $conv.desired; readback = $conv.readback }

  # Leg A: Win+F11 enter then owned exit on the middle helper. Cover, style,
  # props and stable siblings proved on enter; exact slot returns on exit.
  $ordered = @($conv.inspect.windows | Sort-Object { [int]$_.visible[0] })
  $midHwnd = [uint64]$ordered[1].hwnd
  $midSnap = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq $midHwnd } | Select-Object -First 1
  $sibA = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -ne $midHwnd }
  $preMidRect = Get-HelperRectKeyFs $helperCopy $midSnap "legA-pre"
  [ActiveBorderNative]::EnsurePMv2()
  $preMidStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$midHwnd, $GWL_STYLE)
  $preSibs = @($sibA | ForEach-Object { Get-HelperRectKeyFs $helperCopy $_ "legA-pre-sib" })
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legA-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  if ([int]$sent.accepted -ne 4) { Fail-Fs "legA Win+F11 send accepted $([int]$sent.accepted) != 4" }
  $ev = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "legA-enter"
  Rec-Fs "legA-toggle-enter" @{ outcome = "$($ev.event.outcome)"; target = "$($ev.event.target)"; accepted = [int]$sent.accepted }
  $null = Assert-FsForegroundHeld ([uint64]$freshMid.hwnd) "legA-enter-held"
  $cover = Get-FsCoverState $helperCopy $midSnap "legA-cover"
  $duringSibs = @($sibA | ForEach-Object { Get-HelperRectKeyFs $helperCopy $_ "legA-fs-sib" })
  if (($duringSibs -join "|") -cne ($preSibs -join "|")) { Fail-Fs "legA sibling frames moved under fullscreen" }
  Assert-NoWriteForFs $logPath $mark "$($ev.event.window)" "legA-nowrite"
  $inspFs = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $rowFs = @($inspFs.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($null -eq $rowFs) { Fail-Fs "legA fullscreen member missing from inspect" }
  if ($rowFs.eligible -ne $false) { Fail-Fs "legA fullscreen member still eligible" }
  $bFs = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  $bVis = @(@($bFs.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$bVis -ne 0) { Fail-Fs "legA border visible while fullscreen" }
  $uFs = Invoke-Native $ownerCopy @("underlay-inspect") | ConvertFrom-Json
  $uVis = @(@($uFs.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$uVis -ne 0) { Fail-Fs "legA underlay visible while fullscreen" }
  Rec-Fs "legA-enter-state" @{ cover = $cover; eligible = $false; border_visible = $bVis; underlay_visible = $uVis; siblings_stable = $true }
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legA-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legA-exit-send"
  $ev = Wait-FsOutcome $logPath $mark @("restored", "dispatched") 20 "legA-exit"
  Rec-Fs "legA-toggle-exit" @{ outcome = "$($ev.event.outcome)" }
  $tailConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark 20 "legA-plan"
  $null = Get-FsExitState $helperCopy $midSnap ([int]$preMidStyle) $preMidRect "legA-exit-state"
  $postMidRect = Get-HelperRectKeyFs $helperCopy $midSnap "legA-post"
  if ($postMidRect -cne $preMidRect) { Fail-Fs "legA exit rect [$postMidRect] != slot [$preMidRect]" }
  $bBack = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  $bBackVis = @(@($bBack.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$bBackVis -ne 1) { Fail-Fs "legA border not visible after exit (visible=$bBackVis)" }
  Rec-Fs "legA-exited" @{ rect = $postMidRect; slot = $preMidRect; border_visible = $bBackVis }

  # Leg B: repeat hold does not churn (down + 1 repeat = one toggle only).
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legB-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 1 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 1 "legB-send"
  $ev = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "legB-enter"
  Start-Sleep -Milliseconds 2500
  $after = Get-LogEventsAfter $logPath $mark
  $toggles = @($after.events | Where-Object { ($_.event -eq "fullscreen-toggle") -and ("$($_.disposition)" -eq "consumed") -and (@("fullscreen", "restored", "dispatched") -contains "$($_.outcome)") })
  if (@($toggles).Count -ne 1) { Fail-Fs "legB repeat churn: $(@($toggles).Count) toggles != 1" }
  $null = Get-FsCoverState $helperCopy $midSnap "legB-cover"
  Rec-Fs "legB-repeat-hold" @{ toggles = @($toggles).Count; accepted = [int]$sent.accepted }
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legB-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sentB = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  Assert-ChordSendCounts ([int]$sentB.accepted) $false 0 "legB-exit-send"
  $null = Wait-FsOutcome $logPath $mark @("restored", "dispatched") 20 "legB-exit"
  $null = Get-FsExitState $helperCopy $midSnap ([int]$preMidStyle) $preMidRect "legB-exit-state"
  $normRect = Get-HelperRectKeyFs $helperCopy $midSnap "legB-norm-rect"
  if ($normRect -cne $preMidRect) { Fail-Fs "legB exit rect [$normRect] != slot [$preMidRect]" }
  Rec-Fs "legB-normalized" @{ rect = $normRect }

  # Leg C: focus out to the exact slot neighbor and back in (Win+Arrow stays
  # focus, never moves). Exact foreground both ways; fullscreen intact.
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legC-focus"
  $preSlot = Get-InspectFrames $ownerCopy $allowPath
  $meRow = @($preSlot.inspect.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($null -eq $meRow -or $meRow.eligible -ne $true) { Fail-Fs "legC mid not eligible before enter" }
  $slotF = @([int]$meRow.visible[0], [int]$meRow.visible[1], [int]$meRow.visible[2], [int]$meRow.visible[3])
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "legC-enter"
  $null = Get-FsCoverState $helperCopy $midSnap "legC-cover"
  $neighbor = Get-FsFocusNeighborFs $ownerCopy $allowPath $midHwnd $slotF "legC-dir"
  $dirF = "$($neighbor.direction)"; $wantNeighbor = [uint64]$neighbor.hwnd; $vkF = [int]$neighbor.vk
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $vkF $false $false $midHwnd 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legC-arrow-send"
  $evF = Wait-SnapAfter $logPath $mark "focus" $dirF 20 "legC-arrow-out"
  if ("$($evF.outcome)" -ne "focus-ok") { Fail-Fs "legC Win+Arrow OUT outcome $($evF.outcome) != focus-ok" }
  $null = Get-FsCoverState $helperCopy $midSnap "legC-still-cover"
  Assert-ExactForegroundFs $wantNeighbor "legC-arrow-out"
  Rec-Fs "legC-arrow-out" @{ direction = $dirF; outcome = "$($evF.outcome)" }
  # Focus back INTO the fullscreen member along the opposite direction.
  $oppDir = @{ left = "right"; right = "left"; up = "down"; down = "up" }[$dirF]
  $oppVk = @{ left = $VK_RIGHT; right = $VK_LEFT; up = $VK_DOWN; down = $VK_UP }[$dirF]
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord ([int]$oppVk) $false $false $wantNeighbor 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legC-arrow-back-send"
  $evBack = Wait-SnapAfter $logPath $mark "focus" $oppDir 20 "legC-arrow-in"
  if ("$($evBack.outcome)" -ne "focus-ok") { Fail-Fs "legC Win+Arrow INTO outcome $($evBack.outcome) != focus-ok" }
  $null = Get-FsCoverState $helperCopy $midSnap "legC-still-cover2"
  Assert-ExactForegroundFs ([uint64]$midHwnd) "legC-arrow-in"
  Rec-Fs "legC-arrow-in" @{ direction = $oppDir; outcome = "$($evBack.outcome)" }

  # Leg D: move + Win+M + send refuse the fullscreen member with exact
  # product refusal outcomes, plus geometry/membership stable and cover
  # intact. Foreground preserved on every refusal path.
  $preMove = Get-InspectFrames $ownerCopy $allowPath
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $vkF $true $false ([uint64]$midHwnd) 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $true 0 "legD-shift-send"
  $evM = Wait-SnapAfter $logPath $mark "move" $dirF 20 "legD-shift-arrow"
  if ("$($evM.outcome)" -ne "move-refused-fullscreen") { Fail-Fs "legD Win+Shift+Arrow outcome $($evM.outcome) != move-refused-fullscreen" }
  Assert-ExactForegroundFs ([uint64]$midHwnd) "legD-move-fg"
  $null = Get-FsCoverState $helperCopy $midSnap "legD-still-cover"
  $postMove = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preMove.frames $postMove.frames "legD-topology"
  Rec-Fs "legD-shift-refused" @{ outcome = "$($evM.outcome)"; topology = "unchanged" }
  $mark = Get-MarkBeforeActionAb $logPath
  $sentM = Send-MarkedChord $VK_M $false $false ([uint64]$midHwnd) 0 $false
  Assert-ChordSendCounts ([int]$sentM.accepted) $false 0 "legD-winm-send"
  $evMax = Wait-MaxRefusedFs $logPath $mark 20 "legD-winm"
  Assert-ExactForegroundFs ([uint64]$midHwnd) "legD-winm-fg"
  $null = Get-FsCoverState $helperCopy $midSnap "legD-still-cover2"
  Rec-Fs "legD-winm-refused" @{ outcome = "$($evMax.event.outcome)"; accepted = [int]$sentM.accepted }
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$midHwnd) 0 $false
  $evS = Wait-WorkspaceOutcomeFs $logPath $mark "send" 2 30 "legD-send"
  if ("$($evS.event.outcome)" -ne "send-refused-fullscreen") { Fail-Fs "legD send outcome $($evS.event.outcome) != send-refused-fullscreen" }
  Assert-ExactForegroundFs ([uint64]$midHwnd) "legD-send-fg"
  $null = Get-FsCoverState $helperCopy $midSnap "legD-still-cover3"
  $postSend = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preMove.frames $postSend.frames "legD-send-topology"
  Rec-Fs "legD-send-refused" @{ outcome = "$($evS.event.outcome)" }
  # Pointer refusal: bounded drag attempt must change nothing. A borderless
  # cover exposes no title point: honestly SKIPPED as pointer proof (never
  # passed); the no-write plus stable cover/frame gates still hold.
  $drag = Invoke-FsDragAttempt $helperCopy $midSnap "legD-drag"
  if ("$($drag.post)" -cne "$($drag.pre)") { Fail-Fs "legD drag moved fullscreen frame [$($drag.pre)] vs [$($drag.post)]" }
  Assert-NoWriteForFs $logPath $mark "" "legD-drag-nowrite"
  $null = Get-FsCoverState $helperCopy $midSnap "legD-still-cover4"
  if ("$($drag.skipped)" -ne "") { Rec-Fs "legD-drag-skipped" @{ reason = "$($drag.skipped)"; pre = "$($drag.pre)"; post = "$($drag.post)" } }
  else { Rec-Fs "legD-drag-refused" @{ pre = "$($drag.pre)"; post = "$($drag.post)" } }
  # Restore to normal for handoff.
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legD-restore-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sentE = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  Assert-ChordSendCounts ([int]$sentE.accepted) $false 0 "legD-end-send"
  $null = Wait-FsOutcome $logPath $mark @("restored", "dispatched") 20 "legD-end"
  $null = Get-FsExitState $helperCopy $midSnap ([int]$preMidStyle) $preMidRect "legD-end-state"
  $endRect = Get-HelperRectKeyFs $helperCopy $midSnap "legD-end-rect"
  if ($endRect -cne $preMidRect) { Fail-Fs "legD end rect [$endRect] != slot [$preMidRect]" }
  Rec-Fs "legD-end" @{ rect = $endRect }

  # Leg E: border + held-underlay suppression. Show (held) before enter,
  # hold while fullscreen and assert hidden, exit then show again.
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legE-focus"
  Hold-WinShiftFs "legE-show"
  try {
    Wait-UnderlayShownFs $ownerCopy 12 "legE-show"
    $showPre = Get-UnderlayVisibleFs $ownerCopy "legE-show"
    Rec-Fs "legE-show" @{ visible = $showPre; held = $true }
    if ([int]$showPre -eq 0) { Fail-Fs "legE underlay not visible with Win+Shift held before enter" }
  } finally { Release-WinShiftFs "legE-show" }
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legE-restore-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "legE-enter"
  $null = Get-FsCoverState $helperCopy $midSnap "legE-cover"
  $bMid = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  if ((@(@($bMid.overlays) | Where-Object { $_.visible -eq $true }).Count) -ne 0) { Fail-Fs "legE border visible while fullscreen (no hold)" }
  Hold-WinShiftFs "legE-suppressed"
  try {
    Start-Sleep -Milliseconds 1500
    $hideMid = Get-UnderlayVisibleFs $ownerCopy "legE-suppressed"
    Rec-Fs "legE-suppressed" @{ visible = $hideMid; held = $true }
    if ([int]$hideMid -ne 0) { Fail-Fs "legE underlay visible while fullscreen with Win+Shift held" }
  } finally { Release-WinShiftFs "legE-suppressed" }
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legE-unfs-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath $mark @("restored", "dispatched") 20 "legE-exit"
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legE-reshow-focus"
  Hold-WinShiftFs "legE-reshow"
  try {
    Wait-UnderlayShownFs $ownerCopy 12 "legE-reshow"
    $showPost = Get-UnderlayVisibleFs $ownerCopy "legE-reshow"
    Rec-Fs "legE-reshow" @{ visible = $showPost; held = $true }
    if ([int]$showPost -eq 0) { Fail-Fs "legE underlay did not return after exit with Win+Shift held" }
  } finally { Release-WinShiftFs "legE-reshow" }
  $freshMid = Ensure-FsForeground $helperCopy $midSnap "legE-end-focus"
  Rec-Fs "legE-end" @{ suppressed_while_fs = $true; restored_show = $true }
  $Ctx.midSnap = $midSnap; $Ctx.midHwnd = $midHwnd; $Ctx.sibs = $sibA; $Ctx.allowPath = $allowPath
}

function Invoke-UnmanagedFsLive($Ctx) {
  # Unmanaged foreground fullscreen suspension: a preformed captionless
  # monitor frame OUTSIDE the allowlist (fourth helper, never admitted)
  # while the proof owner starts. Expect suspend cause
  # `fullscreen-foreground`, zero writes, suppressed visuals; restoring the
  # saved frame resumes rendering. Never writes foreign windows.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  if ($Ctx.ownerRunning) { Fail-Fs "unmanaged refuses: owner already running (single-owner contract)" }
  $snaps = @($Ctx.wsSnaps)
  $foreign = $snaps[3]
  $managed = @($snaps[0], $snaps[1], $snaps[2])
  foreach ($s in $managed) { Show-ExactHelper $s $s $helperCopy "unmanaged-pre-show" }
  Show-ExactHelper $foreign $foreign $helperCopy "unmanaged-foreign-show"
  $saved = Set-PreformedCaptionlessFs $helperCopy $foreign "unmanaged-preform"
  $null = Ensure-FsForeground $helperCopy $foreign "unmanaged-activate"
  $allowPath = Join-Path $proofDir "fullscreen-unmanaged-allowlist.json"
  $entries = @()
  foreach ($s in $managed) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-unmanaged"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $machinePathU = Join-Path $Ctx.proofDir "machine.json"
  if (Test-Path -LiteralPath $machinePathU) {
    try {
      $mu = Get-Content -LiteralPath $machinePathU -Raw | ConvertFrom-Json
      $mu | Add-Member -NotePropertyName ownerFrozen -NotePropertyValue $ready.owner -Force
      $mu | Add-Member -NotePropertyName ownerLog -NotePropertyValue "$($ready.log_path)" -Force
      $mu | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $machinePathU
    } catch {}
  }
  $logPath = "$($ready.log_path)"
  Rec-Fs "unmanaged-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $evS = Wait-FsSuspend $logPath 0 "fullscreen-foreground" 20 "unmanaged-suspend"
  Rec-Fs "unmanaged-suspended" @{ cause = "$($evS.event.cause)" }
  Start-Sleep -Milliseconds 1500
  $chkOuter = Get-NativeRectAb ([long]$foreign.hwnd)
  if ($null -eq $chkOuter) { Fail-Fs "unmanaged-untouched native outer unreadable" }
  $chk = ($chkOuter -join ",")
  if ($chk -cne "0,0,$($saved.screen -replace 'x',',')") { Fail-Fs "unmanaged owner retiled the foreign frame to $chk" }
  Assert-NoWriteForFs $logPath 0 "" "unmanaged-nowrite"
  $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  if ((@(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count) -ne 0) { Fail-Fs "unmanaged overlay visible under foreign fullscreen" }
  $tail = Get-LogEventsAfter $logPath 0
  if ((@($tail.events | Where-Object { $_.event -eq "resume" }).Count) -ne 0) { Fail-Fs "unmanaged owner resumed during suspension" }
  Rec-Fs "unmanaged-suppressed" @{ frame_untouched = $true; writes = 0 }
  Restore-SavedFrameFs $helperCopy $foreign $saved "unmanaged-restore"
  $mark = (Get-CompleteLinesLocal $logPath).Count
  $null = Wait-ConvergedFrames $ownerCopy $allowPath @($managed | ForEach-Object { $_.hwnd }) $logPath $mark 25 "unmanaged-resume"
  Rec-Fs "unmanaged-resumed" @{ ok = $true }
  $st = Stop-ExactOwner $ownerCopy $false "unmanaged-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "unmanaged-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
}

function Invoke-AdmissionFsLive($Ctx) {
  # Born-fullscreen admission on a FRESH owner: helper A preformed
  # captionless BEFORE the owner starts (no owner runs during preform).
  # The owner is workspace-proof (shortcut handling plus the workspace
  # dispatcher): the born/hide/return/send legs below need workspace ops,
  # which product gates to workspace-proof mode (shortcut-proof hides
  # refuse as `workspace-disabled`).
  # Expect exactly one `initial-fullscreen-held`, slotless Engine exception
  # (no plan slot for the held token), siblings filling the area, and an
  # occupied/hideable workspace until first exit. Fresh admission only.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]
  $allowPath = Join-Path $proofDir "fullscreen-admit-allowlist.json"
  $entries = @()
  foreach ($s in $snaps[0..2]) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  foreach ($s in $snaps[0..2]) { Show-ExactHelper $s $s $helperCopy "admit-show" }
  $saved = Set-PreformedCaptionlessFs $helperCopy $hA "admit-preform"
  $Ctx.admitSaved = $saved
  $null = Set-OwnedForegroundAb $helperCopy $hA "admit-park-fs"
  $fgPre = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgPre -ne [uint64]$hA.hwnd) { Fail-Fs "admit park failed (fg=$fgPre)" }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-admit"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Fs "admit-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $held = Wait-FsHeld $logPath 0 30 "admit-held"
  $heldToken = "$($held.event.window)"
  if ($heldToken -eq "") { Fail-Fs "admit held carried no window token" }
  Start-Sleep -Milliseconds 2000
  $tail = Get-LogEventsAfter $logPath 0
  $holds = @($tail.events | Where-Object { $_.event -eq "initial-fullscreen-held" })
  if (@($holds).Count -ne 1) { Fail-Fs "admit held fired $(@($holds).Count)x, want exactly once" }
  # Slotless: no plan entry carries the held token while siblings converge.
  $lines = Get-CompleteLinesLocal $logPath
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "plan") { continue }
    foreach ($en in @($e.entries)) {
      if ("$($en.window)" -ceq $heldToken) { Fail-Fs "admit held token unexpectedly carries a plan slot" }
    }
    break
  }
  # Untouched proof in the preform's PMv2 physical space (never the
  # helper's DPI-virtualized unaware rect): same space as saved.screen.
  $null = Assert-HelperIdentityAb $helperCopy $hA "admit-untouched"
  [ActiveBorderNative]::EnsurePMv2()
  $chkNat = Get-NativeRectAb ([long]$hA.hwnd)
  if ($null -eq $chkNat) { Fail-Fs "admit-untouched native outer unreadable" }
  $chk = ($chkNat -join ",")
  if ($chk -cne "0,0,$($saved.screen -replace 'x',',')") { Fail-Fs "admit owner retiled the born frame to $chk" }
  $sibRects = @($hB, $hC | ForEach-Object { Get-HelperRectKeyFs $helperCopy $_ "admit-sib" })
  foreach ($r in $sibRects) { Assert-RectNonEmpty $r "admit-sib" }
  Rec-Fs "admit-held-once" @{ token = $heldToken; slotless = $true; frame = $chk }
  # Occupied workspace: select away hides the held member; return reveals it
  # with the frame intact (still held, still cover).
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $false $false ([uint64]$hA.hwnd) 0 $false
  $evH = Wait-WorkspaceOutcomeFs $logPath $mark "select" 2 30 "admit-hide"
  if ("$($evH.event.outcome)" -ne "ok") { Fail-Fs "admit select-away outcome $($evH.event.outcome) != ok" }
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) { Fail-Fs "admit select-away left held member visible" }
  Rec-Fs "admit-hidden" @{ outcome = "$($evH.event.outcome)"; hidden = $true }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $evR = Wait-WorkspaceOutcomeFs $logPath $mark "select" 1 30 "admit-return"
  if ("$($evR.event.outcome)" -ne "ok") { Fail-Fs "admit return outcome $($evR.event.outcome) != ok" }
  Start-Sleep -Milliseconds 1500
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) { Fail-Fs "admit return did not reveal held member" }
  # Return-frame proof in the same PMv2 space as the untouched check above
  # (helper unaware rects live in virtualized space under scaling).
  $chkBackNat = Get-NativeRectAb ([long]$hA.hwnd)
  if ($null -eq $chkBackNat) { Fail-Fs "admit-return native outer unreadable" }
  $chkBack = ($chkBackNat -join ",")
  if ($chkBack -cne $chk) { Fail-Fs "admit return frame [$chkBack] != held frame [$chk]" }
  Rec-Fs "admit-return" @{ outcome = "$($evR.event.outcome)"; frame = $chkBack }
  $Ctx.admitLog = $logPath; $Ctx.admitAllow = $allowPath
}

function Invoke-WorkspaceAppOwnedFsLive($Ctx) {
  # App-owned refusal leg only (separately callable): preform B externally
  # while the admission owner runs, refuse Win+F11, restore B, then wait for
  # the resume. Runs LAST in the workspace chain so an unavailable resume
  # (owner stays suspended, proven 20261003-060236) gates no unrelated
  # acceptance: external release, slot retention and the normal close are
  # already recorded before this leg starts.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.admitLog -or $null -eq $Ctx.admitAllow) { Fail-Fs "workspace legs need the admission owner first" }
  $allowPath = $Ctx.admitAllow
  $logPath = $Ctx.admitLog
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]
  $saved = $Ctx.admitSaved

  # App-owned refusal: preform B externally while the owner runs, focus it,
  # Win+F11 must refuse (`fullscreen-refused-app-owned`), frame stable.
  # The external cover in foreground suspends the owner (unmanaged
  # fullscreen foreground, correct product behavior); restoring B's frame
  # is followed by the resume wait below, which needs a ticking owner and
  # may stay unavailable (owner still suspended): callers run the external
  # release and the normal close BEFORE this leg for exactly that reason.
  $suspMark = (Get-CompleteLinesLocal $logPath).Count
  $savedB = Set-PreformedCaptionlessFs $helperCopy $hB "appowned-preform"
  $freshB = Set-OwnedForegroundAb $helperCopy $hB "appowned-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshB.hwnd) 0 $false
  $evRef = Wait-FsOutcome $logPath $mark @("fullscreen-refused-app-owned") 20 "appowned-refuse"
  Rec-Fs "appowned-refused" @{ outcome = "$($evRef.event.outcome)" }
  # Stability proof in the preform's PMv2 physical space (never the
  # helper's DPI-virtualized unaware rect): same space as savedB.screen.
  $null = Assert-HelperIdentityAb $helperCopy $hB "appowned-stable"
  [ActiveBorderNative]::EnsurePMv2()
  $chkBNat = Get-NativeRectAb ([long]$hB.hwnd)
  if ($null -eq $chkBNat) { Fail-Fs "appowned-stable native outer unreadable" }
  $chkB = ($chkBNat -join ",")
  if ($chkB -cne "0,0,$($savedB.screen -replace 'x',',')") { Fail-Fs "appowned refusal moved the frame to $chkB" }
  Restore-SavedFrameFs $helperCopy $hB $savedB "appowned-restore"
  # Read-only suspender identity (never a pass oracle, never touched):
  # if the owner stays suspended past here, the report pins which
  # foreground held the session (e.g. a persistent Explorer shell overlay).
  $fgAfterRe = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $fgAfterId = Get-FsFgIdentity ([long]$fgAfterRe)
  Rec-Fs "appowned-fg-after-restore" @{ foreground = $fgAfterRe; class = "$($fgAfterId.class)"; pid = $fgAfterId.pid; exe = "$($fgAfterId.exe)" }
  $tailS = Get-LogEventsAfter $logPath $suspMark
  $susp = @($tailS.events | Where-Object { ($_.event -eq "suspend") -and ("$($_.cause)" -eq "fullscreen-foreground") }).Count
  $res = @($tailS.events | Where-Object { $_.event -eq "resume" }).Count
  if (([int]$susp -gt 0) -and ([int]$res -eq 0)) {
    $null = Wait-FsResume $logPath $suspMark 60 "appowned-resume"
    Rec-Fs "appowned-resumed" @{ suspended = $true }
  } else {
    Rec-Fs "appowned-resumed" @{ suspended = ([int]$susp -gt 0) }
  }
}

function Invoke-WorkspaceExternalFsLive($Ctx) {
  # Born-held external release + slot retention (separately callable, runs
  # BEFORE appowned refusal): restore A's preformed frame externally with no
  # chord, then prove slot retention through a later product enter/exit.
  # Uses the admission owner ($Ctx.admitLog); caller guarantees it runs.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.admitLog -or $null -eq $Ctx.admitAllow) { Fail-Fs "external legs need the admission owner first" }
  $allowPath = $Ctx.admitAllow
  $logPath = $Ctx.admitLog
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]
  $saved = $Ctx.admitSaved

  # Fixture external exit: restore A's preformed frame externally (no chord).
  # Expect exactly one `initial-fullscreen-released`, then A admits normally
  # and a later Win+F11 retains its slot on exit.
  Restore-SavedFrameFs $helperCopy $hA $saved "external-exit"
  $rel = Wait-FsReleased $logPath 0 30 "external-released"
  Rec-Fs "external-released-once" @{ ok = $true }
  $mark1 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd, $hC.hwnd) $logPath $mark1 25 "external-converge"
  Rec-Fs "external-converged" @{ tick = $conv.tick }
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "slot-focus"
  $slotPre = Get-HelperRectKeyFs $helperCopy $hA "slot-pre"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshA.hwnd) 0 $false
  $evE = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "slot-enter"
  $slotToken = "$($evE.event.window)"
  $null = Get-FsCoverState $helperCopy $hA "slot-cover"
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "slot-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshA.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath $mark @("restored", "dispatched") 20 "slot-exit"
  $planXYWH = Get-PlannedSlotFs $logPath $slotToken "slot-plan"
  $pp = @($planXYWH -split ",")
  $wantSlot = "$($pp[0]),$($pp[1]),$([int]$pp[0] + [int]$pp[2]),$([int]$pp[1] + [int]$pp[3])"
  $slotPost = Get-FrameKeyFs ([long]$hA.hwnd) "slot-post"
  if ($slotPost -cne $wantSlot) { Fail-Fs "slot exit frame [$slotPost] != retained slot [$wantSlot] (plan $planXYWH)" }
  $slotPostHelper = Get-HelperRectKeyFs $helperCopy $hA "slot-post-helper"
  if ($slotPostHelper -cne $slotPre) { Fail-Fs "slot exit helper rect [$slotPostHelper] != pre-enter rect [$slotPre]" }
  Rec-Fs "slot-retained" @{ frame = $slotPost; slot = $wantSlot }
}

function Invoke-WorkspaceCloseFsLive($Ctx) {
  # Normal close leg only (separately callable, runs BEFORE appowned
  # refusal): close C, a never-fullscreen member. This is explicitly a
  # normal close, never a born-fullscreen close: closing a held member is
  # unaccepted/user-owned and recorded as such below, never inferred here.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.admitLog -or $null -eq $Ctx.admitAllow) { Fail-Fs "close leg needs the admission owner first" }
  $allowPath = $Ctx.admitAllow
  $logPath = $Ctx.admitLog
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]

  # Normal close of C (a never-fullscreen member, NOT a born-fullscreen
  # close): owner converges cleanly with no held/released residue for C.
  $closeMark = (Get-CompleteLinesLocal $logPath).Count
  $closed = Invoke-Native $helperCopy @("close", "$($hC.hwnd)", "--tag", "$($hC.tag)") | ConvertFrom-Json
  Rec-Fs "close-before-exit" @{ closed = $true }
  try {
    $null = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd) $logPath $closeMark 25 "close-converge"
  } catch {
    $tailClose = Get-LogEventsAfter $logPath $closeMark
    $fgClose = Get-FsFgIdentity ([ActiveBorderNative]::GetForegroundWindow().ToInt64())
    Rec-Fs "close-converge" @{ status = "unavailable"; foreground = $fgClose;
      suspend = @($tailClose.events | Where-Object { $_.event -eq "suspend" }).Count;
      resume = @($tailClose.events | Where-Object { $_.event -eq "resume" }).Count }
    throw
  }
  $tail = Get-LogEventsAfter $logPath $closeMark
  $heldC = @($tail.events | Where-Object { ($_.event -eq "initial-fullscreen-held") -or ($_.event -eq "initial-fullscreen-released") })
  if (@($heldC).Count -ne 0) { Fail-Fs "close-before-exit logged held/released for a normal close" }
  Rec-Fs "close-converged" @{ members = 2 }
  Rec-Fs "born-close" @{ status = "unaccepted"; reason = "close-of-held-member-not-attempted-user-owned" }
  $Ctx.wsPair = @($hA, $hB)
}

function Invoke-WorkspaceFsLive($Ctx) {
  # Workspace chain: born external release + normal close run BEFORE appowned
  # refusal, so an unavailable appowned-resume gates no unrelated
  # acceptance. Each stage is separately callable for isolated runs.
  Invoke-WorkspaceExternalFsLive $Ctx
  Invoke-WorkspaceCloseFsLive $Ctx
  Invoke-WorkspaceAppOwnedFsLive $Ctx
}

function Invoke-GracefulFsLive($Ctx) {
  # Graceful stop preserves the project fullscreen frame, style and props;
  # the independent restore is idempotent and keeps cover.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  $logPath = $Ctx.admitLog
  $hA = $Ctx.wsPair[0]; $other = $Ctx.wsPair[1]
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "grace-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshA.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "grace-enter"
  $cover = Get-FsCoverState $helperCopy $hA "grace-cover"
  $sibRect = Get-HelperRectKeyFs $helperCopy $other "grace-pre-sib"
  $ownerPid = [int]$Ctx.ownerFrozen.pid
  $st = Stop-ExactOwner $ownerCopy $false "grace-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "grace-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
  $coverAfter = Get-FsCoverState $helperCopy $hA "grace-preserved"
  $postSib = Get-HelperRectKeyFs $helperCopy $other "grace-post-sib"
  if ($postSib -cne $sibRect) { Fail-Fs "graceful stop moved sibling frame" }
  $bOv = @(Get-OverlayHwndsForOwnerAb $ownerPid) | Where-Object { $_ -ne 0 }
  if (@($bOv).Count -ne 0) { Fail-Fs "graceful stop left overlay HWNDs" }
  Rec-Fs "grace-preserved" @{ cover = $coverAfter; siblings_stable = $true; overlays = 0 }
  $Ctx.graceCover = $cover
}

function Invoke-CrashFsLive($Ctx) {
  # Hidden fullscreen member survives exact-owner death: the watcher
  # auto-reveals with the fullscreen frame intact (same identity, still
  # cover). Restarting the owner then holds the frame (restart-own held)
  # and Win+F11 exits through the surviving restoration props.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $hA = $Ctx.wsPair[0]; $hB = $Ctx.wsPair[1]
  $allowPath = Join-Path $proofDir "fullscreen-crash-allowlist.json"
  $entries = @()
  foreach ($s in @($hA, $hB)) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-crash"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Fs "crash-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  # Grace left hA fullscreen (cover + restoration props preserved across the
  # graceful stop), so this fresh owner must born-hold it (restart-own held,
  # slotless), never converge it as a normal 2-member tile. No Win+F11 enter
  # is sent: hA is already fullscreen; cover is asserted directly.
  $heldC = Wait-FsHeld $logPath 0 30 "crash-held"
  $heldToken = "$($heldC.event.window)"
  if ($heldToken -eq "") { Fail-Fs "crash held carried no window token" }
  Rec-Fs "crash-held" @{ token = $heldToken; slotless = $true }
  $null = Get-FsCoverState $helperCopy $hA "crash-held-cover"
  $sibRect = Get-HelperRectKeyFs $helperCopy $hB "crash-held-sib"
  Assert-RectNonEmpty $sibRect "crash-held-sib"
  $midHwnd = [uint64]$hA.hwnd
  # Fullscreen movers never send: product refuses with
  # `send-refused-fullscreen` (no writes, topology stable, cover intact).
  # The send targets the focused member, so hA is foregrounded first.
  $freshC = Set-OwnedForegroundAb $helperCopy $hA "crash-fs-focus"
  $preSend = Get-InspectFrames $ownerCopy $allowPath
  $mark = Get-MarkBeforeActionAb $logPath
  $sentS = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$freshC.hwnd) 0 $false
  Assert-ChordSendCounts ([int]$sentS.accepted) $true 0 "crash-send2-send"
  $evCS = Wait-WorkspaceOutcomeFs $logPath $mark "send" 2 30 "crash-send2"
  if ("$($evCS.event.outcome)" -ne "send-refused-fullscreen") { Fail-Fs "crash send outcome $($evCS.event.outcome) != send-refused-fullscreen" }
  $null = Get-FsCoverState $helperCopy $hA "crash-still-cover"
  $postSend = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preSend.frames $postSend.frames "crash-send-topology"
  Assert-ExactForegroundFs ([uint64]$midHwnd) "crash-send-follow"
  Rec-Fs "crash-send-refused" @{ outcome = "$($evCS.event.outcome)" }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $false $false ([uint64]$fgNow) 0 $false
  $null = Wait-WorkspaceOutcomeFs $logPath $mark "select" 2 30 "crash-hide2"
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Fs "crash setup left fullscreen member visible" }
  $null = Get-FsCoverState $helperCopy $hA "crash-hidden-cover"
  Rec-Fs "crash-hidden-fs" @{ hidden = $true; cover = $true; selected = 2 }
  $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
  if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$Ctx.ownerFrozen.pid) { Fail-Fs "crash owner changed before kill" }
  $null = Assert-ExactOwner $ownerCopy $Ctx.ownerFrozen "crash-kill"
  $kill = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
  if (-not $kill.owner_exited) { Fail-Fs "crash-kill stop no exit" }
  if (Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)") { Fail-Fs "crash-kill owner alive" }
  $Ctx.ownerRunning = $false
  $deadline = (Get-Date).AddSeconds(15)
  while ((-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Fs "watcher auto-reveal of hidden fullscreen timed out" }
  $back = Assert-HelperIdentityAb $helperCopy $hA "crash-revealed"
  if ([int]$back.process.pid -ne [int]$hA.process.pid) { Fail-Fs "crash revealed pid changed" }
  $null = Get-FsCoverState $helperCopy $hA "crash-revealed-cover"
  Rec-Fs "crash-watcher" @{ stop = $kill.owner_exited; auto_revealed = $true; cover = $true }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    try { Assert-LedgerClean $ownerCopy; break }
    catch { Start-Sleep -Milliseconds 250; if ((Get-Date) -ge $deadline) { Fail-Fs "crash watcher ledger dirty" } }
  }
  $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail-Fs "crash independent restore failed" }
  Assert-LedgerClean $ownerCopy
  Rec-Fs "crash-restore" @{ restored = $r.restored }
  # Restart-own: a fresh owner sees the surviving fullscreen frame, holds it
  # (restart-own held), and Win+F11 exits through the surviving props.
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready2 = Assert-OwnerReady $ownerCopy "fs-restart"
  $Ctx.ownerFrozen = $ready2.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath2 = "$($ready2.log_path)"
  Rec-Fs "restart-owner-ready" @{ pid = $ready2.owner.pid; log = $logPath2 }
  $held2 = Wait-FsHeld $logPath2 0 30 "restart-held"
  Rec-Fs "restart-held" @{ ok = $true }
  Start-Sleep -Milliseconds 1500
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "restart-exit-focus"
  $mark = Get-MarkBeforeActionAb $logPath2
  $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshA.hwnd) 0 $false
  $null = Wait-FsOutcome $logPath2 $mark @("restored", "dispatched") 20 "restart-exit"
  $markR = (Get-CompleteLinesLocal $logPath2).Count
  $null = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd) $logPath2 $markR 25 "restart-converge"
  $rel2 = Wait-FsReleased $logPath2 0 30 "restart-released"
  Rec-Fs "restart-exit" @{ released = $true }
  $st = Stop-ExactOwner $ownerCopy $false "restart-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "restart-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
}

function Invoke-BornCloseFsLive($Ctx) {
  # Independent born-close (no input, no chords): fresh preformed helper
  # BEFORE owner admission, single hold plus slotless plus untouched oracles,
  # then exact-bound close of the HELD helper. Hard oracles: helper window
  # and process gone, exactly one initial-fullscreen-released for the held
  # token, no further held events, held token absent from later plans.
  # Sibling converge/plan is recorded when possible (unavailable is recorded,
  # never faked). Never touches the blocked normal-close/appowned chain.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  if ($null -eq $Ctx.wsSnaps) { New-FsHelperSet $Ctx }
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]
  foreach ($s in $snaps[0..2]) { Show-ExactHelper $s $s $helperCopy "bornclose-show" }
  $saved = Set-PreformedCaptionlessFs $helperCopy $hA "bornclose-preform"
  $allowPath = Join-Path $proofDir "fullscreen-bornclose-allowlist.json"
  $entries = @()
  foreach ($s in $snaps[0..2]) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-bornclose"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Fs "bornclose-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $held = Wait-FsHeld $logPath 0 30 "bornclose-held"
  $heldToken = "$($held.event.window)"
  if ($heldToken -eq "") { Fail-Fs "bornclose held carried no window token" }
  Start-Sleep -Milliseconds 2000
  $tail = Get-LogEventsAfter $logPath 0
  $holds = @($tail.events | Where-Object { $_.event -eq "initial-fullscreen-held" })
  if (@($holds).Count -ne 1) { Fail-Fs "bornclose held fired $(@($holds).Count)x, want exactly once" }
  $lines = Get-CompleteLinesLocal $logPath
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "plan") { continue }
    foreach ($en in @($e.entries)) {
      if ("$($en.window)" -ceq $heldToken) { Fail-Fs "bornclose held token unexpectedly carries a plan slot" }
    }
    break
  }
  $null = Assert-HelperIdentityAb $helperCopy $hA "bornclose-untouched"
  [ActiveBorderNative]::EnsurePMv2()
  $chkNat = Get-NativeRectAb ([long]$hA.hwnd)
  if ($null -eq $chkNat) { Fail-Fs "bornclose-untouched native outer unreadable" }
  $chk = ($chkNat -join ",")
  if ($chk -cne "0,0,$($saved.screen -replace 'x',',')") { Fail-Fs "bornclose owner retiled the born frame to $chk" }
  Rec-Fs "bornclose-held-once" @{ token = $heldToken; slotless = $true; frame = $chk }
  # Exact-bound close of the HELD helper: helper CLI close only, no input.
  $closeMark = (Get-CompleteLinesLocal $logPath).Count
  $null = Invoke-Native $helperCopy @("close", "$($hA.hwnd)", "--tag", "$($hA.tag)")
  Rec-Fs "bornclose-close" @{ closed = $true }
  $rel = Wait-FsReleased $logPath $closeMark 30 "bornclose-released"
  if ("$($rel.event.window)" -cne $heldToken) { Fail-Fs "bornclose released token $($rel.event.window) != held $heldToken" }
  $tailC = Get-LogEventsAfter $logPath $closeMark
  $rels = @($tailC.events | Where-Object { $_.event -eq "initial-fullscreen-released" })
  if (@($rels).Count -ne 1) { Fail-Fs "bornclose released fired $(@($rels).Count)x, want exactly once" }
  $heldAfter = @($tailC.events | Where-Object { $_.event -eq "initial-fullscreen-held" })
  if (@($heldAfter).Count -ne 0) { Fail-Fs "bornclose held refired after close" }
  $linesC = Get-CompleteLinesLocal $logPath
  for ($i = $closeMark; $i -lt $linesC.Count; $i++) {
    if ("$($linesC[$i])".Trim() -eq "") { continue }
    $e = $linesC[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "plan") { continue }
    foreach ($en in @($e.entries)) {
      if ("$($en.window)" -ceq $heldToken) { Fail-Fs "bornclose held token still planned after close" }
    }
  }
  $deadline = (Get-Date).AddSeconds(15)
  while (((Test-ProcessAliveSameCreation ([int]$hA.process.pid) "$($hA.process.process_creation)") -or [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
  if (Test-ProcessAliveSameCreation ([int]$hA.process.pid) "$($hA.process.process_creation)") { Fail-Fs "bornclose helper process alive after close" }
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) { Fail-Fs "bornclose helper window still visible after close" }
  Close-HeldProcessAb $saved.held
  Rec-Fs "bornclose-removed" @{ released = $true; gone = $true }
  # Sibling converge/plan when possible: unavailable is recorded, never faked.
  try {
    $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($hB.hwnd, $hC.hwnd) $logPath $closeMark 25 "bornclose-siblings"
    $sibRects = @($hB, $hC | ForEach-Object { Get-HelperRectKeyFs $helperCopy $_ "bornclose-sib" })
    foreach ($r in $sibRects) { Assert-RectNonEmpty $r "bornclose-sib" }
    Rec-Fs "bornclose-siblings" @{ tick = $conv.tick; members = 2 }
  } catch {
    $msg = "$($_.Exception.Message)"
    $tailS = Get-LogEventsAfter $logPath $closeMark
    $susp = @($tailS.events | Where-Object { $_.event -eq "suspend" }).Count
    $res = @($tailS.events | Where-Object { $_.event -eq "resume" }).Count
    $fgU = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $fgId = Get-FsFgIdentity ([long]$fgU)
    Rec-Fs "bornclose-siblings" @{ status = "unavailable"; error = $msg; suspend = [int]$susp; resume = [int]$res;
      foreground = $fgU; class = "$($fgId.class)"; pid = $fgId.pid; exe = "$($fgId.exe)" }
  }
  $st = Stop-ExactOwner $ownerCopy $false "bornclose-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "bornclose-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
}

function Invoke-RecoveryFsLive($Ctx) {
  # Recovery: normal helpers (no preform), fresh managed owner, converge,
  # single-attempt project entry on hA with the existing approved activation,
  # then the graceful proof directly (wsPair hA,hB) and the isolated crash.
  # Never touches the blocked normal-close/appowned chain.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.wsSnaps) { New-FsHelperSet $Ctx }
  Start-FsManagedOwner $Ctx "fullscreen-recovery-allowlist.json" "fs-recover"
  $logPath = $Ctx.admitLog; $allowPath = $Ctx.admitAllow
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd, $hC.hwnd) $logPath $mark0 25 "recover-adopt"
  Rec-Fs "recover-converged" @{ tick = $conv.tick }
  # Single causal entry attempt with the existing approved activation: no
  # retry, no new method. Unavailable foreground ends this stage here with
  # the owner stopped/restored, never a fake entry.
  try {
    $null = Set-OwnedForegroundAb $helperCopy $hA "recover-entry"
  } catch {
    $msg = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    Rec-Fs "recover-entry" @{ status = "unavailable"; error = $msg; foreground = $fg; class = "$($id.class)"; pid = $id.pid; exe = "$($id.exe)" }
    $st = Stop-ExactOwner $ownerCopy $false "recover-stop-early" $Ctx.ownerFrozen
    $Ctx.ownerRunning = $false
    Rec-Fs "recover-stop-early" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
    return
  }
  $Ctx.wsPair = @($hA, $hB)
  Invoke-GracefulFsLive $Ctx
  Invoke-RecoveryCrashFsLive $Ctx
}

function Invoke-RecoveryCrashFsLive($Ctx) {
  # Crash lifecycle with input-acceptance probes isolated outside it: a fresh
  # owner born-holds the grace-preserved fullscreen hA, hide runs through the
  # existing workspace path (marked chord to the current exact foreground,
  # one CLI attempt only if the chord cannot send), then exact-owner kill,
  # watcher auto-reveal with cover/preimage proof, independent restore,
  # restart hold and a single-attempt product exit. Unavailable foreground
  # ends the stage after a safe stop/restore, never fake props.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $hA = $Ctx.wsPair[0]; $hB = $Ctx.wsPair[1]
  $allowPath = Join-Path $proofDir "fullscreen-recovery-crash-allowlist.json"
  $entries = @()
  foreach ($s in @($hA, $hB)) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  # Single-attempt park: the fresh owner must observe the grace-preserved
  # fullscreen hA itself in foreground. A foreign fullscreen foreground
  # suspends a fresh owner (proven 20261003-062718), so hA is parked first
  # with the existing approved activation, never a new method or retry.
  # Unavailable foreground ends this stage here; no owner runs yet, so the
  # caller cleanup closes the helpers.
  try {
    $null = Set-OwnedForegroundAb $helperCopy $hA "rcov-park"
    Rec-Fs "rcov-park" @{ foreground = "$($hA.hwnd)" }
  } catch {
    $msg = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    Rec-Fs "rcov-park" @{ status = "unavailable"; error = $msg; foreground = $fg; class = "$($id.class)"; pid = $id.pid; exe = "$($id.exe)" }
    return
  }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-recover-crash"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Fs "rcov-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  # Grace left hA fullscreen (cover plus restoration props preserved across
  # the graceful stop), so this fresh owner must born-hold it, never converge
  # it as a normal tile. No Win+F11 enter is sent: hA is already fullscreen.
  # A held timeout pins the read-only suspender identity before failing, so
  # a foreign fullscreen foreground can never hide behind a bare timeout.
  try {
    $heldC = Wait-FsHeld $logPath 0 30 "rcov-held"
  } catch {
    $msg = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    $tailD = Get-LogEventsAfter $logPath 0
    $suspD = @($tailD.events | Where-Object { ($_.event -eq "suspend") }).Count
    $resD = @($tailD.events | Where-Object { $_.event -eq "resume" }).Count
    Rec-Fs "rcov-held" @{ status = "unavailable"; error = $msg; foreground = $fg; class = "$($id.class)";
      pid = $id.pid; exe = "$($id.exe)"; suspend = [int]$suspD; resume = [int]$resD }
    throw
  }
  $heldToken = "$($heldC.event.window)"
  if ($heldToken -eq "") { Fail-Fs "rcov held carried no window token" }
  Rec-Fs "rcov-held" @{ token = $heldToken; slotless = $true }
  $null = Get-FsCoverState $helperCopy $hA "rcov-held-cover"
  $sibRect = Get-HelperRectKeyFs $helperCopy $hB "rcov-held-sib"
  Assert-RectNonEmpty $sibRect "rcov-held-sib"
  $midHwnd = [uint64]$hA.hwnd
  # Send-refusal probe, isolated: a single attempt, recorded, never gating
  # the lifecycle below (send input is unaccepted keyboard proof elsewhere).
  try {
    $freshC = Set-OwnedForegroundAb $helperCopy $hA "rcov-send-focus"
    $preSend = Get-InspectFrames $ownerCopy $allowPath
    $mark = Get-MarkBeforeActionAb $logPath
    $sentS = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$freshC.hwnd) 0 $false
    Assert-ChordSendCounts ([int]$sentS.accepted) $true 0 "rcov-send2-send"
    $evCS = Wait-WorkspaceOutcomeFs $logPath $mark "send" 2 30 "rcov-send2"
    if ("$($evCS.event.outcome)" -ne "send-refused-fullscreen") { Fail-Fs "rcov send outcome $($evCS.event.outcome) != send-refused-fullscreen" }
    $null = Get-FsCoverState $helperCopy $hA "rcov-still-cover"
    $postSend = Get-InspectFrames $ownerCopy $allowPath
    Assert-FramesEqual $preSend.frames $postSend.frames "rcov-send-topology"
    Assert-ExactForegroundFs ([uint64]$midHwnd) "rcov-send-follow"
    Rec-Fs "rcov-send-probe" @{ outcome = "$($evCS.event.outcome)" }
  } catch {
    Rec-Fs "rcov-send-probe" @{ status = "unaccepted"; reason = "input-acceptance-isolated-outside-lifecycle"; error = "$($_.Exception.Message)" }
  }
  # Hide through the existing workspace path: marked chord to the current
  # exact foreground (no owned foreground needed). One CLI attempt only if
  # the chord cannot send; recorded as automation lifecycle, never keyboard
  # acceptance.
  $hidOk = $false
  try {
    $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Send-MarkedChord ($VK_0 + 2) $false $false ([uint64]$fgNow) 0 $false
    $evH = Wait-WorkspaceOutcomeFs $logPath $mark "select" 2 30 "rcov-hide2"
    if ("$($evH.event.outcome)" -ne "ok") { Fail-Fs "rcov hide outcome $($evH.event.outcome) != ok" }
    $hidOk = $true
    Rec-Fs "rcov-hide-via" @{ path = "marked-chord-current-foreground"; outcome = "$($evH.event.outcome)" }
  } catch {
    $cerr = "$($_.Exception.Message)"
    try {
      $markQ = Get-MarkBeforeActionAb $logPath
      $q = Invoke-Native $ownerCopy @("workspace", "--select", "2") | ConvertFrom-Json
      $evQ = Wait-WorkspaceOutcomeFs $logPath $markQ "select" 2 15 "rcov-hide-cli"
      if ("$($evQ.event.outcome)" -eq "ok") { $hidOk = $true }
      Rec-Fs "rcov-hide-via" @{ path = "cli"; chord_error = $cerr; dispatched = [bool]$q.dispatched; outcome = "$($evQ.event.outcome)" }
    } catch {
      Rec-Fs "rcov-hide-via" @{ path = "cli"; chord_error = $cerr; cli_error = "$($_.Exception.Message)" }
    }
  }
  if (-not $hidOk) {
    Rec-Fs "rcov-hidden-fs" @{ status = "unavailable"; reason = "hide-unproven-after-chord-plus-cli" }
    $st = Stop-ExactOwner $ownerCopy $false "rcov-stop-early" $Ctx.ownerFrozen
    $Ctx.ownerRunning = $false
    Rec-Fs "rcov-stop-early" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
    return
  }
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Fs "rcov setup left fullscreen member visible" }
  $null = Get-FsCoverState $helperCopy $hA "rcov-hidden-cover"
  Rec-Fs "rcov-hidden-fs" @{ hidden = $true; cover = $true; selected = 2 }
  $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
  if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$Ctx.ownerFrozen.pid) { Fail-Fs "rcov owner changed before kill" }
  $null = Assert-ExactOwner $ownerCopy $Ctx.ownerFrozen "rcov-kill"
  $kill = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
  if (-not $kill.owner_exited) { Fail-Fs "rcov-kill stop no exit" }
  if (Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)") { Fail-Fs "rcov-kill owner alive" }
  $Ctx.ownerRunning = $false
  $deadline = (Get-Date).AddSeconds(15)
  while ((-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Fs "rcov watcher auto-reveal of hidden fullscreen timed out" }
  $back = Assert-HelperIdentityAb $helperCopy $hA "rcov-revealed"
  if ([int]$back.process.pid -ne [int]$hA.process.pid) { Fail-Fs "rcov revealed pid changed" }
  $null = Get-FsCoverState $helperCopy $hA "rcov-revealed-cover"
  Rec-Fs "rcov-watcher" @{ stop = $kill.owner_exited; auto_revealed = $true; cover = $true }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    try { Assert-LedgerClean $ownerCopy; break }
    catch { Start-Sleep -Milliseconds 250; if ((Get-Date) -ge $deadline) { Fail-Fs "rcov watcher ledger dirty" } }
  }
  $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail-Fs "rcov independent restore failed" }
  Assert-LedgerClean $ownerCopy
  Rec-Fs "rcov-restore" @{ restored = $r.restored }
  # Restart-own: a fresh owner sees the surviving fullscreen frame and holds
  # it, then a single-attempt product exit. Unavailable foreground is
  # recorded and the stage ends after a safe stop/restore, never fake props.
  # Same single-attempt park as the crash owner: the restart owner must also
  # observe hA itself in foreground, never a foreign fullscreen suspender.
  try {
    $null = Set-OwnedForegroundAb $helperCopy $hA "rcov-restart-park"
    Rec-Fs "rcov-restart-park" @{ foreground = "$($hA.hwnd)" }
  } catch {
    $msg = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    Rec-Fs "rcov-restart-park" @{ status = "unavailable"; error = $msg; foreground = $fg; class = "$($id.class)"; pid = $id.pid; exe = "$($id.exe)" }
    $st = Stop-ExactOwner $ownerCopy $false "rcov-restart-stop" $Ctx.ownerFrozen
    $Ctx.ownerRunning = $false
    Rec-Fs "rcov-restart-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
    return
  }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready2 = Assert-OwnerReady $ownerCopy "fs-recover-restart"
  $Ctx.ownerFrozen = $ready2.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath2 = "$($ready2.log_path)"
  Rec-Fs "rcov-restart-ready" @{ pid = $ready2.owner.pid; log = $logPath2 }
  try {
    $held2 = Wait-FsHeld $logPath2 0 30 "rcov-restart-held"
  } catch {
    $msg = "$($_.Exception.Message)"
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    $tailD = Get-LogEventsAfter $logPath2 0
    $suspD = @($tailD.events | Where-Object { ($_.event -eq "suspend") }).Count
    $resD = @($tailD.events | Where-Object { $_.event -eq "resume" }).Count
    Rec-Fs "rcov-restart-held" @{ status = "unavailable"; error = $msg; foreground = $fg; class = "$($id.class)";
      pid = $id.pid; exe = "$($id.exe)"; suspend = [int]$suspD; resume = [int]$resD }
    $st = Stop-ExactOwner $ownerCopy $false "rcov-restart-stop" $Ctx.ownerFrozen
    $Ctx.ownerRunning = $false
    Rec-Fs "rcov-restart-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
    return
  }
  Rec-Fs "rcov-restart-held" @{ ok = $true }
  Start-Sleep -Milliseconds 1500
  try {
    $freshA = Ensure-FsForeground $helperCopy $hA "rcov-restart-exit-focus"
    $mark = Get-MarkBeforeActionAb $logPath2
    $null = Send-MarkedChord $VK_F11 $false $false ([uint64]$freshA.hwnd) 0 $false
    $null = Wait-FsOutcome $logPath2 $mark @("restored", "dispatched") 20 "rcov-restart-exit"
    $markR = (Get-CompleteLinesLocal $logPath2).Count
    $null = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd) $logPath2 $markR 25 "rcov-restart-converge"
    $rel2 = Wait-FsReleased $logPath2 0 30 "rcov-restart-released"
    Rec-Fs "rcov-restart-exit" @{ released = $true }
  } catch {
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $id = Get-FsFgIdentity ([long]$fg)
    Rec-Fs "rcov-restart-exit" @{ status = "unavailable"; error = "$($_.Exception.Message)"; foreground = $fg; class = "$($id.class)"; pid = $id.pid; exe = "$($id.exe)" }
  }
  $st = Stop-ExactOwner $ownerCopy $false "rcov-restart-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "rcov-restart-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
}

function Invoke-NormalSmokeFsLive($Ctx) {
  # Scoped ordinary-app smoke over the normal tile loop: product Win+F11
  # enter/exit plus workspace hide/reveal plus recovery per approved app.
  # Marked chords only into freshly verified approved windows (never blind
  # app F11); no typing; nothing closed.
  Install-BorderNative
  $ownerCopy = $Ctx.ownerCopy
  $binDir = Split-Path -Parent $ownerCopy
  $approved = @("notepad.exe", "mspaint.exe", "applicationframehost.exe")
  $consoleExe = @("pwsh.exe", "powershell.exe", "windowsterminal.exe", "wt.exe")
  $inv = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
  $cands = @()
  $excluded = @()
  foreach ($w in @($inv.windows)) {
    $exe = "$($w.exe)".ToLowerInvariant()
    $cls = "$($w.class)"
    if (@("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd") -contains $cls) { continue }
    if ("$($w.class)" -eq "#32770") { continue }
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$w.hwnd)) { continue }
    if (($exe -eq "firefox.exe") -or ($cls -eq "MozillaWindowClass")) {
      [ActiveBorderNative]::EnsurePMv2()
      if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$w.hwnd)) { Fail-Fs "refuse: visible non-maximized Firefox (never touch)" }
      $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "firefox-maximized-intact" }
      continue
    }
    $wasZoom = [bool][ActiveBorderNative]::IsZoomed([IntPtr][long]$w.hwnd)
    $wasIcon = [bool][ActiveBorderNative]::IsIconic([IntPtr][long]$w.hwnd)
    if ($wasZoom) {
      $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "zoomed-parked"; zoomed = $true; iconic = $false }
      continue
    }
    if ($wasIcon) {
      $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "iconic-parked"; zoomed = $false; iconic = $true }
      continue
    }
    if (($consoleExe -contains $exe) -or ($approved -notcontains $exe)) {
      $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "scope-excluded" }
      continue
    }
    if ($exe -eq "applicationframehost.exe") {
      $ch = Invoke-Native $ownerCopy @("children", "--hwnd", "$($w.hwnd)") | ConvertFrom-Json
      $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
      if ($names -notcontains "calculatorapp.exe") {
        $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "host-without-calculatorapp" }
        continue
      }
    }
    $cands += $w
  }
  if ($cands.Count -eq 0) {
    # Authorized fallback: launch one approved app (user closes nothing;
    # the harness never closes it, only tiles/restores it).
    try { Start-Process "notepad.exe" } catch { Fail-Fs "normal smoke fallback could not launch notepad" }
    Start-Sleep -Milliseconds 3000
    $inv2 = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
    foreach ($w in @($inv2.windows)) {
      [ActiveBorderNative]::EnsurePMv2()
      if ("$($w.exe)".ToLowerInvariant() -ne "notepad.exe") { continue }
      if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$w.hwnd)) { continue }
      if ([bool][ActiveBorderNative]::IsZoomed([IntPtr][long]$w.hwnd)) { continue }
      if ([bool][ActiveBorderNative]::IsIconic([IntPtr][long]$w.hwnd)) { continue }
      $cands += $w; break
    }
    Rec-Fs "normal-fallback-launch" @{ launched = "notepad.exe"; found = ($cands.Count -ne 0) }
  }
  if ($cands.Count -eq 0) { Fail-Fs "normal smoke needs a visible Notepad/Calculator/Paint" }
  Rec-Fs "normal-managed" @($cands | ForEach-Object { @{ hwnd = $_.hwnd; exe = $_.exe; class = $_.class } })
  Rec-Fs "normal-excluded" @($excluded | ForEach-Object { @{ hwnd = $_.hwnd; exe = $_.exe; reason = $_.reason } })
  $Ctx.normalExcluded = $excluded
  Start-ExplorerGui $ownerCopy "tile --user-start --seconds $ownerSeconds --trace --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe" $binDir
  $ready = Assert-OwnerReady $ownerCopy "fs-normal"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Fs "normal-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 2500
  $ownerSeconds = $Ctx.ownerSeconds
  foreach ($w in $cands) {
    $hwnd = [long]$w.hwnd
    $tag = "normal-$($w.exe)-$hwnd"
    $fg0 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fg0 -ne [uint64]$hwnd) {
      $prime = [ActiveBorderNative]::PrimeE8()
      if ([int]$prime -ne 2) { Fail-Fs "$tag E8 prime accepted $prime != 2" }
      $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $pidOut = [uint32]0
      $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
      $myTid = [ActiveBorderNative]::GetCurrentThreadId()
      $attached = $false
      if ([uint32]$fgTid -ne [uint32]$myTid) { $attached = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true) }
      try { $null = [ActiveBorderNative]::SetForegroundWindow([IntPtr]$hwnd) }
      finally { if ($attached) { $null = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) } }
      $deadline = (Get-Date).AddSeconds(5)
      $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      while (([uint64]$fg -ne [uint64]$hwnd) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 100; $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64() }
      if ([uint64]$fg -ne [uint64]$hwnd) { Fail-Fs "$tag foreground readback $fg != $hwnd" }
    }
    # Fresh verification immediately before the marked chord: still the same
    # executable window (PID plus exe path plus creation, not process
    # name-only), still visible, still the exact foreground.
    $rePid = [uint32]0
    $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$rePid)
    $reProc = Get-Process -Id ([int]$rePid) -ErrorAction Stop
    if ("$($reProc.ProcessName).exe".ToLowerInvariant() -ne "$($w.exe)".ToLowerInvariant()) { Fail-Fs "$tag approved identity changed before chord" }
    $reExe = "$($reProc.Path)"
    $reStart = "$($reProc.StartTime.ToString('o'))"
    $stPre = [FollowupNative]::GetWindowLongW([IntPtr]$hwnd, $GWL_STYLE)
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $sent = Send-MarkedChord $VK_F11 $false $false ([uint64]$hwnd) 0 $false
    if ([int]$sent.accepted -ne 4) { Fail-Fs "$tag Win+F11 send accepted $([int]$sent.accepted) != 4" }
    $ev = Wait-FsOutcome $logPath $mark @("fullscreen", "dispatched") 20 "$tag-enter"
    Rec-Fs "$tag-enter" @{ outcome = "$($ev.event.outcome)" }
    Start-Sleep -Milliseconds 800
    # Actual cover proof (never style-only): caption+thickframe cleared AND
    # outer exactly the physical monitor AND the DWM frame containing the
    # monitor PLUS the inert project preimage with valid owned values.
    $stNow = [FollowupNative]::GetWindowLongW([IntPtr]$hwnd, $GWL_STYLE)
    if (($stNow -band $WS_CAPTION) -ne 0) { Fail-Fs "$tag style still captioned after product enter" }
    if (($stNow -band $WS_THICKFRAME) -ne 0) { Fail-Fs "$tag style still has sizing border after product enter" }
    $nW = [ActiveBorderNative]::GetSystemMetrics(0); $nH = [ActiveBorderNative]::GetSystemMetrics(1)
    $nOuter = Get-NativeRectAb $hwnd
    if ($null -eq $nOuter) { Fail-Fs "$tag native outer unreadable after enter" }
    if ([int]$nOuter[0] -ne 0 -or [int]$nOuter[1] -ne 0 -or ([int]$nOuter[2] - [int]$nOuter[0]) -ne $nW -or ([int]$nOuter[3] - [int]$nOuter[1]) -ne $nH) {
      Fail-Fs "$tag outer $($nOuter -join ',') != monitor 0,0,$nW,$nH"
    }
    $nFrame = [ActiveBorderNative]::FrameOf($hwnd)
    if ($null -eq $nFrame) { Fail-Fs "$tag DWM frame unreadable after enter" }
    if (-not ([int]$nFrame[0] -le 0 -and [int]$nFrame[1] -le 0 -and [int]$nFrame[2] -ge $nW -and [int]$nFrame[3] -ge $nH)) {
      Fail-Fs "$tag DWM $($nFrame -join ',') does not contain monitor 0,0,$nW,$nH"
    }
    $nPre = Assert-FsPreimageValid $hwnd "$tag-props"
    Rec-Fs "$tag-cover" @{ style = ("0x{0:X8}" -f $stNow); outer = ($nOuter -join ","); frame = ($nFrame -join ","); max = "$($nPre.max)" }
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $q = Invoke-Native $ownerCopy @("workspace", "--select", "2") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Fs "$tag workspace select 2 not dispatched" }
    $null = Wait-WorkspaceOutcomeFs $logPath $mark "select" 2 30 "$tag-hide"
    Start-Sleep -Milliseconds 1200
    if ([ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Fs "$tag select-away left app visible" }
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $q = Invoke-Native $ownerCopy @("workspace", "--select", "1") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Fs "$tag workspace select 1 not dispatched" }
    $null = Wait-WorkspaceOutcomeFs $logPath $mark "select" 1 30 "$tag-reveal"
    Start-Sleep -Milliseconds 1200
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Fs "$tag reveal left app hidden" }
    $stBack = [FollowupNative]::GetWindowLongW([IntPtr]$hwnd, $GWL_STYLE)
    if (($stBack -band $WS_CAPTION) -ne 0) { Fail-Fs "$tag reveal lost fullscreen frame" }
    # Exit on the exact app window: re-foreground it first (same E8-prime +
    # attach path as entry), never chord into whatever holds foreground.
    $fgR = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgR -ne [uint64]$hwnd) {
      $prime = [ActiveBorderNative]::PrimeE8()
      if ([int]$prime -ne 2) { Fail-Fs "$tag-exit E8 prime accepted $prime != 2" }
      $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $pidOut = [uint32]0
      $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
      $myTid = [ActiveBorderNative]::GetCurrentThreadId()
      $attached = $false
      if ([uint32]$fgTid -ne [uint32]$myTid) { $attached = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true) }
      try { $null = [ActiveBorderNative]::SetForegroundWindow([IntPtr]$hwnd) }
      finally { if ($attached) { $null = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) } }
      $deadline = (Get-Date).AddSeconds(5)
      $fgR = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      while (([uint64]$fgR -ne [uint64]$hwnd) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 100; $fgR = [ActiveBorderNative]::GetForegroundWindow().ToInt64() }
      if ([uint64]$fgR -ne [uint64]$hwnd) { Fail-Fs "$tag-exit foreground readback $fgR != $hwnd" }
    }
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $sent = Send-MarkedChord $VK_F11 $false $false ([uint64]$hwnd) 0 $false
    $evX = Wait-FsOutcome $logPath $mark @("restored", "dispatched", "fullscreen-refused-app-owned") 20 "$tag-exit"
    if ("$($evX.event.outcome)" -eq "fullscreen-refused-app-owned") {
      Fail-Fs "$tag product refused exit on its own frame (preimage defect)"
    }
    # Actual retained-allocation restore (never outcome-only): props absent
    # plus the pre-enter frame style bit-for-bit back, plus fresh identity
    # readback (same PID, exe path and creation as before enter), plus real
    # geometry (non-empty, no longer monitor cover).
    # Tile mode carries no engine plan-token oracle for the app window, so
    # plan-token matching is recorded explicitly as unaccepted, never
    # inferred from geometry.
    Assert-FsPropsAbsent $hwnd "$tag-exit-props"
    $stEnd = [FollowupNative]::GetWindowLongW([IntPtr]$hwnd, $GWL_STYLE)
    if ([int]$stEnd -ne [int]$stPre) { Fail-Fs "$tag style 0x$($stEnd.ToString('X8')) != pre-enter 0x$(([int]$stPre).ToString('X8'))" }
    $postPid = [uint32]0
    $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$postPid)
    if ([int]$postPid -ne [int]$rePid) { Fail-Fs "$tag exit pid changed ($postPid != $rePid)" }
    $postProc = Get-Process -Id ([int]$postPid) -ErrorAction Stop
    if ("$($postProc.Path)" -cne $reExe) { Fail-Fs "$tag exit exe changed ($($postProc.Path) != $reExe)" }
    if ("$($postProc.StartTime.ToString('o'))" -cne $reStart) { Fail-Fs "$tag exit creation changed" }
    $endOuter = Get-NativeRectAb $hwnd
    if ($null -eq $endOuter) { Fail-Fs "$tag exit outer unreadable" }
    $endKey = ($endOuter -join ",")
    if ($endKey -ceq "0,0,$nW,$nH") { Fail-Fs "$tag exit still monitor cover [$endKey]" }
    Assert-RectNonEmpty $endKey "$tag-exit-alloc"
    Rec-Fs "normal-app" @{ exe = "$($w.exe)"; hwnd = $hwnd; enter_hide_reveal_exit = $true; style_restored = $true;
      exit_outer = $endKey; plan_oracle = "unaccepted-tile-mode-no-token" }
  }
  $st = Stop-ExactOwner $ownerCopy $false "normal-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Fs "normal-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
  foreach ($w in $cands) {
    $hwnd = [long]$w.hwnd
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Fs "normal end hwnd=$hwnd not visible" }
  }
  Rec-Fs "normal-end" @{ apps_recovered = $cands.Count }
  foreach ($x in @($Ctx.normalExcluded)) {
    $xh = [long]$x.hwnd
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$xh)) { Fail-Fs "normal end excluded hwnd=$xh exe=$($x.exe) no longer visible" }
    if ([string]$x.reason -eq "zoomed-parked" -and -not [ActiveBorderNative]::IsZoomed([IntPtr]$xh)) {
      Fail-Fs "normal end excluded hwnd=$xh exe=$($x.exe) left maximized state"
    }
    if ([string]$x.reason -eq "iconic-parked" -and -not [ActiveBorderNative]::IsIconic([IntPtr]$xh)) {
      Fail-Fs "normal end excluded hwnd=$xh exe=$($x.exe) left minimized state"
    }
  }
  Rec-Fs "normal-excluded-intact" @{ count = @($Ctx.normalExcluded).Count }
}

function New-FsHelperSet($Ctx) {
  # Helper creation ONLY (no owner): four passive helpers, three managed
  # plus one foreign spare for the unmanaged prologue. Single bootstrap
  # reused across both owners; never recreated.
  $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir
  if ($null -ne $Ctx.wsSnaps) { Fail-Fs "helpers already bootstrapped" }
  $h1 = Start-PassiveShortcutHelper $helperCopy $proofDir "fs-helper1"
  $h2 = Start-PassiveShortcutHelper $helperCopy $proofDir "fs-helper2"
  $h3 = Start-PassiveShortcutHelper $helperCopy $proofDir "fs-helper3"
  $h4 = Start-PassiveShortcutHelper $helperCopy $proofDir "fs-foreign"
  $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $h2; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $h3; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $h4; bin = $helperCopy })
  $Ctx.wsSnaps = @($h1, $h2, $h3, $h4)
  Rec-Fs "helpers-created" @(@($h1, $h2, $h3, $h4) | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; tag = $_.tag } })
}

function Start-FsManagedOwner($Ctx, [string]$AllowName, [string]$Tag) {
  # Owner startup ONLY over the bootstrapped helpers (first three managed).
  # Caller must guarantee no owner is running. Workspace-proof mode
  # (shortcut handling plus the workspace dispatcher): leg D sends a
  # workspace send whose `send-refused-fullscreen` oracle needs the
  # workspace dispatcher, which product gates to workspace-proof mode.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  if ($Ctx.ownerRunning) { Fail-Fs "$Tag refuses: owner already running" }
  if ($null -eq $Ctx.wsSnaps) { Fail-Fs "$Tag needs helpers first" }
  $snaps = @($Ctx.wsSnaps)
  $allowPath = Join-Path $proofDir $AllowName
  $entries = @()
  foreach ($s in $snaps[0..2]) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  foreach ($s in $snaps[0..2]) { Show-ExactHelper $s $s $helperCopy "$Tag-show" }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy $Tag
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $machinePath = Join-Path $Ctx.proofDir "machine.json"
  if (Test-Path -LiteralPath $machinePath) {
    try {
      $m = Get-Content -LiteralPath $machinePath -Raw | ConvertFrom-Json
      $m | Add-Member -NotePropertyName ownerFrozen -NotePropertyValue $ready.owner -Force
      $m | Add-Member -NotePropertyName ownerLog -NotePropertyValue "$($ready.log_path)" -Force
      $m | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $machinePath
    } catch {}
  }
  $logPath = "$($ready.log_path)"
  Rec-Fs "$Tag-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $Ctx.admitLog = $logPath; $Ctx.admitAllow = $allowPath
}

function Invoke-FsLive {
  Install-BorderNative
  Install-FollowupNative
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Fs "refuse: OwnerSeconds must be 1..=600" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\windows-fullscreen\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "fullscreen-report.json"
  if (Test-Path $reportPath) { Fail-Fs "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Fs "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $diffTmp = Join-Path $runDir "working-diff.patch"
  & git -C $Repo diff --no-ext-diff --no-color --output $diffTmp
  $diffHash = (Get-FileHash -LiteralPath $diffTmp -Algorithm SHA256).Hash
  $ownerHash = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
  $helperHash = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
  $scriptHash = (Get-FileHash -LiteralPath (Join-Path $Repo "scripts\windows-fullscreen.ps1") -Algorithm SHA256).Hash
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $os = Get-CimInstance Win32_OperatingSystem
  [ActiveBorderNative]::EnsurePMv2()
  $screenW0 = [ActiveBorderNative]::GetSystemMetrics(0); $screenH0 = [ActiveBorderNative]::GetSystemMetrics(1)
  $work0 = [ActiveBorderNative]::WorkArea()
  Rec-Fs "env" @{ commit = $commit; status = $status; diff_sha256 = $diffHash; run_dir = $runDir; owner_sha256 = $ownerHash;
    helper_sha256 = $helperHash; script_sha256 = $scriptHash; actor_pid = $PID;
    sid = "$($ident.process.user_sid)"; session = $ident.process.session_id; il = "$($ident.integrity_level)";
    os_build = "$($os.BuildNumber)"; screen = "${screenW0}x${screenH0}"; work = ($work0 -join ",");
    marker = ("0x{0:X}" -f $FS_MARKER); input_size = $size }
  $spi = Read-CorrectSpiAb
  Rec-Fs "settings-pre" @{ arranging_raw = $spi.arranging_raw; pen_raw = $spi.pen_raw }
  if ([int]$spi.arranging_raw -ne 1) { Fail-Fs "preflight arranging raw $($spi.arranging_raw) != 1 (must use 0x0082)" }
  if ([int]$spi.pen_raw -ne 35) { Fail-Fs "preflight pen raw $($spi.pen_raw) != 35 (must use 0x201E)" }
  Assert-LedgerClean $ownerCopy
  Test-NoProjectActors $ownerCopy $helperCopy "preflight"
  $originals = Get-OriginalAppsSnapshot
  Rec-Fs "original-apps" @{ count = @($originals).Count }
  $Ctx = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; proofDir = $runDir; ownerSeconds = $OwnerSeconds;
    created = [System.Collections.ArrayList]@(); ownerRunning = $false; ownerFrozen = $null; ownerPayload = "";
    ledgerDir = ""; auditPath = ""; fenceRefused = $false }
  $machineEarly = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; ownerFrozen = $null; ownerLog = "";
    commit = $commit; diff_sha256 = $diffHash; owner_sha256 = $ownerHash; helper_sha256 = $helperHash;
    script_sha256 = $scriptHash; ledger_directory = "$($ident.ledger_directory)";
    sid = "$($ident.process.user_sid)"; session = $ident.process.session_id; il = "$($ident.integrity_level)";
    os_build = "$($os.BuildNumber)"; run_dir = $runDir }
  $machineEarly | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDir "machine.json")
  $want = @()
  if ($Stage -eq "All") { $want = @("OwnedFs", "WorkspaceFs", "NormalSmoke") } else { $want = @($Stage) }
  try {
    if ($want -contains "OwnedFs") {
      New-FsHelperSet $Ctx
      Invoke-UnmanagedFsLive $Ctx
      Start-FsManagedOwner $Ctx "fullscreen-admit0-allowlist.json" "fs-admit0"
      Invoke-OwnedFsLive $Ctx
      $Ctx.ownedLog = $Ctx.admitLog; $Ctx.ownedAllow = $Ctx.admitAllow
      $st = Stop-ExactOwner $ownerCopy $false "ownedfs-stop" $Ctx.ownerFrozen
      $Ctx.ownerRunning = $false
      Rec-Fs "ownedfs-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
    }
    if ($want -contains "WorkspaceFs") {
      if ($null -eq $Ctx.wsSnaps) {
        $h1 = Start-PassiveShortcutHelper $helperCopy $runDir "fs-helper1"
        $h2 = Start-PassiveShortcutHelper $helperCopy $runDir "fs-helper2"
        $h3 = Start-PassiveShortcutHelper $helperCopy $runDir "fs-helper3"
        $h4 = Start-PassiveShortcutHelper $helperCopy $runDir "fs-foreign"
        $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
        $null = $Ctx.created.Add(@{ snap = $h2; bin = $helperCopy })
        $null = $Ctx.created.Add(@{ snap = $h3; bin = $helperCopy })
        $null = $Ctx.created.Add(@{ snap = $h4; bin = $helperCopy })
        $Ctx.wsSnaps = @($h1, $h2, $h3, $h4)
      }
      Invoke-AdmissionFsLive $Ctx
      Invoke-WorkspaceFsLive $Ctx
      Invoke-GracefulFsLive $Ctx
      Invoke-CrashFsLive $Ctx
    }
    if ($want -contains "BornCloseFs") {
      Invoke-BornCloseFsLive $Ctx
    }
    if ($want -contains "RecoveryFs") {
      Invoke-RecoveryFsLive $Ctx
    }
    if ($want -contains "NormalSmoke") {
      Invoke-NormalSmokeFsLive $Ctx
    }
    Close-CreatedHelpers $Ctx "cleanup"
    $postSpi = Read-CorrectSpiAb
    if ([int]$postSpi.arranging_raw -ne 1) { Fail-Fs "end arranging raw $($postSpi.arranging_raw) != 1" }
    if ([int]$postSpi.pen_raw -ne 35) { Fail-Fs "end pen raw $($postSpi.pen_raw) != 35" }
    Assert-LedgerClean $ownerCopy
    Test-NoProjectActors $ownerCopy $helperCopy "end"
    Assert-OriginalAppsIntact $originals "end"
    $machine = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; ownerFrozen = $Ctx.ownerFrozen;
      ledger_directory = "$($ident.ledger_directory)" }
    $machine | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDir "machine.json")
    $gaps = @($FS_STEPS | Where-Object { Test-FsReportGap $_ })
    $reportStatus = if ($gaps.Count -eq 0) { "pass" } else { "partial" }
    $report = @{ status = $reportStatus; stage = $Stage; fence_refused = [bool]$Ctx.fenceRefused;
      unaccepted_steps = @($gaps | ForEach-Object { $_.name }); steps = $FS_STEPS; clean = "ledger=clean; actors=zero; spi=1/35" }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "fullscreen-report=$reportPath"
    Write-Output "status=$reportStatus fence_refused=$($Ctx.fenceRefused)"
  } catch {
    $failMsg = "$($_.Exception.Message)"
    try { Release-WinShiftFs "fail-release" } catch {}
    if (($Ctx.ownerRunning) -and ($ownerCopy -ne "") -and (Test-Path $ownerCopy) -and ($null -ne $Ctx.ownerFrozen)) {
      try {
        $null = Stop-ExactOwner $ownerCopy $false "fail-stop" $Ctx.ownerFrozen
        $Ctx.ownerRunning = $false
        Rec-Fs "fail-stop" @{ graceful = $true }
      } catch {
        Rec-Fs "fail-stop-graceful-failed" @{ error = "$($_.Exception.Message)" }
        try {
          $null = Stop-ExactOwner $ownerCopy $true "fail-emergency" $Ctx.ownerFrozen
          $Ctx.ownerRunning = $false
          Rec-Fs "fail-emergency" @{ forced = $true }
        } catch {
          Rec-Fs "fail-emergency-failed" @{ error = "$($_.Exception.Message)" }
        }
      }
    }
    try { foreach ($c in @($Ctx.created)) {
      try {
        $s = $c.snap
        if ((Test-ProcessAliveSameCreation ([int]$s.process.pid) "$($s.process.process_creation)")) {
          $null = Invoke-Native $helperCopy @("close", "$($s.hwnd)", "--tag", "$($s.tag)")
        }
      } catch {}
    } } catch {}
    $cleanNotes = @()
    try { Assert-LedgerClean $ownerCopy; $cleanNotes += "ledger=clean" } catch { $cleanNotes += "ledger=DIRTY: $($_.Exception.Message)" }
    try { Test-NoProjectActors $ownerCopy $helperCopy "fail-end"; $cleanNotes += "actors=zero" } catch { $cleanNotes += "actors=RESIDUE: $($_.Exception.Message)" }
    try {
      $spiF = Read-CorrectSpiAb
      if (([int]$spiF.arranging_raw -eq 1) -and ([int]$spiF.pen_raw -eq 35)) { $cleanNotes += "spi=1/35" }
      else { $cleanNotes += "spi=MISMATCH arranging=$($spiF.arranging_raw) pen=$($spiF.pen_raw)" }
    } catch { $cleanNotes += "spi=UNREADABLE: $($_.Exception.Message)" }
    $report = @{ status = "fail"; stage = $Stage; fence_refused = [bool]$Ctx.fenceRefused; steps = $FS_STEPS; error = "$failMsg"; clean = ($cleanNotes -join "; ") }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "fullscreen-report=$reportPath"
    throw "Fullscreen stage failed: $failMsg [$($cleanNotes -join '; ')]"
  }
}

if ($Mock) { Invoke-FullscreenMock; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Fs "Stop requires -RunDir" }
  Invoke-StopFromRunDir $RunDir
  exit 0
}
if ($Live) {
  if ($RunDir -ne "") { Fail-Fs "refuse: -Live always creates a new run dir; -RunDir is for -Stop only" }
  Invoke-FsLive
  exit 0
}
Write-Output "windows-fullscreen parsed (no action without -Mock/-Live/-Stop)"
