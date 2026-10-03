param(
  [ValidateSet("dev", "stop", "proof", "tile")]
  [string]$Action = "dev",
  [string]$Mode = "",
  [string]$TileArgs = ""
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Target = Join-Path $Repo "target"
$Scripts = Join-Path $Repo "scripts"
$DevDir = Join-Path $Target "windows-dev"
$OwnerName = "tiler-windows.exe"
$HelperName = "tiler-test-window.exe"

function Fail([string]$Msg) { throw $Msg }
function Invoke-Native([string]$Exe, [string[]]$CliArgs) {
  $out = (& $Exe @CliArgs 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 0) { Fail "native exit ${code}: $Exe $($CliArgs -join ' ') $out" }
  return "$out".Trim()
}
function Get-CimProc([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if (-not $p) { Fail "unknown: no CIM record pid=$ProcessId" }
  return $p
}
function Assert-ParentIsExplorer([int]$ProcessId) {
  $p = Get-CimProc $ProcessId
  $pp = $p.ParentProcessId
  $par = Get-CimProc $pp
  if ("$($par.Name)" -ine "explorer.exe") { Fail "refuse: parent of $ProcessId is $($par.Name), want explorer.exe" }
}
function Test-ExeEqual([string]$A, [string]$B) {
  $na = "$A".Replace("/", "\")
  $nb = "$B".Replace("/", "\")
  return ($na -ieq $nb)
}
function Test-ProcessAliveSameCreation([int]$ProcessId, [string]$ExpectedCreation) {
  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    $fq = "$($_.FullyQualifiedErrorId)"
    if ($fq -like "NoProcessFound*") { return $false }
    throw
  }
  $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
  if ($hex -ieq "$ExpectedCreation") { return $true }
  return $false
}
function Start-ExplorerGui([string]$Exe, [string]$ArgString, [string]$WorkDir) {
  if (-not [IO.Path]::IsPathFullyQualified($Exe)) { Fail "refuse: exe not fully qualified: $Exe" }
  if (-not [IO.Path]::IsPathFullyQualified($WorkDir)) { Fail "refuse: workdir not fully qualified: $WorkDir" }
  if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { Fail "refuse: missing exe: $Exe" }
  $shell = New-Object -ComObject Shell.Application
  $desktopHandle = 0
  # SWC_DESKTOP + SWFO_NEEDDISPATCH selects Explorer's broker, not the caller's.
  $desktop = $shell.Windows().FindWindowSW(0, 0, 8, [ref]$desktopHandle, 1)
  $desktop.Document.Application.ShellExecute($Exe, $ArgString, $WorkDir, "open", 1)
}
function Get-LedgerDir([string]$Payload) {
  $j = Invoke-Native $Payload @("identity") | ConvertFrom-Json
  return "$($j.ledger_directory)"
}
function Assert-LedgerClean([string]$Payload) {
  $ld = Get-LedgerDir $Payload
  if (Test-Path (Join-Path $ld "ledger.json")) { Fail "ledger not clean" }
  if (Test-Path (Join-Path $ld "stop.request")) { Fail "stop.request residue" }
  if (Test-Path (Join-Path $ld "workspace.request")) { Fail "workspace.request residue" }
}
function Stop-PayloadOwner([string]$Payload) {
  $s = Invoke-Native $Payload @("stop") | ConvertFrom-Json
  if ((-not $s.owner_exited) -and ($s.recovery_required -ne $false)) {
    Fail "stop did not exit owner: $($s | ConvertTo-Json -Compress)"
  }
  $r = Invoke-Native $Payload @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail "restore failed: $($r | ConvertTo-Json -Compress)" }
  Assert-LedgerClean $Payload
  return @{ stop = $s; restore = $r }
}
function Wait-Ready([string]$Payload, [int]$TimeoutSec = 5) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $raw = Invoke-Native $Payload @("ready")
    $j = $raw | ConvertFrom-Json
    if ($j.ready -eq $true) { return $j }
    Start-Sleep -Milliseconds 250
  }
  Fail "ready timeout after ${TimeoutSec}s"
}
function Assert-OwnerReady([string]$Payload, [string]$Tag) {
  $ready = Wait-Ready $Payload 5
  if (-not (Test-ExeEqual "$($ready.owner.exe_path)" "$Payload")) { Fail "$Tag owner peer mismatch" }
  Assert-ParentIsExplorer ([int]$ready.owner.pid)
  return $ready
}
function Stop-OwnerVerified([string]$Payload, [bool]$Force, [string]$Tag) {
  if ($Force) { $st = Invoke-Native $Payload @("emergency-stop") | ConvertFrom-Json }
  else { $st = Invoke-Native $Payload @("stop") | ConvertFrom-Json }
  if (-not $st.owner_exited) { Fail "$Tag stop no exit" }
  return $st
}
# Dot-source guard: reusable helpers above stay available when sourced;
# direct -File execution continues to the action blocks below.
if ("$($MyInvocation.InvocationName)" -eq ".") { return }
if ($Action -eq "dev" -or $Action -eq "stop" -or $Action -eq "tile") {
  if (-not (Test-Path $Target)) { Fail "missing target/ parent" }
  if (-not (Test-Path $Scripts)) { Fail "missing scripts/ parent" }
  $payload = Join-Path $DevDir $OwnerName
  if ($Action -eq "dev" -or $Action -eq "tile") {
    $trace = ($Mode -eq "trace")
    & cargo build --locked -p tiler-windows
    if ($LASTEXITCODE -ne 0) { Fail "cargo build failed" }
    if (Test-Path $payload) { $null = Stop-PayloadOwner $payload }
    New-Item -ItemType Directory -Force -Path $DevDir | Out-Null
    Copy-Item (Join-Path $Target "debug\$OwnerName") $payload -Force
    Copy-Item (Join-Path $Target "debug\$HelperName") (Join-Path $DevDir $HelperName) -Force
    # Launch provenance: source + artifact identity bound immediately after
    # build, before the owner starts. The launch commit is the build source,
    # never a claim about an embedded binary identity.
    $provCommit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
    $provDirtyRaw = (& git -C $Repo status --short | Out-String).Trim()
    $provDirty = ($provDirtyRaw.Length -gt 0)
    $provOwnerHash = (Get-FileHash $payload -Algorithm SHA256).Hash
    $provHelperHash = (Get-FileHash (Join-Path $DevDir $HelperName) -Algorithm SHA256).Hash
    if ($Action -eq "tile") {
      # Normal user tiling only (explicit user dogfood): requires
      # `--user-start` in TileArgs and refuses any `--allowlist`. Proof uses
      # `tile-proof` via scripts/windows-tiling.ps1 so lost arguments can
      # never fall back to tiling the whole desktop.
      if ($TileArgs -notmatch "(^|\s)--user-start(\s|$)") {
        Fail "refuse: tile requires explicit --user-start in TileArgs"
      }
      if ($TileArgs -match "(^|\s)--allowlist(\s|$)") {
        Fail "refuse: tile never takes --allowlist; proof uses tile-proof"
      }
      $runArgs = "tile $TileArgs"
      $tag = "tile"
    } else {
      $runArgs = "run --seconds 600"
      if ($trace) { $runArgs += " --trace" }
      $tag = "dev"
    }
    Start-ExplorerGui $payload $runArgs $DevDir
    $ready = Assert-OwnerReady $payload $tag
    # Launch provenance: build source commit plus dirty state and artifact
    # hashes, bound to the ready owner/log identity. Source identity only
    # (never a claim about an embedded binary identity); a dirty tree is
    # allowed developer debugging state, recorded not refused. Sidecar-only
    # plus stdout: the owner log stays single-writer.
    $provenance = @{
      commit        = $provCommit
      dirty         = $provDirty
      dirty_detail  = $provDirtyRaw
      owner_sha256  = $provOwnerHash
      helper_sha256 = $provHelperHash
      argv          = $runArgs
      payload_path  = $payload
      log_path      = "$($ready.log_path)"
      owner         = $ready.owner
    }
    $provSidecar = "$($ready.log_path).provenance.json"
    try {
      $provParent = Split-Path -Parent $provSidecar
      if (-not (Test-Path -LiteralPath $provParent)) { throw "missing provenance parent: $provParent" }
      $provenance | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $provSidecar -Encoding utf8NoBOM
    } catch {
      $null = Stop-PayloadOwner $payload
      throw
    }
    Write-Output "log_path=$($ready.log_path)"
    Write-Output "owner=$($ready.owner | ConvertTo-Json -Compress)"
    Write-Output "provenance=$($provenance | ConvertTo-Json -Compress -Depth 8)"
    Write-Output "provenance_path=$provSidecar"
    Write-Output "ready=true"
  } else {
    if (-not (Test-Path $payload)) { Fail "no dev payload $payload" }
    $null = Stop-PayloadOwner $payload
    Write-Output "stopped clean"
  }
  exit 0
}
if (-not (Test-Path $Target)) { Fail "missing target/ parent" }
if (-not (Test-Path $Scripts)) { Fail "missing scripts/ parent" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$proofDir = Join-Path $Target "windows-proof\$stamp-$PID"
New-Item -ItemType Directory -Force -Path $proofDir | Out-Null
$steps = [System.Collections.ArrayList]@()
function Rec([string]$Name, $Data) { $null = $steps.Add(@{ name = $Name; data = $Data }) }
$commit = (& git rev-parse HEAD | Out-String).Trim()
$dirty = (& git status --short | Out-String).Trim()
$actorPid = $PID
$actorExe = (Get-Process -Id $PID).Path
$actorPar = (Get-CimProc $PID).ParentProcessId
$devPayload = Join-Path $DevDir $OwnerName
$devHelper = Join-Path $DevDir $HelperName
if (-not (Test-Path $devPayload)) { Fail "no dev payload $devPayload" }
if (-not (Test-Path $devHelper)) { Fail "no dev helper $devHelper" }
$ident = (Invoke-Native $devPayload @("identity") | ConvertFrom-Json)
$artHash = (Get-FileHash $devPayload -Algorithm SHA256).Hash
$helpHash = (Get-FileHash $devHelper -Algorithm SHA256).Hash
Rec "env" @{ commit = $commit; dirty = $dirty; actorPid = $actorPid; actorExe = $actorExe; actorParent = $actorPar; sid = $ident.process.user_sid; session = $ident.process.session_id; il = $ident.integrity_level; ownerHash = $artHash; helperHash = $helpHash; payloadPath = $devPayload; helperPath = $devHelper; ledgerDirectory = "$($ident.ledger_directory)" }
function Proof-NoHide([string]$Payload, [bool]$Force) {
  $tag = $Force ? "nohide-forced" : "nohide-grace"
  Start-ExplorerGui $Payload "run --seconds 600" (Split-Path -Parent $Payload)
  $ready = Assert-OwnerReady $Payload $tag
  Rec "$tag-ready" $ready
  $st = Stop-OwnerVerified $Payload $Force $tag
  Rec "$tag-stop" $st
  $alive = Test-ProcessAliveSameCreation ([int]$ready.owner.pid) "$($ready.owner.process_creation)"
  if ($alive) { Fail "$tag owner alive" }
  $r = Invoke-Native $Payload @("restore") | ConvertFrom-Json
  Rec "$tag-restore" $r
}
Proof-NoHide $devPayload $false
Proof-NoHide $devPayload $true
$hBin = Join-Path $DevDir $HelperName
$receipt = Join-Path $proofDir "window.json"
if (Test-Path $receipt) { Fail "receipt preexists $receipt" }
Start-ExplorerGui $hBin "run --seconds 600 --receipt `"$receipt`"" $proofDir
$hDeadline = (Get-Date).AddSeconds(5)
while (-not (Test-Path $receipt)) { if ((Get-Date) -gt $hDeadline) { Fail "helper receipt timeout" }; Start-Sleep -Milliseconds 200 }
$hsnap = Get-Content $receipt -Raw | ConvertFrom-Json
Rec "helper-baseline" $hsnap
if (-not (Test-ExeEqual "$($hsnap.process.exe_path)" "$hBin")) { Fail "helper peer mismatch" }
Assert-ParentIsExplorer ([int]$hsnap.process.pid)
$insp = Invoke-Native $hBin @("inspect", "$($hsnap.hwnd)") | ConvertFrom-Json
if ($insp.tag -ne $hsnap.tag -or "$($insp.process.process_creation)" -ne "$($hsnap.process.process_creation)") { Fail "helper baseline mismatch" }
function Proof-Hide([string]$Payload, [string]$HBin, [object]$Base, [bool]$Force) {
  $tag = $Force ? "hide-forced" : "hide-grace"
  Start-ExplorerGui $Payload "run --seconds 120 --hide $($Base.hwnd)" (Split-Path -Parent $Payload)
  $ready = Assert-OwnerReady $Payload $tag
  Rec "$tag-ready" $ready
  $hid = Invoke-Native $HBin @("inspect", "$($Base.hwnd)") | ConvertFrom-Json
  if ($hid.visible -ne $false -or $hid.tag -ne $Base.tag) { Fail "$tag not hidden" }
  $st = Stop-OwnerVerified $Payload $Force $tag
  $alive = Test-ProcessAliveSameCreation ([int]$ready.owner.pid) "$($ready.owner.process_creation)"
  if ($alive) { Fail "$tag owner alive" }
  $still = Invoke-Native $HBin @("inspect", "$($Base.hwnd)") | ConvertFrom-Json
  if ($still.visible -ne $false -or $still.tag -ne $Base.tag -or "$($still.process.process_creation)" -ne "$($Base.process.process_creation)") { Fail "$tag helper changed" }
  Rec "$tag-stop" @{ stop = $st; helper = $still }
  $r = Invoke-Native $Payload @("restore") | ConvertFrom-Json
  $back = Invoke-Native $HBin @("inspect", "$($Base.hwnd)") | ConvertFrom-Json
  if ($back.visible -ne $true -or $back.tag -ne $Base.tag -or [int]$back.process.pid -ne [int]$Base.process.pid -or "$($back.process.process_creation)" -ne "$($Base.process.process_creation)" -or "$($back.process.user_sid)" -ne "$($Base.process.user_sid)" -or [int]$back.process.session_id -ne [int]$Base.process.session_id -or -not (Test-ExeEqual "$($back.process.exe_path)" "$($Base.process.exe_path)")) { Fail "$tag restore readback" }
  if ($back.left -ne $Base.left -or $back.top -ne $Base.top -or $back.right -ne $Base.right -or $back.bottom -ne $Base.bottom) { Fail "$tag rect changed" }
  Rec "$tag-restore" @{ restore = $r; readback = $back }
}
Proof-Hide $devPayload $hBin $hsnap $false
Proof-Hide $devPayload $hBin $hsnap $true
$closed = Invoke-Native $hBin @("close", "$($hsnap.hwnd)", "--tag", "$($hsnap.tag)") | ConvertFrom-Json
Rec "helper-close" $closed
$exitDeadline = (Get-Date).AddSeconds(5)
while ($true) {
  $held = Test-ProcessAliveSameCreation ([int]$hsnap.process.pid) "$($hsnap.process.process_creation)"
  if (-not $held) { break }
  if ((Get-Date) -gt $exitDeadline) { Fail "helper exit timeout" }
  Start-Sleep -Milliseconds 200
}
Assert-LedgerClean $devPayload
$report = @{ steps = $steps }
$report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $proofDir "report.json")
$report | ConvertTo-Json -Depth 8 | Write-Output
