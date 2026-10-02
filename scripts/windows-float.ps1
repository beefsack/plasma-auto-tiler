param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 300,
  [ValidateSet("All", "OwnedFloat", "WorkspaceFloat", "NormalSmoke")]
  [string]$Stage = "All"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner stop/restore helpers.
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }
# Lean reuse: load ONLY function definitions from the border + shortcuts
# harnesses via AST (never executes their top-level live legs).
$FlMock = $Mock; $FlLive = $Live; $FlStop = $Stop; $FlRunDir = $RunDir; $FlOwnerSeconds = $OwnerSeconds; $FlStage = $Stage
$FlBorderPath = Join-Path $Repo "scripts\windows-active-border.ps1"
$FlShortPath = Join-Path $Repo "scripts\windows-shortcuts.ps1"
$FL_STEPS = [System.Collections.ArrayList]@()
function Rec-Fl([string]$Name, $Data) { $null = $FL_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Fl([string]$Msg) { throw $Msg }
# Sink for AST-loaded shortcuts helpers that call Rec-/Fail-Shortcut
# internally: local shims route to the float ledger (never executes their
# top-level live legs).
$ShortcutSteps = [System.Collections.ArrayList]@()
function Rec-Shortcut([string]$Name, $Data) { Rec-Fl $Name $Data }
function Fail-Shortcut([string]$Msg) { throw $Msg }
function Fail-Ab([string]$Msg) { throw $Msg }
function Load-FlAst([string]$Path, [string[]]$Wanted) {
  $toks = $null; $errs = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$toks, [ref]$errs)
  if ($errs.Count -ne 0) { throw "harness parse errors in $Path : $($errs.Count)" }
  $loaded = @{}
  foreach ($fn in $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    if ($Wanted -contains $fn.Name) {
      $def = "$($fn.Extent.Text)" -replace '(?i)^function\s+', 'function script:'
      Invoke-Expression $def; $loaded[$fn.Name] = $true
    }
  }
  foreach ($need in $Wanted) { if (-not $loaded.ContainsKey($need)) { throw "helper unavailable: $need" } }
}
$FlBorderWanted = @("Install-BorderNative", "Get-MarkBeforeActionAb",
  "Assert-HelperIdentityAb", "Set-OwnedForegroundAb", "Invoke-OwnedSysCommandAb",
  "Get-OverlayHwndsForOwnerAb")
$FlShortWanted = @("Install-ShortcutNative", "Get-ShortcutJourney", "Assert-NoWinLJourney", "Assert-ChordSendCounts",
  "Assert-InputStructSize", "Assert-EncodingInvariant", "Test-ExeEqualLocal", "Assert-FullIdentityMatches",
  "Assert-FramesEqual",   "Install-ShortcutNative", "Read-CompleteTextLocal", "Get-CompleteLinesLocal",
  "Get-LogEventsAfter", "Get-PlanSnapshotLocal",
  "Send-MarkedChord", "Read-PenVisualization", "Read-SpiArranging", "Assert-ExactOwner", "Stop-ExactOwner",
  "Get-InspectFrames", "Wait-ConvergedFrames", "Wait-SnapAfter",
  "Get-OriginalAppsSnapshot", "Assert-OriginalAppsIntact", "Test-NoProjectActors")
Load-FlAst $FlBorderPath $FlBorderWanted
Load-FlAst $FlShortPath $FlShortWanted
$Mock = $FlMock; $Live = $FlLive; $Stop = $FlStop; $RunDir = $FlRunDir; $OwnerSeconds = $FlOwnerSeconds; $Stage = $FlStage

# Safety contract (docs/live-windows-testing.md grants no authority itself):
# explicit flags mandatory; bare invocation parses and exits. Live mutates
# ONLY exact identity-bound owned helpers (plus launched approved extras in
# NormalSmoke, closed after). NEVER closes/kills/types into the hosting
# Terminal/process tree (moving/tiling it is allowed). No process-name kills,
# no registry/policy writes, no screenshots, no app content. Activation is
# E8-prime + AttachThreadInput + one SetForegroundWindow on the exact bound
# target (Set-OwnedForegroundAb / Invoke-OwnedFocusEnsure). Synthetic input
# is marked (SHORTCUT_MARKER) Win+G float chords on frozen exact tagged owned
# helpers only; product `tile` keeps filtering ALL injected. Out-of-hook stop
# only (`stop` then `restore`). End state: zero run actors; ledger/stop
# clean; SPI arranging 1, pen 35.

$FL_MARKER = 0x544C5250524F4F46
$VK_G = 0x47
$VK_H = 72; $VK_J = 74; $VK_K = 75; $VK_L = 76
$VK_LEFT = 37; $VK_UP = 38; $VK_RIGHT = 39; $VK_DOWN = 40
$VK_0 = 0x30
$VK_LWIN = 91; $VK_LSHIFT = 160; $VK_ESC = 27
$GWL_EXSTYLE = -20
$WS_EX_TOPMOST = 0x00000008
$SC_MAXIMIZE = 0xF030; $SC_RESTORE = 0xF120
$SHORTCUT_MARKER = $FL_MARKER
$INPUT_STRUCT_SIZE_X64 = 40
$ARROW_SCAN_TABLE = @{ 37 = 75; 38 = 72; 39 = 77; 40 = 80 }

function Get-FloatReportStatus {
  # Honest contract: partial whenever any required row is unavailable,
  # unaccepted, or not executed, or when only one stage ran (a one-stage
  # pass never implies whole-feature acceptance). Mirrors console output.
  param($Steps, [string]$Stage)
  $names = @($Steps | ForEach-Object { "$($_.name)" })
  $joined = $names -join "|"
  $hasUnaccepted = $false
  foreach ($s in @($Steps)) {
    $n = "$($s.name)"
    if ($n -match "unaccepted|unavailable|not-executed|rows-unaccepted|ws-rows-unaccepted|required-unimplemented|normal-float-rows") { $hasUnaccepted = $true }
    try { if ("$($s.data.float)" -match "unaccepted") { $hasUnaccepted = $true } } catch {}
  }
  if ($joined -match "rows-unaccepted|ws-rows-unaccepted|required-unimplemented") { $hasUnaccepted = $true }
  if ($Stage -ne "All") { return "partial" }
  if ($hasUnaccepted) { return "partial" }
  return "pass"
}

function Test-FloatStatusClassifier([string]$Tag) {
  $mk = { param($n, $d) return @{ name = $n; data = $d } }
  $okSteps = @(@(&$mk "adopted" @{}))
  if ((Get-FloatReportStatus $okSteps "All") -ne "pass") { Fail-Fl "$Tag classifier clean-All != pass" }
  $unSteps = @(@(&$mk "rows-unaccepted" @{ rows = @("x") }))
  if ((Get-FloatReportStatus $unSteps "All") -ne "partial") { Fail-Fl "$Tag classifier rows-unaccepted != partial" }
  $wsSteps = @(@(&$mk "ws-rows-unaccepted" @{}))
  if ((Get-FloatReportStatus $wsSteps "All") -ne "partial") { Fail-Fl "$Tag classifier ws != partial" }
  $reqSteps = @(@(&$mk "required-unimplemented" @{}))
  if ((Get-FloatReportStatus $reqSteps "All") -ne "partial") { Fail-Fl "$Tag classifier required != partial" }
  $floatSteps = @(@(&$mk "normal-notepad" @{ float = "unaccepted-no-cli-synthetic-filtered" }))
  if ((Get-FloatReportStatus $floatSteps "All") -ne "partial") { Fail-Fl "$Tag classifier float-unaccepted != partial" }
  if ((Get-FloatReportStatus $okSteps "OwnedFloat") -ne "partial") { Fail-Fl "$Tag classifier single-stage != partial" }
  Rec-Fl "$Tag-classifier" @{ pass_branch = $true; partial_branches = 5 }
}

function Get-RequiredUnimplementedRows {
  # Required rows with no fixture implementation: user-owned acceptance
  # only, never silently omitted.
  return @("crash-recovery", "hidden-watcher", "restart-native-state", "born-fullscreen-refusal", "fullscreen-focus-retained")
}

function Wait-FloatOutcome([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [int]$TimeoutSec, [string]$Tag) {
  # Consumed float-toggle dispatch only: key-up/passed edges never satisfy.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesLocal $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -ne "float-toggle") { continue }
      if ("$($e.disposition)" -ne "consumed") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      return @{ event = $e; count = $lines.Count }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fl "$Tag no float-toggle outcome=($($Outcomes -join '|')) after mark $Mark"
  return $null
}

function Get-TopmostFl([long]$Hwnd) {
  [ActiveBorderNative]::EnsurePMv2()
  $ex = [ActiveBorderNative]::GetWindowLongW([IntPtr]$Hwnd, $GWL_EXSTYLE)
  return (([int]$ex -band $WS_EX_TOPMOST) -ne 0)
}

function Get-ExpectedCentered60([string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  $wa = [ActiveBorderNative]::WorkArea()
  if ($null -eq $wa) { Fail-Fl "$Tag work area unreadable" }
  $l = [int]$wa[0]; $t = [int]$wa[1]; $r = [int]$wa[2]; $b = [int]$wa[3]
  $w = $r - $l; $h = $b - $t
  $ew = [int][math]::Floor($w * 0.6); $eh = [int][math]::Floor($h * 0.6)
  $ex = $l + [int][math]::Floor(($w - $ew) / 2); $ey = $t + [int][math]::Floor(($h - $eh) / 2)
  return @{ area = "$l,$t,$r,$b"; expected = @($ex, $ey, ($ex + $ew), ($ey + $eh)) }
}

function Assert-FrameApprox([int[]]$Frame, [int[]]$Want, [int]$Tol, [string]$Tag) {
  for ($k = 0; $k -lt 4; $k++) {
    if ([math]::Abs([int]$Frame[$k] - [int]$Want[$k]) -gt $Tol) {
      Fail-Fl "$Tag frame $($Frame -join ',') != want $($Want -join ',') tol=$Tol"
    }
  }
}

function Assert-NoWriteForFloat([string]$LogPath, [int]$Mark, [string]$Token, [string]$Tag) {
  $lines = Get-CompleteLinesLocal $LogPath
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $e = $lines[$i] | ConvertFrom-Json
    if ("$($e.event)" -ne "write") { continue }
    if ("$($lines[$i])" -match [regex]::Escape($Token)) { Fail-Fl "$Tag geometry write references float token" }
  }
}

function Get-HelperRectKeyFl([string]$HelperBin, $Snap, [string]$Tag) {
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-ident"
  return "$($fresh.left),$($fresh.top),$($fresh.right),$($fresh.bottom)"
}

function Assert-ExactForegroundFl([uint64]$Want, [string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  $fg = [uint64]([ActiveBorderNative]::GetForegroundWindow().ToInt64())
  if ($fg -ne $Want) { Fail-Fl "$Tag foreground $fg != expected $Want" }
  Rec-Fl "$Tag-foreground" @{ foreground = $fg; expected = $Want }
}

function Hold-WinShiftFl([string]$Tag) {
  $m = [uint64]$FL_MARKER
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LWIN, $false, $m) -ne 1) { Fail-Fl "$Tag Win down not inserted" }
  if ([ShortcutProofNative]::SendKey([uint16]$VK_LSHIFT, $false, $m) -ne 1) { Fail-Fl "$Tag Shift down not inserted" }
  Start-Sleep -Milliseconds 600
}

function Release-WinShiftFl([string]$Tag) {
  $m = [uint64]$FL_MARKER
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_LSHIFT, $true, $m) } catch {}
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_LWIN, $true, $m) } catch {}
  Start-Sleep -Milliseconds 400
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_ESC, $false, $m) } catch {}
  Start-Sleep -Milliseconds 150
  try { $null = [ShortcutProofNative]::SendKey([uint16]$VK_ESC, $true, $m) } catch {}
  Start-Sleep -Milliseconds 800
}

function Get-UnderlayVisibleFl([string]$Payload) {
  $insp = Invoke-Native $Payload @("underlay-inspect") | ConvertFrom-Json
  if (-not $insp.present) { return 0 }
  return @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
}

function Wait-UnderlayShownFl([string]$Payload, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-UnderlayVisibleFl $Payload) -ne 0) { return }
    Start-Sleep -Milliseconds 100
  }
  Fail-Fl "$Tag underlay not visible while Win+Shift held"
}

function Invoke-FloatMock {
  Rec-Fl "scope" @{ helpers = "owned-only-first"; ordinary = "scoped-normal-smoke"; never = @("terminal"); kills = "exact-owner-only"; registry = "none"; screenshots = "none"; content = "none" }
  $help = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-windows -- help 2>$null
  if ("$help" -notmatch "shortcut-proof") { Fail-Fl "mock CLI help missing shortcut-proof" }
  if ("$help" -notmatch "workspace-proof") { Fail-Fl "mock CLI help missing workspace-proof" }
  if ("$help" -notmatch "tile-proof") { Fail-Fl "mock CLI help missing tile-proof" }
  if ("$help" -notmatch "border-inspect") { Fail-Fl "mock CLI help missing border-inspect" }
  if ("$help" -notmatch "underlay-inspect") { Fail-Fl "mock CLI help missing underlay-inspect" }
  $hhelp = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-test-window -- help 2>$null
  if ("$hhelp" -notmatch "move HWND --tag TAG --to") { Fail-Fl "mock helper help missing exact-bound move" }
  Rec-Fl "cli-surface" @{ shortcut_proof = $true; workspace_proof = $true; tile_proof = $true }
  $rows = Get-ShortcutJourney
  Assert-NoWinLJourney $rows
  Rec-Fl "journey-guard" @{ rows = @($rows | ForEach-Object { $_.name }) }
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  # Win+G plain chord: Win down, G down, G up, Win up = 4 events.
  Assert-ChordSendCounts 4 $false 0 "mock-plain-g"
  Assert-ChordSendCounts 6 $true 0 "mock-shift-arrow"
  Assert-EncodingInvariant $VK_G $false 0 "mock-g-plain"
  foreach ($vk in @(37, 38, 39, 40)) {
    $scan = [int][ShortcutProofNative]::MapVirtualKey([uint32]$vk, 0)
    Assert-EncodingInvariant ([int]$vk) $true ([int]$scan) "mock-arrow-$vk"
  }
  try { Assert-EncodingInvariant $VK_G $true 0 "mock-negative"; Fail-Fl "negative G-extended did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "EXTENDEDKEY") { throw } }
  Rec-Fl "encoding" @{ g_plain = $true; arrows_extended = $true; input_size = $size }
  Test-FloatStatusClassifier "mock-status"
  $src = Get-Content -LiteralPath (Join-Path $Repo "scripts\windows-float.ps1") -Raw
  foreach ($need in @("Wait-FloatOutcome", "Wait-SuspendFl", "Get-TopmostFl", "Get-ExpectedCentered60", "Assert-NoWriteForFloat",
      "Set-OwnedForegroundAb", "Set-ApprovedForegroundFl", "Get-PrimeTargetFl", "Close-PrimeExtraFl",
      "Send-MarkedChord", "Get-FloatReportStatus", "Get-RequiredUnimplementedRows",
      "Stop-ExactOwner", "Test-NoProjectActors", "Get-OriginalAppsSnapshot",
      "0x0082", "0x201E", "SHORTCUT_MARKER", "border-inspect", "underlay-inspect",
      "emergency-stop", "Get-OverlayHwndsForOwnerAb", "float-toggle", "WS_EX_TOPMOST")) {
    if ($src -notmatch [regex]::Escape($need)) { Fail-Fl "mock harness missing $need" }
  }
  if ($src -match ('Show' + 'Window')) { Fail-Fl "mock direct no-owner hiding present" }
  $floorPat = '[math]::Fl' + 'oor($w * 0.6)'
  $roundPat = '[math]::Ro' + 'und($w * 0.6)'
  if (-not $src.Contains($floorPat)) { Fail-Fl "mock centered60 not Floor" }
  if ($src.Contains($roundPat)) { Fail-Fl "mock centered60 still Round" }
  $harnessHash = (Get-FileHash -LiteralPath (Join-Path $Repo "scripts\windows-float.ps1") -Algorithm SHA256).Hash
  Rec-Fl "harness-hash" @{ sha256 = $harnessHash }
  $regPat = 'Set-Item' + 'Property|New-Item' + 'Property'
  if ($src -match $regPat) { Fail-Fl "mock registry/policy write present" }
  if ($src -match ('Get' + 'Pixel')) { Fail-Fl "mock screen-content capture present (geometry/state gates only)" }
  Rec-Fl "harness-seams" @{ zoom_gates = $false; float_gates = $true; marks_before_actions = $true }
  $tsrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\tiling_sys.rs") -Raw
  foreach ($need in @("dispatch_float_intent", "float-toggle", "float_topmost_prev", "float_rects",
      "float-focus-retained", "proof-topmost",
      "float-topmost-restore", "send-refused-floating", "focus-refused-floating", "move-refused-floating") ) {
    if ($tsrc -notmatch [regex]::Escape($need)) { Fail-Fl "mock product missing $need" }
  }
  $tlsrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\tiling.rs") -Raw
  foreach ($need in @("float-refused-fullscreen", "float-refused-maximize", "float_toggle_refusal", "float_topmost_restore_needed") ) {
    if ($tlsrc -notmatch [regex]::Escape($need)) { Fail-Fl "mock product missing $need" }
  }
  $ksrc = Get-Content -LiteralPath (Join-Path $Repo "crates\tiler-windows\src\snapkey.rs") -Raw
  if ($ksrc -notmatch "is_float_vk") { Fail-Fl "mock classifier missing is_float_vk" }
  if ($ksrc -notmatch "Float") { Fail-Fl "mock classifier missing Float arm" }
  if ($ksrc -notmatch "0x47") { Fail-Fl "mock classifier missing VK_G 0x47" }
  Rec-Fl "product-seams" @{ discrete_toggle = $true; preimage = $true; classifier = $true }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test tiling 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Fl "mock cargo test tiling failed" }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test snapkey 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Fl "mock cargo test snapkey failed" }
  Rec-Fl "portable-tests" @{ suites = @("tiling", "snapkey"); result = "pass" }
  $report = @{ status = "pass"; stage = "FloatMock"; steps = $FL_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Set-ApprovedForegroundFl([long]$Hwnd, [string]$Tag) {
  # Fixture-only prime: move foreground off a cloaked/foreign fullscreen
  # window onto one exact approved app (Notepad/Paint) so a proof owner does
  # not suspend on fullscreen-foreground at start. E8 prime + attach + one
  # setter + immediate detach + exact readback. No geometry mutation, no
  # typing, no hide. Failure is recorded by the caller, never retried.
  [ActiveBorderNative]::EnsurePMv2()
  $fgEntry = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Hwnd) { return "already-foreground" }
  $primeInserted = [ActiveBorderNative]::PrimeE8()
  if ([int]$primeInserted -ne 2) { Fail-Fl "$Tag E8 prime accepted $primeInserted != 2" }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Fl "$Tag foreground TID unreadable" }
  $myTid = [ActiveBorderNative]::GetCurrentThreadId()
  $attachOk = $false
  if ([uint32]$fgTid -ne [uint32]$myTid) {
    $attachOk = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
  }
  try {
    $null = [ActiveBorderNative]::SetForegroundWindow([IntPtr][long]$Hwnd)
  } finally {
    if ($attachOk) { $null = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) }
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne [uint64]$Hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  }
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Fl "$Tag foreground readback $fg != $Hwnd attach=$attachOk" }
  return "primed attach=$attachOk"
}

function Get-PrimeTargetFl([string]$Payload, [string]$Tag) {
  # Read-only inventory pick: exact Notepad first, else Paint. Returns $null
  # when no approved prime candidate exists (caller records unavailable).
  $inv = Invoke-Native $Payload @("inventory") | ConvertFrom-Json
  foreach ($want in @("notepad.exe", "mspaint.exe")) {
    $hit = @($inv.windows | Where-Object { "$($_.exe)".ToLowerInvariant() -eq $want }) | Select-Object -First 1
    if ($null -ne $hit) { return $hit }
  }
  return $null
}

function New-FloatRunDir {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $rd = Join-Path $Repo "target\windows-float\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $rd | Out-Null
  $binDir = Join-Path $rd "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  return @{ runDir = $rd; binDir = $binDir }
}

function Start-FloatHelperSet([string]$HelperCopy, [string]$ProofDir, [int]$Count, [int]$OwnerSeconds) {
  $snaps = @()
  $created = [System.Collections.ArrayList]@()
  foreach ($n in 1..$Count) {
    $receipt = Join-Path $ProofDir "helper$n.json"
    if (Test-Path $receipt) { Fail-Fl "receipt preexists $receipt" }
    Start-ExplorerGui $HelperCopy "run --receipt `"$receipt`" --seconds 600 --passive" $ProofDir
    $deadline = (Get-Date).AddSeconds(10)
    while (-not (Test-Path $receipt)) {
      if ((Get-Date) -gt $deadline) { Fail-Fl "helper receipt timeout $n" }
      Start-Sleep -Milliseconds 200
    }
    $snap = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    if ("$($snap.process.exe_path)" -ine "$HelperCopy") { Fail-Fl "helper$n peer mismatch" }
    Assert-ParentIsExplorer ([int]$snap.process.pid)
    if ([string]$snap.tag -eq "") { Fail-Fl "helper$n missing tag" }
    if ($snap.visible -ne $false) { Fail-Fl "helper$n passive helper visible at create" }
    $null = $created.Add(@{ hwnd = [uint64]$snap.hwnd; tag = "$($snap.tag)"; pid = [int]$snap.process.pid; creation = "$($snap.process.process_creation)";
      exe_path = "$($snap.process.exe_path)"; user_sid = "$($snap.process.user_sid)"; session_id = [uint32]$snap.process.session_id })
    $shown = Invoke-Native $HelperCopy @("show", "$($snap.hwnd)", "--tag", "$($snap.tag)") | ConvertFrom-Json
    if ([uint64]$shown.foreground -eq [uint64]$snap.hwnd) { Fail-Fl "helper$n admission focused helper" }
    $fresh = Invoke-Native $HelperCopy @("inspect", "$($snap.hwnd)") | ConvertFrom-Json
    Assert-FullIdentityMatches $fresh $snap "helper$n-postshow"
    if ($fresh.visible -ne $true) { Fail-Fl "helper$n not visible after show" }
    $snaps += $fresh
  }
  return @{ snaps = $snaps; created = $created }
}

function Wait-SuspendFl([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if ("$($e.event)" -eq "suspend") { return @{ event = $e; count = $tail.count } }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Fl "$Tag no suspend after mark $Mark"
  return $null
}

function Close-PrimeExtraFl($Ctx, [string]$Tag) {
  if ($null -eq $Ctx.primeExtra) { return }
  [ActiveBorderNative]::EnsurePMv2()
  $hwnd = [long]$Ctx.primeExtra.hwnd
  $pidOut = [uint32]0
  $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr]$hwnd, [ref]$pidOut)
  if ([int]$pidOut -ne [int]$Ctx.primeExtra.pid) { Fail-Fl "$Tag prime-extra pid fence mismatch (live $([int]$pidOut) != bound $([int]$Ctx.primeExtra.pid)); refusing broad close" }
  $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
  $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
  if ($hex -cne "$($Ctx.primeExtra.creation)") { Fail-Fl "$Tag prime-extra creation fence mismatch; refusing broad close" }
  $ok = [ActiveBorderNative]::PostMessageW([IntPtr]$hwnd, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)
  if (-not $ok) { Fail-Fl "$Tag prime-extra WM_CLOSE post refused" }
  $deadline = (Get-Date).AddSeconds(10)
  while ([ActiveBorderNative]::IsWindow([IntPtr]$hwnd)) {
    if ((Get-Date) -gt $deadline) {
      Rec-Fl "$Tag-prime-extra-unclosed" @{ hwnd = $hwnd; pid = [int]$pidOut; uncertainty = "HWND still valid after exact WM_CLOSE; left for user; no broad close" }
      Fail-Fl "$Tag prime-extra HWND still valid after WM_CLOSE"
    }
    Start-Sleep -Milliseconds 250
  }
  Rec-Fl "$Tag-prime-extra-closed" @{ hwnd = $hwnd }
  $Ctx.primeExtra = $null
}

function Stop-FloatOwnerExact($Ctx, [string]$Tag) {
  if (-not $Ctx.ownerRunning -or ($null -eq $Ctx.ownerFrozen)) { return "no-owner" }
  $pp = $Ctx.ownerPayload
  if ($pp -eq "") { $pp = $Ctx.ownerCopy }
  try {
    $r = Stop-ExactOwner $pp $false $Tag $Ctx.ownerFrozen
    $Ctx.ownerRunning = $false
    Rec-Fl "$Tag-owner-stop" @{ graceful = $true }
    return $r
  } catch {
    $first = "$($_.Exception.Message)"
    $e = Invoke-Native $pp @("emergency-stop") | ConvertFrom-Json
    if (-not $e.owner_exited) { Fail-Fl "$Tag emergency-stop no exit after graceful failure ($first)" }
    if (Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)") { Fail-Fl "$Tag owner alive after emergency-stop" }
    $r = Invoke-Native $pp @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Fl "$Tag restore failed after emergency-stop" }
    Assert-LedgerClean $pp
    $Ctx.ownerRunning = $false
    Rec-Fl "$Tag-owner-stop" @{ graceful = $false; first_error = $first }
    return @{ stop = $e; restore = $r }
  }
}

function Close-FloatHelpersExact([string]$HelperCopy, $Created, [string]$Tag) {
  foreach ($h in @($Created)) {
    if ($null -eq $h) { continue }
    if (-not (Test-ProcessAliveSameCreation ([int]$h.pid) "$($h.creation)")) {
      Rec-Fl "$Tag-helper-already-closed" @{ hwnd = $h.hwnd }
      continue
    }
    $fresh = Assert-HelperIdentityAb $HelperCopy @{ hwnd = $h.hwnd; tag = "$($h.tag)"; process = @{ pid = [int]$h.pid; process_creation = "$($h.creation)"; user_sid = "$($h.user_sid)"; session_id = [uint32]$h.session_id } } "$Tag-ident"
    $null = Invoke-Native $HelperCopy @("close", "$($fresh.hwnd)", "--tag", "$($fresh.tag)") | ConvertFrom-Json
    Rec-Fl "$Tag-helper-close" @{ hwnd = $h.hwnd }
  }
  $exitDeadline = (Get-Date).AddSeconds(10)
  foreach ($h in @($Created)) {
    if ($null -eq $h) { continue }
    while (Test-ProcessAliveSameCreation ([int]$h.pid) "$($h.creation)") {
      if ((Get-Date) -gt $exitDeadline) { Fail-Fl "$Tag helper exit timeout pid=$([int]$h.pid)" }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Invoke-OwnedFloatLive($Ctx) {
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $hs = Start-FloatHelperSet $helperCopy $proofDir 3 $ownerSeconds
  $snaps = @($hs.snaps); $Ctx.created = $hs.created; $Ctx.helperCopy = $helperCopy
  Rec-Fl "helpers-created" @($snaps | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; visible = $_.visible } })
  $allowPath = Join-Path $proofDir "float-allowlist.json"
  $entries = @()
  foreach ($s in $snaps) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "float"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $Ctx.allOwnerPids = @(@($Ctx.allOwnerPids) + @([int]$ready.owner.pid) | Sort-Object -Unique)
  $logPath = "$($ready.log_path)"
  Rec-Fl "owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  if (-not $Ctx.primed) {
    # Activation-blocker partial: no foreground is acquirable, so the owner
    # suspends and no chord can dispatch. Achievable evidence only: helpers
    # admitted, owner suspend cause observed, exact stop leaves frames,
    # independent restore clean. All activation rows stay explicitly
    # unaccepted (no spin, no retry of the same semantic failure).
    $markS = 0
    $susp = Wait-SuspendFl $logPath $markS 25 "suspend-partial"
    Rec-Fl "suspend-observed" @{ cause = "$($susp.event.cause)" }
    $preFrames = @($snaps | ForEach-Object { "$($_.left),$($_.top),$($_.right),$($_.bottom)" })
    $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Fl "suspend-partial stop no exit" }
    if (Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)") { Fail-Fl "suspend-partial owner alive" }
    $postFrames = @($snaps | ForEach-Object { Get-HelperRectKeyFl $helperCopy $_ "suspend-partial-left" })
    if (($preFrames -join "|") -cne ($postFrames -join "|")) { Fail-Fl "suspend-partial stop moved frames" }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Fl "suspend-partial restore failed" }
    Assert-LedgerClean $ownerCopy
    $Ctx.ownerRunning = $false
    Rec-Fl "suspend-partial" @{ stop = $st; restore = $r; frames = $postFrames }
    Rec-Fl "rows-unaccepted" @{ reason = "activation-blocker: cloaked Explorer ApplicationFrameWindow holds foreground; AttachThreadInput=false; new-extra prime did not take foreground"; rows = @(
      "initial-centered60", "sibling-reflow", "exact-toggled-focus", "held-G-repeat-exclusion",
      "unfloat-admission-topology", "moved-float-retention", "no-reassert", "topmost-request",
      "unfloat-band-restore", "border-on-float", "underlay-hidden-on-float", "tiled-group-reshow",
      "direction-focus-refusal", "direction-move-refusal", "tiled-focus-never-float",
      "send-focused-float-refusal", "tiled-send-preserves-float", "workspace-hide-reveal-float",
      "close-float-cleanup", "native-max-float-refusal", "stop-frames", "restart-clears-adopts") }
    return
  }
  $h1 = $snaps[0]; $h2 = $snaps[1]; $h3 = $snaps[2]
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark0 25 "adopt"
  Rec-Fl "adopted" @{ tick = $conv.tick }

  $ordered = @($conv.inspect.windows | Sort-Object { [int]$_.visible[0] })
  $midHwnd = [uint64]$ordered[1].hwnd
  $midSnap = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq $midHwnd } | Select-Object -First 1
  $sibA = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -ne $midHwnd }
  $preMidRect = Get-HelperRectKeyFl $helperCopy $midSnap "legA-pre"
  $preSibs = @($sibA | ForEach-Object { Get-HelperRectKeyFl $helperCopy $_ "legA-pre-sib" })
  $preTopmost = Get-TopmostFl ([long]$midHwnd)
  Rec-Fl "legA-pre" @{ rect = $preMidRect; topmost = $preTopmost }

  # Leg A: Win+G floats the middle helper. Centered-60% frame, sibling reflow
  # excluding the float, exact toggled focus, topmost request readback.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legA-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  if ([int]$sent.accepted -ne 4) { Fail-Fl "legA Win+G send accepted $([int]$sent.accepted) != 4" }
  $ev = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legA-float"
  $outcome = "$($ev.event.outcome)"
  Rec-Fl "legA-toggle-float" @{ outcome = $outcome; target = "$($ev.event.target)"; focus = "$($ev.event.focus)"; accepted = [int]$sent.accepted }
  if ($outcome -notin @("floated", "float-applied", "dispatched")) { Fail-Fl "legA float outcome $outcome not accepted (want floated/float-applied/dispatched)" }
  Start-Sleep -Milliseconds 1500
  $frame = [ActiveBorderNative]::FrameOf([long]$midHwnd)
  if ($null -eq $frame) { Fail-Fl "legA DWM frame unreadable" }
  $exp = Get-ExpectedCentered60 "legA-exp"
  Assert-FrameApprox $frame $exp.expected 2 "legA-centered60"
  $duringSibs = @($sibA | ForEach-Object { Get-HelperRectKeyFl $helperCopy $_ "legA-float-sib" })
  if (($duringSibs -join "|") -ceq ($preSibs -join "|")) { Fail-Fl "legA siblings did not reflow (float must leave tile plans)" }
  $inspF = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $rowF = @($inspF.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd }) | Select-Object -First 1
  if ($null -eq $rowF) { Fail-Fl "legA float member missing from inspect" }
  if ($rowF.eligible -ne $false) { Fail-Fl "legA float member still eligible (floats hold no tile slot)" }
  Assert-ExactForegroundFl $midHwnd "legA"
  $postTopmost = Get-TopmostFl ([long]$midHwnd)
  if (-not $postTopmost) { Fail-Fl "legA WS_EX_TOPMOST request not visible on float" }
  Rec-Fl "legA-float-state" @{ frame = ($frame -join ","); want = ($exp.expected -join ","); area = $exp.area;
    siblings_reflowed = $true; eligible = $false; topmost = $postTopmost; prior_topmost = $preTopmost }
  $bF = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
  $bVis = @(@($bF.overlays) | Where-Object { $_.visible -eq $true }).Count
  if ([int]$bVis -ne 1) { Fail-Fl "legA border not visible on focused float (visible=$bVis)" }
  Rec-Fl "legA-border" @{ visible = $bVis }

  # Leg B: held G repeats consume no toggles (down + 2 repeats = one toggle).
  # Float is currently ON; unfloat once to return to tiled, then hold.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legB-unfloat-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legB-unfloat"
  Start-Sleep -Milliseconds 1500
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legB-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 2 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 2 "legB-send"
  $ev = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legB-float"
  Start-Sleep -Milliseconds 2500
  $after = Get-LogEventsAfter $logPath $mark
  $toggles = @($after.events | Where-Object { ($_.event -eq "float-toggle") -and ("$($_.disposition)" -eq "consumed") -and (@("floated", "unfloated", "float-applied", "unfloat-applied", "float-mismatch", "unfloat-mismatch", "dispatched") -contains "$($_.outcome)") })
  if (@($toggles).Count -ne 1) { Fail-Fl "legB repeat churn: $(@($toggles).Count) toggles != 1" }
  Rec-Fl "legB-repeat-hold" @{ toggles = @($toggles).Count; accepted = [int]$sent.accepted }
  # Back to tiled for the retention leg.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legB-norm"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legB-norm"
  Start-Sleep -Milliseconds 1500

  # Leg C: moved/resized live float retained next float; no reassert on
  # native float movement (no geometry write references the float token).
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legC-float"
  Start-Sleep -Milliseconds 1500
  $moveTo = "1400,400,520,360"
  $preMove = Assert-HelperIdentityAb $helperCopy $midSnap "legC-premove"
  $null = Invoke-Native $helperCopy @("move", "$($preMove.hwnd)", "--tag", "$($preMove.tag)", "--to", $moveTo) | ConvertFrom-Json
  $movedKey = Get-HelperRectKeyFl $helperCopy $midSnap "legC-moved"
  if ($movedKey -cne $moveTo) { Fail-Fl "legC float move readback [$movedKey] != [$moveTo]" }
  $markMove = Get-MarkBeforeActionAb $logPath
  Start-Sleep -Milliseconds 3000
  $floatTok = ""
  try { $floatTok = "$($ev.event.window)" } catch {}
  if ($floatTok -ne "") { Assert-NoWriteForFloat $logPath $markMove $floatTok "legC-noreassert" }
  Rec-Fl "legC-moved" @{ rect = $movedKey; noreassert = $true }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-unfloat-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $evU = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legC-unfloat"
  $restoredFlag = "$($evU.event.topmost_restored)"
  Rec-Fl "legC-unfloat" @{ outcome = "$($evU.event.outcome)"; topmost_restored = $restoredFlag }
  Start-Sleep -Milliseconds 1500
  # Fresh admission topology: unfloat adopts like a new window (converges).
  $tailConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark 20 "legC-plan"
  Rec-Fl "legC-readmitted" @{ tick = $tailConv.tick }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legC-refloat-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legC-refloat"
  Start-Sleep -Milliseconds 1500
  $refloatKey = Get-HelperRectKeyFl $helperCopy $midSnap "legC-refloat"
  if ($refloatKey -cne $movedKey) { Fail-Fl "legC refloat rect [$refloatKey] != retained moved [$movedKey]" }
  Rec-Fl "legC-retained" @{ rect = $refloatKey; moved = $movedKey }

  # Leg D: underlay genuinely hidden on float with Win+Shift held; tiled
  # group baseline shows it again after unfloat.
  Hold-WinShiftFl "legD-suppressed"
  try {
    Start-Sleep -Milliseconds 1500
    $hideMid = Get-UnderlayVisibleFl $ownerCopy
    Rec-Fl "legD-suppressed" @{ visible = $hideMid; held = $true; floated = $true }
    if ([int]$hideMid -ne 0) { Fail-Fl "legD underlay visible on float with Win+Shift held" }
  } finally { Release-WinShiftFl "legD-suppressed" }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legD-unfloat-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legD-unfloat"
  Start-Sleep -Milliseconds 1500
  $bandBack = Get-TopmostFl ([long]$midHwnd)
  if ($bandBack -ne $preTopmost) { Fail-Fl "legD unfloat band $bandBack != prior $preTopmost (project-raised only)" }
  Rec-Fl "legD-unfloated" @{ topmost = $bandBack; prior = $preTopmost }
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legD-reshow-focus"
  Hold-WinShiftFl "legD-reshow"
  try {
    Wait-UnderlayShownFl $ownerCopy 12 "legD-reshow"
    $showPost = Get-UnderlayVisibleFl $ownerCopy
    Rec-Fl "legD-reshow" @{ visible = $showPost; held = $true }
    if ([int]$showPost -eq 0) { Fail-Fl "legD underlay did not return on tiled group with Win+Shift held" }
  } finally { Release-WinShiftFl "legD-reshow" }
  $null = Set-OwnedForegroundAb $helperCopy $midSnap "legD-end-focus"

  # Leg E: direction focus/move from float refuse with no retarget; tiled
  # focus never targets the float.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legE-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legE-float"
  Start-Sleep -Milliseconds 1000
  $preE = Get-InspectFrames $ownerCopy $allowPath
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_H $false $false $midHwnd 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legE-focus-send"
  $evF = Wait-SnapAfter $logPath $mark "focus" "left" 20 "legE-focus-out"
  if ("$($evF.outcome)" -ne "focus-refused-floating") { Fail-Fl "legE focus outcome $($evF.outcome) != focus-refused-floating" }
  Assert-ExactForegroundFl $midHwnd "legE-focus-refused"
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_H $true $false $midHwnd 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $true 0 "legE-move-send"
  $evM = Wait-SnapAfter $logPath $mark "move" "left" 20 "legE-move"
  if ("$($evM.outcome)" -ne "move-refused-floating") { Fail-Fl "legE move outcome $($evM.outcome) != move-refused-floating" }
  $postE = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preE.frames $postE.frames "legE-topology"
  Rec-Fl "legE-refused" @{ focus = "$($evF.outcome)"; move = "$($evM.outcome)"; topology = "unchanged" }
  # Tiled focus from a sibling never lands on the float: focus sibling, arrow
  # toward the float side and prove foreground is a tiled sibling, not float.
  $sib0 = @($sibA)[0]
  $null = Set-OwnedForegroundAb $helperCopy $sib0 "legE-sib-focus"
  $sibFg = [uint64]$sib0.hwnd
  $mark = Get-MarkBeforeActionAb $logPath
  $sent = Send-MarkedChord $VK_L $false $false $sibFg 0 $false
  Assert-ChordSendCounts ([int]$sent.accepted) $false 0 "legE-tiled-send"
  $evT = Wait-SnapAfter $logPath $mark "focus" "right" 20 "legE-tiled"
  if ("$($evT.outcome)" -ne "focus-ok") { Fail-Fl "legE tiled focus outcome $($evT.outcome) != focus-ok" }
  $fgT = [uint64]([ActiveBorderNative]::GetForegroundWindow().ToInt64())
  if ($fgT -eq $midHwnd) { Fail-Fl "legE tiled focus landed on the float" }
  Rec-Fl "legE-tiled-focus" @{ outcome = "$($evT.outcome)"; foreground = $fgT; float = $midHwnd }

  # Leg F: native max/fullscreen float refusal, then recovery.
  $null = Set-OwnedForegroundAb $helperCopy $midSnap "legF-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false $midHwnd 0 $false
  # mid may already be floated from leg E; normalize: if toggle unfloated, refloat.
  try { $evTmp = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied") 8 "legF-norm" } catch { $evTmp = $null }
  if ($null -ne $evTmp) {
    Start-Sleep -Milliseconds 1000
    $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legF-refloat"
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
    $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legF-float"
    Start-Sleep -Milliseconds 1000
  }
  $freshMid = Assert-HelperIdentityAb $helperCopy $midSnap "legF-pre-native"
  $null = Invoke-OwnedSysCommandAb $helperCopy $freshMid $SC_MAXIMIZE "legF-sysmax"
  Start-Sleep -Milliseconds 1000
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legF-attempt-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $evR = Wait-FloatOutcome $logPath $mark @("float-refused-maximize", "float-refused-fullscreen") 20 "legF-refused"
  Assert-ExactForegroundFl ([uint64]$midHwnd) "legF-refused"
  Rec-Fl "legF-native-refused" @{ outcome = "$($evR.event.outcome)" }
  $freshMid = Assert-HelperIdentityAb $helperCopy $midSnap "legF-restore-pre"
  $null = Invoke-OwnedSysCommandAb $helperCopy $freshMid $SC_RESTORE "legF-native-restore"
  Start-Sleep -Milliseconds 1000
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legF-unfloat-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legF-unfloat"
  Start-Sleep -Milliseconds 1000
  Rec-Fl "legF-recovered" @{ restored = $true }

  # Leg G: close float cleans membership and normal reflow.
  $freshMid = Set-OwnedForegroundAb $helperCopy $midSnap "legG-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshMid.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legG-float"
  Start-Sleep -Milliseconds 1000
  $closed = Invoke-Native $helperCopy @("close", "$($midSnap.hwnd)", "--tag", "$($midSnap.tag)") | ConvertFrom-Json
  Rec-Fl "legG-close" $closed
  Start-Sleep -Milliseconds 2000
  $postClose = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $gone = @($postClose.windows | Where-Object { [uint64]$_.hwnd -eq $midHwnd })
  if (@($gone).Count -ne 0) { Fail-Fl "legG closed float still member" }
  Rec-Fl "legG-cleaned" @{ members = @($postClose.windows | ForEach-Object { $_.hwnd }) }
  $Ctx.midClosed = $true

  # Leg H: graceful stop leaves frames; restart clears float state, fresh adopts.
  $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
  if (-not $st.owner_exited) { Fail-Fl "legH stop no exit" }
  $alive = Test-ProcessAliveSameCreation ([int]$Ctx.ownerFrozen.pid) "$($Ctx.ownerFrozen.process_creation)"
  if ($alive) { Fail-Fl "legH owner alive after stop" }
  $leftA = Get-HelperRectKeyFl $helperCopy $h1 "legH-leftA"
  $leftC = Get-HelperRectKeyFl $helperCopy $h3 "legH-leftC"
  Rec-Fl "legH-stop-frames" @{ a = $leftA; c = $leftC }
  $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail-Fl "legH restore failed" }
  Assert-LedgerClean $ownerCopy
  # Fresh owner over survivors: float state cleared, fresh float adopts.
  $allowPath2 = Join-Path $proofDir "float-allowlist-2.json"
  $entries2 = @()
  foreach ($s in @($h1, $h3)) {
    $entries2 += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries2 } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath2
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath2`" --seconds $ownerSeconds --trace" $binDir
  $ready2 = Assert-OwnerReady $ownerCopy "float-restart"
  $Ctx.ownerFrozen = $ready2.owner
  $Ctx.allOwnerPids = @(@($Ctx.allOwnerPids) + @([int]$ready2.owner.pid) | Sort-Object -Unique)
  $logPath2 = "$($ready2.log_path)"
  Rec-Fl "legH-restart" @{ pid = $ready2.owner.pid; log = $logPath2 }
  Start-Sleep -Milliseconds 1500
  $mark = (Get-CompleteLinesLocal $logPath2).Count
  $conv2 = Wait-ConvergedFrames $ownerCopy $allowPath2 @($h1.hwnd, $h3.hwnd) $logPath2 $mark 25 "legH-adopt"
  Rec-Fl "legH-adopted" @{ tick = $conv2.tick }
  $freshA = Set-OwnedForegroundAb $helperCopy $h1 "legH-fresh-float"
  $mark = Get-MarkBeforeActionAb $logPath2
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshA.hwnd) 0 $false
  $evN = Wait-FloatOutcome $logPath2 $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "legH-fresh"
  Rec-Fl "legH-fresh-float" @{ outcome = "$($evN.event.outcome)" }
  $freshA = Set-OwnedForegroundAb $helperCopy $h1 "legH-fresh-unfloat"
  $mark = Get-MarkBeforeActionAb $logPath2
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshA.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath2 $mark @("unfloated", "unfloat-applied", "dispatched") 20 "legH-fresh-unfloat"
  Rec-Fl "legH-fresh-unfloat" @{ ok = $true }
  $Ctx.ownerLog = $logPath2; $Ctx.allowPath = $allowPath2
}

function Invoke-WorkspaceFloatLive($Ctx) {
  if (-not $Ctx.primed) {
    Rec-Fl "ws-rows-unaccepted" @{ reason = "activation-blocker (see rows-unaccepted)"; rows = @(
      "send-focused-float-refusal", "tiled-send-preserves-float", "workspace-hide-reveal-float") }
    return
  }
  $ownerCopy = $Ctx.ownerCopy; $helperCopy = $Ctx.helperCopy; $proofDir = $Ctx.proofDir; $ownerSeconds = $Ctx.ownerSeconds
  $hs = Start-FloatHelperSet $helperCopy $proofDir 3 $ownerSeconds
  $snaps = @($hs.snaps); $Ctx.created = $hs.created
  $allowPath = Join-Path $proofDir "float-ws-allowlist.json"
  $entries = @()
  foreach ($s in $snaps) {
    $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)";
      exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "workspace-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "float-ws"
  $Ctx.ownerFrozen = $ready.owner; $Ctx.ownerRunning = $true; $Ctx.ownerPayload = $ownerCopy
  $Ctx.allOwnerPids = @(@($Ctx.allOwnerPids) + @([int]$ready.owner.pid) | Sort-Object -Unique)
  $logPath = "$($ready.log_path)"
  Rec-Fl "ws-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  Start-Sleep -Milliseconds 1500
  $hA = $snaps[0]; $hB = $snaps[1]
  $mark0 = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($snaps[0].hwnd, $snaps[1].hwnd, $snaps[2].hwnd) $logPath $mark0 25 "ws-adopt"
  Rec-Fl "ws-adopted" @{ tick = $conv.tick }
  # Float A first (marked Win+G is accepted by workspace-proof too).
  $freshA = Set-OwnedForegroundAb $helperCopy $hA "ws-float-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord $VK_G $false $false ([uint64]$freshA.hwnd) 0 $false
  $null = Wait-FloatOutcome $logPath $mark @("floated", "float-applied", "float-mismatch", "dispatched") 20 "ws-float"
  Start-Sleep -Milliseconds 1500
  $floatFrame = Get-HelperRectKeyFl $helperCopy $hA "ws-float-frame"
  Rec-Fl "ws-floated" @{ rect = $floatFrame }
  # Send focused float refuses; normal tiled send preserves the float survivor.
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$hA.hwnd) 0 $false
  $deadline = (Get-Date).AddSeconds(20)
  $refused = $null
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $logPath $mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq "send") -and ([int]$e.index -eq 2) -and ("$($e.outcome)" -ne "key-up")) {
        $refused = $e; break
      }
    }
    if ($null -ne $refused) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($null -eq $refused) { Fail-Fl "ws-send-float no workspace dispatch send/2" }
  if ("$($refused.outcome)" -ne "send-refused-floating") { Fail-Fl "ws send focused float outcome $($refused.outcome) != send-refused-floating" }
  $memAfterRefuse = Invoke-Native $ownerCopy @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
  $refRow = @($memAfterRefuse.windows | Where-Object { [uint64]$_.hwnd -eq [uint64]$hA.hwnd }) | Select-Object -First 1
  if ($null -eq $refRow) { Fail-Fl "ws send refusal dropped float membership" }
  if ($refRow.eligible -ne $false) { Fail-Fl "ws send refusal made float eligible" }
  Rec-Fl "ws-send-float-refused" @{ outcome = "$($refused.outcome)"; membership = "retained-ineligible" }
  $freshB = Set-OwnedForegroundAb $helperCopy $hB "ws-send-focus"
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $true $false ([uint64]$freshB.hwnd) 0 $false
  $deadline = (Get-Date).AddSeconds(30)
  $sentEv = $null
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $logPath $mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq "send") -and ([int]$e.index -eq 2) -and ("$($e.outcome)" -ne "key-up")) {
        $sentEv = @{ event = $e; count = $tail.count }; break
      }
    }
    if ($null -ne $sentEv) { break }
    Start-Sleep -Milliseconds 400
  }
  if ("$($sentEv.event.outcome)" -ne "ok") { Fail-Fl "ws tiled send outcome $($sentEv.event.outcome) != ok" }
  Start-Sleep -Milliseconds 1500
  $stillFloat = Get-HelperRectKeyFl $helperCopy $hA "ws-float-survivor"
  if ($stillFloat -cne $floatFrame) { Fail-Fl "ws tiled send moved float survivor [$stillFloat] vs [$floatFrame]" }
  Rec-Fl "ws-float-survivor" @{ rect = $stillFloat }
  # Select away hides and reveals the float preserving its frame.
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 2) $false $false ([uint64]$fgNow) 0 $false
  $deadline = (Get-Date).AddSeconds(20)
  while ($true) {
    $tail = Get-LogEventsAfter $logPath $mark
    $hit = @($tail.events | Where-Object { ($_.event -eq "workspace") -and ($_.op -eq "select") -and ([int]$_.index -eq 2) -and ("$($_.outcome)" -ne "key-up") })
    if (@($hit).Count -gt 0) { $mark = $tail.count; break }
    if ((Get-Date) -ge $deadline) { Fail-Fl "ws-select-2 no dispatch" }
    Start-Sleep -Milliseconds 400
  }
  Start-Sleep -Milliseconds 1500
  [ActiveBorderNative]::EnsurePMv2()
  if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) { Fail-Fl "ws-select-2 float still visible while hidden workspace selected" }
  Rec-Fl "ws-float-hidden" @{ visible = $false }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $mark = Get-MarkBeforeActionAb $logPath
  $null = Send-MarkedChord ($VK_0 + 1) $false $false ([uint64]$fgNow) 0 $false
  $deadline = (Get-Date).AddSeconds(20)
  while ($true) {
    $tail = Get-LogEventsAfter $logPath $mark
    $hit = @($tail.events | Where-Object { ($_.event -eq "workspace") -and ($_.op -eq "select") -and ([int]$_.index -eq 1) -and ("$($_.outcome)" -ne "key-up") })
    if (@($hit).Count -gt 0) { $mark = $tail.count; break }
    if ((Get-Date) -ge $deadline) { Fail-Fl "ws-select-1 no dispatch" }
    Start-Sleep -Milliseconds 400
  }
  Start-Sleep -Milliseconds 1500
  if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hA.hwnd)) { Fail-Fl "ws-select-1 float not visible after reveal" }
  $backFrame = Get-HelperRectKeyFl $helperCopy $hA "ws-float-back"
  if ($backFrame -cne $floatFrame) { Fail-Fl "ws select cycle changed float frame [$backFrame] vs [$floatFrame]" }
  Rec-Fl "ws-float-preserved" @{ rect = $backFrame; visible = $true }
  $Ctx.ownerLog = $logPath; $Ctx.allowPath = $allowPath
}

function Get-AppRectFl([long]$Hwnd, [string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  $r = New-Object ActiveBorderNative+RECT
  if (-not [ActiveBorderNative]::GetWindowRect([IntPtr]$Hwnd, [ref]$r)) { Fail-Fl "$Tag rect unreadable" }
  return @([int]$r.left, [int]$r.top, [int]$r.right, [int]$r.bottom)
}

function Invoke-NormalSmokeLive($Ctx) {
  [ActiveBorderNative]::EnsurePMv2()
  $inv = Invoke-Native $Ctx.ownerCopy @("inventory") | ConvertFrom-Json
  $np = @($inv.windows | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "notepad.exe" }) | Select-Object -First 1
  $pt = @($inv.windows | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "mspaint.exe" }) | Select-Object -First 1
  $calc = $null
  foreach ($h in @($inv.windows | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "applicationframehost.exe" })) {
    try {
      $ch = Invoke-Native $Ctx.ownerCopy @("children", "--hwnd", "$($h.hwnd)") | ConvertFrom-Json
      $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
      if ($names -contains "calculatorapp.exe") { $calc = $h; break }
    } catch {}
  }
  $targets = @()
  if ($null -ne $np) { $targets += @{ name = "notepad"; row = $np } }
  if ($null -ne $pt) { $targets += @{ name = "paint"; row = $pt } }
  if ($null -ne $calc) { $targets += @{ name = "calculator"; row = $calc } }
  if (@($targets).Count -eq 0) { Fail-Fl "normal smoke needs a visible Notepad/Calculator/Paint" }
  Rec-Fl "normal-targets" @($targets | ForEach-Object { @{ app = $_.name; hwnd = $_.row.hwnd; class = "$($_.row.class)" } })
  foreach ($t in $targets) {
    $hwnd = [long]$t.row.hwnd
    $rect = Get-AppRectFl $hwnd "normal-$($t.name)"
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr]$hwnd)) { Fail-Fl "normal $($t.name) not visible at snapshot" }
    Rec-Fl "normal-$($t.name)" @{ rect = ($rect -join ","); visible = $true; mutation = "none-readonly"; float = "unaccepted-no-cli-synthetic-filtered" }
  }
  Rec-Fl "normal-float-rows-unaccepted" @{ reason = "product float on ordinary apps is physical user-owned: no float CLI, tile filters ALL injected input"; rows = @("ordinary-float-toggle", "ordinary-float-retention", "ordinary-float-refusal") }
}

function Invoke-FloatLive {
  Install-ShortcutNative
  Install-BorderNative
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Fl "refuse: OwnerSeconds must be 1..=600" }
  $dirs = New-FloatRunDir
  $proofDir = $dirs.runDir; $binDir = $dirs.binDir
  $reportPath = Join-Path $proofDir "float-report.json"
  if (Test-Path $reportPath) { Fail-Fl "report preexists, will not overwrite" }
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Fl "cargo build failed" }
  $dbgOwner = Join-Path $Repo "target\debug\tiler-windows.exe"
  $dbgHelper = Join-Path $Repo "target\debug\tiler-test-window.exe"
  if (-not (Test-Path -LiteralPath $dbgOwner)) { Fail-Fl "preflight missing built owner $dbgOwner" }
  if (-not (Test-Path -LiteralPath $dbgHelper)) { Fail-Fl "preflight missing built helper $dbgHelper" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item $dbgOwner $ownerCopy -Force
  Copy-Item $dbgHelper $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $diffStat = (& git -C $Repo diff --stat | Out-String).Trim()
  $diffText = (& git -C $Repo diff | Out-String)
  $diffBytes = [System.Text.Encoding]::UTF8.GetBytes($diffText)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $diffSha = ([System.BitConverter]::ToString($sha.ComputeHash($diffBytes)) -replace "-", "")
  $harnessSha = (Get-FileHash -LiteralPath (Join-Path $Repo "scripts\windows-float.ps1") -Algorithm SHA256).Hash
  $osInfo = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber, Version | ConvertTo-Json -Compress)
  $actorExe = (Get-Process -Id $PID).Path
  $prov = @{
    commit = $commit; status = $status; diff_stat = $diffStat; diff_sha256 = $diffSha; harness_sha256 = $harnessSha
    actor_pid = $PID; actor_exe = $actorExe
    owner_sha256 = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
    helper_sha256 = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
    os = "$osInfo"; run_dir = $proofDir
  }
  Rec-Fl "env" $prov
  $originals = Get-OriginalAppsSnapshot
  Rec-Fl "originals-pre" @{ apps = @($originals | ForEach-Object { "$($_.name):$($_.pid)" }) }
  $terminalHosts = @(Get-Process -Name WindowsTerminal -ErrorAction Stop | ForEach-Object {
      @{ pid = $_.Id; start = $_.StartTime.ToUniversalTime().ToFileTimeUtc() }
    })
  if ($terminalHosts.Count -eq 0) { Fail-Fl "hosting Terminal baseline unavailable" }
  $ident = (Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json)
  $ledgerDir = "$($ident.ledger_directory)"
  $preSpi = Read-SpiArranging
  $prePen = Read-PenVisualization
  Rec-Fl "settings-pre" @{ arranging = $preSpi; pen = $prePen; session = $ident.process.session_id; medium = "$($ident.integrity_level)" }
  if ($preSpi -ne $true) { Fail-Fl "preflight arranging not raw1" }
  if ([int]$prePen -ne 35) { Fail-Fl "preflight pen not 35" }
  Assert-LedgerClean $ownerCopy
  Rec-Fl "preflight" @{ ledger = "clean" }
  # Fixture-only prime: a cloaked Explorer-owned ApplicationFrameWindow holds
  # foreground on this host and suspends any proof owner on
  # fullscreen-foreground. Move foreground onto one exact approved app
  # (Notepad/Paint) before helpers/owner start. Mechanisms in order, one
  # attempt each, no repeats: (1) direct E8/attach/setter on an existing
  # approved app; (2) OS-granted foreground from launching one Notepad extra
  # via the Explorer broker (closed by exact HWND at the end). Anything else
  # records unavailable and activation-dependent legs stay unaccepted.
  $Ctx = @{ ownerCopy = $ownerCopy; helperCopy = $helperCopy; proofDir = $proofDir; ownerSeconds = $OwnerSeconds;
    created = @(); ownerFrozen = $null; ownerRunning = $false; ownerPayload = ""; ownerLog = ""; allowPath = ""; midClosed = $false;
    primed = $false; primeExtra = $null; allOwnerPids = @() }
  try {
    $prime = Get-PrimeTargetFl $ownerCopy "prime-pick"
    if ($null -eq $prime) {
      Rec-Fl "prime-foreground" @{ available = $false; reason = "no-approved-prime-candidate" }
    } else {
      $how = Set-ApprovedForegroundFl ([long]$prime.hwnd) "prime"
      $Ctx.primed = $true
      Rec-Fl "prime-foreground" @{ available = $true; method = "direct"; hwnd = $prime.hwnd; exe = "$($prime.exe)"; class = "$($prime.class)"; how = $how }
    }
  } catch {
    Rec-Fl "prime-direct" @{ available = $false; reason = "$($_.Exception.Message)" }
    try {
      $seedProc = Get-Process -Name Notepad -ErrorAction Stop | Select-Object -First 1
      $seedExe = "$($seedProc.Path)"
      $before = @(Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json | Select-Object -ExpandProperty windows | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "notepad.exe" } | ForEach-Object { [uint64]$_.hwnd })
      Start-ExplorerGui $seedExe "" $proofDir
      $found = $null
      $deadline = (Get-Date).AddSeconds(15)
      while ((Get-Date) -lt $deadline) {
        $inv = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
        $cands = @($inv.windows | Where-Object { ("$($_.exe)".ToLowerInvariant() -eq "notepad.exe") -and ($before -notcontains [uint64]$_.hwnd) })
        if (($null -eq $Ctx.primeExtra) -and (@($cands).Count -gt 0)) {
          $bind = @($cands | Sort-Object { [uint64]$_.hwnd }) | Select-Object -First 1
          $pidOut = [uint32]0
          $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$bind.hwnd, [ref]$pidOut)
          $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
          $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
          $Ctx.primeExtra = @{ hwnd = [uint64]$bind.hwnd; pid = [int]$pidOut; creation = $hex; exe = "$($bind.exe)"; class = "$($bind.class)"; extra_cands = @($cands).Count }
          Rec-Fl "prime-extra-bound" @{ hwnd = $bind.hwnd; pid = [int]$pidOut; cands = @($cands).Count }
        }
        if (@($cands).Count -gt 0) {
          $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
          $hit = @($cands | Where-Object { [uint64]$_.hwnd -eq [uint64]$fg }) | Select-Object -First 1
          if ($null -ne $hit) { $found = $hit; break }
        }
        Start-Sleep -Milliseconds 500
      }
      if ($null -eq $found) { Fail-Fl "new Notepad extra did not take foreground" }
      $Ctx.primed = $true
      Rec-Fl "prime-foreground" @{ available = $true; method = "new-extra"; hwnd = $found.hwnd; exe = "$($found.exe)"; class = "$($found.class)" }
    } catch {
      Rec-Fl "prime-foreground" @{ available = $false; method = "none"; reason = "$($_.Exception.Message)"; extra_bound = ($null -ne $Ctx.primeExtra) }
    }
  }
  try {
    $runOwned = ($Stage -eq "All") -or ($Stage -eq "OwnedFloat")
    $runWs = ($Stage -eq "All") -or ($Stage -eq "WorkspaceFloat")
    $runNormal = ($Stage -eq "All") -or ($Stage -eq "NormalSmoke")
    if ($runOwned) { Invoke-OwnedFloatLive $Ctx }
    if ($runOwned -and $runWs) {
      if ($Ctx.ownerRunning) { $null = Stop-FloatOwnerExact $Ctx "between-owned-ws" }
      if (@($Ctx.created).Count -gt 0) { Close-FloatHelpersExact $helperCopy $Ctx.created "between-owned-ws" }
      $Ctx.created = @(); $Ctx.ownerFrozen = $null; $Ctx.midClosed = $false
      Assert-LedgerClean $ownerCopy
      Rec-Fl "between-stages" @{ owner = "stopped"; helpers = "closed"; ledger = "clean" }
    }
    if ($runWs) {
      $seg = Join-Path $proofDir "ws"
      New-Item -ItemType Directory -Force -Path $seg | Out-Null
      $Ctx.proofDir = $seg
      Invoke-WorkspaceFloatLive $Ctx
      $Ctx.proofDir = $proofDir
      if ($runNormal) {
        if ($Ctx.ownerRunning) { $null = Stop-FloatOwnerExact $Ctx "between-ws-normal" }
        if (@($Ctx.created).Count -gt 0) { Close-FloatHelpersExact $helperCopy $Ctx.created "between-ws-normal" }
        $Ctx.created = @(); $Ctx.ownerFrozen = $null; $Ctx.midClosed = $false
        Assert-LedgerClean $ownerCopy
        Rec-Fl "between-stages-ws-normal" @{ owner = "stopped"; helpers = "closed"; ledger = "clean" }
      }
    }
    if ($runNormal) { Invoke-NormalSmokeLive $Ctx }
    Rec-Fl "required-unimplemented" @{ owner = "user"; rows = @(Get-RequiredUnimplementedRows) }
    Close-PrimeExtraFl $Ctx "final"
    if ($Ctx.ownerRunning) { $null = Stop-FloatOwnerExact $Ctx "final" }
    if (@($Ctx.created).Count -gt 0) { Close-FloatHelpersExact $helperCopy $Ctx.created "final" }
    Test-NoProjectActors $ownerCopy $helperCopy "final"
    Assert-LedgerClean $ownerCopy
    $endSpi = Read-SpiArranging
    $endPen = Read-PenVisualization
    if ($endSpi -ne $true) { Fail-Fl "end arranging not restored raw1" }
    if ([int]$endPen -ne 35) { Fail-Fl "end pen changed $endPen" }
    Rec-Fl "cleanup" @{ ledger = "clean"; actors = "absent"; arranging = $endSpi; pen = $endPen }
    $ovCount = 0
    foreach ($opid in @(@($Ctx.allOwnerPids) + @($Ctx.ownerFrozen.pid) | Where-Object { $_ -ne $null } | Sort-Object -Unique)) {
      $ovCount += @(@(Get-OverlayHwndsForOwnerAb ([int]$opid)) | Where-Object { $_ -ne 0 }).Count
    }
    if ($ovCount -ne 0) { Fail-Fl "overlay residue count=$ovCount" }
    Rec-Fl "overlay-residue" @{ count = $ovCount }
    Assert-OriginalAppsIntact $originals "final-originals"
    foreach ($hostIdentity in $terminalHosts) {
      $tp = Get-Process -Id $hostIdentity.pid -ErrorAction Stop
      if ($tp.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $hostIdentity.start) {
        Fail-Fl "host Terminal identity changed"
      }
    }
    $termAlive = $true
    $audit = @{ actors_absent = $true; overlays = $ovCount; ledger = "clean"; arranging = $endSpi; pen = $endPen; originals = "intact"; terminal_alive = $termAlive }
    $audit | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $proofDir "float-audit.json")
    Rec-Fl "final-audit" $audit
    $finalStatus = Get-FloatReportStatus $FL_STEPS $Stage
    $report = @{ status = $finalStatus; stage = "Float-$Stage"; started = (Get-Date).ToString("o"); provenance = $prov; steps = $FL_STEPS }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "float-report=$reportPath"
    Write-Output "status=$finalStatus"
  } catch {
    try {
      if ($ownerCopy -ne "" -and (Test-Path $ownerCopy)) {
        try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
        try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      }
    } catch {}
    foreach ($h in @($Ctx.created)) {
      try {
        if (($null -ne $h) -and (Test-ProcessAliveSameCreation ([int]$h.pid) "$($h.creation)")) {
          $null = Invoke-Native $helperCopy @("close", "$($h.hwnd)", "--tag", "$($h.tag)")
        }
      } catch {}
    }
    try { Close-PrimeExtraFl $Ctx "fail" } catch {}
    $report = @{ status = "fail"; stage = "Float-$Stage"; provenance = $prov; steps = $FL_STEPS; error = "$($_.Exception.Message)" }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "float-report=$reportPath"
    throw "Float stage failed: $($_.Exception.Message)"
  }
}

if ($Mock) { Invoke-FloatMock; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Fl "Stop requires -RunDir" }
  $ownerCopy = Join-Path $RunDir "bin\tiler-windows.exe"
  try { $s = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json; Write-Output ("stop=" + ($s | ConvertTo-Json -Compress)) } catch { Write-Output "stop failed: $($_.Exception.Message)" }
  try { $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json; Write-Output ("restore=" + ($r | ConvertTo-Json -Compress)) } catch { Write-Output "restore failed: $($_.Exception.Message)" }
  exit 0
}
if ($Live) { Invoke-FloatLive; exit 0 }
Write-Output "float parsed (no action without -Mock/-Live/-Stop)"
