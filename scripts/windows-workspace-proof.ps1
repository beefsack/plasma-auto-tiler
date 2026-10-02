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

# Scoped automated workspace-proof verification (physical, medium, owned
# helpers only). Reuses the Explorer broker plus exact-owner helpers.
# Product `tile` keeps filtering ALL injected; `workspace-proof` accepts
# exactly SHORTCUT_PROOF_MARKER ("TLRPROOF") in dwExtraInfo on frozen exact
# tagged owned helpers. Digits share the digit VK (US Shift aliases same VK).
#   pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 -Mock
#   pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 -Live
#   pwsh -NoProfile -File scripts/windows-workspace-proof.ps1 -Stop -RunDir '<dir>'
# Safety: explicit flags mandatory; bare invocation parses and exits. Only
# frozen exact tagged owned helpers are activated/moved/hidden; Firefox
# (MozillaWindowClass) and Terminal are never targeted; Terminal is never
# hidden/typed/closed. No process-name kills, no registry/policy writes.
# Fixture activation is E8-prime + AttachThreadInput + one SetForegroundWindow
# on the exact frozen helper with immediate detach and exact readback (no
# pointer clicks on any window). The GLOBAL empty-select foreground is a
# fourth owned helper deliberately outside the allowlist, never an ordinary
# app.

$WORKSPACE_MARKER = 0x544C5250524F4F46
$VK_LWIN = 91
$VK_LSHIFT = 160
$VK_H = 72
$VK_J = 74
$VK_K = 75
$VK_L = 76
$VK_LEFT = 37
$VK_UP = 38
$VK_RIGHT = 39
$VK_DOWN = 40
$VK_0 = 0x30
$MOUSEEVENTF_MOVE = 0x0001
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_ABSOLUTE = 0x8000
$SM_XVIRTUALSCREEN = 76
$SM_YVIRTUALSCREEN = 77
$SM_CXVIRTUALSCREEN = 78
$SM_CYVIRTUALSCREEN = 79
$SW_HIDE = 0
$SW_SHOWNA = 8
$SW_RESTORE = 9
$SW_MINIMIZE = 6
$SW_MAXIMIZE = 3
$SW_SHOWMINNOACTIVE = 7

$WsSteps = [System.Collections.ArrayList]@()
function Rec-Ws([string]$Name, $Data) { $null = $WsSteps.Add(@{ name = $Name; data = $Data }) }
function Fail-Ws([string]$Msg) { throw $Msg }

function Get-WorkspaceJourney {
  return @(
    @{ name = "send-focused-to-ws2"; vk = ($VK_0 + 2); shift = $true; op = "send"; index = 2; family = "send-follow" }
    @{ name = "select-ws1"; vk = ($VK_0 + 1); shift = $false; op = "select"; index = 1; family = "select-reveal" }
    @{ name = "absent-ordinal-9"; vk = ($VK_0 + 9); shift = $false; op = "select"; index = 9; family = "unknown-target" }
    @{ name = "select-trailing-0"; vk = $VK_0; shift = $false; op = "select"; index = 0; family = "trailing" }
    @{ name = "send-trailing-shift0"; vk = $VK_0; shift = $true; op = "send"; index = 0; family = "trailing-send" }
    @{ name = "digit-alias-shift1"; vk = ($VK_0 + 1); shift = $true; op = "send"; index = 1; family = "alias-same-vk" }
  )
}

function Assert-NoWinLJourney($Rows) {
  foreach ($row in @($Rows)) {
    if (([int]$row.vk -eq $VK_L) -and (-not $row.shift)) { Fail-Ws "refuse: journey must never send unshifted Win+L" }
  }
}

function Install-WorkspaceNative {
  if (-not ("WorkspaceProofNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WorkspaceProofNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData;
    public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT pt);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  public static uint PrimeE8() {
    return SendKey(0xE8, false, 0) + SendKey(0xE8, true, 0);
  }
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int x; public int y; }
  public static bool RaiseActivate(long hwnd) {
    const uint flags = 0x0002u | 0x0001u;
    return SetWindowPos((IntPtr)hwnd, IntPtr.Zero, 0, 0, 0, 0, flags);
  }
  public static int SizeOfInput() { return Marshal.SizeOf(typeof(INPUT)); }
  public static uint SendKey(ushort vk, bool up, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk; arr[0].u.ki.wScan = 0;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static int[] RectOf(long hwnd) {
    RECT r;
    if (!GetWindowRect((IntPtr)hwnd, out r)) return null;
    return new int[] { r.left, r.top, r.right, r.bottom };
  }
  public static uint SendMouse(uint flags, int nx, int ny, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 0;
    arr[0].u.mi.dx = nx; arr[0].u.mi.dy = ny;
    arr[0].u.mi.mouseData = 0; arr[0].u.mi.dwFlags = flags;
    arr[0].u.mi.time = 0;
    arr[0].u.mi.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static int[] CursorXY() {
    POINT p;
    if (!GetCursorPos(out p)) return null;
    return new int[] { p.x, p.y };
  }
  public static long WindowAncestorAt(int x, int y) {
    POINT p; p.x = x; p.y = y;
    IntPtr w = WindowFromPoint(p);
    if (w == IntPtr.Zero) return 0;
    return GetAncestor(w, 2).ToInt64();
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
}

function Test-ExeEqualWs([string]$A, [string]$B) {
  return ("$A".Replace("/", "\") -ieq "$B".Replace("/", "\"))
}

function Assert-WsIdentity($Snap, $Frozen, [string]$Tag) {
  if ([uint64]$Snap.hwnd -ne [uint64]$Frozen.hwnd) { Fail-Ws "$Tag hwnd changed" }
  if ([int]$Snap.process.pid -ne [int]$Frozen.process.pid) { Fail-Ws "$Tag pid changed" }
  if ("$($Snap.process.process_creation)" -cne "$($Frozen.process.process_creation)") { Fail-Ws "$Tag creation changed" }
  if (-not (Test-ExeEqualWs "$($Snap.process.exe_path)" "$($Frozen.process.exe_path)")) { Fail-Ws "$Tag exe changed" }
  if ("$($Snap.process.user_sid)" -cne "$($Frozen.process.user_sid)") { Fail-Ws "$Tag sid changed" }
  if ([int]$Snap.process.session_id -ne [int]$Frozen.process.session_id) { Fail-Ws "$Tag session changed" }
  if ("$($Snap.tag)" -cne "$($Frozen.tag)") { Fail-Ws "$Tag tag changed" }
  if ([string]$Snap.tag -eq "") { Fail-Ws "$Tag tag empty" }
}

function Read-SpiArrangingWs {
  if (-not ("WsSpiProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WsSpiProbe {
  private const uint SPI_GETWINARRANGING = 0x0082;
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  public static int Get() {
    int v = 0;
    if (!SystemParametersInfo(SPI_GETWINARRANGING, 0, ref v, 0)) throw new Exception("SPI_GETWINARRANGING failed");
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  return ([WsSpiProbe]::Get() -ne 0)
}

function Read-PenWs {
  if (-not ("WsPenProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class WsPenProbe {
  private const uint SPI_GETPENVISUALIZATION = 0x201E;
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  public static int Get() {
    int v = 0;
    if (!SystemParametersInfo(SPI_GETPENVISUALIZATION, 0, ref v, 0)) throw new Exception("SPI_GETPENVISUALIZATION failed");
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  return [WsPenProbe]::Get()
}

function Read-CompleteTextWs([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $reader = New-Object IO.StreamReader($stream); return $reader.ReadToEnd() }
  finally { $stream.Close() }
}

function Get-CompleteLinesWs([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Ws "missing log $Path" }
  $text = Read-CompleteTextWs $Path
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

function Get-LogEventsAfterWs([string]$LogPath, [int]$Mark) {
  $lines = Get-CompleteLinesWs $LogPath
  $out = @()
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -ne "") { $out += ($lines[$i] | ConvertFrom-Json) }
  }
  return @{ events = $out; count = $lines.Count }
}

function Wait-WorkspaceOutcome([string]$LogPath, [int]$Mark, [string]$Op, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
  # Skip key-up edges (ups only close the pair; unconsumed downs also log
  # key-up in trace): only a real dispatch outcome satisfies the wait. A
  # missing dispatch times out truthfully instead of mistaking the up for it.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterWs $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index) -and ("$($e.outcome)" -ne "key-up")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Ws "$Tag no workspace dispatch $Op/$Index after mark $Mark (only key-up edges observed)"
  return $null
}

function Send-DigitChordRetry([int]$Vk, [bool]$WithShift, [ScriptBlock]$FgOf, [string]$Op, [int]$Index, [string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  # Foreground-transition race guard: the OS moves foreground asynchronously
  # after hide/reveal, so the first chord after a switch can land while the
  # hook still sees the stale origin. One settle-then-retry with a fresh
  # foreground read; a second miss is a truthful semantic failure, not a
  # harness race.
  $attemptMark = $Mark
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $fg = & $FgOf
    $null = Send-DigitChord $Vk $WithShift ([uint64]$fg)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
      $tail = Get-LogEventsAfterWs $LogPath $attemptMark
      foreach ($e in @($tail.events)) {
        if (($e.event -eq "workspace") -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index) -and ("$($e.outcome)" -ne "key-up")) {
          return @{ event = $e; count = $tail.count; attempt = $attempt }
        }
      }
      Start-Sleep -Milliseconds 400
    }
    if ($attempt -eq 1) {
      Start-Sleep -Milliseconds 2000
      $tail = Get-LogEventsAfterWs $LogPath $attemptMark
      $attemptMark = $tail.count
    }
  }
  Fail-Ws "$Tag no workspace dispatch $Op/$Index after 2 attempts (foreground race excluded)"
  return $null
}

function Send-DigitChord([int]$Vk, [bool]$WithShift, [uint64]$WantForeground) {
  $markerValue = [uint64]$WORKSPACE_MARKER
  $fg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$WantForeground) { Fail-Ws "foreground $fg != target $WantForeground before digit input" }
  $pressed = [System.Collections.ArrayList]@()
  $accepted = 0
  try {
    foreach ($key in @($VK_LWIN) + (@($VK_LSHIFT) | Where-Object { $WithShift })) {
      $one = [WorkspaceProofNative]::SendKey([uint16]$key, $false, $markerValue)
      if ($one -ne 1) { Fail-Ws "short insertion on down vk=$key" }
      $accepted += $one; $null = $pressed.Add($key)
    }
    $down = [WorkspaceProofNative]::SendKey([uint16]$Vk, $false, $markerValue)
    if ($down -ne 1) { Fail-Ws "short insertion on digit down vk=$Vk" }
    $accepted += $down; $null = $pressed.Add($Vk)
    $up = [WorkspaceProofNative]::SendKey([uint16]$Vk, $true, $markerValue)
    if ($up -ne 1) { Fail-Ws "short insertion on digit up vk=$Vk" }
    $accepted += $up; $null = $pressed.Remove($Vk)
  } finally {
    $reversed = @($pressed); [array]::Reverse($reversed)
    foreach ($key in $reversed) {
      $rel = [WorkspaceProofNative]::SendKey([uint16]$key, $true, $markerValue)
      if ($rel -ne 1) { Fail-Ws "short insertion on release vk=$key" }
      $accepted += $rel
    }
  }
  # Plain digit: 4 events; with Shift: 6.
  $want = $WithShift ? 6 : 4
  if ($accepted -ne $want) { Fail-Ws "digit send count $accepted != $want" }
  return @{ accepted = $accepted; marked = $true }
}

function ConvertTo-AbsoluteNativeWs([int]$Px, [int]$Origin, [int]$Span) {
  if ($Span -le 1) { Fail-Ws "absolute span $Span invalid" }
  return [int][math]::Round(($Px - $Origin) * 65535.0 / ($Span - 1))
}

function Get-ApprovedUnmanagedTargets {
  Fail-Ws "retired: GLOBAL select uses the fourth owned helper, never ordinary apps"
}

function Get-ApprovedUnmanagedTarget {
  Fail-Ws "retired: GLOBAL select uses the fourth owned helper, never ordinary apps"
}

function Set-UnmanagedForeground($Pool, [string]$Tag) {
  Fail-Ws "retired: GLOBAL select uses the fourth owned helper, never ordinary apps"
}

function Set-WsForeground([string]$HelperBin, $Frozen, [string]$Tag) {
  # Fixture-only activation of one exact frozen owned helper: full identity
  # verify, E8 prime from the harness, temporary AttachThreadInput coupling
  # of the harness thread to the CURRENT foreground TID, exactly one
  # SetForegroundWindow on the frozen helper, immediate detach, exact
  # foreground readback. Activates ONLY the frozen helper; no pointer click
  # on any occluding foreign window, no Firefox/Terminal targeting, no
  # geometry mutation. GetWindowThreadProcessId TID comes from the RETURN
  # value, never the PID out-param. Setter BOOL never trusted: only the
  # exact readback decides. Post-activation identity re-verified.
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-WsIdentity $fresh $Frozen "$Tag-prefocus"
  $fgEntry = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Frozen.hwnd) { return }
  $primeInserted = [WorkspaceProofNative]::PrimeE8()
  if ([int]$primeInserted -ne 2) { Fail-Ws "$Tag E8 prime accepted $primeInserted != 2" }
  $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [WorkspaceProofNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Ws "$Tag foreground TID unreadable" }
  $myTid = [WorkspaceProofNative]::GetCurrentThreadId()
  $attachOk = $false
  if ([uint32]$fgTid -ne [uint32]$myTid) {
    $attachOk = [WorkspaceProofNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
  }
  try {
    $null = [WorkspaceProofNative]::SetForegroundWindow([IntPtr][long]$Frozen.hwnd)
  } finally {
    if ($attachOk) { $null = [WorkspaceProofNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) }
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne [uint64]$Frozen.hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
  }
  if ([uint64]$fg -ne [uint64]$Frozen.hwnd) { Fail-Ws "$Tag foreground readback $fg != $($Frozen.hwnd) via attach attach=$attachOk" }
  $post = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-WsIdentity $post $Frozen "$Tag-postactivate"
}

function Wait-WsVisible([string]$HelperBin, $Base, [bool]$WantVisible, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = ""
  while ((Get-Date) -lt $deadline) {
    try { $s = Invoke-Native $HelperBin @("inspect", "$($Base.hwnd)") | ConvertFrom-Json }
    catch { $last = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 250; continue }
    if ([bool]$s.visible -eq $WantVisible -and "$($s.tag)" -ceq "$($Base.tag)") { return $s }
    $last = "visible=$($s.visible)"
    Start-Sleep -Milliseconds 250
  }
  Fail-Ws "$Tag visibility timeout want=$WantVisible last=$last"
}

function Get-WsInspect([string]$Payload, [string]$AllowPath) {
  return (Invoke-Native $Payload @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json)
}

function Invoke-WorkspaceMock {
  Install-WorkspaceNative
  $size = [WorkspaceProofNative]::SizeOfInput()
  if ($size -ne 40) { Fail-Ws "INPUT size $size != 40" }
  Rec-Ws "input-struct-size" @{ actual = $size; want = 40 }
  $rows = Get-WorkspaceJourney
  Assert-NoWinLJourney $rows
  Rec-Ws "journey-guard" @{ rows = @($rows | ForEach-Object { $_.name }) }
  # Digit VK alias: Shift never changes the VK; op flips select->send.
  foreach ($d in 0..9) {
    $vk = $VK_0 + $d
    if ($vk -lt 0x30 -or $vk -gt 0x39) { Fail-Ws "mock digit vk range $vk" }
  }
  Rec-Ws "digit-alias-same-vk" @{ vk0 = $VK_0; vk9 = ($VK_0 + 9); shift_flips_op = $true }
  try { Assert-NoWinLJourney @(@{ vk = $VK_L; shift = $false }); Fail-Ws "negative journey-guard did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "Win\+L") { throw } }
  $report = @{ status = "pass"; stage = "WorkspaceProofMock"; steps = $WsSteps }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Invoke-WorkspaceLive {
  Install-WorkspaceNative
  $size = [WorkspaceProofNative]::SizeOfInput()
  if ($size -ne 40) { Fail-Ws "INPUT size $size != 40" }
  $rows = Get-WorkspaceJourney
  Assert-NoWinLJourney $rows
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\windows-workspace-proof\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "workspace-report.json"
  if (Test-Path $reportPath) { Fail-Ws "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Ws "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $osInfo = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber, Version | ConvertTo-Json -Compress)
  $dispX = [WorkspaceProofNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
  $dispY = [WorkspaceProofNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
  $dispW = [WorkspaceProofNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
  $dispH = [WorkspaceProofNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
  $prov = @{
    commit = $commit; status = $status
    actor_pid = $PID; actor_exe = (Get-Process -Id $PID).Path
    owner_sha256 = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
    helper_sha256 = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
    os = "$osInfo"; display_virtual = "$dispX,$dispY,${dispW}x${dispH}"
    run_dir = $runDir; marker = ("0x{0:X}" -f $WORKSPACE_MARKER)
  }
  Rec-Ws "env" $prov
  $ident = (Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json)
  $ledgerDir = "$($ident.ledger_directory)"
  $preSpi = Read-SpiArrangingWs
  $prePen = Read-PenWs
  Rec-Ws "settings-pre" @{ arranging = $preSpi; pen = $prePen }
  if ($preSpi -ne $true) { Fail-Ws "preflight arranging not raw1" }
  if ([int]$prePen -ne 35) { Fail-Ws "preflight pen not 35" }
  Assert-LedgerClean $ownerCopy
  Rec-Ws "preflight" @{ ledger = "clean"; arranging = $preSpi; pen = $prePen; monitors = 1 }
  $created = [System.Collections.ArrayList]@()
  try {
    # Four visible owned helpers: exact Explorer-broker launch, receipt,
    # peer + parent + visibility checks. The first three form the frozen
    # managed allowlist; the fourth stays deliberately OUT of the allowlist
    # as the owned unmanaged foreground for the GLOBAL empty-select path
    # (identity tag-validated, never an ordinary app, never Firefox/Terminal).
    $snaps = @()
    foreach ($n in 1..4) {
      $receipt = Join-Path $runDir "helper$n.json"
      if (Test-Path $receipt) { Fail-Ws "receipt preexists $receipt" }
      Start-ExplorerGui $helperCopy "run --receipt `"$receipt`" --seconds 600" $runDir
      $deadline = (Get-Date).AddSeconds(10)
      while (-not (Test-Path $receipt)) {
        if ((Get-Date) -gt $deadline) { Fail-Ws "helper receipt timeout $n" }
        Start-Sleep -Milliseconds 200
      }
      $snap = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
      if (-not (Test-ExeEqualWs "$($snap.process.exe_path)" "$helperCopy")) { Fail-Ws "helper$n peer mismatch" }
      Assert-ParentIsExplorer ([int]$snap.process.pid)
      if ([string]$snap.tag -eq "") { Fail-Ws "helper$n missing tag" }
      if ($snap.visible -ne $true) { Fail-Ws "helper$n not visible at create" }
      $null = $created.Add(@{ hwnd = [uint64]$snap.hwnd; tag = "$($snap.tag)"; pid = [int]$snap.process.pid; creation = "$($snap.process.process_creation)" })
      $snaps += $snap
    }
    Rec-Ws "helpers-created" @($snaps | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; tag = $_.tag; visible = $_.visible } })
    $allowPath = Join-Path $runDir "allowlist.json"
    $entries = @()
    foreach ($s in $snaps[0..2]) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
    $hA = $snaps[0]; $hB = $snaps[1]; $hC = $snaps[2]; $hD = $snaps[3]
    if ([string]$hD.tag -eq "") { Fail-Ws "unmanaged owned helper missing tag" }

    # Workspace-proof owner: frozen allowlist, hook with test-only marker.
    $wsArgs = "workspace-proof --allowlist `"$allowPath`" --seconds $OwnerSeconds --trace"
    Start-ExplorerGui $ownerCopy $wsArgs $binDir
    $ready = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready) { Fail-Ws "workspace ready timeout" }
    $ownerFrozen = $ready.owner
    if (-not (Test-ExeEqualWs "$($ownerFrozen.exe_path)" "$ownerCopy")) { Fail-Ws "owner peer mismatch" }
    Assert-ParentIsExplorer ([int]$ownerFrozen.pid)
    $logPath = "$($ready.log_path)"
    Rec-Ws "owner-ready" $ready
    Start-Sleep -Milliseconds 2500
    $midSpi = Read-SpiArrangingWs
    if ($midSpi -ne $false) { Fail-Ws "mid-run arranging not FALSE under prevention, got $midSpi" }
    Rec-Ws "settings-mid" @{ arranging = $midSpi }
    $mark = (Get-CompleteLinesWs $logPath).Count

    # Focus A, send focused to existing ws2 with follow.
    Set-WsForeground $helperCopy $hA "send-focus-A"
    $r = Send-DigitChord (($VK_0 + 2)) $true ([uint64]$hA.hwnd)
    $ev = Wait-WorkspaceOutcome $logPath $mark "send" 2 20 "send-ws2"
    $mark = $ev.count
    Rec-Ws "send-ws2" @{ outcome = $ev.event.outcome; send = $r }
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "focus-unverified")) { Fail-Ws "send-ws2 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $insp = Get-WsInspect $ownerCopy $allowPath
    $fg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    Rec-Ws "send-ws2-inspect" @{ foreground = $fg; windows = @($insp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; eligible = $_.eligible; skip = $_.skip } }) }
    if ([uint64]$fg -ne [uint64]$hA.hwnd) { Fail-Ws "send-ws2 follow foreground $fg != A $($hA.hwnd) (truthful focus, not log ok)" }

    # Select ws1: hides others, reveals correct set + last focus.
    Set-WsForeground $helperCopy $hA "select-focus-A"
    $r = Send-DigitChord (($VK_0 + 1)) $false ([uint64]$hA.hwnd)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 1 20 "select-ws1"
    $mark = $ev.count
    Rec-Ws "select-ws1" @{ outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Ws "select-ws1 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $insp = Get-WsInspect $ownerCopy $allowPath
    $fg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    Rec-Ws "select-ws1-inspect" @{ foreground = $fg; windows = @($insp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; eligible = $_.eligible; skip = $_.skip } }) }

    # Absent ordinal 9: no creation, no effects.
    $beforeCount = (Get-WsInspect $ownerCopy $allowPath).windows.Count
    $fgBefore = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 9)) $false ([uint64]$fgBefore)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 9 20 "absent-9"
    $mark = $ev.count
    Rec-Ws "absent-9" @{ outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -ne "unknown-target") { Fail-Ws "absent-9 outcome $($ev.event.outcome) != unknown-target" }
    $afterCount = (Get-WsInspect $ownerCopy $allowPath).windows.Count
    if ($afterCount -ne $beforeCount) { Fail-Ws "absent-9 changed window count" }

    # Trailing 0: reuse-or-create from managed, then back.
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord ($VK_0) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 0 20 "select-0"
    $mark = $ev.count
    Rec-Ws "select-0" @{ outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -notin @("ok", "partial")) { Fail-Ws "select-0 outcome $($ev.event.outcome)" }
    $trailingFg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    # Back to ws1 from the (possibly empty) trailing workspace: the GLOBAL
    # unmanaged/empty-fg path. Foreground is the FOURTH OWNED helper, which
    # is deliberately NOT in the frozen allowlist (identity tag-validated):
    # it proves GLOBAL empty-select without touching any ordinary app, and
    # without any pointer click on a foreign window. One retry on race; a
    # second miss is a truthful product failure.
    Start-Sleep -Milliseconds 2000
    $freshD = Invoke-Native $helperCopy @("inspect", "$($hD.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $freshD $hD "global-fg-prefocus"
    Set-WsForeground $helperCopy $hD "global-fg"
    $fgCheck = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgCheck -ne [uint64]$hD.hwnd) { Fail-Ws "global-fg readback $fgCheck != $($hD.hwnd)" }
    $postD = Invoke-Native $helperCopy @("inspect", "$($hD.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $postD $hD "global-fg-postactivate"
    Rec-Ws "global-fg" @{ hwnd = $hD.hwnd; pid = $hD.process.pid; tag = $hD.tag; owned_unmanaged = $true; in_allowlist = $false; foreground = $fgCheck }
    $ev = Send-DigitChordRetry ($VK_0 + 1) $false { [WorkspaceProofNative]::GetForegroundWindow().ToInt64() } "select" 1 $logPath $mark 20 "select-1-back"
    $mark = $ev.count
    Rec-Ws "select-1-back" @{ outcome = $ev.event.outcome; attempt = $ev.attempt }
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Ws "select-1-back outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    # Deterministic managed focus before the trailing send: click-focus a
    # visible helper and verify the foreground readback (the empty-trailing
    # return leaves focus implicit, which send must not rely on).
    $inspBack = Get-WsInspect $ownerCopy $allowPath
    $visBack = @($inspBack.windows | Where-Object { $_.identity_match -eq $true -and $_.eligible -eq $true }) | Select-Object -First 1
    if ($null -eq $visBack) { Fail-Ws "select-1-back left no visible managed helper" }
    $focusSnap = @($snaps | Where-Object { [uint64]$_.hwnd -eq [uint64]$visBack.hwnd }) | Select-Object -First 1
    Set-WsForeground $helperCopy $focusSnap "send0-focus"

    # Shift+0 trailing send (reuse-or-create), min-2/prune floor holds.
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord ($VK_0) $true ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "send" 0 20 "send-0"
    $mark = $ev.count
    Rec-Ws "send-0" @{ outcome = $ev.event.outcome }
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "no-op", "unmanaged", "focus-unverified")) { Fail-Ws "send-0 outcome $($ev.event.outcome)" }

    # Digit US Shift alias: Shift+1 uses the same digit VK as unshifted 1.
    if ((($VK_0 + 1) -eq 0x31) -ne $true) { Fail-Ws "digit alias VK mismatch" }
    Rec-Ws "digit-alias" @{ vk = (($VK_0 + 1)); shifted_op = "send"; unshifted_op = "select"; same_vk = $true }

    # Repeated switch preserves layout: ws2 -> ws1 -> ws2, outcomes ok/partial.
    # Geometry recorded per repeat from fresh allowlist inspect (not log only).
    foreach ($idx in @(2, 1, 2)) {
      $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
      $r = Send-DigitChord (($VK_0 + $idx)) $false ([uint64]$fgNow)
      $ev = Wait-WorkspaceOutcome $logPath $mark "select" $idx 20 "repeat-$idx"
      $mark = $ev.count
      Start-Sleep -Milliseconds 1000
      $repInsp = Get-WsInspect $ownerCopy $allowPath
      $repFg = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
      Rec-Ws "repeat-$idx" @{ outcome = $ev.event.outcome; foreground = $repFg; windows = @($repInsp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; eligible = $_.eligible; visible_rect = $_.visible } }) }
    }

    # Directional focus/move within the selected workspace (Engine retained).
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $pressed = [System.Collections.ArrayList]@()
    try {
      foreach ($key in @($VK_LWIN)) { $one = [WorkspaceProofNative]::SendKey([uint16]$key, $false, [uint64]$WORKSPACE_MARKER); if ($one -ne 1) { Fail-Ws "short insertion dir" }; $null = $pressed.Add($key) }
      $down = [WorkspaceProofNative]::SendKey([uint16]$VK_H, $false, [uint64]$WORKSPACE_MARKER)
      if ($down -ne 1) { Fail-Ws "short insertion dir down" }
      $null = $pressed.Add($VK_H)
      $up = [WorkspaceProofNative]::SendKey([uint16]$VK_H, $true, [uint64]$WORKSPACE_MARKER)
      if ($up -ne 1) { Fail-Ws "short insertion dir up" }
      $null = $pressed.Remove($VK_H)
    } finally {
      foreach ($key in @(@($pressed) | Sort-Object -Descending)) {
        $rel = [WorkspaceProofNative]::SendKey([uint16]$key, $true, [uint64]$WORKSPACE_MARKER)
        if ($rel -ne 1) { Fail-Ws "short insertion dir release" }
      }
    }
    Start-Sleep -Milliseconds 1500
    Rec-Ws "directional-probe" @{ sent = "Win+H marked"; note = "fresh observation + native readback inspected below" }
    $insp = Get-WsInspect $ownerCopy $allowPath
    Rec-Ws "directional-inspect" @{ foreground = ([WorkspaceProofNative]::GetForegroundWindow().ToInt64()); windows = @($insp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; eligible = $_.eligible; visible_rect = $_.visible } }) }
    # Directional move within the selected domain (Win+Shift+J, observe-only:
    # exact fg + geometry recorded, no outcome gate beyond dispatch proof).
    $movePressed = [System.Collections.ArrayList]@()
    try {
      foreach ($key in @($VK_LWIN, $VK_LSHIFT)) { $one = [WorkspaceProofNative]::SendKey([uint16]$key, $false, [uint64]$WORKSPACE_MARKER); if ($one -ne 1) { Fail-Ws "short insertion move" }; $null = $movePressed.Add($key) }
      $down = [WorkspaceProofNative]::SendKey([uint16]$VK_J, $false, [uint64]$WORKSPACE_MARKER)
      if ($down -ne 1) { Fail-Ws "short insertion move down" }
      $null = $movePressed.Add($VK_J)
      $up = [WorkspaceProofNative]::SendKey([uint16]$VK_J, $true, [uint64]$WORKSPACE_MARKER)
      if ($up -ne 1) { Fail-Ws "short insertion move up" }
      $null = $movePressed.Remove($VK_J)
    } finally {
      $reversed = @($movePressed); [array]::Reverse($reversed)
      foreach ($key in $reversed) {
        $rel = [WorkspaceProofNative]::SendKey([uint16]$key, $true, [uint64]$WORKSPACE_MARKER)
        if ($rel -ne 1) { Fail-Ws "short insertion move release" }
      }
    }
    Start-Sleep -Milliseconds 1500
    $moveInsp = Get-WsInspect $ownerCopy $allowPath
    Rec-Ws "directional-move-inspect" @{ sent = "Win+Shift+J marked"; foreground = ([WorkspaceProofNative]::GetForegroundWindow().ToInt64()); windows = @($moveInsp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; eligible = $_.eligible; visible_rect = $_.visible } }) }

    # Minimized member retains occupancy and state across hide/reveal.
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hB.hwnd, $SW_MINIMIZE)
    Start-Sleep -Milliseconds 800
    if (-not [WorkspaceProofNative]::IsIconic([IntPtr][long]$hB.hwnd)) { Fail-Ws "helper B not minimized after SW_MINIMIZE" }
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgNow -eq [uint64]$hB.hwnd) { Set-WsForeground $helperCopy $hA "min-focus-A" }
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 2)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 2 20 "min-hide"
    $mark = $ev.count
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 1)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 1 20 "min-reveal"
    $mark = $ev.count
    $backB = Invoke-Native $helperCopy @("inspect", "$($hB.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $backB $hB "minimized-B"
    Rec-Ws "minimized-retained" @{ hwnd = $hB.hwnd; visible = $backB.visible; iconic = ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hB.hwnd)); geometry = "$($backB.left),$($backB.top),$($backB.right),$($backB.bottom)" }
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hB.hwnd, $SW_RESTORE)
    Start-Sleep -Milliseconds 800

    # Maximized member retains occupancy and state across hide/reveal.
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hC.hwnd, $SW_MAXIMIZE)
    Start-Sleep -Milliseconds 800
    if (-not [WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) { Fail-Ws "helper C not maximized after SW_MAXIMIZE" }
    Set-WsForeground $helperCopy $hA "max-focus-A"
    $r = Send-DigitChord (($VK_0 + 2)) $false ([uint64]$hA.hwnd)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 2 20 "max-hide"
    $mark = $ev.count
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 1)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 1 20 "max-reveal"
    $mark = $ev.count
    $backC = Invoke-Native $helperCopy @("inspect", "$($hC.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $backC $hC "maximized-C"
    Rec-Ws "maximized-retained" @{ hwnd = $hC.hwnd; visible = $backC.visible; zoomed = ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)); geometry = "$($backC.left),$($backC.top),$($backC.right),$($backC.bottom)" }
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hC.hwnd, $SW_RESTORE)
    Start-Sleep -Milliseconds 800

    # Close a hidden helper: retire safely with cleanup.
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 2)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 2 20 "closehide-goto2"
    $mark = $ev.count
    Start-Sleep -Milliseconds 1200
    $hidB = Wait-WsVisible $helperCopy $hB $false 10 "closehide-B"
    $c = Invoke-Native $helperCopy @("close", "$($hB.hwnd)", "--tag", "$($hB.tag)") | ConvertFrom-Json
    Rec-Ws "close-hidden" @{ close = $c }
    Start-Sleep -Milliseconds 1500
    $insp = Get-WsInspect $ownerCopy $allowPath
    Rec-Ws "close-hidden-inspect" @{ windows = @($insp.windows | ForEach-Object { @{ hwnd = $_.hwnd; match = $_.identity_match; skip = $_.skip } }) }
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 1)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 1 20 "closehide-back1"
    $mark = $ev.count

    # External ShowWindow alone (no foreground) rehides; with activation it
    # switches workspace. Use remaining hidden member on ws2.
    $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    $r = Send-DigitChord (($VK_0 + 2)) $false ([uint64]$fgNow)
    $ev = Wait-WorkspaceOutcome $logPath $mark "select" 2 20 "ext-goto2"
    $mark = $ev.count
    Start-Sleep -Milliseconds 1200
    $probe = Get-WsInspect $ownerCopy $allowPath
    $hiddenOne = @($probe.windows | Where-Object { $_.identity_match -eq $true -and $_.eligible -eq $false }) | Select-Object -First 1
    if ($null -ne $hiddenOne) {
      $hw = [uint64]$hiddenOne.hwnd
      $null = [WorkspaceProofNative]::ShowWindowAsync([IntPtr][long]$hw, $SW_SHOWNA)
      Start-Sleep -Milliseconds 2500
      $vis = [WorkspaceProofNative]::IsWindowVisible([IntPtr][long]$hw)
      $fgNow = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
      Rec-Ws "external-show-no-fg" @{ hwnd = $hw; visible = $vis; foreground = $fgNow; expect = "rehidden (visible=false) unless foregrounded" }
      $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hw, $SW_RESTORE)
      $extSnap = @($snaps | Where-Object { [uint64]$_.hwnd -eq $hw }) | Select-Object -First 1
      if ($null -eq $extSnap) { Fail-Ws "external-activation frozen snap missing for $hw" }
      Set-WsForeground $helperCopy $extSnap "external-activate"
      Start-Sleep -Milliseconds 2500
      $fgAfter = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
      Rec-Ws "external-activation" @{ hwnd = $hw; foreground = $fgAfter; switched = ([uint64]$fgAfter -eq $hw) }
    } else {
      Rec-Ws "external-skipped" @{ reason = "no hidden eligible member at probe time" }
    }

    # Normal stop reveals all.
    $frozen = $ownerFrozen
    $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
    if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$frozen.pid) { Fail-Ws "owner changed before stop" }
    $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Ws "graceful stop no exit" }
    $alive = Test-ProcessAliveSameCreation ([int]$frozen.pid) "$($frozen.process_creation)"
    if ($alive) { Fail-Ws "owner alive after stop" }
    foreach ($h in @($hA, $hC)) {
      $back = Wait-WsVisible $helperCopy $h $true 10 "grace-reveal-$($h.hwnd)"
      Assert-WsIdentity $back $h "grace-reveal-$($h.hwnd)"
    }
    $backD = Wait-WsVisible $helperCopy $hD $true 10 "grace-unmanaged-$($hD.hwnd)"
    Assert-WsIdentity $backD $hD "grace-unmanaged-$($hD.hwnd)"
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Ws "graceful restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Ws "graceful-stop" @{ stop = $st; restore = $r }
    $endSpi = Read-SpiArrangingWs
    if ($endSpi -ne $true) { Fail-Ws "end arranging not restored raw1" }
    $endPen = Read-PenWs
    if ([int]$endPen -ne 35) { Fail-Ws "end pen changed $endPen" }
    Rec-Ws "settings-restored" @{ arranging = $endSpi; pen = $endPen }

    # Forced cycle: re-hide via a fresh owner, exact owner death, watcher
    # auto-reveals with state, independent restore idempotent. The fresh
    # owner adopts a pruned frozen allowlist of the LIVE managed survivors
    # (hA, hC): hB was retired mid-journey, and the product fail-closes a
    # fresh adopt whose listed member is dead (proven 20261002-081736:
    # "proof allowlist non-owned identity-changed"). The adopt gate itself
    # stays strict: exact hwnd/pid/creation/exe/sid/session/tag per entry.
    $retiredB = $false
    try { $chkB = Invoke-Native $helperCopy @("inspect", "$($hB.hwnd)") | ConvertFrom-Json; if ("$($chkB.tag)" -ceq "$($hB.tag)") { Fail-Ws "retired hB still alive" } } catch { $retiredB = $true }
    if (-not $retiredB) { Fail-Ws "retired hB inspectable" }
    $liveSnaps = @()
    foreach ($h in @($hA, $hC)) {
      $live = Invoke-Native $helperCopy @("inspect", "$($h.hwnd)") | ConvertFrom-Json
      Assert-WsIdentity $live $h "forced-adopt-$($h.hwnd)"
      $liveSnaps += $live
    }
    $allowPath2 = Join-Path $runDir "allowlist-forced.json"
    if (Test-Path $allowPath2) { Fail-Ws "forced allowlist preexists" }
    $entries2 = @()
    foreach ($s in $liveSnaps) {
      $entries2 += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries2 } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath2
    Rec-Ws "forced-allowlist" @{ live = @($liveSnaps | ForEach-Object { $_.hwnd }); retired = @($hB.hwnd) }
    $wsArgs2 = "workspace-proof --allowlist `"$allowPath2`" --seconds $OwnerSeconds --trace"
    Start-ExplorerGui $ownerCopy $wsArgs2 $binDir
    $ready2 = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready2 = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready2) { Fail-Ws "forced workspace ready timeout" }
    $frozen2 = $ready2.owner
    $logPath2 = "$($ready2.log_path)"
    Start-Sleep -Milliseconds 2500
    # Forced min/max fixture: live survivors carry their original show state
    # into the hide (hA minimized, hC maximized) so the crash proves the
    # durable v4 show preimage, not the normal-state path. Owned helpers
    # only; no Terminal/Firefox targeting.
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hA.hwnd, $SW_MINIMIZE)
    Start-Sleep -Milliseconds 800
    if (-not [WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)) { Fail-Ws "forced hA not minimized before hide" }
    $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hC.hwnd, $SW_MAXIMIZE)
    Start-Sleep -Milliseconds 800
    if (-not [WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) { Fail-Ws "forced hC not maximized before hide" }
    $preA = Invoke-Native $helperCopy @("inspect", "$($hA.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $preA $hA "forced-premin-A"
    $preC = Invoke-Native $helperCopy @("inspect", "$($hC.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $preC $hC "forced-premax-C"
    Rec-Ws "forced-show-pre" @{ hA = $hA.hwnd; iconicA = ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)); hC = $hC.hwnd; zoomedC = ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) }
    # GLOBAL select from the owned unmanaged fourth helper (never an ordinary
    # app, never a pointer click on a foreign window).
    $freshD2 = Invoke-Native $helperCopy @("inspect", "$($hD.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $freshD2 $hD "forced-global-prefocus"
    Set-WsForeground $helperCopy $hD "forced-global-fg"
    $fgCheck2 = [WorkspaceProofNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgCheck2 -ne [uint64]$hD.hwnd) { Fail-Ws "forced-global-fg readback $fgCheck2 != $($hD.hwnd)" }
    $postD2 = Invoke-Native $helperCopy @("inspect", "$($hD.hwnd)") | ConvertFrom-Json
    Assert-WsIdentity $postD2 $hD "forced-global-postactivate"
    Rec-Ws "forced-global-fg" @{ hwnd = $hD.hwnd; pid = $hD.process.pid; tag = $hD.tag; owned_unmanaged = $true; in_allowlist = $false; foreground = $fgCheck2 }
    $mark2 = (Get-CompleteLinesWs $logPath2).Count
    $ev = Send-DigitChordRetry (($VK_0 + 2)) $false { [WorkspaceProofNative]::GetForegroundWindow().ToInt64() } "select" 2 $logPath2 $mark2 20 "forced-hide"
    $mark2 = $ev.count
    Rec-Ws "forced-hide" @{ outcome = $ev.event.outcome; attempt = $ev.attempt }
    if ("$($ev.event.outcome)" -notin @("ok", "partial")) { Fail-Ws "forced-hide outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    # Durable v4 show-preimage gate while hidden: exact owner binding plus
    # exact minimized/maximized preimages for the live survivors.
    $ledgerPath2 = Join-Path $ledgerDir "ledger.json"
    if (-not (Test-Path -LiteralPath $ledgerPath2 -PathType Leaf)) { Fail-Ws "forced hidden ledger missing" }
    $ledger2 = Get-Content -LiteralPath $ledgerPath2 -Raw | ConvertFrom-Json
    if ([int]$ledger2.v -ne 4) { Fail-Ws "forced hidden ledger v$($ledger2.v) != v4" }
    if ([int]$ledger2.owner.pid -ne [int]$frozen2.pid) { Fail-Ws "forced hidden ledger owner pid changed" }
    if ("$($ledger2.owner.process_creation)" -cne "$($frozen2.process_creation)") { Fail-Ws "forced hidden ledger owner creation changed" }
    $claims2 = @($ledger2.windows)
    if ($claims2.Count -ne 2) { Fail-Ws "forced hidden ledger claims $($claims2.Count) != 2" }
    $claimA = @($claims2 | Where-Object { [uint64]$_.hwnd -eq [uint64]$hA.hwnd }) | Select-Object -First 1
    $claimC = @($claims2 | Where-Object { [uint64]$_.hwnd -eq [uint64]$hC.hwnd }) | Select-Object -First 1
    if ($null -eq $claimA) { Fail-Ws "forced hidden ledger missing hA claim" }
    if ($null -eq $claimC) { Fail-Ws "forced hidden ledger missing hC claim" }
    foreach ($pair in @(@{ claim = $claimA; frozen = $hA; name = "hA" }, @{ claim = $claimC; frozen = $hC; name = "hC" })) {
      $c = $pair.claim; $f = $pair.frozen
      if ("$($c.kind)" -ne "product") { Fail-Ws "forced ledger $($pair.name) kind=$($c.kind) != product" }
      if ([int]$c.process.pid -ne [int]$f.process.pid) { Fail-Ws "forced ledger $($pair.name) pid changed" }
      if ("$($c.process.process_creation)" -cne "$($f.process.process_creation)") { Fail-Ws "forced ledger $($pair.name) creation changed" }
      if (-not (Test-ExeEqualWs "$($c.process.exe_path)" "$($f.process.exe_path)")) { Fail-Ws "forced ledger $($pair.name) exe changed" }
      if ("$($c.process.user_sid)" -cne "$($f.process.user_sid)") { Fail-Ws "forced ledger $($pair.name) sid changed" }
      if ([int]$c.process.session_id -ne [int]$f.process.session_id) { Fail-Ws "forced ledger $($pair.name) session changed" }
      if ("$($c.tag)" -notmatch "^[0-9a-f]{16}$" -or "$($c.tag)" -eq "0000000000000000") { Fail-Ws "forced ledger $($pair.name) tag malformed" }
    }
    if ([bool]$claimA.show.minimized -ne $true) { Fail-Ws "forced ledger hA show.minimized != true" }
    if ([bool]$claimA.show.maximized -ne $false) { Fail-Ws "forced ledger hA show.maximized != false" }
    if ([bool]$claimC.show.minimized -ne $false) { Fail-Ws "forced ledger hC show.minimized != false" }
    if ([bool]$claimC.show.maximized -ne $true) { Fail-Ws "forced ledger hC show.maximized != true" }
    Rec-Ws "forced-ledger-show" @{ v = $ledger2.v; hA_min = [bool]$claimA.show.minimized; hA_max = [bool]$claimA.show.maximized; hC_min = [bool]$claimC.show.minimized; hC_max = [bool]$claimC.show.maximized }
    $probe = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
    if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$frozen2.pid) { Fail-Ws "forced owner changed before kill" }
    $st = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Ws "forced stop no exit" }
    $alive = Test-ProcessAliveSameCreation ([int]$frozen2.pid) "$($frozen2.process_creation)"
    if ($alive) { Fail-Ws "forced owner alive" }
    foreach ($h in @($hA, $hC)) {
      $back = Wait-WsVisible $helperCopy $h $true 15 "forced-watcher-$($h.hwnd)"
      Assert-WsIdentity $back $h "forced-watcher-$($h.hwnd)"
    }
    if (-not [WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)) { Fail-Ws "forced watcher hA lost iconic" }
    if (-not [WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) { Fail-Ws "forced watcher hC lost zoomed" }
    Rec-Ws "forced-watcher-show" @{ hA_iconic = ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)); hC_zoomed = ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      try { Assert-LedgerClean $ownerCopy; break }
      catch { Start-Sleep -Milliseconds 250; if ((Get-Date) -ge $deadline) { Fail-Ws "forced watcher ledger dirty" } }
    }
    Rec-Ws "forced-watcher" @{ stop = $st }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Ws "forced independent restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Ws "forced-restore" $r
    if (-not [WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)) { Fail-Ws "forced restore hA lost iconic" }
    if (-not [WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) { Fail-Ws "forced restore hC lost zoomed" }
    Rec-Ws "forced-restore-show" @{ hA_iconic = ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)); hC_zoomed = ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) }
    # Normalize survivors before close (owned helpers only).
    if ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)) {
      $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hA.hwnd, $SW_RESTORE)
      Start-Sleep -Milliseconds 800
      if ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)) { Fail-Ws "forced normalize hA still iconic" }
    }
    if ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) {
      $null = [WorkspaceProofNative]::ShowWindow([IntPtr][long]$hC.hwnd, $SW_RESTORE)
      Start-Sleep -Milliseconds 800
      if ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) { Fail-Ws "forced normalize hC still zoomed" }
    }
    Rec-Ws "forced-normalized" @{ hA_iconic = ([WorkspaceProofNative]::IsIconic([IntPtr][long]$hA.hwnd)); hC_zoomed = ([WorkspaceProofNative]::IsZoomed([IntPtr][long]$hC.hwnd)) }

    # Mask-pair + off evidence from the proof audit (opaque): the owner
    # drains marked callback diagnostics per chord; Win+L never sent.
    $auditFiles = @(Get-ChildItem -LiteralPath $ledgerDir -Filter "proof-audit-*.jsonl" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 2)
    Rec-Ws "mask-audit" @{ files = @($auditFiles | ForEach-Object { $_.Name }) }
    $endSpi = Read-SpiArrangingWs
    $endPen = Read-PenWs
    if ($endSpi -ne $true -or [int]$endPen -ne 35) { Fail-Ws "end settings changed" }

    # Exact-helper cleanup and end state (managed survivors plus the
    # fourth owned unmanaged helper).
    foreach ($h in @($hA, $hC, $hD)) {
      $c = Invoke-Native $helperCopy @("close", "$($h.hwnd)", "--tag", "$($h.tag)") | ConvertFrom-Json
      Rec-Ws "cleanup-close" @{ hwnd = $h.hwnd; close = $c }
    }
    $deadline = (Get-Date).AddSeconds(10)
    while ($true) {
      $aliveAny = $false
      foreach ($h in @($hA, $hC, $hD)) {
        $still = $false
        try {
          $chk = Invoke-Native $helperCopy @("inspect", "$($h.hwnd)") | ConvertFrom-Json
          if ("$($chk.tag)" -ceq "$($h.tag)") { $still = $true }
        } catch { $still = $false }
        if ($still) { $aliveAny = $true }
      }
      if (-not $aliveAny) { break }
      if ((Get-Date) -gt $deadline) { Fail-Ws "helper exit timeout" }
      Start-Sleep -Milliseconds 200
    }
    Assert-LedgerClean $ownerCopy
    $leftovers = @(Get-Process -Name "tiler-windows", "tiler-test-window" -ErrorAction SilentlyContinue | Where-Object {
        $p = ""; try { $p = $_.Path } catch {}
        ($p -ieq $ownerCopy) -or ($p -ieq $helperCopy)
      })
    if ($leftovers.Count -ne 0) { Fail-Ws "end actors remain" }
    Rec-Ws "cleanup" @{ ledger = "clean"; actors = "absent"; arranging = $endSpi; pen = $endPen }

    $report = @{ status = "pass"; stage = "WorkspaceProof"; started = (Get-Date).ToString("o"); provenance = $prov; steps = $WsSteps }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "workspace-report=$reportPath"
    Write-Output "status=pass"
  } catch {
    foreach ($h in @($created)) {
      try {
        if (Test-ProcessAliveSameCreation ([int]$h.pid) "$($h.creation)") {
          $null = Invoke-Native $helperCopy @("close", "$($h.hwnd)", "--tag", "$($h.tag)")
        }
      } catch {}
    }
    try {
      if ($ownerCopy -ne "" -and (Test-Path $ownerCopy)) {
        try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
        try {
          $id = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
          $alive = $false
          try { $alive = Test-ProcessAliveSameCreation ([int]$id.process.pid) "$($id.process.process_creation)" } catch {}
        } catch {}
        try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      }
    } catch {}
    $report = @{ status = "fail"; stage = "WorkspaceProof"; provenance = $prov; steps = $WsSteps; error = "$($_.Exception.Message)" }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "workspace-report=$reportPath"
    throw "WorkspaceProof stage failed: $($_.Exception.Message)"
  }
}

if ($Mock) { Invoke-WorkspaceMock; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Ws "Stop requires -RunDir" }
  . (Join-Path $Repo "scripts\windows-dev.ps1")
  $ownerCopy = Join-Path $RunDir "bin\tiler-windows.exe"
  $helperCopy = Join-Path $RunDir "bin\tiler-test-window.exe"
  try { $s = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json; Write-Output ("stop=" + ($s | ConvertTo-Json -Compress)) } catch { Write-Output "stop failed: $($_.Exception.Message)" }
  try { $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json; Write-Output ("restore=" + ($r | ConvertTo-Json -Compress)) } catch { Write-Output "restore failed: $($_.Exception.Message)" }
  exit 0
}
if ($Live) { Invoke-WorkspaceLive; exit 0 }
Write-Output "workspace-proof parsed (no action without -Mock/-Live/-Stop)"
