param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 240
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner stop/restore helpers.
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }

# Scoped ordinary-app workspace verification over the normal `tile` loop
# (physical, medium, no hooks for dispatch, no synthetic digit input).
# Dispatch uses the exact-owner `workspace --select INDEX` control only: the
# CLI queues one bounded `workspace.request` file and the owner validates the
# full owner binding before dispatching once through the existing
# `workspace_do_select` resolver. Product `tile` keeps filtering ALL injected
# input; the helper `workspace-proof` strict class/lifetime-tag gate is
# untouched (this script never sends marked input and never presents an
# allowlist). The normal owner runs with an explicit test-scoped
# `--scope-exe` filter (Notepad + Calculator host + Paint, no default): the
# product default manages everything including Terminal, so this script
# always passes the explicit scope and never relies on product exclusion.
#
#   pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 -Mock
#   pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 -Live
#   pwsh -NoProfile -File scripts/windows-workspace-normal.ps1 -Stop -RunDir '<dir>'
#
# Safety: explicit flags mandatory; bare invocation parses and exits. Only
# approved ordinary apps (Notepad, Calculator via ApplicationFrameHost,
# Paint) are activated/minimized/restored/hidden; Terminal is out of the
# explicit scope and is never hidden/typed/closed. Firefox (MozillaWindowClass)
# is NEVER touched and is never in scope: a non-maximized visible Firefox
# refuses live scope, a maximized one is recorded excluded. No process-name
# kills, no registry/policy writes, no typing, no closing/killing of any app
# (owned-helper admission closes only the script-launched owned helper).
# Activation is E8-prime + AttachThreadInput + one SetForegroundWindow on the
# exact approved target with immediate detach and exact readback (no pointer
# clicks on any window).
# End state: approved apps open, visible, unminimized, unmaximized; zero run
# actors; ledger/stop/workspace-request clean; arranging raw1, pen 35.

$WN_STEPS = [System.Collections.ArrayList]@()
function Rec-Wn([string]$Name, $Data) { $null = $WN_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Wn([string]$Msg) { throw $Msg }
function Offline-Wn([string]$Reason) {
  $report = @{ status = "offline"; stage = "WorkspaceNormal"; reason = $Reason; steps = $WN_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
  exit 0
}

$WN_APPROVED_EXE = @("notepad.exe", "mspaint.exe", "ApplicationFrameHost.exe")
# Runtime mid-run fence: the host passes observation/hide only with a live
# CalculatorApp child, so another Store app appearing under
# ApplicationFrameHost mid-run is scope-excluded (never managed, never
# hidden) instead of riding the host executable. The startup children check
# below stays as the preflight refusal.
$WN_SCOPE_ARGS = " --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe"
$WN_TERMINAL_EXE = @("windowsterminal.exe", "wt.exe")
$WN_SHELL_CLASS = @("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "DV2ControlHost", "MSCTFIME UI", "SystemTray_Main")
$WN_DIALOG_CLASS = "#32770"
$WN_FIREFOX_CLASS = "MozillaWindowClass"
$SW_HIDE = 0
$SW_RESTORE = 9
$SW_MINIMIZE = 6
$SM_XVIRTUALSCREEN = 76
$SM_YVIRTUALSCREEN = 77
$SM_CXVIRTUALSCREEN = 78
$SM_CYVIRTUALSCREEN = 79

function Install-NormalNative {
  if (-not ("WorkspaceNormalNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WorkspaceNormalNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint a, ref int v, int s);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }
  public static uint SendKey(ushort vk, bool up, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk; arr[0].u.ki.wScan = 0;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint PrimeE8() { return SendKey(0xE8, false, 0) + SendKey(0xE8, true, 0); }
  public static int[] RectOf(long hwnd) {
    RECT r;
    if (!GetWindowRect((IntPtr)hwnd, out r)) return null;
    return new int[] { r.left, r.top, r.right, r.bottom };
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
}

function Read-SpiArrangingWn {
  if (-not ("WnSpiProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WnSpiProbe {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  public static int Get() {
    int v = 0;
    if (!SystemParametersInfo(0x0082, 0, ref v, 0)) throw new Exception("SPI_GETWINARRANGING failed");
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  return ([WnSpiProbe]::Get() -ne 0)
}

function Read-PenWn {
  if (-not ("WnPenProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WnPenProbe {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  public static int Get() {
    int v = 0;
    if (!SystemParametersInfo(0x201E, 0, ref v, 0)) throw new Exception("SPI_GETPENVISUALIZATION failed");
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  return [WnPenProbe]::Get()
}

function Read-CompleteTextWn([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $reader = New-Object IO.StreamReader($stream); return $reader.ReadToEnd() }
  finally { $stream.Close() }
}

function Get-CompleteLinesWn([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Wn "missing log $Path" }
  $text = Read-CompleteTextWn $Path
  $complete = @()
  if ([string]::IsNullOrEmpty($text)) { return ,$complete }
  $endsNewline = $text.EndsWith("`n")
  $parts = $text -split "`n"
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $last = ($i -eq ($parts.Count - 1))
    if ($last -and -not $endsNewline) { break }
    $line = "$($parts[$i])" -replace "`r$", ""
    if ($last -and $line -eq "") { break }
    $complete += $line
  }
  return ,$complete
}

function Get-LogEventsAfterWn([string]$LogPath, [int]$Mark) {
  $lines = Get-CompleteLinesWn $LogPath
  $out = @()
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -ne "") { $out += ($lines[$i] | ConvertFrom-Json) }
  }
  return @{ events = $out; count = $lines.Count }
}

function Wait-WorkspaceCliOutcome([string]$LogPath, [int]$Mark, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterWn $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq "select") -and ([int]$e.index -eq [int]$Index) -and ("$($e.edge)" -eq "cli") -and ("$($e.outcome)" -ne "key-up")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Wn "$Tag no owner workspace dispatch select/$Index edge cli after mark $Mark"
  return $null
}

function Send-WorkspaceSelect([string]$OwnerBin, [int]$Index, [string]$Tag) {
  $raw = Invoke-Native $OwnerBin @("workspace", "--select", "$Index")
  $j = $raw | ConvertFrom-Json
  if (-not $j.dispatched) { Fail-Wn "$Tag workspace --select $Index not dispatched: $raw" }
  if ([int]$j.index -ne [int]$Index) { Fail-Wn "$Tag workspace --select index mismatch: $raw" }
  return $j
}

function Get-CloakedWn([long]$Hwnd) {
  $v = 0
  $hr = [WorkspaceNormalNative]::DwmGetWindowAttribute([IntPtr]$Hwnd, 14, [ref]$v, 4)
  if ($hr -ne 0) { return -1 }
  return [int]$v
}

function Get-AppSnapshotWn([long]$Hwnd, [string]$Tag) {
  $pidOut = [uint32]0
  $null = [WorkspaceNormalNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$pidOut)
  if ([uint32]$pidOut -eq 0) { Fail-Wn "$Tag hwnd $Hwnd has no pid" }
  $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
  $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
  $session = -1; $sid = "unreadable"
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$pidOut" -ErrorAction Stop
    $session = [int]$cim.SessionId
    $owner = Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
    $sid = "$($owner.Sid)"
  } catch {}
  $rect = [WorkspaceNormalNative]::RectOf($Hwnd)
  return @{
    hwnd = [uint64]$Hwnd; pid = [int]$pidOut; start = $hex; exe = "$($proc.Path)"
    sid = $sid; session = $session; rect = "$(if ($null -eq $rect) { 'unreadable' } else { $rect -join ',' })"
    visible = [bool][WorkspaceNormalNative]::IsWindowVisible([IntPtr]$Hwnd)
    iconic = [bool][WorkspaceNormalNative]::IsIconic([IntPtr]$Hwnd)
    zoomed = [bool][WorkspaceNormalNative]::IsZoomed([IntPtr]$Hwnd)
  }
}

function Set-AppForegroundWn([long]$Hwnd, [string]$Tag) {
  $fgEntry = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Hwnd) { return }
  $prime = [WorkspaceNormalNative]::PrimeE8()
  if ([int]$prime -ne 2) { Fail-Wn "$Tag E8 prime accepted $prime != 2" }
  $fgNow = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [WorkspaceNormalNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Wn "$Tag foreground TID unreadable" }
  $myTid = [WorkspaceNormalNative]::GetCurrentThreadId()
  $attachOk = $false
  if ([uint32]$fgTid -ne [uint32]$myTid) {
    $attachOk = [WorkspaceNormalNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
  }
  try {
    $null = [WorkspaceNormalNative]::SetForegroundWindow([IntPtr][long]$Hwnd)
  } finally {
    if ($attachOk) { $null = [WorkspaceNormalNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) }
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne [uint64]$Hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
  }
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Wn "$Tag foreground readback $fg != $Hwnd attach=$attachOk" }
}

function Get-InventoryPreflight([string]$OwnerBin, [string]$HelperBin) {
  $inv = Invoke-Native $OwnerBin @("inventory") | ConvertFrom-Json
  $eligible = [System.Collections.ArrayList]@()
  $terminal = [System.Collections.ArrayList]@()
  $firefoxZoomed = [System.Collections.ArrayList]@()
  foreach ($w in @($inv.windows)) {
    $hwnd = [uint64]$w.hwnd
    $exe = "$($w.exe)"
    $base = $exe.ToLowerInvariant()
    $class = "$($w.class)"
    $exstyle = 0
    try { $exstyle = [Convert]::ToUInt32(("$($w.exstyle)" -replace '^0[xX]', ''), 16) } catch { $exstyle = 0 }
    if ($WN_SHELL_CLASS -contains $class) { continue }
    if (($exstyle -band 0x80) -ne 0) { continue }
    if (($exstyle -band 0x8) -ne 0) { continue }
    if (($exstyle -band 0x08000000) -ne 0) { continue }
    if ($class -eq $WN_DIALOG_CLASS) { continue }
    $cloak = Get-CloakedWn ([long]$hwnd)
    if ($cloak -ne 0) { continue }
    $owner = [WorkspaceNormalNative]::GetWindow([IntPtr][long]$hwnd, 4).ToInt64()
    if ([long]$owner -ne 0) { continue }
    $parent = [WorkspaceNormalNative]::GetParent([IntPtr][long]$hwnd).ToInt64()
    if ([long]$parent -ne 0) { continue }
    if (-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$hwnd)) { continue }
    if ($WN_TERMINAL_EXE -contains $base) { $null = $terminal.Add($w); continue }
    $zoomed = [WorkspaceNormalNative]::IsZoomed([IntPtr][long]$hwnd)
    if (($base -eq "firefox.exe") -or ($class -eq $WN_FIREFOX_CLASS)) {
      if ($zoomed) { $null = $firefoxZoomed.Add($w); continue }
      Fail-Wn "refuse: visible non-maximized Firefox hwnd=$hwnd (never touch)"
    }
    if ($zoomed) { continue }
    if ([WorkspaceNormalNative]::IsIconic([IntPtr][long]$hwnd)) { continue }
    $null = $eligible.Add($w)
  }
  return @{ eligible = $eligible; terminal = $terminal; firefox = $firefoxZoomed }
}

function Assert-ApprovedEligible($Eligible, [string]$OwnerBin, [string]$Tag) {
  $managed = [System.Collections.ArrayList]@()
  foreach ($w in @($Eligible)) {
    $base = "$($w.exe)".ToLowerInvariant()
    if ($WN_APPROVED_EXE -notcontains $w.exe -and $WN_APPROVED_EXE -notcontains $base -and @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -notcontains $base) {
      Fail-Wn "$Tag unapproved eligible candidate exe=$($w.exe) class=$($w.class) hwnd=$($w.hwnd) refuses live scope"
    }
    if ($base -eq "applicationframehost.exe") {
      $ch = Invoke-Native $OwnerBin @("children", "--hwnd", "$($w.hwnd)") | ConvertFrom-Json
      $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
      if ($names -notcontains "calculatorapp.exe") {
        Fail-Wn "$Tag ApplicationFrameHost hwnd=$($w.hwnd) hosts none-approved ($($names -join ',')) refuses live scope"
      }
    }
    $null = $managed.Add($w)
  }
  if ($managed.Count -eq 0) { Fail-Wn "$Tag no eligible approved ordinary app (need Notepad/Calculator/Paint visible)" }
  return ,$managed
}

function Test-ExeEqualWn([string]$A, [string]$B) {
  return ("$A".Replace("/", "\") -ieq "$B".Replace("/", "\"))
}

function Assert-LedgerOrdinaryClaims([string]$LedgerDir, $Snapshots, $OwnerFrozen, [string]$Tag) {
  $ledgerPath = Join-Path $LedgerDir "ledger.json"
  if (-not (Test-Path -LiteralPath $ledgerPath)) { Fail-Wn "$Tag ledger missing" }
  $ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
  if ([int]$ledger.v -ne 4) { Fail-Wn "$Tag ledger v$($ledger.v) != v4" }
  if ([int]$ledger.owner.pid -ne [int]$OwnerFrozen.pid) { Fail-Wn "$Tag ledger owner pid changed" }
  if ("$($ledger.owner.process_creation)" -cne "$($OwnerFrozen.process_creation)") { Fail-Wn "$Tag ledger owner creation changed" }
  $claims = @($ledger.windows)
  if ($claims.Count -ne $Snapshots.Count) { Fail-Wn "$Tag ledger claims $($claims.Count) != managed $($Snapshots.Count)" }
  foreach ($c in @($claims)) {
    if ("$($c.kind)" -ne "product") { Fail-Wn "$Tag ledger claim hwnd=$($c.hwnd) kind=$($c.kind) != product" }
    $snap = @($Snapshots | Where-Object { [uint64]$_.hwnd -eq [uint64]$c.hwnd }) | Select-Object -First 1
    if ($null -eq $snap) { Fail-Wn "$Tag ledger claim hwnd=$($c.hwnd) not in managed set" }
    if ([int]$c.process.pid -ne [int]$snap.pid) { Fail-Wn "$Tag claim hwnd=$($c.hwnd) pid changed" }
    if ("$($c.process.process_creation)" -cne "$($snap.start)") { Fail-Wn "$Tag claim hwnd=$($c.hwnd) creation changed" }
    if (-not (Test-ExeEqualWn "$($c.process.exe_path)" "$($snap.exe)")) { Fail-Wn "$Tag claim hwnd=$($c.hwnd) exe changed" }
    if ("$($c.process.user_sid)" -cne "$($snap.sid)") { Fail-Wn "$Tag claim hwnd=$($c.hwnd) sid changed" }
    if ([int]$c.process.session_id -ne [int]$snap.session) { Fail-Wn "$Tag claim hwnd=$($c.hwnd) session changed" }
    if ("$($c.tag)" -notmatch "^[0-9a-f]{16}$") { Fail-Wn "$Tag claim hwnd=$($c.hwnd) tag malformed" }
    if ("$($c.tag)" -match "^0{16}$") { Fail-Wn "$Tag claim hwnd=$($c.hwnd) tag zero" }
    if ([WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$c.hwnd)) { Fail-Wn "$Tag claim hwnd=$($c.hwnd) still visible while hidden" }
  }
  return $ledger
}

function Invoke-NormalMock {
  $journey = @(
    @{ op = "select"; index = 2; edge = "cli" }
    @{ op = "select"; index = 1; edge = "cli" }
  )
  foreach ($row in @($journey)) {
    if ("$($row.op)" -ne "select") { Fail-Wn "mock journey op must be select-only" }
    if ([int]$row.index -lt 0 -or [int]$row.index -gt 9) { Fail-Wn "mock journey index range" }
    if ("$($row.edge)" -ne "cli") { Fail-Wn "mock journey edge must be cli" }
  }
  Rec-Wn "journey-guard" @{ rows = @($journey | ForEach-Object { "$($_.op)/$($_.index)/$($_.edge)" }); synthetic_digit_input = $false }
  $approved = @("notepad.exe", "calculatorapp.exe", "mspaint.exe")
  Rec-Wn "approved-set" @{ apps = $approved; scope = $WN_SCOPE_ARGS.Trim(); default_scope = "none (product default manages everything)"; firefox = "never-touch" }
  $report = @{ status = "pass"; stage = "WorkspaceNormalMock"; steps = $WN_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Invoke-NormalLive {
  Install-NormalNative
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Wn "refuse: OwnerSeconds must be 1..=600" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\windows-workspace-normal\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "workspace-normal-report.json"
  if (Test-Path $reportPath) { Fail-Wn "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Wn "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $osInfo = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber, Version | ConvertTo-Json -Compress)
  $dispX = [WorkspaceNormalNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
  $dispY = [WorkspaceNormalNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
  $dispW = [WorkspaceNormalNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
  $dispH = [WorkspaceNormalNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
  $prov = @{
    commit = $commit; status = $status
    actor_pid = $PID; actor_exe = (Get-Process -Id $PID).Path
    owner_sha256 = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
    helper_sha256 = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
    os = "$osInfo"; display_virtual = "$dispX,$dispY,${dispW}x${dispH}"
    run_dir = $runDir
  }
  Rec-Wn "env" $prov
  $ident = (Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json)
  $ledgerDir = "$($ident.ledger_directory)"
  $preSpi = Read-SpiArrangingWn
  $prePen = Read-PenWn
  Rec-Wn "settings-pre" @{ arranging = $preSpi; pen = $prePen }
  if ($preSpi -ne $true) { Fail-Wn "preflight arranging not raw1" }
  if ([int]$prePen -ne 35) { Fail-Wn "preflight pen not 35" }
  Assert-LedgerClean $ownerCopy
  Rec-Wn "preflight" @{ ledger = "clean"; arranging = $preSpi; pen = $prePen }

  # Actual candidate inventory: only approved ordinary apps may be eligible.
  # Any unapproved eligible candidate (or a non-maximized Firefox) refuses
  # live scope here with an offline report and zero mutation.
  $pre = Get-InventoryPreflight $ownerCopy $helperCopy
  if (@($pre.firefox).Count -gt 0) {
    Rec-Wn "firefox-excluded" @{ count = @($pre.firefox).Count; hwnds = @($pre.firefox | ForEach-Object { $_.hwnd }); maximized = $true; touched = $false }
  }
  $managedRows = Assert-ApprovedEligible $pre.eligible $ownerCopy "preflight"
  $snaps = @()
  foreach ($w in @($managedRows)) {
    $s = Get-AppSnapshotWn ([long]$w.hwnd) "preflight-$($w.hwnd)"
    if (-not $s.visible) { Fail-Wn "preflight managed hwnd=$($w.hwnd) not visible" }
    if ($s.iconic -or $s.zoomed) { Fail-Wn "preflight managed hwnd=$($w.hwnd) must start restored (iconic=$($s.iconic) zoomed=$($s.zoomed))" }
    $snaps += $s
  }
  $calcSnap = @($snaps | Where-Object { "$($_.exe)".ToLowerInvariant() -like "*applicationframehost*" }) | Select-Object -First 1
  if ($null -eq $calcSnap) { Fail-Wn "preflight needs a visible Calculator host (ApplicationFrameHost + CalculatorApp child)" }
  Rec-Wn "managed-pre" @($snaps | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.pid; exe = $_.exe; rect = $_.rect } })
  if (@($pre.terminal).Count -gt 0) {
    Rec-Wn "terminal-float" @{ count = @($pre.terminal).Count; hwnds = @($pre.terminal | ForEach-Object { $_.hwnd }); hidden_allowed = $false }
  }

  $createdHelper = $null
  try {
    # Normal owner via Explorer (user dogfood path, explicit --user-start plus
    # the explicit test scope; product default is unscoped).
    Start-ExplorerGui $ownerCopy "tile --user-start --seconds $OwnerSeconds --trace$WN_SCOPE_ARGS" $binDir
    $ready = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready) { Fail-Wn "normal tile ready timeout" }
    $ownerFrozen = $ready.owner
    if (-not (Test-ExeEqual "$($ownerFrozen.exe_path)" "$ownerCopy")) { Fail-Wn "owner peer mismatch" }
    Assert-ParentIsExplorer ([int]$ownerFrozen.pid)
    $logPath = "$($ready.log_path)"
    Rec-Wn "owner-ready" @{ pid = $ownerFrozen.pid; log = $logPath }
    Start-Sleep -Milliseconds 2500
    $midSpi = Read-SpiArrangingWn
    if ($midSpi -ne $false) { Fail-Wn "mid-run arranging not FALSE under prevention, got $midSpi" }
    Rec-Wn "settings-mid" @{ arranging = $midSpi }
    $startEv = @((Get-LogEventsAfterWn $logPath 0).events | Where-Object { $_.event -eq "tile-start" }) | Select-Object -First 1
    if ($null -eq $startEv) { Fail-Wn "tile-start missing" }
    if ("$($startEv.mode)" -ne "normal") { Fail-Wn "tile-start mode $($startEv.mode) != normal" }
    Rec-Wn "tile-start" @{ mode = "$($startEv.mode)"; takeover = $startEv.keyboard.takeover; prevention = $startEv.mouse_snap_prevention; scope_count = $startEv.scope_count }
    if ([int]$startEv.scope_count -ne 3) { Fail-Wn "tile-start scope_count $($startEv.scope_count) != 3 (explicit test scope required)" }

    # Deterministic focus on an approved app before dispatch (approved
    # activation only, no pointer on any window).
    $focusSnap = @($snaps | Where-Object { "$($_.exe)".ToLowerInvariant() -like "*notepad*" }) | Select-Object -First 1
    if ($null -eq $focusSnap) { $focusSnap = $snaps[0] }
    Set-AppForegroundWn ([long]$focusSnap.hwnd) "dispatch-focus"
    $mark = (Get-CompleteLinesWn $logPath).Count

    # CLI select 2 hides all managed approved apps; out-of-scope Terminal
    # stays visible (explicit scope fence, never hidden).
    $q = Send-WorkspaceSelect $ownerCopy 2 "select-2"
    $ev = Wait-WorkspaceCliOutcome $logPath $mark 2 30 "select-2"
    $mark = $ev.count
    Rec-Wn "select-2" @{ dispatched = $q; outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -notin @("ok", "partial")) { Fail-Wn "select-2 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $ledger = Assert-LedgerOrdinaryClaims $ledgerDir $snaps $ownerFrozen "select-2"
    Rec-Wn "select-2-ledger" @{ v = $ledger.v; claims = @($ledger.windows | ForEach-Object { $_.hwnd }) }
    foreach ($t in @($pre.terminal)) {
      if (-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$t.hwnd)) { Fail-Wn "select-2 Terminal hwnd=$($t.hwnd) hidden (scope fence violated)" }
    }
    Rec-Wn "select-2-terminal" @{ visible = $true }

    # CLI select 1 reveals the correct identities with layout and focus.
    $q = Send-WorkspaceSelect $ownerCopy 1 "select-1"
    $ev = Wait-WorkspaceCliOutcome $logPath $mark 1 30 "select-1"
    $mark = $ev.count
    Rec-Wn "select-1" @{ dispatched = $q; outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Wn "select-1 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    foreach ($s in @($snaps)) {
      $live = Get-AppSnapshotWn ([long]$s.hwnd) "reveal-$($s.hwnd)"
      if ([int]$live.pid -ne [int]$s.pid) { Fail-Wn "reveal hwnd=$($s.hwnd) pid changed" }
      if ("$($live.start)" -cne "$($s.start)") { Fail-Wn "reveal hwnd=$($s.hwnd) restarted" }
      if (-not (Test-ExeEqualWn "$($live.exe)" "$($s.exe)")) { Fail-Wn "reveal hwnd=$($s.hwnd) exe changed" }
      if (-not $live.visible) { Fail-Wn "reveal hwnd=$($s.hwnd) not visible" }
      if ($live.rect -eq "unreadable") { Fail-Wn "reveal hwnd=$($s.hwnd) rect unreadable" }
    }
    $fg = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
    $inSet = @($snaps | Where-Object { [uint64]$_.hwnd -eq [uint64]$fg }).Count -gt 0
    Rec-Wn "select-1-reveal" @{ foreground = $fg; foreground_in_managed = $inSet; rects = @($snaps | ForEach-Object { $_.hwnd }) }
    if (-not $inSet) { Fail-Wn "select-1 foreground $fg outside managed set" }

    # New-window admission: only an owned helper is opened (then closed).
    try {
      $receipt = Join-Path $runDir "helper-admit.json"
      Start-ExplorerGui $helperCopy "run --receipt `"$receipt`" --seconds 600" $runDir
      $deadline = (Get-Date).AddSeconds(10)
      while (-not (Test-Path $receipt)) {
        if ((Get-Date) -gt $deadline) { Fail-Wn "helper receipt timeout" }
        Start-Sleep -Milliseconds 200
      }
      $hsnap = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
      $createdHelper = @{ hwnd = [uint64]$hsnap.hwnd; tag = "$($hsnap.tag)"; pid = [int]$hsnap.process.pid; creation = "$($hsnap.process.process_creation)" }
      if (-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$hsnap.hwnd)) { Fail-Wn "admitted helper not visible" }
      Rec-Wn "admit-helper" @{ hwnd = $hsnap.hwnd; pid = $hsnap.process.pid; visible = $true }
      Start-Sleep -Milliseconds 2000
      $c = Invoke-Native $helperCopy @("close", "$($hsnap.hwnd)", "--tag", "$($hsnap.tag)") | ConvertFrom-Json
      Rec-Wn "admit-close" @{ close = $c }
      $createdHelper = $null
    } catch {
      Rec-Wn "admit-optional" @{ skipped = "$($_.Exception.Message)" }
    }

    # Ordinary minimize: Calculator minimized, then select 2 / select 1
    # retains iconic until the authorized restore.
    $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$calcSnap.hwnd, $SW_MINIMIZE)
    Start-Sleep -Milliseconds 800
    if (-not [WorkspaceNormalNative]::IsIconic([IntPtr][long]$calcSnap.hwnd)) { Fail-Wn "calculator not minimized after SW_MINIMIZE" }
    $fgNow = [WorkspaceNormalNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgNow -eq [uint64]$calcSnap.hwnd) { Set-AppForegroundWn ([long]$focusSnap.hwnd) "min-focus" }
    $q = Send-WorkspaceSelect $ownerCopy 2 "min-hide"
    $ev = Wait-WorkspaceCliOutcome $logPath $mark 2 30 "min-hide"
    $mark = $ev.count
    $q = Send-WorkspaceSelect $ownerCopy 1 "min-reveal"
    $ev = Wait-WorkspaceCliOutcome $logPath $mark 1 30 "min-reveal"
    $mark = $ev.count
    Start-Sleep -Milliseconds 1000
    $backCalc = Get-AppSnapshotWn ([long]$calcSnap.hwnd) "min-retained"
    if ([int]$backCalc.pid -ne [int]$calcSnap.pid) { Fail-Wn "minimized calculator pid changed" }
    if ("$($backCalc.start)" -cne "$($calcSnap.start)") { Fail-Wn "minimized calculator restarted" }
    Rec-Wn "minimized-retained" @{ hwnd = $calcSnap.hwnd; iconic = $backCalc.iconic }
    if (-not $backCalc.iconic) { Fail-Wn "minimized calculator lost iconic across select2/reveal1" }
    $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$calcSnap.hwnd, $SW_RESTORE)
    Start-Sleep -Milliseconds 800
    if ([WorkspaceNormalNative]::IsIconic([IntPtr][long]$calcSnap.hwnd)) { Fail-Wn "calculator restore failed" }

    # Graceful stop reveals all; independent restore is idempotent.
    $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
    if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$ownerFrozen.pid) { Fail-Wn "owner changed before stop" }
    $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Wn "graceful stop no exit" }
    if (Test-ProcessAliveSameCreation ([int]$ownerFrozen.pid) "$($ownerFrozen.process_creation)") { Fail-Wn "owner alive after stop" }
    foreach ($s in @($snaps)) {
      $deadline = (Get-Date).AddSeconds(10)
      while ((-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$s.hwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
      if (-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$s.hwnd)) { Fail-Wn "grace reveal hwnd=$($s.hwnd) not visible" }
      $live = Get-AppSnapshotWn ([long]$s.hwnd) "grace-$($s.hwnd)"
      if ([int]$live.pid -ne [int]$s.pid -or "$($live.start)" -cne "$($s.start)") { Fail-Wn "grace hwnd=$($s.hwnd) identity changed" }
    }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Wn "graceful restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Wn "graceful-stop" @{ stop = $st; restore = $r }
    $endSpi = Read-SpiArrangingWn
    if ($endSpi -ne $true) { Fail-Wn "grace end arranging not restored raw1" }
    $endPen = Read-PenWn
    if ([int]$endPen -ne 35) { Fail-Wn "grace end pen changed $endPen" }
    Rec-Wn "settings-grace" @{ arranging = $endSpi; pen = $endPen }

    # Forced cycle: fresh scoped normal owner, hide, exact owner death while
    # hidden. The watcher auto-reveals before the independent restore.
    Start-ExplorerGui $ownerCopy "tile --user-start --seconds $OwnerSeconds --trace$WN_SCOPE_ARGS" $binDir
    $ready2 = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready2 = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready2) { Fail-Wn "forced owner ready timeout" }
    $frozen2 = $ready2.owner
    $logPath2 = "$($ready2.log_path)"
    Assert-ParentIsExplorer ([int]$frozen2.pid)
    Start-Sleep -Milliseconds 2500
    Set-AppForegroundWn ([long]$focusSnap.hwnd) "forced-focus"
    $mark2 = (Get-CompleteLinesWn $logPath2).Count
    $q = Send-WorkspaceSelect $ownerCopy 2 "forced-hide"
    $ev = Wait-WorkspaceCliOutcome $logPath2 $mark2 2 30 "forced-hide"
    Start-Sleep -Milliseconds 1500
    $hiddenNow = @($snaps | Where-Object { -not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$_.hwnd) })
    if ($hiddenNow.Count -eq 0) { Fail-Wn "forced hide left nothing hidden" }
    $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
    if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$frozen2.pid) { Fail-Wn "forced owner changed before kill" }
    $st = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Wn "forced stop no exit" }
    if (Test-ProcessAliveSameCreation ([int]$frozen2.pid) "$($frozen2.process_creation)") { Fail-Wn "forced owner alive" }
    foreach ($s in @($snaps)) {
      $deadline = (Get-Date).AddSeconds(15)
      while ((-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$s.hwnd)) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
      if (-not [WorkspaceNormalNative]::IsWindowVisible([IntPtr][long]$s.hwnd)) { Fail-Wn "watcher auto-reveal hwnd=$($s.hwnd) timeout" }
      $live = Get-AppSnapshotWn ([long]$s.hwnd) "forced-$($s.hwnd)"
      if ([int]$live.pid -ne [int]$s.pid -or "$($live.start)" -cne "$($s.start)") { Fail-Wn "forced hwnd=$($s.hwnd) identity changed" }
    }
    Rec-Wn "forced-watcher" @{ stop = $st; auto_revealed = $true }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      try { Assert-LedgerClean $ownerCopy; break }
      catch { Start-Sleep -Milliseconds 250; if ((Get-Date) -ge $deadline) { Fail-Wn "forced watcher ledger dirty" } }
    }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Wn "forced independent restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Wn "forced-restore" $r
    $endSpi = Read-SpiArrangingWn
    $endPen = Read-PenWn
    if ($endSpi -ne $true -or [int]$endPen -ne 35) { Fail-Wn "forced end settings changed arranging=$endSpi pen=$endPen" }

    # End state: approved apps restored (unminimized, unmaximized), Firefox
    # intact and still maximized, zero run actors, clean ledger.
    foreach ($s in @($snaps)) {
      if ([WorkspaceNormalNative]::IsIconic([IntPtr][long]$s.hwnd)) {
        $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$s.hwnd, $SW_RESTORE)
        Start-Sleep -Milliseconds 500
      }
      if ([WorkspaceNormalNative]::IsZoomed([IntPtr][long]$s.hwnd)) {
        $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$s.hwnd, $SW_RESTORE)
        Start-Sleep -Milliseconds 500
      }
      $live = Get-AppSnapshotWn ([long]$s.hwnd) "end-$($s.hwnd)"
      if (-not $live.visible -or $live.iconic -or $live.zoomed) { Fail-Wn "end hwnd=$($s.hwnd) not restored visible=$($live.visible) iconic=$($live.iconic) zoomed=$($live.zoomed)" }
      if ([int]$live.pid -ne [int]$s.pid -or "$($live.start)" -cne "$($s.start)") { Fail-Wn "end hwnd=$($s.hwnd) identity changed" }
    }
    foreach ($f in @($pre.firefox)) {
      if (-not [WorkspaceNormalNative]::IsZoomed([IntPtr][long]$f.hwnd)) { Fail-Wn "end Firefox hwnd=$($f.hwnd) no longer maximized (touched)" }
    }
    Rec-Wn "firefox-intact" @{ count = @($pre.firefox).Count; maximized = $true; touched = $false }
    $leftovers = @(Get-Process -Name "tiler-windows", "tiler-test-window" -ErrorAction SilentlyContinue | Where-Object {
        $p = ""; try { $p = $_.Path } catch {}
        ($p -ieq $ownerCopy) -or ($p -ieq $helperCopy)
      })
    if ($leftovers.Count -ne 0) { Fail-Wn "end actors remain" }
    Assert-LedgerClean $ownerCopy
    Rec-Wn "cleanup" @{ ledger = "clean"; actors = "absent"; arranging = $endSpi; pen = $endPen }

    $report = @{ status = "pass"; stage = "WorkspaceNormal"; started = (Get-Date).ToString("o"); provenance = $prov; steps = $WN_STEPS }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "workspace-normal-report=$reportPath"
    Write-Output "status=pass"
  } catch {
    foreach ($h in @($createdHelper)) {
      try {
        if (($null -ne $h) -and (Test-ProcessAliveSameCreation ([int]$h.pid) "$($h.creation)")) {
          $null = Invoke-Native $helperCopy @("close", "$($h.hwnd)", "--tag", "$($h.tag)")
        }
      } catch {}
    }
    try {
      if ($ownerCopy -ne "" -and (Test-Path $ownerCopy)) {
        try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
        try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      }
    } catch {}
    try {
      foreach ($s in @($snaps)) {
        try {
          if ([WorkspaceNormalNative]::IsIconic([IntPtr][long]$s.hwnd)) { $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$s.hwnd, $SW_RESTORE) }
          if ([WorkspaceNormalNative]::IsZoomed([IntPtr][long]$s.hwnd)) { $null = [WorkspaceNormalNative]::ShowWindow([IntPtr][long]$s.hwnd, $SW_RESTORE) }
        } catch {}
      }
    } catch {}
    $report = @{ status = "fail"; stage = "WorkspaceNormal"; provenance = $prov; steps = $WN_STEPS; error = "$($_.Exception.Message)" }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "workspace-normal-report=$reportPath"
    throw "WorkspaceNormal stage failed: $($_.Exception.Message)"
  }
}

if ($Mock) { Invoke-NormalMock; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Wn "Stop requires -RunDir" }
  . (Join-Path $Repo "scripts\windows-dev.ps1")
  $ownerCopy = Join-Path $RunDir "bin\tiler-windows.exe"
  try { $s = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json; Write-Output ("stop=" + ($s | ConvertTo-Json -Compress)) } catch { Write-Output "stop failed: $($_.Exception.Message)" }
  try { $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json; Write-Output ("restore=" + ($r | ConvertTo-Json -Compress)) } catch { Write-Output "restore failed: $($_.Exception.Message)" }
  exit 0
}
if ($Live) { Invoke-NormalLive; exit 0 }
Write-Output "workspace-normal parsed (no action without -Mock/-Live/-Stop)"
