param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 300,
  [ValidateSet("All", "OwnedMax", "WorkspaceMax", "NormalSmoke")]
  [string]$Stage = "All"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner stop/restore helpers.
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }
# Lean reuse: load ONLY function definitions from the border + shortcuts
# harnesses via AST (never executes their top-level live legs).
$MxMock = $Mock; $MxLive = $Live; $MxStop = $Stop; $MxRunDir = $RunDir; $MxOwnerSeconds = $OwnerSeconds; $MxStage = $Stage
$MxBorderPath = Join-Path $Repo "scripts\windows-active-border.ps1"
$MxShortPath = Join-Path $Repo "scripts\windows-shortcuts.ps1"
$MX_STEPS = [System.Collections.ArrayList]@()
function Rec-Mx([string]$Name, $Data) { $null = $MX_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Mx([string]$Msg) { throw $Msg }
# Sink for AST-loaded shortcuts helpers that record via Rec-Shortcut
# (Close-CreatedHelpers): keeps their extent without crashing on $null.
$ShortcutSteps = [System.Collections.ArrayList]@()
function Load-MxAst([string]$Path, [string[]]$Wanted) {
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
$MxBorderWanted = @("Install-BorderNative", "Read-CompleteTextAb", "Get-CompleteLinesAb", "Get-MarkBeforeActionAb",
  "Assert-HelperIdentityAb", "Set-OwnedForegroundAb", "Invoke-OwnedSysCommandAb", "Get-NativeRectAb", "Get-NativeFrameAb",
  "Find-TitlePointAb", "Read-CorrectSpiAb", "New-HeldProcessAb", "Close-HeldProcessAb", "ConvertTo-AbsoluteAb",
  "Get-VirtualScreenAb", "Assert-ButtonReleasedAb", "Get-OverlayHwndsForOwnerAb")
$MxShortWanted = @("Rec-Shortcut", "Fail-Shortcut", "Get-ShortcutJourney", "Assert-NoWinLJourney", "Assert-ChordSendCounts",
  "Assert-InputStructSize", "Assert-EncodingInvariant", "Test-ExeEqualLocal", "Assert-FullIdentityMatches",
  "Assert-TileStartMode", "Assert-ProofStartArgv", "Assert-ProductionLogTokenOnly", "Assert-FramesEqual",
  "Assert-FramesChanged", "Assert-RectNonEmpty", "ConvertTo-AbsoluteNative", "Assert-OcclusionClear",
  "Assert-SpiPreimageOwned", "Install-ShortcutNative", "Read-CompleteTextLocal", "Get-CompleteLinesLocal",
  "Get-LogEventsAfter", "Get-PlanSnapshotLocal", "Show-ExactHelper", "Invoke-OwnedFocusEnsure",
  "Send-MarkedChord", "Read-PenVisualization", "Read-SpiArranging", "Assert-ExactOwner", "Stop-ExactOwner",
  "Get-FrozenHwnds", "Get-InspectFrames", "Wait-ConvergedFrames", "Wait-SnapAfter", "New-ShortcutRunDir",
  "Start-PassiveShortcutHelper", "Get-DisplayBaselineLive", "Get-OriginalAppsSnapshot", "Assert-OriginalAppsIntact",
  "Close-CreatedHelpers", "Test-NoProjectActors", "Invoke-StopFromRunDir")
Load-MxAst $MxBorderPath $MxBorderWanted
Load-MxAst $MxShortPath $MxShortWanted
$Mock = $MxMock; $Live = $MxLive; $Stop = $MxStop; $RunDir = $MxRunDir; $OwnerSeconds = $MxOwnerSeconds; $Stage = $MxStage

# Safety contract (docs/live-windows-testing.md grants no authority itself):
# explicit flags mandatory; bare invocation parses and exits. Live mutates
# ONLY exact identity-bound owned helpers (plus launched approved extras in
# NormalSmoke, closed after). NEVER closes/kills/types into the hosting
# Terminal/process tree (moving/tiling it is allowed). No process-name kills,
# no registry/policy writes, no screenshots, no app content. Activation is
# E8-prime + AttachThreadInput + one SetForegroundWindow on the exact bound
# target (Set-OwnedForegroundAb / Invoke-OwnedFocusEnsure). Synthetic input
# is marked (SHORTCUT_MARKER) for hook chords and unmarked absolute mouse
# only for native titlebar/button gestures on the exact foreground helper.
# Out-of-hook stop only (`stop` then `restore`). End state: zero run actors;
# ledger/stop clean; SPI arranging 1, pen 35.

$MX_MARKER = 0x544C5250524F4F46
$VK_M = 77
$VK_H = 72; $VK_J = 74; $VK_K = 75; $VK_L = 76
$VK_LEFT = 37; $VK_UP = 38; $VK_RIGHT = 39; $VK_DOWN = 40
$VK_0 = 0x30
$VK_LWIN = 91; $VK_LSHIFT = 160; $VK_CONTROL = 17; $VK_ESC = 27
$SC_MAXIMIZE = 0xF030; $SC_RESTORE = 0xF120
$ARROW_SCAN_TABLE = @{ 37 = 75; 38 = 72; 39 = 77; 40 = 80 }
$SHORTCUT_MARKER = $MX_MARKER
$INPUT_STRUCT_SIZE_X64 = 40
$MOUSE_MOVE = 0x0001; $MOUSE_ABS = 0x8000; $MOUSE_DOWN = 0x0002; $MOUSE_UP = 0x0004

function Wait-MaxOutcome([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [int]$TimeoutSec, [string]$Tag) {
  # `dispatched` is the settled async report (setter accepted, native
  # completion pending): every caller pairs this with Wait-ZoomedMx, which
  # proves the actual native convergence. Discrete-toggle parity: each fresh
  # Win+M down dispatches once; repeats never dispatch (classifier
  # trace-only), so no `maximize-refused-attempted` fence exists.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -ne "maximize-toggle") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      return @{ event = $e; count = $lines.Count }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Mx "$Tag no maximize-toggle outcome=($($Outcomes -join '|')) after mark $Mark"
  return $null
}

function Wait-AdmissionClear([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -eq "maximize-admission-clear") { return @{ event = $e; count = $lines.Count } }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Mx "$Tag no maximize-admission-clear after mark $Mark"
  return $null
}

function Wait-WorkspaceOutcomeMx([string]$LogPath, [int]$Mark, [string]$Op, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
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
  Fail-Mx "$Tag no workspace $Op/$Index after mark $Mark"
  return $null
}

function Test-IsZoomedMx([long]$Hwnd) {
  [ActiveBorderNative]::EnsurePMv2()
  return [bool][ActiveBorderNative]::IsZoomed([IntPtr]$Hwnd)
}

function Wait-ZoomedMx([long]$Hwnd, [bool]$Want, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    [ActiveBorderNative]::EnsurePMv2()
    $z = [ActiveBorderNative]::IsZoomed([IntPtr]$Hwnd)
    if ([bool]$z -eq [bool]$Want) { return }
    Start-Sleep -Milliseconds 200
  }
  Fail-Mx "$Tag IsZoomed did not converge to $Want"
}

function Get-HelperRectKeyMx([string]$HelperBin, $Snap, [string]$Tag) {
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  return "$($fresh.left),$($fresh.top),$($fresh.right),$($fresh.bottom)"
}

function Get-FrameKeyMx([long]$Hwnd, [string]$Tag) {
  # Owner-side DWM visible frame (physical PMv2): comparable to Engine plan
  # slots. Helper outer rects are GetWindowRect (invisible borders included)
  # in the helper CLI's unaware coordinates: never mix the two.
  [ActiveBorderNative]::EnsurePMv2()
  $f = [ActiveBorderNative]::FrameOf($Hwnd)
  if ($null -eq $f) { Fail-Mx "$Tag DWM frame unreadable" }
  return "$([int]$f[0]),$([int]$f[1]),$([int]$f[2]),$([int]$f[3])"
}

function Invoke-TitleDoubleClickMx([string]$HelperBin, $Snap, [string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Mx "$Tag not foreground for double-click" }
  $outer = Get-NativeRectAb $Hwnd
  if ($null -eq $outer) { Fail-Mx "$Tag native outer unreadable" }
  $start = Find-TitlePointAb $Hwnd $outer
  if ($null -eq $start) { Fail-Mx "$Tag no WindowFromPoint bound-helper title hit" }
  $held = New-HeldProcessAb ([uint32]$fresh.process.pid) "$Tag"
  try {
    $dpi = [ActiveBorderNative]::GetDpiForWindow([IntPtr]$Hwnd)
    $vs = Get-VirtualScreenAb ([uint32]$dpi)
    $ax = ConvertTo-AbsoluteAb ([int]$start[0]) ([int]$vs[0]) ([int]$vs[2])
    $ay = ConvertTo-AbsoluteAb ([int]$start[1]) ([int]$vs[1]) ([int]$vs[3])
    $saved = $null
    try { $pt = New-Object ActiveBorderNative+POINT; if ([ActiveBorderNative]::GetCursorPos([ref]$pt)) { $saved = @($pt.x, $pt.y) } } catch {}
    try {
      if ([ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $ax, $ay) -eq 0) { Fail-Mx "$Tag cursor move not inserted" }
      Start-Sleep -Milliseconds 250
      $fg2 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      if ([uint64]$fg2 -ne [uint64]$Hwnd) { Fail-Mx "$Tag lost foreground before double-click" }
      $pt2 = New-Object ActiveBorderNative+POINT; $pt2.x = [int]$start[0]; $pt2.y = [int]$start[1]
      if ([uint64]([ActiveBorderNative]::WindowFromPoint($pt2).ToInt64()) -ne [uint64]$Hwnd) { Fail-Mx "$Tag WindowFromPoint lost helper before double-click" }
      foreach ($k in 1..2) {
        if ([ActiveBorderNative]::SendMouse($MOUSE_DOWN, 0, 0) -eq 0) { Fail-Mx "$Tag click$k down not inserted" }
        Start-Sleep -Milliseconds 90
        if ([ActiveBorderNative]::SendMouse($MOUSE_UP, 0, 0) -eq 0) { Fail-Mx "$Tag click$k up not inserted" }
        if ($k -eq 1) { Start-Sleep -Milliseconds 120 }
      }
      Start-Sleep -Milliseconds 500
      if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Mx "$Tag held process exited across double-click" }
    } finally {
      try { $null = [ActiveBorderNative]::SendMouse($MOUSE_UP, 0, 0) } catch {}
      Assert-ButtonReleasedAb "$Tag-release"
      if ($null -ne $saved) {
        try {
          $rx = ConvertTo-AbsoluteAb ([int]$saved[0]) ([int]$vs[0]) ([int]$vs[2]); $ry = ConvertTo-AbsoluteAb ([int]$saved[1]) ([int]$vs[1]) ([int]$vs[3])
          $null = [ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $rx, $ry)
        } catch {}
      }
    }
  } finally { Close-HeldProcessAb $held }
  $null = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post"
}

function Assert-NoWriteForMx([string]$LogPath, [int]$Mark, [string]$Token, [string]$Tag) {
  # Token-scoped when the Engine token is known (Win+M legs carry it on the
  # toggle event); empty token means strict (native legs): no overlay geometry
  # write at all while maximized.
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "write") { continue }
    if ($Token -eq "") { Fail-Mx "$Tag geometry write while maximized: $($lines[$i])" }
    $text = "$($lines[$i])"
    if ($text -match [regex]::Escape($Token)) { Fail-Mx "$Tag geometry write references maximized token" }
  }
}

function Assert-SendGeometryMx([string]$LogPath, [int]$Mark, [int]$Tick, [string]$Op, [int]$Index, [string]$Tag) {
  # Send-success oracle for maximized movers after the focus-into-max fix:
  # the follow focus must be exact (`focus-ok` into the maximized mover),
  # never `focus-unverified`/`no-focus`. Membership transfer must carry
  # source/target readback_ok with no veto. Records the focus field
  # explicitly. Callers additionally prove the final exact foreground
  # (`GetForegroundWindow` == mover) after settle.
  $lines = Get-CompleteLinesLocal $LogPath
  $found = $null
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if (($e.event -eq "workspace-action") -and ([int]$e.tick -eq [int]$Tick) -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index)) {
      $found = $e; break
    }
  }
  if ($null -eq $found) { Fail-Mx "$Tag no workspace-action for tick $Tick" }
  if ("$($found.outcome)" -ne "ok") { Fail-Mx "$Tag send outcome $($found.outcome) != ok" }
  if ("$($found.focus)" -ne "focus-ok") { Fail-Mx "$Tag send focus $($found.focus) != focus-ok (maximized mover must take exact follow focus)" }
  if ($null -eq $found.source -or $null -eq $found.target) { Fail-Mx "$Tag send geometry missing" }
  if (-not [bool]$found.source.readback_ok) { Fail-Mx "$Tag source readback not verified" }
  if (-not [bool]$found.target.readback_ok) { Fail-Mx "$Tag target readback not verified" }
  if ($null -ne $found.source.veto -or $null -ne $found.target.veto) { Fail-Mx "$Tag send vetoed" }
  Rec-Mx "$Tag-geometry" @{ outcome = "$($found.outcome)"; focus = "$($found.focus)";
    source_readback = [bool]$found.source.readback_ok; target_readback = [bool]$found.target.readback_ok }
  return $found
}

function Assert-ExactForegroundMx([uint64]$Want, [string]$Tag) {
  # Exact foreground proof: `GetForegroundWindow` must equal the expected
  # HWND now (no frozen-set membership, no inference from logs).
  [ActiveBorderNative]::EnsurePMv2()
  $fg = [uint64]([ActiveBorderNative]::GetForegroundWindow().ToInt64())
  if ($fg -ne $Want) { Fail-Mx "$Tag foreground $fg != expected $Want" }
  Rec-Mx "$Tag-foreground" @{ foreground = $fg; expected = $Want }
}

function Get-UnderlayVisibleMx([string]$Payload, [string]$Tag) {
  $insp = Invoke-Native $Payload @("underlay-inspect") | ConvertFrom-Json
  if (-not $insp.present) { return 0 }
  return @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
}

function Hold-WinShiftMx([string]$Tag) {
  # Synthetic marked Win+Shift hold (back-to-back downs, one settle): the
  # underlay samples levels via GetAsyncKeyState on the owner's 100ms pump,
  # so one settle sleep lets the chord-edge wake fire. Marked
  # (SHORTCUT_MARKER) so the hook sees synthetic test input like every
  # other chord in this harness; sent via the shortcut native which carries
  # the 3-arg marked overload.
  $m = [uint64]$MX_MARKER
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LWIN, $false, $m) -ne 1) { Fail-Mx "$Tag Win down not inserted" }
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LSHIFT, $false, $m) -ne 1) { Fail-Mx "$Tag Shift down not inserted" }
  Start-Sleep -Milliseconds 600
}

function Release-WinShiftMx([string]$Tag) {
  $m = [uint64]$MX_MARKER
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

function Wait-UnderlayShownMx([string]$Payload, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-UnderlayVisibleMx $Payload $Tag) -ne 0) { return }
    Start-Sleep -Milliseconds 100
  }
  Fail-Mx "$Tag underlay not visible while Win+Shift held"
}

function Get-WorkspaceActionMx([string]$LogPath, [int]$Mark, [int]$Tick, [string]$Op, [int]$Index, [string]$Tag) {
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if (($e.event -eq "workspace-action") -and ([int]$e.tick -eq [int]$Tick) -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index)) {
      return $e
    }
  }
  Fail-Mx "$Tag no workspace-action for tick $Tick"
  return $null
}

function Get-PlannedSlotMx([string]$LogPath, [string]$Token, [string]$Tag) {
  # Engine-allocated slot for one opaque window token: the newest plan entry
  # carrying that token. Native helper rects cannot serve here (a maximized
  # member reads the compositor maximum, not its slot).
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "plan") { continue }
    foreach ($en in @($e.entries)) {
      if ("$($en.window)" -ceq $Token) { return (($en.rect | ForEach-Object { "$_" }) -join ",") }
    }
  }
  Fail-Mx "$Tag no plan entry for token"
  return ""
}

function Get-MaxFocusDirectionMx([string]$Payload, [string]$AllowPath, [uint64]$MeHwnd, [int[]]$MeRect, [string]$Tag) {
  $n = Get-MaxFocusNeighborMx $Payload $AllowPath $MeHwnd $MeRect $Tag
  return $n.direction
}

function Get-MaxFocusNeighborMx([string]$Payload, [string]$AllowPath, [uint64]$MeHwnd, [int[]]$MeRect, [string]$Tag) {
  # Neighbor lookup against the member's TILE SLOT, not its native frame: a
  # maximized member's fresh frame is the compositor maximum (no strict
  # neighbor), while its retained slot keeps Engine topology. Returns both
  # the direction and the exact expected neighbor HWND so callers prove
  # exact foreground, not frozen-set membership.
  $insp = Invoke-Native $Payload @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json
  $x = [int]$MeRect[0]; $y = [int]$MeRect[1]; $ww = [int]$MeRect[2]; $hh = [int]$MeRect[3]
  foreach ($dir in @("left", "right", "up", "down")) {
    foreach ($o in @($insp.windows)) {
      if ([uint64]$o.hwnd -eq [uint64]$MeHwnd) { continue }
      if ($o.eligible -ne $true) { continue }
      $ox = [int]$o.visible[0]; $oy = [int]$o.visible[1]; $ow = [int]$o.visible[2]; $oh = [int]$o.visible[3]
      $overlapX = ($x -lt ($ox + $ow)) -and ($ox -lt ($x + $ww))
      $overlapY = ($y -lt ($oy + $oh)) -and ($oy -lt ($y + $hh))
      if (($dir -eq "left") -and ((($ox + $ow) -le $x) -and $overlapY)) { return @{ direction = "left"; hwnd = [uint64]$o.hwnd } }
      if (($dir -eq "right") -and (($ox -ge ($x + $ww)) -and $overlapY)) { return @{ direction = "right"; hwnd = [uint64]$o.hwnd } }
      if (($dir -eq "up") -and ((($oy + $oh) -le $y) -and $overlapX)) { return @{ direction = "up"; hwnd = [uint64]$o.hwnd } }
      if (($dir -eq "down") -and (($oy -ge ($y + $hh)) -and $overlapX)) { return @{ direction = "down"; hwnd = [uint64]$o.hwnd } }
    }
  }
  Fail-Mx "$Tag maximized member has no directional neighbor"
  return $null
}

function Get-OppositeDirMx([string]$Dir) {
  if ($Dir -eq "left") { return "right" }
  if ($Dir -eq "right") { return "left" }
  if ($Dir -eq "up") { return "down" }
  return "up"
}

function Get-DirVkMx([string]$Dir) {
  if ($Dir -eq "left") { return $VK_LEFT }
  if ($Dir -eq "right") { return $VK_RIGHT }
  if ($Dir -eq "up") { return $VK_UP }
  return $VK_DOWN
}

function Invoke-MaximiseMock {
  Rec-Mx "scope" @{ helpers = "owned-only-first"; ordinary = "scoped-normal-smoke"; never = @("terminal"); kills = "exact-owner-only"; registry = "none"; screenshots = "none"; content = "none" }
  $help = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-windows -- help 2>$null
  if ("$help" -notmatch "shortcut-proof") { Fail-Mx "mock CLI help missing shortcut-proof" }
  if ("$help" -notmatch "workspace-proof") { Fail-Mx "mock CLI help missing workspace-proof" }
  if ("$help" -notmatch "tile-proof") { Fail-Mx "mock CLI help missing tile-proof" }
  if ("$help" -notmatch "border-inspect") { Fail-Mx "mock CLI help missing border-inspect" }
  if ("$help" -notmatch "underlay-inspect") { Fail-Mx "mock CLI help missing underlay-inspect" }
  $hhelp = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-test-window -- help 2>$null
  if ("$hhelp" -notmatch "move HWND --tag TAG --to") { Fail-Mx "mock helper help missing exact-bound move" }
  Rec-Mx "cli-surface" @{ shortcut_proof = $true; workspace_proof = $true; tile_proof = $true }
  $rows = Get-ShortcutJourney
  Assert-NoWinLJourney $rows
  $maxRows = @($rows | Where-Object { $_.family -eq "maximize-toggle" })
  if ($maxRows.Count -ne 1) { Fail-Mx "mock journey needs exactly one maximize-toggle row" }
  $maxRow = $maxRows[0]
  if (([int]$maxRow.vk -ne $VK_M) -or ($maxRow.shift) -or ($maxRow.ctrl) -or ($maxRow.op -ne "maximize")) {
    Fail-Mx "mock maximize-toggle row must be unshifted Win+M with op maximize"
  }
  Rec-Mx "journey-maximize" @{ vk = [int]$maxRow.vk; op = "$($maxRow.op)" }
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  Assert-ChordSendCounts 4 $false 0 "mock-plain-m"
  Assert-ChordSendCounts 6 $true 0 "mock-shift-arrow"
  Assert-EncodingInvariant $VK_M $false 0 "mock-m-plain"
  foreach ($vk in @(37, 38, 39, 40)) {
    $scan = [int][ShortcutProofNative]::MapVirtualKey([uint32]$vk, 0)
    Assert-EncodingInvariant ([int]$vk) $true ([int]$scan) "mock-arrow-$vk"
  }
  try { Assert-EncodingInvariant $VK_M $true 0 "mock-negative"; Fail-Mx "negative M-extended did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "EXTENDEDKEY") { throw } }
  Rec-Mx "encoding" @{ m_plain = $true; arrows_extended = $true; input_size = $size }
  $src = Get-Content -LiteralPath (Join-Path $Repo "scripts\windows-maximise.ps1") -Raw
  foreach ($need in @("Wait-MaxOutcome", "Wait-AdmissionClear", "Assert-SendGeometryMx", "Assert-ExactForegroundMx", "Get-WorkspaceActionMx", "Get-PlannedSlotMx", "Invoke-TitleDoubleClickMx",
      "Invoke-OwnedSysCommandAb", "Set-OwnedForegroundAb", "Send-MarkedChord", "Assert-NoWriteForMx",
      "0x0082", "0x201E", "SHORTCUT_MARKER", "IsZoomed", "border-inspect", "underlay-inspect",
      "emergency-stop", "Get-OverlayHwndsForOwnerAb")) {
    if ($src -notmatch [regex]::Escape($need)) { Fail-Mx "mock harness missing $need" }
  }
  $regPat = 'Set-Item' + 'Property|New-Item' + 'Property'
  if ($src -match $regPat) { Fail-Mx "mock registry/policy write present" }
  if ($src -match ('Get' + 'Pixel')) { Fail-Mx "mock screen-content capture present (geometry/state gates only)" }
  Rec-Mx "harness-seams" @{ zoom_gates = $true; overlay_gates = $true; marks_before_actions = $true }
  $tsrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\tiling_sys.rs") -Raw
  foreach ($need in @("clear_maximize_at_admission", "canonical_retained_rect",
      "overlay_refusal", "managed_origins", "restore_zoom_placement", "toggle_zoom_async", "maximize-toggle",
      "maximize-admission-clear", "move-refused-maximize", "classify_focus")) {
    if ($tsrc -notmatch [regex]::Escape($need)) { Fail-Mx "mock product missing $need" }
  }
  foreach ($gone in @("maximize_toggle_wanted", "maximize-refused-attempted", "still-restored", "still-maximized", "toggle_fence_release")) {
    if ($tsrc -match [regex]::Escape($gone)) { Fail-Mx "mock product still carries removed fence $gone" }
  }
  $ksrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\snapkey.rs") -Raw
  if ($ksrc -notmatch "is_maximize_vk") { Fail-Mx "mock classifier missing is_maximize_vk" }
  if ($ksrc -notmatch "Maximize") { Fail-Mx "mock classifier missing Maximize arm" }
  Rec-Mx "product-seams" @{ admission_clear = $true; discrete_toggle = $true; retained_origins = $true; classifier = $true; focus_into_max = $true }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test tiling 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Mx "mock cargo test tiling failed" }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test snapkey 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Mx "mock cargo test snapkey failed" }
  Rec-Mx "portable-tests" @{ suites = @("tiling", "snapkey"); result = "pass" }
  $report = @{ status = "pass"; stage = "MaximiseMock"; steps = $MX_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Invoke-OwnedMaxLive($Ctx) {
  # Reuses the admission-phase shortcut-proof owner (same allowlist, helpers
  # already visible and converged): no second owner, no ledger conflict.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  if ($null -eq $Ctx.admitLog -or $null -eq $Ctx.admitAllow) { Fail-Mx "owned legs need the admission owner first" }
  $allowPath = $Ctx.admitAllow
  $logPath = $Ctx.admitLog
  $h1 = $Ctx.wsSnaps[0]; $h2 = $Ctx.wsSnaps[1]; $h3 = $Ctx.wsSnaps[2]
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $Ctx.ledgerDir = "$($ident.ledger_directory)"
  $Ctx.auditPath = Join-Path ($Ctx.ledgerDir) "proof-audit-$($Ctx.ownerFrozen.process_creation).jsonl"
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark0 25 "adopt"
  Rec-Mx "adopted" @{ tick = $conv.tick; desired = $conv.desired; readback = $conv.readback }

  # Leg A: Win+M toggle max then restore on the middle helper (sibling
  # geometry oracle lives on the other two).
  $ordered = @($conv.inspect.windows | Sort-Object { [int]$_.visible[0] })
  $midHwnd = [uint64]$ordered[1].hwnd
  $midSnap = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq $midHwnd } | Select-Object -First 1
  $sibA = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -ne $midHwnd }
  $preMidRect = Get-HelperRectKeyMx $helperCopy $midSnap "legA-pre"
  $preSibs = @($sibA | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "legA-pre-sib" })
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legA-focus"
  $preFg = [uint64]$freshMid.hwnd
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_M $false $false $preFg 0 $false
  if ([int]$sent.accepted -ne 4) { Fail-Mx "legA Win+M send accepted $([int]$sent.accepted) != 4" }
  $ev = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legA-max"
  Rec-Mx "legA-toggle-max" @{ outcome = "$($ev.event.outcome)"; target = "$($ev.event.target)"; accepted = [int]$sent.accepted }
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legA-zoomed"
  $duringSibs = @($sibA | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "legA-max-sib" })
  if (($duringSibs -join "|") -cne ($preSibs -join "|")) { Fail-Mx "legA sibling frames moved under maximize" }
  Assert-NoWriteForMx $logPath $mark "$($ev.event.window)" "legA-nowrite"
  $inspMax = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $rowMax = @($inspMax.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($null -eq $rowMax) { Fail-Mx "legA maximized member missing from inspect" }
  if ($rowMax.eligible -ne $false) { Fail-Mx "legA maximized member still eligible" }
  $bMax = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  $bVis = @(@($bMax.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$bVis -ne 0) { Fail-Mx "legA border visible while maximized" }
  $uMax = Invoke-Native $ownerCopy @("underlay-inspect") | ConvertFrom-Json
  $uVis = @(@($uMax.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$uVis -ne 0) { Fail-Mx "legA underlay visible while maximized" }
  Rec-Mx "legA-max-state" @{ zoomed = $true; eligible = $false; border_visible = $bVis; underlay_visible = $uVis; siblings_stable = $true }
  # Toggle back to restored; exact slot returns.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legA-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $ev = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legA-restore"
  Rec-Mx "legA-toggle-restore" @{ outcome = "$($ev.event.outcome)" }
  Wait-ZoomedMx ([long]$midHwnd) $false 10 "legA-unzoomed"
  $tailConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark 20 "legA-plan"
  $postMidRect = Get-HelperRectKeyMx $helperCopy $midSnap "legA-post"
  if ($postMidRect -cne $preMidRect) { Fail-Mx "legA restore rect [$postMidRect] != slot [$preMidRect]" }
  $bBack = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  $bBackVis = @(@($bBack.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$bBackVis -ne 1) { Fail-Mx "legA border not visible after restore (visible=$bBackVis)" }
  Rec-Mx "legA-restored" @{ rect = $postMidRect; slot = $preMidRect; border_visible = $bBackVis }

  # Leg B: repeat hold does not churn (down + 2 repeats = one toggle only).
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legB-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 2 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 2 "legB-send"
  $ev = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legB-max"
  Start-Sleep -Milliseconds 2500
  $after = Get-LogEventsAfter $logPath $mark
  $toggles = @($after.events | Where-Object { ($_.event -eq "maximize-toggle") -and ("$($_.disposition)" -eq "consumed") -and (@("maximized", "restored", "dispatched") -contains "$($_.outcome)") })
  if (@($toggles).Count -ne 1) { Fail-Mx "legB repeat churn: $(@($toggles).Count) toggles != 1" }
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legB-zoomed"
  Rec-Mx "legB-repeat-hold" @{ toggles = @($toggles).Count; accepted = [int]$sent.accepted }
  # Leave restored for the next legs.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legB-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legB-restore"
  Wait-ZoomedMx ([long]$midHwnd) $false 10 "legB-unzoomed"

  # Leg C: own-maximize then native restore then Win+M (discrete-toggle
  # proof). No fence exists: the press after the native restore must
  # dispatch a fresh maximize (the old pending-only fence defect is gone).
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legC-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legC-zoomed"
  $freshMid2 = Assert-HelperIdentityAb $helperCopy $midSnap "legC-pre-native"
  $null = Invoke-OwnedSysCommandAb $helperCopy $freshMid2 $SC_RESTORE "legC-native-restore"
  Wait-ZoomedMx ([long]$midHwnd) $false 10 "legC-native-unzoomed"
  $fgC = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgC -ne [uint64]$midHwnd) { $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-refocus2" }
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$midHwnd) 0 $false
  $evF = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legC-toggle"
  $fenceOutcome = "$($evF.event.outcome)"
  Rec-Mx "legC-discrete-toggle" @{ outcome = $fenceOutcome; note = "own-max then native restore then Win+M must dispatch (no fence)" }
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legC-remax"
  # Normalize to restored for the native legs.
  [ActiveBorderNative]::EnsurePMv2()
  if ([ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) {
    $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-norm"
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
    $null = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legC-norm"
    Wait-ZoomedMx ([long]$midHwnd) $false 15 "legC-norm-unzoomed"
  }
  $normRect = Get-HelperRectKeyMx $helperCopy $midSnap "legC-norm-rect"
  Rec-Mx "legC-normalized" @{ rect = $normRect; zoomed = $false }

  # Leg D: native SC_MAXIMIZE converges identically (same gates as Win+M max),
  # then Win+M restores; native SC_RESTORE state then Win+M maximizes.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legD-focus"
  $slotD = Get-HelperRectKeyMx $helperCopy $midSnap "legD-slot"
  $sibsD = @($sibA | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "legD-pre-sib" })
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Invoke-OwnedSysCommandAb $helperCopy $freshMid $SC_MAXIMIZE "legD-sysmax"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legD-zoomed"
  Start-Sleep -Milliseconds 1500
  $duringSibs = @($sibA | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "legD-max-sib" })
  if (($duringSibs -join "|") -cne ($sibsD -join "|")) { Fail-Mx "legD sibling frames moved under native maximize" }
  Assert-NoWriteForMx $logPath $mark "" "legD-nowrite"
  $inspD = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $rowD = @($inspD.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($rowD.eligible -ne $false) { Fail-Mx "legD native-maximized member still eligible" }
  Rec-Mx "legD-native-max" @{ zoomed = $true; eligible = $false; siblings_stable = $true }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legD-refocus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $ev = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legD-winm-restore"
  Wait-ZoomedMx ([long]$midHwnd) $false 15 "legD-unzoomed"
  $restD = Get-HelperRectKeyMx $helperCopy $midSnap "legD-restored"
  if ($restD -cne $slotD) { Fail-Mx "legD restore rect [$restD] != slot [$slotD]" }
  Rec-Mx "legD-native-converged" @{ restored_rect = $restD; slot = $slotD }

  # Leg E: native titlebar double-click toggles both ways (synthetic mouse
  # on the exact bound helper). The maximize-button click fixture is parked:
  # two blind-aim variants hit Close and killed the owned helper;
  # GetTitleBarInfo returns FALSE (err 87 at every cbSize, and FALSE on
  # classic Notepad too), so no exact caption-button rect is available.
  # Physical button verification is user-only; SC_MAXIMIZE via WM_SYSCOMMAND
  # (legD) is the identical native message the button sends. No new mouse
  # approaches are added.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legE-focus"
  Invoke-TitleDoubleClickMx $helperCopy $midSnap "legE-dblmax"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legE-dbl-zoomed"
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legE-focus2"
  Invoke-TitleDoubleClickMx $helperCopy $midSnap "legE-dblrestore"
  Wait-ZoomedMx ([long]$midHwnd) $false 10 "legE-dbl-unzoomed"
  $dblRect = Get-HelperRectKeyMx $helperCopy $midSnap "legE-dbl-rect"
  if ($dblRect -cne $slotD) { Fail-Mx "legE double-click restore rect [$dblRect] != slot [$slotD]" }
  Rec-Mx "legE-native-chrome" @{ double_click = "max+restore"; slot = $slotD;
    max_button = "gap: two blind-aim variants hit Close and killed the owned helper; GetTitleBarInfo returns FALSE (err 87 at every cbSize, and FALSE on classic Notepad too), so no exact caption-button rect is available. SC_MAXIMIZE via WM_SYSCOMMAND (legD) is the identical native message the button sends." }

  # Leg F: Win+Arrow stays focus while maximized (not Snap); proves focus
  # OUT OF the maximized member (exact expected neighbor foreground) and
  # focus back INTO it (exact maximized foreground). Win+Shift+Arrow
  # refuses with move-refused-maximize, topology unchanged, max intact.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legF-focus"
  $preSlot = Get-InspectFrames $ownerCopy $allowPath
  $meRow = @($preSlot.inspect.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($null -eq $meRow -or $meRow.eligible -ne $true) { Fail-Mx "legF mid not eligible before max" }
  $slotF = @([int]$meRow.visible[0], [int]$meRow.visible[1], [int]$meRow.visible[2], [int]$meRow.visible[3])
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legF-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legF-zoomed"
  $neighbor = Get-MaxFocusNeighborMx $ownerCopy $allowPath $midHwnd $slotF "legF-dir"
  $dirF = "$($neighbor.direction)"
  $wantNeighbor = [uint64]$neighbor.hwnd
  $vkF = Get-DirVkMx $dirF
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord ([int]$vkF) $false $false $midHwnd 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legF-arrow-send"
  $evF = Wait-SnapAfter $logPath $mark "focus" $dirF 20 "legF-arrow-out"
  if ("$($evF.outcome)" -ne "focus-ok") { Fail-Mx "legF Win+Arrow OUT while max outcome $($evF.outcome) != focus-ok (must stay focus, not Snap)" }
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "legF Win+Arrow OUT unmaximized the member" }
  Assert-ExactForegroundMx $wantNeighbor "legF-arrow-out"
  Rec-Mx "legF-arrow-out" @{ direction = $dirF; outcome = "$($evF.outcome)"; foreground = $wantNeighbor; expected = $wantNeighbor }
  # Focus back INTO the maximized member: exact maximized foreground proof.
  $oppDir = Get-OppositeDirMx $dirF
  $oppVk = Get-DirVkMx $oppDir
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord ([int]$oppVk) $false $false $wantNeighbor 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legF-arrow-back-send"
  $evBack = Wait-SnapAfter $logPath $mark "focus" $oppDir 20 "legF-arrow-in"
  if ("$($evBack.outcome)" -ne "focus-ok") { Fail-Mx "legF Win+Arrow INTO max outcome $($evBack.outcome) != focus-ok" }
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "legF Win+Arrow INTO unmaximized the member" }
  Assert-ExactForegroundMx ([uint64]$midHwnd) "legF-arrow-in"
  Rec-Mx "legF-arrow-in" @{ direction = $oppDir; outcome = "$($evBack.outcome)"; foreground = [uint64]$midHwnd; expected = [uint64]$midHwnd }
  $fgF = [uint64]$midHwnd
  # INTO proof leaves foreground exactly on the maximized member, so the
  # move-refusal probe dispatches from it directly (no refocus chord: a
  # Win+M now would restore it instead).
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "legF focus advance unmaximized the member" }
  $preMove = Get-InspectFrames $ownerCopy $allowPath
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord ([int]$vkF) $true $false ([uint64]$fgF) 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $true 0 "legF-shift-send"
  $evM = Wait-SnapAfter $logPath $mark "move" $dirF 20 "legF-shift-arrow"
  if ("$($evM.outcome)" -ne "move-refused-maximize") { Fail-Mx "legF Win+Shift+Arrow outcome $($evM.outcome) != move-refused-maximize" }
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "legF move attempt unmaximized the member" }
  $postMove = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preMove.frames $postMove.frames "legF-topology"
  Rec-Mx "legF-shift-refused" @{ outcome = "$($evM.outcome)"; topology = "unchanged"; zoomed = $true }
  # Restore to normal for handoff to the workspace stage.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legF-restore-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $evEnd = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legF-end"
  Wait-ZoomedMx ([long]$midHwnd) $false 15 "legF-end-unzoomed"
  $endRect = Get-HelperRectKeyMx $helperCopy $midSnap "legF-end-rect"
  Rec-Mx "legF-end" @{ rect = $endRect }

  # Leg G: group-underlay suppression with a real held Win+Shift chord.
  # Show (held) before max, hold while max and assert hidden, restore then
  # show again before release. Synthetic marked hold + the owner's input
  # pump (settle sleeps); the old inactive query (no held chord) is gone.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-focus"
  Hold-WinShiftMx "legG-show"
  try {
    Wait-UnderlayShownMx $ownerCopy 12 "legG-show"
    $showPre = Get-UnderlayVisibleMx $ownerCopy "legG-show"
    Rec-Mx "legG-show" @{ visible = $showPre; held = $true }
    if ([int]$showPre -eq 0) { Fail-Mx "legG underlay not visible with Win+Shift held before max" }
  } finally { Release-WinShiftMx "legG-show" }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-restore-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "legG-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "legG-zoomed"
  Hold-WinShiftMx "legG-suppressed"
  try {
    Start-Sleep -Milliseconds 1500
    $hideMid = Get-UnderlayVisibleMx $ownerCopy "legG-suppressed"
    Rec-Mx "legG-suppressed" @{ visible = $hideMid; held = $true; zoomed = $true }
    if ([int]$hideMid -ne 0) { Fail-Mx "legG underlay visible while maximized with Win+Shift held" }
  } finally { Release-WinShiftMx "legG-suppressed" }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-unmax-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "legG-restore"
  Wait-ZoomedMx ([long]$midHwnd) $false 15 "legG-unzoomed"
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-reshow-focus"
  Hold-WinShiftMx "legG-reshow"
  try {
    Wait-UnderlayShownMx $ownerCopy 12 "legG-reshow"
    $showPost = Get-UnderlayVisibleMx $ownerCopy "legG-reshow"
    Rec-Mx "legG-reshow" @{ visible = $showPost; held = $true }
    if ([int]$showPost -eq 0) { Fail-Mx "legG underlay did not return after restore with Win+Shift held" }
  } finally { Release-WinShiftMx "legG-reshow" }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-end-focus"
  Rec-Mx "legG-end" @{ suppressed_while_max = $true; restored_show = $true }
  $Ctx.midSnap = $midSnap; $Ctx.midHwnd = $midHwnd; $Ctx.sibs = $sibA; $Ctx.allowPath = $allowPath
}

function Invoke-WorkspaceMaxLive($Ctx) {
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $allowPath = Join-Path $proofDir "maximise-ws-allowlist.json"
  $snaps = @($Ctx.wsSnaps)
  if ($snaps.Count -ne 3) { Fail-Mx "workspace stage needs 3 admitted helpers" }
  $entries = @()
  foreach ($s in $snaps) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  # Normalize: no owner runs here, so a leftover maximize from an earlier
  # phase restores natively (standalone SYSCOMMAND, exact foreground).
  [ActiveBorderNative]::EnsurePMv2()
  if ([ActiveBorderNative]::IsZoomed([IntPtr][long]$snaps[0].hwnd)) {
    $fA = Set-OwnedForegroundAb $helperCopy $snaps[0] "ws-norm-focus"
    $null = Invoke-OwnedSysCommandAb $helperCopy $fA $SC_RESTORE "ws-norm-restore"
    Wait-ZoomedMx ([long]$snaps[0].hwnd) $false 10 "ws-norm-unzoomed"
    Rec-Mx "ws-normalized" @{ zoomed = $false }
  }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "max-ws"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Mx "ws-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  $hA = $snaps[0]
  $hB = $snaps[1]
  $midHwnd = [uint64]$hA.hwnd
  $seedHwnd = [uint64]$hB.hwnd
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($snaps[0].hwnd, $snaps[1].hwnd, $snaps[2].hwnd) $logPath $mark0 25 "ws-adopt"
  Rec-Mx "ws-adopted" @{ tick = $conv.tick }
  # Seed ws2 with a normal sibling FIRST (ws2 was empty: the old target slot
  # was the whole workarea). Send B to ws2, return to ws1, then max A sends
  # into the populated ws2: the target layout must carry both the sibling
  # allocation and the mover slot.
  $freshB = Set-OwnedForegroundAb $helperCopy $hB "ws-seed-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$freshB.hwnd) 0 $false
  $evSeed = Wait-WorkspaceOutcomeMx $logPath $mark "send" 2 30 "ws-seed2"
  if ("$($evSeed.event.outcome)" -ne "ok") { Fail-Mx "ws seed send outcome $($evSeed.event.outcome) != ok" }
  $null = Assert-SendGeometryMx $logPath $mark ([int]$evSeed.event.tick) "send" 2 "ws-seed2"
  Start-Sleep -Milliseconds 1500
  Assert-ExactForegroundMx $seedHwnd "ws-seed-follow"
  Rec-Mx "ws-seeded" @{ outcome = "$($evSeed.event.outcome)"; seed = $seedHwnd; populated = $true }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $null = Wait-WorkspaceOutcomeMx $logPath $mark "select" 1 30 "ws-seed-back1"
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$seedHwnd)) { Fail-Mx "ws seed left sibling visible on ws1" }
  Rec-Mx "ws-seed-back" @{ visible_ws1 = $true }
  # Maximize A, then send it (Shift+Win+2) to populated ws2 with follow.
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "ws-max-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshA.hwnd) 0 $false
  $evWMax = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "ws-max"
  $wsToken = "$($evWMax.event.window)"
  if ($wsToken -eq "") { Fail-Mx "ws-max toggle carried no window token" }
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "ws-zoomed"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false $midHwnd 0 $false
  $evS = Wait-WorkspaceOutcomeMx $logPath $mark "send" 2 30 "ws-send2"
  if ("$($evS.event.outcome)" -ne "ok") { Fail-Mx "ws send outcome $($evS.event.outcome) != ok" }
  $null = Assert-SendGeometryMx $logPath $mark ([int]$evS.event.tick) "send" 2 "ws-send2"
  Start-Sleep -Milliseconds 1500
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "ws send lost maximize" }
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "ws send-follow did not follow (not visible on ws2)" }
  Assert-ExactForegroundMx ([uint64]$midHwnd) "ws-send-follow"
  # Populated-target proof: the seed sibling keeps a live allocated layout
  # (eligible with a non-empty frame) beside the maximized mover's retained
  # slot (plan entry present), never the whole-workarea solo slot.
  $postSend = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $seedRow = @($postSend.windows | Where-Object { [uint64]$_.hwnd -eq $seedHwnd }) | Select-Object -First 1
  if ($null -eq $seedRow -or $seedRow.eligible -ne $true) { Fail-Mx "ws populated target lost sibling eligibility" }
  $seedVis = @([int]$seedRow.visible[0], [int]$seedRow.visible[1], [int]$seedRow.visible[2], [int]$seedRow.visible[3])
  if ([int]$seedVis[2] -le 0 -or [int]$seedVis[3] -le 0) { Fail-Mx "ws sibling layout not allocated" }
  $moverSlotPre = Get-PlannedSlotMx $logPath $wsToken "ws-send-slot"
  if ($moverSlotPre -eq "") { Fail-Mx "ws mover slot missing after populated send" }
  Rec-Mx "ws-send-follow" @{ outcome = "$($evS.event.outcome)"; zoomed = $true; visible = $true; sibling_allocated = $true; mover_slot = $moverSlotPre }
  # Select away hides; return focuses the maximized member exactly.
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $evH = Wait-WorkspaceOutcomeMx $logPath $mark "select" 1 30 "ws-select1"
  if ("$($evH.event.outcome)" -ne "ok") { Fail-Mx "ws select-away outcome $($evH.event.outcome) != ok" }
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "ws select-away left max member visible" }
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "ws hidden max lost zoom" }
  Rec-Mx "ws-select-away" @{ outcome = "$($evH.event.outcome)"; hidden = $true; zoomed = $true }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $false $false ([uint64]$fgNow) 0 $false
  $evR = Wait-WorkspaceOutcomeMx $logPath $mark "select" 2 30 "ws-return2"
  if ("$($evR.event.outcome)" -ne "ok") { Fail-Mx "ws return outcome $($evR.event.outcome) != ok" }
  $actR = Get-WorkspaceActionMx $logPath $mark ([int]$evR.event.tick) "select" 2 "ws-return2"
  if ("$($actR.outcome)" -ne "ok") { Fail-Mx "ws return action outcome $($actR.outcome) != ok" }
  if ("$($actR.focus)" -ne "focus-ok") { Fail-Mx "ws return focus $($actR.focus) != focus-ok (maximized member must take exact return focus)" }
  Start-Sleep -Milliseconds 1500
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "ws return did not reveal max member" }
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "ws return lost maximize" }
  Assert-ExactForegroundMx ([uint64]$midHwnd) "ws-return"
  Rec-Mx "ws-return" @{ outcome = "$($actR.outcome)"; focus = "$($actR.focus)"; visible = $true; zoomed = $true }
  # Restore lands the retained-allocated slot exactly: the slot is the
  # Engine plan entry for the toggle token (x,y,w,h -> l,t,r,b), never the
  # maximized native frame.
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "ws-restore-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshA.hwnd) 0 $false
  $evU = Wait-MaxOutcome $logPath $mark @("restored", "dispatched") 20 "ws-unmax"
  Wait-ZoomedMx ([long]$midHwnd) $false 15 "ws-unzoomed"
  # Converge scopes to the ws2-visible members (A restored beside seeded B;
  # C rides hidden ws1).
  $null = Wait-ConvergedFrames $ownerCopy $allowPath @($hA.hwnd, $hB.hwnd) $logPath $mark 20 "ws-slot-plan"
  $planXYWH = Get-PlannedSlotMx $logPath $wsToken "ws-slot"
  $pp = @($planXYWH -split ",")
  $wsSlot = "$($pp[0]),$($pp[1]),$([int]$pp[0] + [int]$pp[2]),$([int]$pp[1] + [int]$pp[3])"
  $wsRest = Get-FrameKeyMx ([long]$midHwnd) "ws-slot-post"
  if ($wsRest -cne $wsSlot) { Fail-Mx "ws restore frame [$wsRest] != allocated slot [$wsSlot] (plan $planXYWH)" }
  Rec-Mx "ws-restore-slot" @{ frame = $wsRest; slot = $wsSlot }
  # Trailing workspace send (index 0, never visited) keeps max + follows.
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "ws-trail-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshA.hwnd) 0 $false
  $evT = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "ws-trail-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 10 "ws-trail-zoomed"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 0) $true $false $midHwnd 0 $false
  $evT2 = Wait-WorkspaceOutcomeMx $logPath $mark "send" 0 30 "ws-trail-send"
  if ("$($evT2.event.outcome)" -ne "ok") { Fail-Mx "ws trailing send outcome $($evT2.event.outcome) != ok" }
  $null = Assert-SendGeometryMx $logPath $mark ([int]$evT2.event.tick) "send" 0 "ws-trail-send"
  Start-Sleep -Milliseconds 1500
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "ws trailing send lost maximize" }
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "ws trailing send-follow did not follow" }
  Assert-ExactForegroundMx ([uint64]$midHwnd) "ws-trailing"
  Rec-Mx "ws-trailing" @{ outcome = "$($evT2.event.outcome)"; zoomed = $true; visible = $true }
  # Return to ws1, then graceful stop reveals every member (A rides ws0).
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $null = Wait-WorkspaceOutcomeMx $logPath $mark "select" 1 30 "ws-back1"
  Start-Sleep -Milliseconds 1500
  $st = Stop-ExactOwner $ownerCopy $false "ws-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Mx "ws-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
  foreach ($s in $snaps) {
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$s.hwnd)) { Fail-Mx "ws stop reveal hwnd=$($s.hwnd) not visible" }
  }
  Rec-Mx "ws-revealed" @{ visible = $snaps.Count }
  $Ctx.wsLog = $logPath; $Ctx.wsAllow = $allowPath
}

function Invoke-AdmissionLive($Ctx) {
  # Pre-maximized first admission on a FRESH owner: no retained slot exists,
  # so the member restores once without stealing focus.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]; $hB = $snaps[1]
  $allowPath = Join-Path $proofDir "maximise-admit-allowlist.json"
  $entries = @()
  foreach ($s in $snaps) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  # Park focus on B first; A is maximized natively BEFORE the owner starts
  # (standalone exact-bound show needs no owner; the first owner starts below).
  # SYSCOMMAND needs the target foreground, so focus A for the maximize,
  # then park B and record it as the no-steal baseline.
  Show-ExactHelper $hA $hA $helperCopy "admit-show-a"
  Show-ExactHelper $hB $hB $helperCopy "admit-show-b"
  if ($snaps.Count -ge 3) { Show-ExactHelper $snaps[2] $snaps[2] $helperCopy "admit-show-c" }
  $focusA = Set-OwnedForegroundAb $helperCopy $hA "admit-focus-a"
  $null = Invoke-OwnedSysCommandAb $helperCopy $focusA $SC_MAXIMIZE "admit-premax-sys"
  Wait-ZoomedMx ([long]$hA.hwnd) $true 10 "admit-premax-zoomed"
  $null = Set-OwnedForegroundAb $helperCopy $hB "admit-park-b"
  $fgPre = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgPre -ne [uint64]$hB.hwnd) { Fail-Mx "admit park failed (fg=$fgPre)" }
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "max-admit"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Mx "admit-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $mark = 0
  $ev = Wait-AdmissionClear $logPath $mark 30 "admit-clear"
  if ("$($ev.event.outcome)" -notin @("restored", "dispatched")) { Fail-Mx "admit clear outcome $($ev.event.outcome)" }
  Wait-ZoomedMx ([long]$hA.hwnd) $false 15 "admit-unzoomed"
  Start-Sleep -Milliseconds 2000
  $fgPost = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgPost -ne [uint64]$fgPre) { Fail-Mx "admit clear stole focus (was $fgPre now $fgPost)" }
  $tail = Get-LogEventsAfter $logPath $mark
  $clears = @($tail.events | Where-Object { $_.event -eq "maximize-admission-clear" })
  if (@($clears).Count -ne 1) { Fail-Mx "admit clear fired $(@($clears).Count)x, want exactly once" }
  Rec-Mx "admit-clear" @{ outcome = "$($ev.event.outcome)"; focus_stable = $true; fires = @($clears).Count }
  $mark1 = (Get-CompleteLinesLocal $logPath).Count
  $null = Wait-ConvergedFrames $ownerCopy $allowPath @($snaps | ForEach-Object { $_.hwnd }) $logPath $mark1 25 "admit-converge"
  Rec-Mx "admit-converged" @{ ok = $true }
  $Ctx.admitLog = $logPath; $Ctx.admitAllow = $allowPath
}

function Invoke-GracefulMaxLive($Ctx) {
  # Graceful stop preserves the current maximize plus sibling frames; the
  # independent restore is idempotent and keeps zoom.
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy
  $logPath = $Ctx.ownedLog; $allowPath = $Ctx.ownedAllow
  $midSnap = $Ctx.midSnap; $midHwnd = [uint64]$Ctx.midHwnd; $sibs = @($Ctx.sibs)
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "grace-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshMid.hwnd) 0 $false
  $ev = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "grace-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 15 "grace-zoomed"
  $sibRects = @($sibs | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "grace-pre-sib" })
  $ownerPid = [int]$Ctx.ownerFrozen.pid
  $st = Stop-ExactOwner $ownerCopy $false "grace-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Mx "grace-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
  [ActiveBorderNative]::EnsurePMv2()
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "graceful stop lost maximize" }
  $postSibs = @($sibs | ForEach-Object { Get-HelperRectKeyMx $helperCopy $_ "grace-post-sib" })
  if (($postSibs -join "|") -cne ($sibRects -join "|")) { Fail-Mx "graceful stop moved sibling frames" }
  $bOv = @(Get-OverlayHwndsForOwnerAb $ownerPid) | Where-Object { $_ -ne 0 }
  if (@($bOv).Count -ne 0) { Fail-Mx "graceful stop left overlay HWNDs" }
  $midRect = Get-HelperRectKeyMx $helperCopy $midSnap "grace-post"
  Rec-Mx "grace-preserved" @{ zoomed = $true; siblings_stable = $true; overlays = 0; rect = $midRect }
}

function Invoke-CrashHiddenMaxLive($Ctx) {
  # Hidden maximized member survives exact-owner death: the watcher
  # auto-reveals with show state intact (still maximized, same identity).
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $snaps = @($Ctx.wsSnaps)
  $hA = $snaps[0]
  $midHwnd = [uint64]$hA.hwnd
  $allowPath = Join-Path $proofDir "maximise-crash-allowlist.json"
  $entries = @()
  foreach ($s in $snaps) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  # Normalize leftover zoom natively (no owner runs here).
  [ActiveBorderNative]::EnsurePMv2()
  if ([ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) {
    $fA = Set-OwnedForegroundAb $helperCopy $hA "crash-norm-focus"
    $null = Invoke-OwnedSysCommandAb $helperCopy $fA $SC_RESTORE "crash-norm-restore"
    Wait-ZoomedMx ([long]$midHwnd) $false 10 "crash-norm-unzoomed"
    Rec-Mx "crash-normalized" @{ zoomed = $false }
  }
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "max-crash"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Mx "crash-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $null = Wait-ConvergedFrames $ownerCopy $allowPath @($snaps | ForEach-Object { $_.hwnd }) $logPath $mark0 25 "crash-adopt"
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "crash-max-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_M $false $false ([uint64]$freshA.hwnd) 0 $false
  $evM = Wait-MaxOutcome $logPath $mark @("maximized", "dispatched") 20 "crash-max"
  Wait-ZoomedMx ([long]$midHwnd) $true 15 "crash-zoomed"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false $midHwnd 0 $false
  $evCS = Wait-WorkspaceOutcomeMx $logPath $mark "send" 2 30 "crash-send2"
  if ("$($evCS.event.outcome)" -ne "ok") { Fail-Mx "crash send outcome $($evCS.event.outcome) != ok" }
  $null = Assert-SendGeometryMx $logPath $mark ([int]$evCS.event.tick) "send" 2 "crash-send2"
  Start-Sleep -Milliseconds 1500
  Assert-ExactForegroundMx ([uint64]$midHwnd) "crash-send-follow"
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $null = Wait-WorkspaceOutcomeMx $logPath $mark "select" 1 30 "crash-hide1"
  Start-Sleep -Milliseconds 1500
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "crash setup left max member visible" }
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "crash setup lost zoom on hidden max" }
  Rec-Mx "crash-hidden-max" @{ hidden = $true; zoomed = $true }
  $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
  if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$Ctx.ownerFrozen.pid) { Fail-Mx "crash owner changed before kill" }
  # Exact-owner death only: the watcher auto-reveals first and holds the
  # store until it is done, so the independent restore waits for a clean
  # ledger (workspace-normal forced-cycle precedent).
  $null = Assert-ExactOwner $ownerCopy $Ctx.ownerFrozen "crash-kill"
  $kill = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
  if (-not $kill.owner_exited) { Fail-Mx "crash-kill stop no exit" }
  if (Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)") { Fail-Mx "crash-kill owner alive" }
  $Ctx.ownerRunning = $false
  $deadline = (Get-Date).AddSeconds(15)
  while ((-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midHwnd)) { Fail-Mx "watcher auto-reveal of hidden max timed out" }
  $back = Assert-HelperIdentityAb $helperCopy $hA "crash-revealed"
  if ([int]$back.process.pid -ne [int]$hA.process.pid) { Fail-Mx "crash revealed pid changed" }
  if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$midHwnd)) { Fail-Mx "watcher reveal lost maximize show state" }
  Rec-Mx "crash-watcher" @{ stop = $kill.owner_exited; auto_revealed = $true; zoomed = $true }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    try { Assert-LedgerClean $ownerCopy; break }
    catch { Start-Sleep -Milliseconds 250; if ((Get-Date) -ge $deadline) { Fail-Mx "crash watcher ledger dirty" } }
  }
  $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail-Mx "crash independent restore failed" }
  Assert-LedgerClean $ownerCopy
  Rec-Mx "crash-restore" @{ restored = $r.restored }
}

function Invoke-NormalSmokeLive($Ctx) {
  # Scoped ordinary-app smoke over the normal tile loop: native maximize,
  # workspace hide/reveal, native restore per app. No hook chords (product
  # tile filters injected input); no typing; nothing closed.
  Install-BorderNative
  if (-not ("MxCloakProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class MxCloakProbe {
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint a, ref int v, int s);
  public static int Cloaked(long hwnd) {
    int v = 0;
    if (DwmGetWindowAttribute((IntPtr)hwnd, 14, ref v, 4) != 0) return -1;
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
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
    if ([MxCloakProbe]::Cloaked([long]$w.hwnd) -ne 0) { continue }
    if (($exe -eq "firefox.exe") -or ($cls -eq "MozillaWindowClass")) {
      [ActiveBorderNative]::EnsurePMv2()
      if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$w.hwnd)) { Fail-Mx "refuse: visible non-maximized Firefox (never touch)" }
      $excluded += @{ hwnd = $w.hwnd; exe = "$($w.exe)"; reason = "firefox-maximized-intact" }
      continue
    }
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$w.hwnd)) { continue }
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
    # Hosting tree, consoles, and every non-approved executable are
    # recorded-excluded: the explicit --scope-exe allowlist keeps the product
    # off them, and no leg below activates/hides/closes anything but $cands.
    # (Strict refuse-all would block this smoke on any lived-in desktop.)
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
  if ($cands.Count -eq 0) { Fail-Mx "normal smoke needs a visible Notepad/Calculator/Paint" }
  Rec-Mx "normal-managed" @($cands | ForEach-Object { @{ hwnd = $_.hwnd; exe = $_.exe; class = $_.class } })
  Rec-Mx "normal-excluded" @($excluded | ForEach-Object { @{ hwnd = $_.hwnd; exe = $_.exe; reason = $_.reason } })
  $Ctx.normalExcluded = $excluded
  Start-ExplorerGui $ownerCopy "tile --user-start --seconds $ownerSeconds --trace --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe" $binDir
  $ready = Assert-OwnerReady $ownerCopy "max-normal"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Mx "normal-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 2500
  foreach ($w in $cands) {
    $hwnd = [long]$w.hwnd
    $tag = "normal-$($w.exe)-$hwnd"
    $fg0 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fg0 -ne [uint64]$hwnd) {
      $prime = [ActiveBorderNative]::PrimeE8()
      if ([int]$prime -ne 2) { Fail-Mx "$tag E8 prime accepted $prime != 2" }
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
      if ([uint64]$fg -ne [uint64]$hwnd) { Fail-Mx "$tag foreground readback $fg != $hwnd" }
    }
    $WM_SYSCOMMAND = 0x0112
    $ok = [ActiveBorderNative]::PostMessageW([IntPtr]$hwnd, $WM_SYSCOMMAND, [UIntPtr]$SC_MAXIMIZE, [IntPtr]::Zero)
    if (-not $ok) { Fail-Mx "$tag native maximize post failed" }
    Wait-ZoomedMx $hwnd $true 10 "$tag-zoomed"
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $q = Invoke-Native $ownerCopy @("workspace", "--select", "2") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Mx "$tag workspace select 2 not dispatched" }
    $null = Wait-WorkspaceOutcomeMx $logPath $mark "select" 2 30 "$tag-hide"
    Start-Sleep -Milliseconds 1200
    if ([ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Mx "$tag select-away left app visible" }
    $mark = (Get-CompleteLinesLocal $logPath).Count
    $q = Invoke-Native $ownerCopy @("workspace", "--select", "1") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Mx "$tag workspace select 1 not dispatched" }
    $null = Wait-WorkspaceOutcomeMx $logPath $mark "select" 1 30 "$tag-reveal"
    Start-Sleep -Milliseconds 1200
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Mx "$tag reveal left app hidden" }
    if (-not [ActiveBorderNative]::IsZoomed([IntPtr]$hwnd)) { Fail-Mx "$tag reveal lost maximize" }
    $ok = [ActiveBorderNative]::PostMessageW([IntPtr]$hwnd, $WM_SYSCOMMAND, [UIntPtr]$SC_RESTORE, [IntPtr]::Zero)
    if (-not $ok) { Fail-Mx "$tag native restore post failed" }
    Wait-ZoomedMx $hwnd $false 10 "$tag-unzoomed"
    Rec-Mx "normal-app" @{ exe = "$($w.exe)"; hwnd = $hwnd; max_hide_reveal_restore = $true }
  }
  $st = Stop-ExactOwner $ownerCopy $false "normal-stop" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Mx "normal-stop" @{ exited = $st.stop.owner_exited; restored = $st.restore.restored }
  foreach ($w in $cands) {
    $hwnd = [long]$w.hwnd
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Mx "normal end hwnd=$hwnd not visible" }
    if ([ActiveBorderNative]::IsZoomed([IntPtr]$hwnd)) {
      $null = [ActiveBorderNative]::ShowWindow([IntPtr]$hwnd, 9)
      Start-Sleep -Milliseconds 500
    }
    if ([ActiveBorderNative]::IsZoomed([IntPtr]$hwnd)) { Fail-Mx "normal end hwnd=$hwnd still maximized" }
  }
  Rec-Mx "normal-end" @{ apps_restored = $cands.Count }
  # Excluded set intact: still present, visible, and in the parked show state
  # (scope fence held; nothing activated/hidden/closed outside $cands).
  foreach ($x in @($Ctx.normalExcluded)) {
    $xh = [long]$x.hwnd
    [ActiveBorderNative]::EnsurePMv2()
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$xh)) { Fail-Mx "normal end excluded hwnd=$xh exe=$($x.exe) no longer visible" }
    if ([string]$x.reason -eq "zoomed-parked" -and -not [ActiveBorderNative]::IsZoomed([IntPtr]$xh)) {
      Fail-Mx "normal end excluded hwnd=$xh exe=$($x.exe) left maximized state"
    }
    if ([string]$x.reason -eq "iconic-parked" -and -not [ActiveBorderNative]::IsIconic([IntPtr]$xh)) {
      Fail-Mx "normal end excluded hwnd=$xh exe=$($x.exe) left minimized state"
    }
  }
  Rec-Mx "normal-excluded-intact" @{ count = @($Ctx.normalExcluded).Count }
}

function Invoke-MaxLive {
  Install-BorderNative
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Mx "refuse: OwnerSeconds must be 1..=600" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\windows-maximise\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "maximise-report.json"
  if (Test-Path $reportPath) { Fail-Mx "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Mx "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $ownerHash = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
  $helperHash = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
  $scriptHash = (Get-FileHash -LiteralPath (Join-Path $Repo "scripts\windows-maximise.ps1") -Algorithm SHA256).Hash
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $os = Get-CimInstance Win32_OperatingSystem
  Rec-Mx "env" @{ commit = $commit; status = $status; run_dir = $runDir; owner_sha256 = $ownerHash;
    helper_sha256 = $helperHash; script_sha256 = $scriptHash; actor_pid = $PID;
    sid = "$($ident.process.user_sid)"; session = $ident.process.session_id; il = "$($ident.integrity_level)";
    os_build = "$($os.BuildNumber)"; marker = ("0x{0:X}" -f $MX_MARKER); input_size = $size }
  $spi = Read-CorrectSpiAb
  Rec-Mx "settings-pre" @{ arranging_raw = $spi.arranging_raw; pen_raw = $spi.pen_raw }
  if ([int]$spi.arranging_raw -ne 1) { Fail-Mx "preflight arranging raw $($spi.arranging_raw) != 1 (must use 0x0082)" }
  if ([int]$spi.pen_raw -ne 35) { Fail-Mx "preflight pen raw $($spi.pen_raw) != 35 (must use 0x201E)" }
  Assert-LedgerClean $ownerCopy
  Test-NoProjectActors $ownerCopy $helperCopy "preflight"
  $originals = Get-OriginalAppsSnapshot
  Rec-Mx "original-apps" @{ count = @($originals).Count }
  $Ctx = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; proofDir = $runDir; ownerSeconds = $OwnerSeconds;
    created = [System.Collections.ArrayList]@(); ownerRunning = $false; ownerFrozen = $null; ownerPayload = "";
    ledgerDir = ""; auditPath = ""; fenceRefused = $false }
  $want = @()
  if ($Stage -eq "All") { $want = @("OwnedMax", "WorkspaceMax", "NormalSmoke") } else { $want = @($Stage) }
  try {
    if ($want -contains "OwnedMax") {
      # Admission-first: helpers start passive, A pre-maximized, first owner
      # clears once; the owned toggle/native/arrow legs reuse that owner.
      $h1 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper1"
      $h2 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper2"
      $h3 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper3"
      $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
      $null = $Ctx.created.Add(@{ snap = $h2; bin = $helperCopy })
      $null = $Ctx.created.Add(@{ snap = $h3; bin = $helperCopy })
      $Ctx.wsSnaps = @($h1, $h2, $h3)
      Invoke-AdmissionLive $Ctx
      Invoke-OwnedMaxLive $Ctx
      $Ctx.ownedLog = $Ctx.admitLog; $Ctx.ownedAllow = $Ctx.admitAllow
      Invoke-GracefulMaxLive $Ctx
    }
    if ($want -contains "WorkspaceMax") {
      if ($null -eq $Ctx.wsSnaps) {
        $h1 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper1"
        $h2 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper2"
        $h3 = Start-PassiveShortcutHelper $helperCopy $runDir "mx-helper3"
        $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
        $null = $Ctx.created.Add(@{ snap = $h2; bin = $helperCopy })
        $null = $Ctx.created.Add(@{ snap = $h3; bin = $helperCopy })
        $Ctx.wsSnaps = @($h1, $h2, $h3)
        foreach ($s in @($Ctx.wsSnaps)) { Show-ExactHelper $s $s $helperCopy "ws-pre-show" }
      }
      Invoke-WorkspaceMaxLive $Ctx
      Invoke-CrashHiddenMaxLive $Ctx
    }
    if ($want -contains "NormalSmoke") {
      Invoke-NormalSmokeLive $Ctx
    }
    Close-CreatedHelpers $Ctx "cleanup"
    $postSpi = Read-CorrectSpiAb
    if ([int]$postSpi.arranging_raw -ne 1) { Fail-Mx "end arranging raw $($postSpi.arranging_raw) != 1" }
    if ([int]$postSpi.pen_raw -ne 35) { Fail-Mx "end pen raw $($postSpi.pen_raw) != 35" }
    Assert-LedgerClean $ownerCopy
    Test-NoProjectActors $ownerCopy $helperCopy "end"
    Assert-OriginalAppsIntact $originals "end"
    $machine = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; ownerFrozen = $Ctx.ownerFrozen;
      ledger_directory = "$($ident.ledger_directory)" }
    $machine | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $runDir "machine.json")
    $report = @{ status = "pass"; stage = $Stage; fence_refused = [bool]$Ctx.fenceRefused; steps = $MX_STEPS }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "maximise-report=$reportPath"
    Write-Output "status=pass fence_refused=$($Ctx.fenceRefused)"
  } catch {
    try { if (($Ctx.ownerRunning) -and ($ownerCopy -ne "") -and (Test-Path $ownerCopy)) {
      try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
      try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      $Ctx.ownerRunning = $false
    } } catch {}
    try { foreach ($c in @($Ctx.created)) {
      try {
        $s = $c.snap
        if ((Test-ProcessAliveSameCreation ([int]$s.process.pid) "$($s.process.process_creation)")) {
          $null = Invoke-Native $helperCopy @("close", "$($s.hwnd)", "--tag", "$($s.tag)")
        }
      } catch {}
    } } catch {}
    $report = @{ status = "fail"; stage = $Stage; fence_refused = [bool]$Ctx.fenceRefused; steps = $MX_STEPS; error = "$($_.Exception.Message)" }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "maximise-report=$reportPath"
    throw "Maximise stage failed: $($_.Exception.Message)"
  }
}

if ($Mock) { Invoke-MaximiseMock; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Mx "Stop requires -RunDir" }
  Invoke-StopFromRunDir $RunDir
  exit 0
}
if ($Live) {
  if ($RunDir -ne "") { Fail-Mx "refuse: -Live always creates a new run dir; -RunDir is for -Stop only" }
  Invoke-MaxLive
  exit 0
}
Write-Output "windows-maximise parsed (no action without -Mock/-Live/-Stop)"
