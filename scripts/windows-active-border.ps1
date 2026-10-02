param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [switch]$Followup,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 240,
  [string]$FuPhases = "all"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner stop/restore helpers.
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }

# Owned-helper-first active-border verification harness (physical, medium).
# Primary legs run over the proof `tile-proof` loop (no synthetic input for
# dispatch); followup legs (`-Followup`) cover directional, workspace,
# fullscreen, shell, and ordinary-app behavior with composed-pixel oracles.
#
#   pwsh -NoProfile -File scripts/windows-active-border.ps1 -Mock
#   pwsh -NoProfile -File scripts/windows-active-border.ps1 -Live
#   pwsh -NoProfile -File scripts/windows-active-border.ps1 -Followup [-FuPhases ...]
#   pwsh -NoProfile -File scripts/windows-active-border.ps1 -Stop -RunDir '<dir>'
#
# Safety: explicit flags mandatory; bare invocation parses and exits. Live
# legs mutate ONLY exact identity-bound owned project helpers (plus their
# owned overlay); ordinary Notepad/Calculator/Paint legs bind extras by
# PID/HWND delta and close only launched extras, never pre-existing windows.
# NEVER touches Terminal or Firefox (no activation, no hide, no close; the
# proof allowlist plus the owner scope fences protect them). No process-name
# kills, no registry/policy writes, no typing, no closing of any app except
# exact-tag owned helpers/extras. Activation is E8-prime +
# AttachThreadInput + one SetForegroundWindow on the exact bound helper with
# immediate detach and exact readback (no pointer clicks on any window).
# Out-of-hook stop only (`stop` then `restore`).
# End state: zero run actors; ledger/stop clean; no overlay residue.
# Composed-pixel capture samples the owned overlay-only ring strips; style
# variants beyond width/gap/radius flags stay bounded to the theme-off leg.

$AB_STEPS = [System.Collections.ArrayList]@()
function Rec-Ab([string]$Name, $Data) { $null = $AB_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Ab([string]$Msg) { throw $Msg }

$SW_MINIMIZE = 6
$SW_RESTORE = 9

function Install-BorderNative {
  if (-not ("ActiveBorderNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ActiveBorderNative {
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
  public struct POINT { public int x; public int y; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public static uint SendKey(ushort vk, bool up) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk; arr[0].u.ki.wScan = 0;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)0;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint PrimeE8() {
    return SendKey(0xE8, false) + SendKey(0xE8, true);
  }
  public static uint SendMouse(uint flags, int nx, int ny) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 0;
    arr[0].u.mi.dx = nx; arr[0].u.mi.dy = ny;
    arr[0].u.mi.mouseData = 0; arr[0].u.mi.dwFlags = flags;
    arr[0].u.mi.time = 0;
    arr[0].u.mi.dwExtraInfo = (UIntPtr)0;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr hWnd, int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint a, ref RECT v, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetColorizationColor(out uint color, out int opaque);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, UIntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern int GetSystemMetricsForDpi(int nIndex, uint dpi);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr hdc, int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfoW(uint a, uint b, ref RECT r, uint f);
  public static int[] WorkArea() {
    RECT r; r.left = 0; r.top = 0; r.right = 0; r.bottom = 0;
    if (!SystemParametersInfoW(0x0030u, 0, ref r, 0)) throw new Exception("SPI_GETWORKAREA failed");
    return new int[] { r.left, r.top, r.right, r.bottom };
  }
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  public static void EnsurePMv2() {
    try { SetThreadDpiAwarenessContext((IntPtr)(-4)); } catch {}
  }
  public static IntPtr HoldProcess(uint pid) {
    const uint Q = 0x1000u; const uint S = 0x100000u;
    IntPtr h = OpenProcess(Q | S, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess held failed pid=" + pid);
    if (WaitForSingleObject(h, 0) == 0) { CloseHandle(h); throw new Exception("held pid exited pid=" + pid); }
    return h;
  }
  public static long HeldCreation(IntPtr h) {
    long c, e, k, u;
    if (!GetProcessTimes(h, out c, out e, out k, out u)) throw new Exception("GetProcessTimes held failed");
    return c;
  }
  public static bool HeldAlive(IntPtr h) {
    // Strict liveness: only WAIT_TIMEOUT (0x102) means still running.
    // WAIT_OBJECT_0 (0) means exited; WAIT_FAILED must never read as alive
    // (notably on a closed handle, where it would mask a use-after-close).
    return WaitForSingleObject(h, 0) == 0x102u;
  }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }
  public static string ClassOf(long hwnd) {
    StringBuilder b = new StringBuilder(256);
    int n = GetClassNameW((IntPtr)hwnd, b, b.Capacity);
    if (n <= 0) return "";
    return b.ToString();
  }
  public static int[] FrameOf(long hwnd) {
    RECT r; r.left = 0; r.top = 0; r.right = 0; r.bottom = 0;
    if (DwmGetWindowAttribute((IntPtr)hwnd, 9, ref r, 16) != 0) return null;
    return new int[] { r.left, r.top, r.right, r.bottom };
  }
  public static int SpiGet(uint action) {
    int v = 0;
    if (!SystemParametersInfo(action, 0, ref v, 0)) throw new Exception("SPI failed " + action);
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  # DPI-aware thread context (PMv2 = -4) so SPI/screen reads are physical pixels.
  try { $null = [ActiveBorderNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}
}

function Read-CompleteTextAb([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $reader = New-Object IO.StreamReader($stream); return $reader.ReadToEnd() }
  finally { $stream.Close() }
}

function Get-CompleteLinesAb([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Ab "missing log $Path" }
  $text = Read-CompleteTextAb $Path
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

function Get-MarkBeforeActionAb([string]$LogPath) {
  # Edge-safe mark: captured BEFORE the action, never after action/sleep.
  return (Get-CompleteLinesAb $LogPath).Count
}

function Wait-BorderOutcome([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [string]$Reason, [int]$TimeoutSec, [string]$Tag) {
  # Single-outcome wait: first shown is `shown` (never `shown`+`redrew`
  # together); position-only follows are trace `moved`. Callers pass exactly
  # the accepted outcomes for the leg.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $lines = Get-CompleteLinesAb $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -ne "active-border") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      if (($Reason -ne "") -and ("$($e.reason)" -ne $Reason)) { continue }
      return @{ event = $e; count = $lines.Count }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Ab "$Tag no active-border outcome=($($Outcomes -join '|')) reason=$Reason after mark $Mark"
  return $null
}

function Assert-HelperIdentityAb([string]$HelperBin, $Snap, [string]$Tag) {
  if ([string]$($Snap.tag) -eq "") { Fail-Ab "$Tag helper missing tag" }
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Snap.hwnd)") | ConvertFrom-Json
  if ("$($fresh.tag)" -ne "$($Snap.tag)") { Fail-Ab "$Tag tag mismatch" }
  if ([int]$fresh.process.pid -ne [int]$Snap.process.pid) { Fail-Ab "$Tag pid changed" }
  if ("$($fresh.process.process_creation)" -ne "$($Snap.process.process_creation)") { Fail-Ab "$Tag creation changed" }
  if ("$($fresh.process.user_sid)" -ne "$($Snap.process.user_sid)") { Fail-Ab "$Tag sid changed" }
  if ([int]$fresh.process.session_id -ne [int]$Snap.process.session_id) { Fail-Ab "$Tag session changed" }
  return $fresh
}

function Test-OwnerlessMoveCloakAb([string]$HelperBin, $Snap, [string]$Tag) {
  # Ownerless DWM-cloak precondition (caller guarantees NO owner runs): one
  # exact-bound owned-helper move (+40,+30 same size) via the official helper
  # own `move` (no activation, never the acceptance subject). Compares the
  # correct expected LTRB (move takes XYWH). Wrong readback throws (fixture
  # break). Cloak -1/unreadable never counts as present. Minimal facts only.
  [ActiveBorderNative]::EnsurePMv2()
  $pre = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $w = [int]$pre.right - [int]$pre.left
  $h = [int]$pre.bottom - [int]$pre.top
  if ($w -lt 1 -or $h -lt 1) { Fail-Ab "$Tag bad size ${w}x${h}" }
  $x0 = [int]$pre.left; $y0 = [int]$pre.top
  $tx = $x0 + 40; $ty = $y0 + 30
  $toXywh = "$tx,$ty,$w,$h"
  $wantLtrb = "$tx,$ty,$($tx + $w),$($ty + $h)"
  $origXywh = "$x0,$y0,$w,$h"
  $origLtrb = "$x0,$y0,$($x0 + $w),$($y0 + $h)"
  $beforeFresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-before-ident"
  $beforeCloak = "unreadable"
  try { $beforeCloak = [int](Get-FuCloaked ([long]$beforeFresh.hwnd)) } catch {}
  $beforeVis = "unreadable"
  try { $beforeVis = [bool][ActiveBorderNative]::IsWindowVisible([IntPtr][long]$beforeFresh.hwnd) } catch {}
  $beforeZoom = "unreadable"
  try { $beforeZoom = [bool][ActiveBorderNative]::IsZoomed([IntPtr][long]$beforeFresh.hwnd) } catch {}
  $beforeStyle = "unreadable"
  try {
    $bst = [ActiveBorderNative]::GetWindowLongW([IntPtr][long]$beforeFresh.hwnd, -16)
    $beforeStyle = ("0x{0:X8}" -f [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$bst), 0))
  } catch {}
  $before = @{ cloaked = $beforeCloak; visible = $beforeVis; zoomed = $beforeZoom; style = "$beforeStyle";
    rect = "$($beforeFresh.left),$($beforeFresh.top),$($beforeFresh.right),$($beforeFresh.bottom)" }
  $null = Invoke-Native $HelperBin @("move", "$($pre.hwnd)", "--tag", "$($pre.tag)", "--to", $toXywh) | ConvertFrom-Json
  $midFresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-mid"
  $midKey = "$($midFresh.left),$($midFresh.top),$($midFresh.right),$($midFresh.bottom)"
  if ($midKey -cne $wantLtrb) { Fail-Ab "$Tag moved readback [$midKey] != [$wantLtrb] (to $toXywh)" }
  $midCloak = "unreadable"
  try { $midCloak = [int](Get-FuCloaked ([long]$midFresh.hwnd)) } catch {}
  $midVis = "unreadable"
  try { $midVis = [bool][ActiveBorderNative]::IsWindowVisible([IntPtr][long]$midFresh.hwnd) } catch {}
  $midZoom = "unreadable"
  try { $midZoom = [bool][ActiveBorderNative]::IsZoomed([IntPtr][long]$midFresh.hwnd) } catch {}
  $midStyle = "unreadable"
  try {
    $mst = [ActiveBorderNative]::GetWindowLongW([IntPtr][long]$midFresh.hwnd, -16)
    $midStyle = ("0x{0:X8}" -f [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$mst), 0))
  } catch {}
  $mid = @{ cloaked = $midCloak; visible = $midVis; zoomed = $midZoom; style = "$midStyle"; rect = $midKey }
  $null = Invoke-Native $HelperBin @("move", "$($pre.hwnd)", "--tag", "$($pre.tag)", "--to", $origXywh) | ConvertFrom-Json
  $backFresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-restored"
  $backKey = "$($backFresh.left),$($backFresh.top),$($backFresh.right),$($backFresh.bottom)"
  if ($backKey -cne $origLtrb) { Fail-Ab "$Tag restore readback [$backKey] != [$origLtrb]" }
  $finalCloak = "unreadable"
  try { $finalCloak = [int](Get-FuCloaked ([long]$backFresh.hwnd)) } catch {}
  $restored = @{ cloaked = $finalCloak; rect = $backKey }
  $beforeZero = ($beforeCloak -is [int] -and [int]$beforeCloak -eq 0)
  $midPos = ($midCloak -is [int] -and [int]$midCloak -gt 0)
  $midZero = ($midCloak -is [int] -and [int]$midCloak -eq 0)
  $finalZero = ($finalCloak -is [int] -and [int]$finalCloak -eq 0)
  $present = ($beforeZero -and $midPos)
  $status = "pass"
  if (-not ($beforeZero -and $midZero -and $finalZero)) { $status = "unavailable" }
  return @{ status = $status; present = $present; before = $before; mid = $mid; restored = $restored;
    move_to = $toXywh; expect_ltrb = $wantLtrb; restore_to = $origXywh }
}

function Test-OwnerlessGateRegressionAb([string]$Tag) {
  # Offline regression for the shared gate with mocked seams (no windows):
  # valid XYWH move/LTRB readback + exact restore; cloak 0->2 unavailable;
  # 0->0 pass; -1 unreadable never present; wrong readback stays fixture error.
  $origAssert = ${function:Assert-HelperIdentityAb}
  $hasInvoke = ($null -ne (Get-Command Invoke-Native -ErrorAction SilentlyContinue))
  $origInvoke = $null
  if ($hasInvoke) { $origInvoke = ${function:Invoke-Native} }
  $origCloakFn = ${function:Get-FuCloaked}
  $script:gateState = @{ l = 100; t = 200; r = 600; b = 450; cloakBefore = 0; cloakAfter = 2; cloakFinal = 2; calls = 0; breakMove = $false; log = @() }
  function script:Assert-HelperIdentityAb([string]$HelperBin, $Snap, [string]$T) {
    return @{ hwnd = [uint64]1; tag = "mock"; left = [int]$script:gateState.l; top = [int]$script:gateState.t;
      right = [int]$script:gateState.r; bottom = [int]$script:gateState.b;
      process = @{ pid = 4242; process_creation = "mock-creation"; user_sid = "mock-sid"; session_id = 1 } }
  }
  function script:Get-FuCloaked([long]$Hwnd) {
    $script:gateState.calls++
    if ($script:gateState.calls -eq 1) { return [int]$script:gateState.cloakBefore }
    if ($script:gateState.calls -eq 3) { return [int]$script:gateState.cloakFinal }
    return [int]$script:gateState.cloakAfter
  }
  function script:Invoke-Native([string]$Exe, [string[]]$CliArgs) {
    if ($CliArgs[0] -ne "move") { return '{"ok":true}' }
    $xywh = "$($CliArgs[5])"
    $script:gateState.log += $xywh
    if (-not $script:gateState.breakMove) {
      $p = $xywh -split ","
      $script:gateState.l = [int]$p[0]; $script:gateState.t = [int]$p[1]
      $script:gateState.r = [int]$p[0] + [int]$p[2]; $script:gateState.b = [int]$p[1] + [int]$p[3]
    }
    $r = "$($script:gateState.l),$($script:gateState.t),$($script:gateState.r),$($script:gateState.b)"
    return (@{ moved = 1; tag = "mock"; rect = @($script:gateState.l, $script:gateState.t, $script:gateState.r, $script:gateState.b); foreground = 0 } | ConvertTo-Json -Compress)
  }
  try {
    $snap = @{ hwnd = [uint64]1; tag = "mock"; process = @{ pid = 4242; process_creation = "mock-creation"; user_sid = "mock-sid"; session_id = 1 } }
    $reset = { param($cb, $ca)
      $script:gateState.l = 100; $script:gateState.t = 200; $script:gateState.r = 600; $script:gateState.b = 450
      $script:gateState.cloakBefore = $cb; $script:gateState.cloakAfter = $ca; $script:gateState.calls = 0
      $script:gateState.cloakFinal = $ca
      $script:gateState.breakMove = $false; $script:gateState.log = @() }
    & $reset 0 2
    $g1 = Test-OwnerlessMoveCloakAb "mockbin" $snap "$Tag-case1"
    if ($g1.move_to -cne "140,230,500,250") { Fail-Ab "$Tag case1 move_to $($g1.move_to) != 140,230,500,250" }
    if ($g1.expect_ltrb -cne "140,230,640,480") { Fail-Ab "$Tag case1 expect $($g1.expect_ltrb) != 140,230,640,480" }
    if ($g1.restore_to -cne "100,200,500,250") { Fail-Ab "$Tag case1 restore $($g1.restore_to) != 100,200,500,250" }
    if (-not [bool]$g1.present) { Fail-Ab "$Tag case1 0->2 not present" }
    if ("$($g1.status)" -cne "unavailable") { Fail-Ab "$Tag case1 status $($g1.status) != unavailable" }
    if (("$($script:gateState.l),$($script:gateState.t),$($script:gateState.r),$($script:gateState.b)") -cne "100,200,600,450") {
      Fail-Ab "$Tag case1 not restored exactly" }
    & $reset 0 0
    $g2 = Test-OwnerlessMoveCloakAb "mockbin" $snap "$Tag-case2"
    if ([bool]$g2.present) { Fail-Ab "$Tag case2 0->0 wrongly present" }
    if ("$($g2.status)" -cne "pass") { Fail-Ab "$Tag case2 status $($g2.status) != pass" }
    & $reset 0 -1
    $g3 = Test-OwnerlessMoveCloakAb "mockbin" $snap "$Tag-case3"
    if ([bool]$g3.present) { Fail-Ab "$Tag case3 -1 unreadable wrongly present" }
    if ("$($g3.status)" -cne "unavailable") { Fail-Ab "$Tag case3 status $($g3.status) != unavailable" }
    & $reset 0 2
    $script:gateState.breakMove = $true
    try { $null = Test-OwnerlessMoveCloakAb "mockbin" $snap "$Tag-case4"; Fail-Ab "$Tag case4 wrong readback did not throw" }
    catch { if ("$($_.Exception.Message)" -notmatch "readback") { throw } }
    foreach ($final in @(2, -1)) {
      & $reset 0 0
      $script:gateState.cloakFinal = $final
      $g = Test-OwnerlessMoveCloakAb "mockbin" $snap "$Tag-final-$final"
      if ("$($g.status)" -cne "unavailable") { Fail-Ab "$Tag final cloak $final wrongly passed" }
    }
  } finally {
    ${function:Assert-HelperIdentityAb} = $origAssert
    if ($hasInvoke) { ${function:Invoke-Native} = $origInvoke }
    ${function:Get-FuCloaked} = $origCloakFn
  }
  return @{ cases = 6; move = "xywh-to-ltrb"; restore = "exact"; cloak = "0->2-unavailable/0->0-pass/-1-never-present/final-must-be-zero"; readback = "fixture-error" }
}

function Set-OwnedForegroundAb([string]$HelperBin, $Snap, [string]$Tag) {
  # Exact-bound fixture activation only: revalidate identity immediately
  # before the write, then E8 prime + AttachThreadInput + one
  # SetForegroundWindow with immediate detach and exact readback. Mirrors
  # product actuate_focus ordering (prime before attach/setter) and the
  # proven workspace-proof fixture. No pointer clicks on any window.
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fgEntry = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Hwnd) { return $fresh }
  $primeInserted = [ActiveBorderNative]::PrimeE8()
  if ([int]$primeInserted -ne 2) { Fail-Ab "$Tag E8 prime accepted $primeInserted != 2" }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Ab "$Tag foreground TID unreadable" }
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
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Ab "$Tag foreground readback $fg != $Hwnd attach=$attachOk" }
  return (Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post")
}

function Get-OverlayHwndsForOwnerAb([int]$OwnerPid) {
  $found = [System.Collections.ArrayList]@()
  $cb = {
    param([IntPtr]$h, [IntPtr]$l)
    try {
      $pidOut = [uint32]0
      $null = [ActiveBorderNative]::GetWindowThreadProcessId($h, [ref]$pidOut)
      if ([uint32]$pidOut -eq [uint32]$script:abOwnerPid) {
        if ([ActiveBorderNative]::ClassOf($h.ToInt64()) -eq "PlasmaAutoTilerActiveBorder") {
          $null = $script:abFound.Add($h.ToInt64())
        }
      }
    } catch {}
    return $true
  }
  $script:abOwnerPid = $OwnerPid
  $script:abFound = $found
  $null = [ActiveBorderNative]::EnumWindows($cb, [IntPtr]::Zero)
  return ,$found
}

function Assert-ExactOuterAb([int[]]$OverlayRect, [int[]]$Frame, [int]$WidthPx, [int]$GapPx, [string]$Tag) {
  # Meaningful oracle: exact visible DWM frame expanded by gap then width,
  # not merely contains. Overlay rect is [x,y,w,h]; frame is [l,t,r,b].
  if ($null -eq $OverlayRect -or $null -eq $Frame) { Fail-Ab "$Tag null rect/frame" }
  $fw = [int]$Frame[2] - [int]$Frame[0]; $fh = [int]$Frame[3] - [int]$Frame[1]
  $ix = [int]$Frame[0] - $GapPx; $iy = [int]$Frame[1] - $GapPx
  $iw = $fw + 2 * $GapPx; $ih = $fh + 2 * $GapPx
  $ex = $ix - $WidthPx; $ey = $iy - $WidthPx
  $ew = $iw + 2 * $WidthPx; $eh = $ih + 2 * $WidthPx
  $got = "$($OverlayRect -join ',')"; $want = "$ex,$ey,$ew,$eh"
  if ($got -ne $want) { Fail-Ab "$Tag exact outer mismatch got=$got want=$want frame=$($Frame -join ',') w=$WidthPx gap=$GapPx" }
  return @{ x = $ex; y = $ey; w = $ew; h = $eh }
}

function Assert-ZOrderAb($Insp, [string]$Tag) {
  # A background owner cannot place its surface above the foreground window:
  # adjacent-below (directly beneath the target, ring uncovered) is the
  # achievable correct placement. Accept above OR adjacent-below, hard fail
  # otherwise. Returns @(above, adjacent) for records.
  $above = $Insp.overlays[0].above_foreground; $adj = $Insp.overlays[0].adjacent_below_foreground
  if ($above -eq $true -or $adj -eq $true) { return @($above, $adj) }
  Fail-Ab "$Tag overlay z-order neither above nor adjacent-below (above=$above adjacent=$adj fg=$($Insp.foreground))"
}

function Wait-ExactAndZAb([string]$OwnerBin, [long]$Hwnd, [int]$WidthPx, [int]$GapPx, [string]$Tag) {
  # Settle loop for post-transition convergence: foreground z-order settles
  # async after SetForegroundWindow, and the owner reasserts every ~100ms tick
  # while displaced. Fresh DWM frame + border-inspect until BOTH exact outer
  # and z-order (above or adjacent-below) hold, or hard fail with evidence.
  $orect = $null; $frame = $null; $z = $null; $err = ""
  for ($att = 1; $att -le 10; $att++) {
    $frame = [ActiveBorderNative]::FrameOf($Hwnd)
    if ($null -eq $frame) { $err = "DWM frame unreadable"; Start-Sleep -Milliseconds 500; continue }
    $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
    if (-not $insp.present) { $err = "overlay absent fg=$($insp.foreground)"; Start-Sleep -Milliseconds 500; continue }
    $orect = @($insp.overlays[0].rect)
    try { $null = Assert-ExactOuterAb $orect $frame $WidthPx $GapPx "$Tag-exact-try$att" }
    catch { $err = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500; continue }
    try { $z = Assert-ZOrderAb $insp "$Tag-z-try$att"; return @{ overlay = $orect; frame = $frame; z = $z; insp = $insp } }
    catch { $err = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500; continue }
  }
  Fail-Ab "$Tag settle $err"
  return $null
}

function Get-LastShownColorAb([string]$LogPath, [string]$Tag) {
  # Effective-color proof independent of transition outcomes: position-only
  # follows log `moved` without color, so the last `shown`/`redrew` anywhere
  # in the log carries the owner's exact resolved ring color.
  $last = $null
  foreach ($line in (Get-CompleteLinesAb $LogPath)) {
    if ("$line".Trim() -eq "") { continue }
    $e = $line | ConvertFrom-Json
    if ("$($e.event)" -ne "active-border") { continue }
    if (@("shown", "redrew") -contains "$($e.outcome)") { $last = $e }
  }
  if ($null -eq $last) { Fail-Ab "$Tag no shown/redrew color event in log" }
  return $last
}

function Get-SystemAccentAb {
  # Read-only DwmGetColorizationColor (0xAARRGGBB) -> hex + channels. No writes.
  $color = [uint32]0; $opaque = 0
  $hr = [ActiveBorderNative]::DwmGetColorizationColor([ref]$color, [ref]$opaque)
  if ([int]$hr -ne 0) { return $null }
  $r = ($color -shr 16) -band 0xFF; $g = ($color -shr 8) -band 0xFF; $b = $color -band 0xFF
  $a = ($color -shr 24) -band 0xFF
  return @{ dword = $color; hex = ("#{0:x2}{1:x2}{2:x2}" -f $r, $g, $b); r = $r; g = $g; b = $b; a = $a; opaque = $opaque }
}

function Get-ComposedRingSamplesAb([int[]]$OverlayRect, [int]$WidthPx, [hashtable]$WantColor, [string]$Tag, [int]$Tolerance = 40) {
  # Composed-only evidence: GetPixel on the screen DC at overlay-owned outer
  # ring strips only (no app content, no broad screenshot). Samples sit 1-2px
  # inside the outer edge on all four sides, inside the width_px band.
  # PMv2 is reasserted on this thread so screen reads stay physical pixels.
  # Points off-screen (negative from edge-tiled geometry) or at/below the
  # work-area bottom (taskbar-occluded by design: shell stays above our
  # normal-band surface) are SKIPPED, never counted as misses: only on-screen
  # ring pixels can carry evidence. Threshold scales: ceil(3*valid/4), so a
  # full 8-strip needs 6 but a 2-side edge case needs 2/2. Hard fail below.
  [ActiveBorderNative]::EnsurePMv2()
  if ($WidthPx -lt 2) { Fail-Ab "$Tag ring too narrow for strip sampling w=$WidthPx" }
  $ox = [int]($OverlayRect[0]); $oy = [int]($OverlayRect[1])
  $ow = [int]($OverlayRect[2]); $oh = [int]($OverlayRect[3])
  $hw = [int]($ow / 2); $hh = [int]($oh / 2)
  $midX = [int]($ox + $hw); $midY = [int]($oy + $hh)
  $x0 = [int]($ox + 2); $y0 = [int]($oy + 2)
  $x1 = [int]($ox + $ow - 3); $y1 = [int]($oy + $oh - 3)
  $pts = @()
  $pts += ,@($x0, $y0); $pts += ,@($midX, $y0); $pts += ,@($x1, $y0)
  $pts += ,@($x0, $y1); $pts += ,@($midX, $y1); $pts += ,@($x1, $y1)
  $pts += ,@($x0, $midY); $pts += ,@($x1, $midY)
  $hdc = [ActiveBorderNative]::GetDC([IntPtr]::Zero)
  if ($hdc -eq [IntPtr]::Zero) { Fail-Ab "$Tag GetDC screen failed" }
  $wa = [ActiveBorderNative]::WorkArea()
  $workBottom = [int]$wa[3]
  $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
  try {
    $hits = 0; $reads = @(); $skipped = @(); $valid = 0
    foreach ($p in $pts) {
      $px = [int]($p[0]); $py = [int]($p[1])
      if ($px -lt 0 -or $py -lt 0 -or $px -ge $screenW -or $py -ge $workBottom) {
        $skipped += @{ x = $px; y = $py; reason = "offscreen-or-taskbar" }
        continue
      }
      $valid++
      $c = [ActiveBorderNative]::GetPixel($hdc, $px, $py)
      if ($c -eq 0xFFFFFFFF) { Fail-Ab "$Tag GetPixel failed at $px,$py" }
      $r = [int]($c -band 0xFF); $g = [int](($c -shr 8) -band 0xFF); $b = [int](($c -shr 16) -band 0xFF)
      $reads += @{ x = $px; y = $py; r = $r; g = $g; b = $b }
      # Tolerance is caller-chosen: system-accent legs keep bounded ±40
      # (DWM shadow/composition shifts composed values from the opaque DIB
      # accent); the controlled distinctive-color leg relies on exact log
      # color plus a blue-dominance hue guard below. Never silently downgraded.
      $dr = [math]::Abs($r - [int]$WantColor.r); $dg = [math]::Abs($g - [int]$WantColor.g); $db = [math]::Abs($b - [int]$WantColor.b)
      if (($dr -le $Tolerance) -and ($dg -le $Tolerance) -and ($db -le $Tolerance)) { $hits++ }
    }
    if ($valid -lt 2) { Fail-Ab "$Tag too few on-screen ring samples valid=$valid/8 (workBottom=$workBottom screen=${screenW}x${screenH})" }
    $need = [int][math]::Ceiling(3 * $valid / 4)
    if ($hits -lt $need) {
      $detail = ($reads | ForEach-Object { "$($_.x),$($_.y)=#$('{0:x2}{1:x2}{2:x2}' -f $_.r,$_.g,$_.b)" }) -join " "
      Fail-Ab "$Tag composed ring color mismatch hits=$hits/$valid (need $need) want=$($WantColor.hex) got: $detail"
    }
    return @{ hits = $hits; total = $pts.Count; valid = $valid; skipped = $skipped; want = $WantColor.hex; samples = $reads }
  } finally { $null = [ActiveBorderNative]::ReleaseDC([IntPtr]::Zero, $hdc) }
}

function New-HeldProcessAb([uint32]$TargetPid, [string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  try { return [ActiveBorderNative]::HoldProcess($TargetPid) }
  catch { Fail-Ab "$Tag held OpenProcess failed pid=$TargetPid $($_.Exception.Message)" }
  return [IntPtr]::Zero
}

function Close-HeldProcessAb([IntPtr]$Handle) {
  if ($Handle -ne [IntPtr]::Zero) { $null = [ActiveBorderNative]::CloseHandle($Handle) }
}

function Invoke-OwnedSysCommandAb([string]$HelperBin, $Snap, [uint32]$Cmd, [string]$Tag) {
  # Active minimize/maximize/restore on the exact foreground-owned helper via
  # WM_SYSCOMMAND. A real OS process handle (OpenProcess QUERY_LIMITED+SYNCH)
  # is held across the async PostMessage and the readback: handle aliveness
  # plus full identity (PID/creation/exe/SID/session/tag) is revalidated
  # before and after. No helper CLI (which intentionally refuses foreground
  # targets); no foreign window. Never weakens bound_target refusal: the
  # foreground gate below stays hard.
  [ActiveBorderNative]::EnsurePMv2()
  $WM_SYSCOMMAND = 0x0112
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Ab "$Tag not foreground (fg=$fg want=$Hwnd): active SYSCOMMAND requires foreground" }
  $held = New-HeldProcessAb ([uint32]$fresh.process.pid) "$Tag"
  $heldCreation = [ActiveBorderNative]::HeldCreation($held)
  try {
    $ok = [ActiveBorderNative]::PostMessageW([IntPtr][long]$Hwnd, $WM_SYSCOMMAND, [UIntPtr]$Cmd, [IntPtr]::Zero)
    if (-not $ok) { Fail-Ab "$Tag PostMessage SYSCOMMAND 0x$($Cmd.ToString('X')) failed" }
    Start-Sleep -Milliseconds 800
    if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Ab "$Tag held process exited across SYSCOMMAND" }
    if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Ab "$Tag held creation changed across SYSCOMMAND" }
    $back = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post"
    if ([int]$back.process.pid -ne [int]$fresh.process.pid) { Fail-Ab "$Tag pid changed across SYSCOMMAND" }
    if ("$($back.process.process_creation)" -ne "$($fresh.process.process_creation)") { Fail-Ab "$Tag creation changed across SYSCOMMAND" }
    return $back
  } finally { Close-HeldProcessAb $held }
}

function ConvertTo-AbsoluteAb([int]$Px, [int]$Origin, [int]$Span) {
  if ($Span -le 1) { Fail-Ab "absolute span invalid" }
  return [int][math]::Round(($Px - $Origin) * 65535.0 / ($Span - 1))
}

function Get-NativeRectAb([long]$Hwnd) {
  [ActiveBorderNative]::EnsurePMv2()
  $r = New-Object ActiveBorderNative+RECT
  if (-not [ActiveBorderNative]::GetWindowRect([IntPtr]$Hwnd, [ref]$r)) { return $null }
  return @([int]$r.left, [int]$r.top, [int]$r.right, [int]$r.bottom)
}

function Get-NativeFrameAb([long]$Hwnd) {
  [ActiveBorderNative]::EnsurePMv2()
  $f = [ActiveBorderNative]::FrameOf($Hwnd)
  if ($null -eq $f) { return $null }
  return @([int]$f[0], [int]$f[1], [int]$f[2], [int]$f[3])
}

function Get-NativeOverlayRectAb([int]$OwnerPid) {
  $hwnds = @(Get-OverlayHwndsForOwnerAb $OwnerPid) | Where-Object { $_ -ne 0 }
  if (@($hwnds).Count -ne 1) { return $null }
  $rect = Get-NativeRectAb ([long]$hwnds[0])
  if ($null -eq $rect) { return $null }
  $w = [int]$rect[2] - [int]$rect[0]; $h = [int]$rect[3] - [int]$rect[1]
  $vis = [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hwnds[0])
  return @{ hwnd = [long]$hwnds[0]; x = [int]$rect[0]; y = [int]$rect[1]; w = $w; h = $h; visible = [bool]$vis }
}

function Find-TitlePointAb([long]$Hwnd, [int[]]$Outer) {
  # No guessed coordinate: probe titlebar candidates and require
  # WindowFromPoint to hit the exact bound helper.
  [ActiveBorderNative]::EnsurePMv2()
  $left = [int]$Outer[0]; $top = [int]$Outer[1]; $right = [int]$Outer[2]
  foreach ($dx in @(50, 100, 150)) {
    $sx = $left + $dx; $sy = $top + 10
    if ($sx -ge $right) { continue }
    $pt = New-Object ActiveBorderNative+POINT; $pt.x = $sx; $pt.y = $sy
    $hit = [ActiveBorderNative]::WindowFromPoint($pt).ToInt64()
    if ([uint64]$hit -eq [uint64]$Hwnd) { return @($sx, $sy) }
  }
  return $null
}

function Find-EdgePointAb([long]$Hwnd, [int[]]$Outer) {
  # Actual resize edge: SE corner inside the bound helper frame.
  [ActiveBorderNative]::EnsurePMv2()
  $candidates = @(
    @(([int]$Outer[2] - 6), ([int]$Outer[3] - 6)),
    @(([int]$Outer[2] - 10), ([int]$Outer[3] - 10)),
    @(([int]$Outer[2] - 4), ([int](($Outer[1] + $Outer[3]) / 2)))
  )
  foreach ($c in $candidates) {
    $pt = New-Object ActiveBorderNative+POINT; $pt.x = [int]$c[0]; $pt.y = [int]$c[1]
    $hit = [ActiveBorderNative]::WindowFromPoint($pt).ToInt64()
    if ([uint64]$hit -eq [uint64]$Hwnd) { return @([int]$c[0], [int]$c[1]) }
  }
  return $null
}

function Get-VirtualScreenAb([uint32]$Dpi) {
  [ActiveBorderNative]::EnsurePMv2()
  $SM_XVS = 76; $SM_YVS = 77; $SM_CXVS = 78; $SM_CYVS = 79
  try {
    $vx = [ActiveBorderNative]::GetSystemMetricsForDpi($SM_XVS, $Dpi)
    $vy = [ActiveBorderNative]::GetSystemMetricsForDpi($SM_YVS, $Dpi)
    $vw = [ActiveBorderNative]::GetSystemMetricsForDpi($SM_CXVS, $Dpi)
    $vh = [ActiveBorderNative]::GetSystemMetricsForDpi($SM_CYVS, $Dpi)
    if ($vw -gt 1 -and $vh -gt 1) { return @($vx, $vy, $vw, $vh) }
  } catch {}
  return @(
    [ActiveBorderNative]::GetSystemMetrics($SM_XVS),
    [ActiveBorderNative]::GetSystemMetrics($SM_YVS),
    [ActiveBorderNative]::GetSystemMetrics($SM_CXVS),
    [ActiveBorderNative]::GetSystemMetrics($SM_CYVS)
  )
}

function Assert-ButtonReleasedAb([string]$Tag) {
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline) {
    $st = [ActiveBorderNative]::GetAsyncKeyState(1)
    if (([int]$st -band 0x8000) -eq 0) { return }
    Start-Sleep -Milliseconds 50
  }
  Fail-Ab "$Tag left button still down after mouseup"
}

function Invoke-ActiveGestureAb([string]$HelperBin, $Snap, [int]$Dx, [int]$Dy, [string]$LogPath, [int]$Mark, [string]$Tag, [int]$OwnerPid, [string]$Kind) {
  # Scoped synthetic mouse gesture on the exact foreground-owned helper only.
  # Kind title = titlebar move; kind edge = SE/east border resize. Requires
  # WindowFromPoint bound-helper hit plus foreground immediately before button
  # down, holds the OS process handle across, steps with per-step native
  # physical reads (target DWM frame + outer + overlay rect, Stopwatch
  # timestamps, explicit poll resolution), demands mid-gesture samples plus
  # final exact, and always mouseups + restores cursor + verifies release on
  # every path. Never touches other windows. No whole-screen content capture.
  [ActiveBorderNative]::EnsurePMv2()
  $MOUSE_MOVE = 0x0001; $MOUSE_ABS = 0x8000; $MOUSE_DOWN = 0x0002; $MOUSE_UP = 0x0004
  $STEP_MS = 60
  $fresh = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Ab "$Tag not foreground for gesture" }
  $outer0 = Get-NativeRectAb $Hwnd
  if ($null -eq $outer0) { Fail-Ab "$Tag native outer unreadable" }
  if ($Kind -eq "edge") { $start = Find-EdgePointAb $Hwnd $outer0 }
  else { $start = Find-TitlePointAb $Hwnd $outer0 }
  if ($null -eq $start) { Fail-Ab "$Tag no WindowFromPoint bound-helper hit ($Kind)" }
  $dpi = [ActiveBorderNative]::GetDpiForWindow([IntPtr]$Hwnd)
  if ([uint32]$dpi -eq 0) { Fail-Ab "$Tag DPI unreadable" }
  $vs = Get-VirtualScreenAb ([uint32]$dpi)
  $vx = [int]$vs[0]; $vy = [int]$vs[1]; $vw = [int]$vs[2]; $vh = [int]$vs[3]
  $frame0 = Get-NativeFrameAb $Hwnd
  if ($null -eq $frame0) { Fail-Ab "$Tag native DWM frame unreadable" }
  $ov0 = Get-NativeOverlayRectAb $OwnerPid
  $saved = $null
  try { $pt = New-Object ActiveBorderNative+POINT; if ([ActiveBorderNative]::GetCursorPos([ref]$pt)) { $saved = @($pt.x, $pt.y) } } catch {}
  $held = New-HeldProcessAb ([uint32]$fresh.process.pid) "$Tag"
  $heldCreation = [ActiveBorderNative]::HeldCreation($held)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $trace = [System.Collections.ArrayList]@()
  $null = $trace.Add(@{ step = 0; t_ms = 0; frame = ($frame0 -join ","); outer = ($outer0 -join ","); overlay = $(if ($null -ne $ov0) { "$($ov0.x),$($ov0.y),$($ov0.w),$($ov0.h)" } else { "absent" }) })
  $down = $false
  try {
    $sx = [int]$start[0]; $sy = [int]$start[1]
    $ax = ConvertTo-AbsoluteAb $sx $vx $vw; $ay = ConvertTo-AbsoluteAb $sy $vy $vh
    if ([ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $ax, $ay) -eq 0) { Fail-Ab "$Tag cursor move not inserted" }
    Start-Sleep -Milliseconds 250
    # Revalidate bound helper + foreground immediately before button down.
    $re = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-down"
    if ([long]$re.hwnd -ne $Hwnd) { Fail-Ab "$Tag hwnd changed before down" }
    $fg2 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fg2 -ne [uint64]$Hwnd) { Fail-Ab "$Tag lost foreground before down" }
    $pt2 = New-Object ActiveBorderNative+POINT; $pt2.x = $sx; $pt2.y = $sy
    if ([uint64]([ActiveBorderNative]::WindowFromPoint($pt2).ToInt64()) -ne [uint64]$Hwnd) { Fail-Ab "$Tag WindowFromPoint lost helper before down" }
    if ([ActiveBorderNative]::SendMouse($MOUSE_DOWN, 0, 0) -eq 0) { Fail-Ab "$Tag button down not inserted" }
    $down = $true
    Start-Sleep -Milliseconds 250
    $tx = $sx + $Dx; $ty = $sy + $Dy
    $bx = ConvertTo-AbsoluteAb $tx $vx $vw; $by = ConvertTo-AbsoluteAb $ty $vy $vh
    $steps = 8
    for ($i = 1; $i -le $steps; $i++) {
      # Bound-target gate before each step: the foreground must still be the
      # exact bound helper (cheap native read; a mid-gesture focus loss aborts
      # with cleanup via finally). Tag identity is verified pre/post via
      # inspect; per-step CLI would perturb gesture timing.
      $fgS = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      if ([uint64]$fgS -ne [uint64]$Hwnd) { Fail-Ab "$Tag lost foreground at step $i" }
      $ix = [int]($ax + ($bx - $ax) * $i / $steps); $iy = [int]($ay + ($by - $ay) * $i / $steps)
      $null = [ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $ix, $iy)
      Start-Sleep -Milliseconds $STEP_MS
      $fr = Get-NativeFrameAb $Hwnd
      $ou = Get-NativeRectAb $Hwnd
      $ov = Get-NativeOverlayRectAb $OwnerPid
      $null = $trace.Add(@{
          step = $i; t_ms = [int]$sw.ElapsedMilliseconds
          frame = $(if ($null -ne $fr) { ($fr -join ",") } else { "unreadable" })
          outer = $(if ($null -ne $ou) { ($ou -join ",") } else { "unreadable" })
          overlay = $(if ($null -ne $ov) { "$($ov.x),$($ov.y),$($ov.w),$($ov.h)" } else { "absent" })
        })
    }
    Start-Sleep -Milliseconds 250
    # Held-process guard runs INSIDE the try while the handle is still open
    # (matching the syscommand harness): aliveness plus creation equality
    # across the gesture, before finally closes the handle.
    if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Ab "$Tag held process exited across gesture" }
    if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Ab "$Tag held creation changed across gesture" }
  } finally {
    try { $null = [ActiveBorderNative]::SendMouse($MOUSE_UP, 0, 0) } catch {}
    $down = $false
    Assert-ButtonReleasedAb "$Tag-release"
    if ($null -ne $saved) {
      try {
        $rx = ConvertTo-AbsoluteAb ([int]$saved[0]) $vx $vw; $ry = ConvertTo-AbsoluteAb ([int]$saved[1]) $vy $vh
        $null = [ActiveBorderNative]::SendMouse(($MOUSE_MOVE -bor $MOUSE_ABS), $rx, $ry)
      } catch {}
    }
    try { Close-HeldProcessAb $held } catch {}
  }
  $totalMs = [int]$sw.ElapsedMilliseconds
  # Mid-gesture demand: at least 2 steps moved the physical DWM frame.
  $moved = 0
  for ($i = 1; $i -lt $trace.Count; $i++) {
    if ("$($trace[$i].frame)" -ne "$($trace[0].frame)" -and "$($trace[$i].frame)" -ne "unreadable") { $moved++ }
  }
  if ($moved -lt 2) { Fail-Ab "$Tag no mid-gesture physical frame change (moved=$moved/8)" }
  # Post-release border follow with 100ms resolution.
  $samples = 0; $found = $null; $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100; $samples++
    $lines = Get-CompleteLinesAb $LogPath
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
      if ("$($lines[$i])".Trim() -eq "") { continue }
      $e = $lines[$i] | ConvertFrom-Json
      if ("$($e.event)" -ne "active-border") { continue }
      if (@("moved", "redrew", "shown") -contains "$($e.outcome)") { $found = $e; break }
    }
    if ($null -ne $found) { break }
  }
  if ($null -eq $found) { Fail-Ab "$Tag no border follow after gesture (samples=$samples poll=100ms)" }
  $back = Assert-HelperIdentityAb $HelperBin $Snap "$Tag-post"
  if ([int]$back.process.pid -ne [int]$fresh.process.pid) { Fail-Ab "$Tag pid changed across gesture" }
  if ("$($back.process.process_creation)" -ne "$($fresh.process.process_creation)") { Fail-Ab "$Tag creation changed across gesture" }
  $backFrame = Get-NativeFrameAb ([long]$back.hwnd)
  return @{ total_ms = $totalMs; step_ms = $STEP_MS; samples = $samples; outcome = "$($found.outcome)"; frame = $backFrame; trace = $trace; moved_steps = $moved }
}

function Invoke-ActiveTitleDragAb([string]$HelperBin, $Snap, [int]$Dx, [int]$Dy, [string]$LogPath, [int]$Mark, [string]$Tag, [int]$OwnerPid) {
  return (Invoke-ActiveGestureAb $HelperBin $Snap $Dx $Dy $LogPath $Mark $Tag $OwnerPid "title")
}

function Invoke-ActiveEdgeResizeAb([string]$HelperBin, $Snap, [int]$Dx, [int]$Dy, [string]$LogPath, [int]$Mark, [string]$Tag, [int]$OwnerPid) {
  return (Invoke-ActiveGestureAb $HelperBin $Snap $Dx $Dy $LogPath $Mark $Tag $OwnerPid "edge")
}

function Read-CorrectSpiAb {
  $arr = [ActiveBorderNative]::SpiGet(0x0082); $pen = [ActiveBorderNative]::SpiGet(0x201E)
  return @{ arranging_raw = $arr; pen_raw = $pen }
}

function Invoke-BorderMock {
  # Offline only: no owner launch, no window mutation, no hooks.
  Rec-Ab "scope" @{ helpers = "owned-only-first"; ordinary = "later-legs"; never = @("terminal", "firefox"); kills = "exact-owner-only"; registry = "none" }
  # CLI surface parses offline (help is static text; parsing is the contract).
  $help = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-windows -- help 2>$null
  if ("$help" -notmatch "border-inspect") { Fail-Ab "mock CLI help missing border-inspect" }
  $hhelp = & cargo run --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --bin tiler-test-window -- help 2>$null
  if ("$hhelp" -notmatch "move HWND --tag TAG --to") { Fail-Ab "mock helper help missing exact-bound move" }
  Rec-Ab "cli-surface" @{ border_inspect = $true; helper_move = $true }
  # Edge-safe mark ordering: the mark helper must read the count BEFORE any
  # action. The old script marked after action/sleep and waited for both
  # shown+redrew (impossible: first show is exactly one of them).
  $src = Get-Content -LiteralPath (Join-Path $Repo "scripts\windows-active-border.ps1") -Raw
  if ($src -notmatch "Get-MarkBeforeActionAb") { Fail-Ab "mock mark-before-action helper missing" }
  $oldWaiter = 'function Wait-Border' + 'Event'
  if ($src -match $oldWaiter) { Fail-Ab "mock still defines old shown+redrew waiter" }
  Rec-Ab "transition-seams" @{ mark = "before-action"; first_show = "single-shown-not-shown-plus-redrew"; moved = "trace-only" }
  # Exact-bound targeting: every helper mutation carries HWND+tag (+rect for
  # move); no bare-HWND SetWindowPos/ShowWindow path remains in this script.
  if ($src -match "\[ActiveBorderNative\]::ShowWindow\(\[IntPtr\]") { Fail-Ab "mock bare-HWND ShowWindow mutation remains" }
  if ($src -notmatch 'move.*--tag.*--to') { Fail-Ab "mock exact-bound move missing" }
  Rec-Ab "targeting" @{ helper_mutations = "exact-bound-only"; bare_hwnd = "absent" }
  # Cleanup seams: out-of-hook stop+restore, overlay-class enumeration scoped
  # to the exact owner PID, no broad process-name kills.
  $broadPat = 'Get-Process' + ' -Name'
  if (($src -match $broadPat) -and ($src -match 'tiler-test-window.*-ErrorAction SilentlyContinue.*Where-Object')) {
    # scoped path-bound actor check is allowed; bare -Name with process-name
    # list is not. Distinguish by comma-name list form:
    if ($src -match '-Name "tiler') { Fail-Ab "mock broad process-name cleanup remains" }
  }
  $oldMarkers = 'AB_APPROVED' + '_EXE|' + 'Set-AppForeground' + 'Ab|' + 'Wait-Border' + 'Event'
  if ($src -match $oldMarkers) { Fail-Ab "mock old harness markers remain" }
  if ($src -notmatch "Get-OverlayHwndsForOwnerAb") { Fail-Ab "mock overlay-scoped post-stop check missing" }
  if ($src -notmatch "Assert-ExactOuterAb") { Fail-Ab "mock exact-outer oracle missing" }
  if ($src -notmatch "Get-ComposedRingSamplesAb") { Fail-Ab "mock composed ring-strip capture missing" }
  if ($src -notmatch "Invoke-OwnedSysCommandAb") { Fail-Ab "mock owned SYSCOMMAND helper missing" }
  if ($src -notmatch "Invoke-ActiveTitleDragAb") { Fail-Ab "mock active title-drag helper missing" }
  if ($src -notmatch "Invoke-ActiveEdgeResizeAb") { Fail-Ab "mock active edge-resize helper missing" }
  if ($src -notmatch "WindowFromPoint") { Fail-Ab "mock WindowFromPoint bound-helper check missing" }
  if ($src -notmatch "HoldProcess") { Fail-Ab "mock held-process handle missing" }
  if ($src -notmatch "Assert-ButtonReleasedAb") { Fail-Ab "mock button-release verification missing" }
  if ($src -notmatch "above_foreground") { Fail-Ab "mock z-order evidence missing" }
  if ($src -notmatch "Assert-ZOrderAb") { Fail-Ab "mock z-order assert missing" }
  if ($src -notmatch "Wait-ExactAndZAb") { Fail-Ab "mock exact+z settle helper missing" }
  if ($src -match ('New-HeldProcessAb\(\[uint32\]\$' + 'Pid')) { Fail-Ab "mock held-process param shadows automatic PID" }
  if ($src -notmatch "adjacent_below") { Fail-Ab "mock adjacent-below evidence missing" }
  if ($src -notmatch "StringBuilder") { Fail-Ab "mock unicode ClassOf missing" }
  $oldClass = 'char\[\] b = new ' + 'char\[256\]'
  if ($src -match $oldClass) { Fail-Ab "mock ansi char-array ClassOf remains" }
  if ($src -match ('composed' + '_gap')) { Fail-Ab "mock composed-gap downgrade present (must hard fail)" }
  if ($src -match ('leg1b-' + 'directional')) { Fail-Ab "mock old directional label remains (must be background-refocus truth)" }
  if ($src -notmatch "leg1b-background-refocus") { Fail-Ab "mock background-refocus truth label missing" }
  if ($src -notmatch "theme-off-distinct") { Fail-Ab "mock distinctive theme-off leg missing" }
  $badSpi = '0x100' + 'C|0x102' + '3'
  if ($src -match $badSpi) { Fail-Ab "mock mistaken SPI codes present (must use 0x0082/0x201E)" }
  if ($src -notmatch "0x0082" -or $src -notmatch "0x201E") { Fail-Ab "mock correct SPI codes missing" }
  $regPat = 'Set-Item' + 'Property|New-Item' + 'Property'
  if ($src -match $regPat) { Fail-Ab "mock registry/policy write present" }
  Rec-Ab "cleanup-seams" @{ stop = "out-of-hook-stop-then-restore"; overlay = "class-scoped-exact-owner"; kills = "none-broad"; registry = "none" }
  if ($src -notmatch "Test-OwnerlessMoveCloakAb") { Fail-Ab "mock shared ownerless gate missing" }
  if ($src -notmatch "Test-OwnerlessGateRegressionAb") { Fail-Ab "mock shared gate regression missing" }
  Install-BorderNative
  Install-FollowupNative
  Rec-Ab "mock-gate" (Test-OwnerlessGateRegressionAb "mock")
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --test active_border 2>$null
  if ($LASTEXITCODE -ne 0) { Fail-Ab "mock cargo test active_border failed" }
  & cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --lib 2>$null
  if ($LASTEXITCODE -ne 0) { Fail-Ab "mock cargo test lib failed" }
  Rec-Ab "portable-tests" @{ suites = @("active_border", "lib"); result = "pass" }
  $report = @{ status = "pass"; stage = "ActiveBorderMock"; steps = $AB_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function Invoke-BorderLive {
  Install-BorderNative
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Ab "refuse: OwnerSeconds must be 1..=600" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\windows-active-border\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "active-border-report.json"
  if (Test-Path $reportPath) { Fail-Ab "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Ab "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $ownerHash = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
  $helperHash = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
  Rec-Ab "env" @{ commit = $commit; status = $status; run_dir = $runDir; owner_sha256 = $ownerHash; helper_sha256 = $helperHash }
  Assert-LedgerClean $ownerCopy
  $created = [System.Collections.ArrayList]@()

  try {
    # Two passive owned helpers via the proven Explorer-broker path.
    $snaps = @()
    foreach ($n in 1..2) {
      $receipt = Join-Path $runDir "helper$n.json"
      if (Test-Path $receipt) { Fail-Ab "receipt preexists $receipt" }
      Start-ExplorerGui $helperCopy "run --receipt `"$receipt`" --seconds $OwnerSeconds --passive" $runDir
      $deadline = (Get-Date).AddSeconds(10)
      while (-not (Test-Path $receipt)) {
        if ((Get-Date) -gt $deadline) { Fail-Ab "helper receipt timeout $n" }
        Start-Sleep -Milliseconds 200
      }
      $snap = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
      $hbin = (Get-Process -Id $PID).Path
      if ("$($snap.process.exe_path)" -ine "$helperCopy") { Fail-Ab "helper$n peer mismatch" }
      Assert-ParentIsExplorer ([int]$snap.process.pid)
      if ([string]$snap.tag -eq "") { Fail-Ab "helper$n missing tag" }
      if ($snap.visible -ne $false) { Fail-Ab "helper$n passive visible at create" }
      $null = $created.Add(@{ hwnd = [uint64]$snap.hwnd; tag = "$($snap.tag)" })
      $shown = Invoke-Native $helperCopy @("show", "$($snap.hwnd)", "--tag", "$($snap.tag)") | ConvertFrom-Json
      if ([uint64]$shown.foreground -eq [uint64]$snap.hwnd) { Fail-Ab "helper$n admission focused helper" }
      $fresh = Assert-HelperIdentityAb $helperCopy $snap "helper$n-postshow"
      if ($fresh.visible -ne $true) { Fail-Ab "helper$n not visible after show" }
      $snaps += $fresh
    }
    Rec-Ab "helpers-created" @($snaps | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; visible = $_.visible } })
    $allowPath = Join-Path $runDir "allowlist.json"
    $entries = @()
    foreach ($s in $snaps) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath

    # Proof owner (scoped fences protect every unrelated window; no
    # unrelated-app refusal: Terminal/Firefox are simply never targets).
    Start-ExplorerGui $ownerCopy "tile-proof --allowlist `"$allowPath`" --seconds $OwnerSeconds --trace --active-border-theme" $binDir
    $ready = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready) { Fail-Ab "proof owner ready timeout" }
    if ("$($ready.owner.exe_path)" -ine "$ownerCopy") { Fail-Ab "owner peer mismatch" }
    Assert-ParentIsExplorer ([int]$ready.owner.pid)
    $ownerPid = [int]$ready.owner.pid
    $ownerCreation = "$($ready.owner.process_creation)"
    $logPath = "$($ready.log_path)"
    Rec-Ab "owner-ready" @{ pid = $ownerPid; log = $logPath }
    Start-Sleep -Milliseconds 2000

    $hA = $snaps[0]; $hB = $snaps[1]

    # Baseline: correct SPI codes under PMv2 (physical), per-helper DPI, accent.
    $spi = Read-CorrectSpiAb
    Rec-Ab "settings-pre" @{ arranging_raw = $spi.arranging_raw; pen_raw = $spi.pen_raw }
    if ([int]$spi.arranging_raw -ne 1) { Fail-Ab "preflight arranging raw $($spi.arranging_raw) != 1 (must use 0x0082)" }
    if ([int]$spi.pen_raw -ne 35) { Fail-Ab "preflight pen raw $($spi.pen_raw) != 35 (must use 0x201E)" }
    $dpiA = [ActiveBorderNative]::GetDpiForWindow([IntPtr][long]$hA.hwnd)
    $dpiB = [ActiveBorderNative]::GetDpiForWindow([IntPtr][long]$hB.hwnd)
    Rec-Ab "dpi" @{ a = [int]$dpiA; b = [int]$dpiB }
    if ([int]$dpiA -ne 120 -or [int]$dpiB -ne 120) { Fail-Ab "helper DPI not 120 (a=$dpiA b=$dpiB)" }
    $accent = Get-SystemAccentAb
    if ($null -eq $accent) { Fail-Ab "DwmGetColorizationColor query failed" }
    Rec-Ab "accent" @{ hex = $accent.hex; alpha = $accent.a; dword = ("0x{0:X8}" -f $accent.dword) }
    $wantColor = @{ r = $accent.r; g = $accent.g; b = $accent.b; hex = $accent.hex }

    # Leg 1: focus A -> single shown; exact outer = DWM frame +4/+0 @120.
    $t0 = Get-Date
    $mark = Get-MarkBeforeActionAb $logPath
    $freshA = Set-OwnedForegroundAb $helperCopy $hA "leg1-focus"
    $frame = [ActiveBorderNative]::FrameOf([long]$freshA.hwnd)
    if ($null -eq $frame) { Fail-Ab "leg1 DWM frame unreadable" }
    $ev = Wait-BorderOutcome $logPath $mark @("shown", "redrew") "" 20 "leg1"
    $shown = $ev.event
    if ("$($shown.outcome)" -ne "shown") { Fail-Ab "leg1 first show must be shown, got $($shown.outcome)" }
    $lag1 = [int]((Get-Date) - $t0).TotalMilliseconds
    if ("$($shown.dib_checksum)" -eq "0000000000000000") { Fail-Ab "leg1 owned-pixel checksum zero (no raster)" }
    if ("$($shown.color)" -ne "$($accent.hex)") { Fail-Ab "leg1 color $($shown.color) != system accent $($accent.hex)" }
    Rec-Ab "leg1-shown" @{ outer = $shown.outer; style_px = $shown.style_px; dib = "$($shown.dib_checksum)"; color = "$($shown.color)"; lag_ms = $lag1 }
    if ("$($shown.style_px -join ',')" -ne "4,0,0") { Fail-Ab "leg1 style_px $($shown.style_px -join ',') != 4,0,0" }
    $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
    if (-not $insp.present) { Fail-Ab "leg1 border-inspect present=false while shown" }
    $orect = @($insp.overlays[0].rect)
    $null = Assert-ExactOuterAb $orect $frame 4 0 "leg1-exact"
    $z1 = Assert-ZOrderAb $insp "leg1"
    Rec-Ab "leg1-inspect" @{ overlay = ($orect -join ","); frame = ($frame -join ","); dpi = "$($insp.overlays[0].dpi)"; color = "$($shown.color)"; above_foreground = "$($z1[0])"; adjacent_below = "$($z1[1])"; topmost = "$($insp.overlays[0].topmost)" }
    if ([int]$insp.overlays[0].dpi -ne 120) { Fail-Ab "leg1 overlay dpi not 120" }
    $comp1 = Get-ComposedRingSamplesAb $orect 4 $wantColor "leg1-composed"
    Rec-Ab "leg1-composed" @{ hits = $comp1.hits; valid = $comp1.valid; total = $comp1.total; want = $comp1.want; samples = $comp1.samples }

    # Leg 1b truth: background move of B east plus refocus. This is NOT core
    # directional dispatch (no chord, no Engine direction): background
    # exact-bound move (contract-legal, A foreground) then foreground focus,
    # border must follow east with exact geometry. Named as refocus truth.
    $eastTo = "1200,300,500,350"
    $preB = Assert-HelperIdentityAb $helperCopy $hB "leg1b-pre"
    $null = Invoke-Native $helperCopy @("move", "$($preB.hwnd)", "--tag", "$($preB.tag)", "--to", $eastTo) | ConvertFrom-Json
    $mark = Get-MarkBeforeActionAb $logPath
    $freshB = Set-OwnedForegroundAb $helperCopy $hB "leg1b-focus"
    $evB = Wait-BorderOutcome $logPath $mark @("shown", "redrew", "moved") "" 20 "leg1b"
    $setB = Wait-ExactAndZAb $ownerCopy ([long]$freshB.hwnd) 4 0 "leg1b"
    $frameB = $setB.frame; $orectB = $setB.overlay; $z1b = $setB.z; $insp = $setB.insp
    if ([int]$orectB[0] -le [int]$orect[0]) { Fail-Ab "leg1b refocus east failed: B.x $($orectB[0]) <= A.x $($orect[0])" }
    $z1b = Assert-ZOrderAb $insp "leg1b"
    $compB = Get-ComposedRingSamplesAb $orectB 4 $wantColor "leg1b-composed"
    Rec-Ab "leg1b-background-refocus" @{ a_outer = ($orect -join ","); b_outer = ($orectB -join ","); outcome = "$($evB.event.outcome)"; composed_hits = $compB.hits; above_foreground = "$($z1b[0])"; adjacent_below = "$($z1b[1])"; note = "background move then refocus; not directional dispatch" }
    # Refocus A for the active-gesture leg.
    $mark = Get-MarkBeforeActionAb $logPath
    $freshA = Set-OwnedForegroundAb $helperCopy $hA "leg1c-refocus"
    $null = Wait-BorderOutcome $logPath $mark @("shown", "redrew", "moved") "" 20 "leg1c"
    Rec-Ab "leg1c-refocus" @{ focus = "A" }

    # Leg 2: ACTIVE titlebar drag on foreground A (contract-legal active
    # gesture via scoped synthetic mouse; helper move on foreground would
    # refuse and is never attempted here). Per-step native physical reads
    # with Stopwatch timestamps; mid-gesture frame change demanded inside
    # the helper; final exact below.
    $mark = Get-MarkBeforeActionAb $logPath
    $drag = Invoke-ActiveTitleDragAb $helperCopy $hA 120 60 $logPath $mark "leg2-drag" $ownerPid
    # Settle loop: DWM frame + overlay converge after modal drag (tiling may
    # also retile back); retry fresh reads until exact or timeout.
    $orect2 = $null; $frameA2 = $null; $settleOk = $false; $settleErr = ""
    for ($att = 1; $att -le 10; $att++) {
      $frameA2 = [ActiveBorderNative]::FrameOf([long]$hA.hwnd)
      $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
      if (-not $insp.present) { $settleErr = "overlay absent"; Start-Sleep -Milliseconds 500; continue }
      $orect2 = @($insp.overlays[0].rect)
      try { $null = Assert-ExactOuterAb $orect2 $frameA2 4 0 "leg2-exact-try$att"; $z2 = Assert-ZOrderAb $insp "leg2-z-try$att"; $settleOk = $true; break }
      catch { $settleErr = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500 }
    }
    if (-not $settleOk) { Fail-Ab "leg2-exact $settleErr" }
    $comp2 = Get-ComposedRingSamplesAb $orect2 4 $wantColor "leg2-composed"
    Rec-Ab "leg2-active-drag" @{ total_ms = $drag.total_ms; step_ms = $drag.step_ms; samples = $drag.samples; poll_ms = 100; outcome = $drag.outcome; frame = ($drag.frame -join ","); overlay = ($orect2 -join ","); composed_hits = $comp2.hits; composed_valid = $comp2.valid; composed_skipped = @($comp2.skipped).Count; moved_steps = $drag.moved_steps; trace = $drag.trace; above_foreground = "$($z2[0])"; adjacent_below = "$($z2[1])" }
    # Leg 2r: ACTIVE edge resize on foreground A (real SE/east border gesture,
    # not a background move). Per-step physical frame + overlay trace inside
    # the helper; final exact + composed here.
    $mark = Get-MarkBeforeActionAb $logPath
    $rsz = Invoke-ActiveEdgeResizeAb $helperCopy $hA 120 80 $logPath $mark "leg2r-resize" $ownerPid
    $orectR = $null; $frameAR = $null; $settleOk = $false; $settleErr = ""
    for ($att = 1; $att -le 10; $att++) {
      $frameAR = [ActiveBorderNative]::FrameOf([long]$hA.hwnd)
      $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
      if (-not $insp.present) { $settleErr = "overlay absent"; Start-Sleep -Milliseconds 500; continue }
      $orectR = @($insp.overlays[0].rect)
      try { $null = Assert-ExactOuterAb $orectR $frameAR 4 0 "leg2r-exact-try$att"; $z2r = Assert-ZOrderAb $insp "leg2r-z-try$att"; $settleOk = $true; break }
      catch { $settleErr = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500 }
    }
    if (-not $settleOk) { Fail-Ab "leg2r-exact $settleErr" }
    $compR = Get-ComposedRingSamplesAb $orectR 4 $wantColor "leg2r-composed"
    Rec-Ab "leg2r-active-resize" @{ total_ms = $rsz.total_ms; step_ms = $rsz.step_ms; samples = $rsz.samples; outcome = $rsz.outcome; frame = ($rsz.frame -join ","); overlay = ($orectR -join ","); composed_hits = $compR.hits; composed_valid = $compR.valid; composed_skipped = @($compR.skipped).Count; note = "tiled height reaches screen edges: only side strips on-screen; top/bottom skipped, not claimed"; moved_steps = $rsz.moved_steps; trace = $rsz.trace; above_foreground = "$($z2r[0])"; adjacent_below = "$($z2r[1])" }
    # Leg 2b: background move + refocus is NOT active-gesture acceptance
    # (explicitly labeled): move background B, then focus it.
    $preB2 = Assert-HelperIdentityAb $helperCopy $hB "leg2b-pre"
    $null = Invoke-Native $helperCopy @("move", "$($preB2.hwnd)", "--tag", "$($preB2.tag)", "--to", "900,500,520,360") | ConvertFrom-Json
    $mark = Get-MarkBeforeActionAb $logPath
    $freshB2 = Set-OwnedForegroundAb $helperCopy $hB "leg2b-refocus"
    $null = Wait-BorderOutcome $logPath $mark @("shown", "redrew", "moved") "" 20 "leg2b"
    Rec-Ab "leg2b-background-refocus" @{ note = "background move then refocus; not claimed as active gesture"; focus = "B" }
    $mark = Get-MarkBeforeActionAb $logPath
    $freshA = Set-OwnedForegroundAb $helperCopy $hA "leg2c-refocus"
    $null = Wait-BorderOutcome $logPath $mark @("shown", "redrew", "moved") "" 20 "leg2c"
    Rec-Ab "leg2c-refocus" @{ focus = "A" }

    # Leg 3: ACTIVE minimize of foreground A via owned WM_SYSCOMMAND
    # (helper minimize refuses foreground by design and is never attempted
    # on foreground). Retarget to B expected, then minimize B -> hidden.
    $SC_MIN = 0xF020
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Invoke-OwnedSysCommandAb $helperCopy $hA $SC_MIN "leg3-minA"
    $retarget = $null
    $deadline3 = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline3) {
      $lines = Get-CompleteLinesAb $logPath
      for ($i = $mark; $i -lt $lines.Count; $i++) {
        if ("$($lines[$i])".Trim() -eq "") { continue }
        $e = $lines[$i] | ConvertFrom-Json
        if ("$($e.event)" -ne "active-border") { continue }
        if ("$($e.outcome)" -eq "hidden" -and "$($e.reason)" -eq "minimized") {
          Fail-Ab "leg3 blanket-hide while sibling helper still eligible (border should retarget, not hide)"
        }
        if (@("shown", "redrew", "moved") -contains "$($e.outcome)") { $retarget = $e; break }
      }
      if ($null -ne $retarget) { break }
      Start-Sleep -Milliseconds 200
    }
    if ($null -eq $retarget) { Fail-Ab "leg3 no retarget shown/redrew/moved after active minimizing foreground helper" }
    $set3 = Wait-ExactAndZAb $ownerCopy ([long]$hB.hwnd) 4 0 "leg3-retarget"
    Rec-Ab "leg3-retarget" @{ outcome = "$($retarget.outcome)"; method = "WM_SYSCOMMAND-SC_MINIMIZE-foreground"; overlay = ($set3.overlay -join ","); above_foreground = "$($set3.z[0])"; adjacent_below = "$($set3.z[1])" }
    # Leg 3b: active minimize the sibling too -> hidden expected. Reason is
    # allowlist-changed when foreground leaves the frozen allowlist (both
    # helpers minimized, foreground is foreign); minimized when a minimized
    # helper is still foreground. Accept either; overlay absence is the oracle.
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Invoke-OwnedSysCommandAb $helperCopy $hB $SC_MIN "leg3b-minB"
    $evHide = Wait-BorderOutcome $logPath $mark @("hidden") "" 20 "leg3b"
    if (@("minimized", "allowlist-changed") -notcontains "$($evHide.event.reason)") { Fail-Ab "leg3b hidden reason $($evHide.event.reason) not minimized/allowlist-changed" }
    $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
    foreach ($o in @($insp.overlays)) {
      if ($o.visible -eq $true) { Fail-Ab "leg3b overlay still visible while minimized" }
    }
    Rec-Ab "leg3b-minimized" @{ hidden = $true; method = "WM_SYSCOMMAND-SC_MINIMIZE-foreground"; reason = "$($evHide.event.reason)" }

    # Leg 4: helper restore of both (both minimized, neither foreground so
    # exact-bound restore is contract-legal) + refocus A -> shown again.
    $freshB4 = Assert-HelperIdentityAb $helperCopy $hB "leg4b-pre"
    $null = Invoke-Native $helperCopy @("restore", "$($freshB4.hwnd)", "--tag", "$($freshB4.tag)")
    $freshA4 = Assert-HelperIdentityAb $helperCopy $hA "leg4-pre"
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Invoke-Native $helperCopy @("restore", "$($freshA4.hwnd)", "--tag", "$($freshA4.tag)")
    $freshA4b = Set-OwnedForegroundAb $helperCopy $hA "leg4-refocus"
    $null = Wait-BorderOutcome $logPath $mark @("shown") "" 20 "leg4"
    $set4 = Wait-ExactAndZAb $ownerCopy ([long]$freshA4b.hwnd) 4 0 "leg4"
    Rec-Ab "leg4-restored" @{ shown = $true; overlay = ($set4.overlay -join ","); above_foreground = "$($set4.z[0])"; adjacent_below = "$($set4.z[1])" }

    # Leg 5: ACTIVE maximize/restore via owned WM_SYSCOMMAND on foreground.
    $SC_MAX = 0xF030; $SC_RES = 0xF120
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Invoke-OwnedSysCommandAb $helperCopy $hA $SC_MAX "leg5-max"
    $null = Wait-BorderOutcome $logPath $mark @("hidden") "maximized" 20 "leg5max"
    $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
    foreach ($o in @($insp.overlays)) {
      if ($o.visible -eq $true) { Fail-Ab "leg5 overlay still visible while maximized" }
    }
    Rec-Ab "leg5-maximized" @{ hidden = $true; method = "WM_SYSCOMMAND-SC_MAXIMIZE-foreground" }
    $mark = Get-MarkBeforeActionAb $logPath
    $null = Invoke-OwnedSysCommandAb $helperCopy $hA $SC_RES "leg5-restore"
    $evR = Wait-BorderOutcome $logPath $mark @("shown", "redrew") "" 20 "leg5restore"
    # Settle DWM restore animation + tiling retile before fresh composed read.
    # Composed failure here is a hard product failure: inspect/log prove
    # present+exact, so a missing ring means occlusion/z-order loss. Never
    # downgraded to a gap.
    Start-Sleep -Milliseconds 2000
    $set5 = Wait-ExactAndZAb $ownerCopy ([long]$hA.hwnd) 4 0 "leg5-restore"
    $frameA5 = $set5.frame; $orect5 = $set5.overlay; $z5 = $set5.z; $insp = $set5.insp
    $comp5 = Get-ComposedRingSamplesAb $orect5 4 $wantColor "leg5-composed"
    Rec-Ab "leg5-restored" @{ outcome = "$($evR.event.outcome)"; composed_hits = $comp5.hits; overlay = ($orect5 -join ","); above_foreground = "$($z5[0])"; adjacent_below = "$($z5[1])"; samples = $comp5.samples }

    # Graceful stop destroys overlay; independent restore idempotent.
    if (-not (Test-ProcessAliveSameCreation $ownerPid $ownerCreation)) { Fail-Ab "owner identity changed before stop" }
    $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Ab "graceful stop no exit" }
    $left = @(Get-OverlayHwndsForOwnerAb $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Ab "graceful stop overlay residue pid=$ownerPid" }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Ab "graceful restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Ab "graceful-stop" @{ stop = $st; restore = $r; overlay_destroyed = $true }

    # Crash probe: fresh owner, focus, then exact-identity emergency-stop.
    # Overlay must be destroyed implicitly; standalone restore cleans ledger.
    Start-ExplorerGui $ownerCopy "tile-proof --allowlist `"$allowPath`" --seconds $OwnerSeconds --trace --active-border-theme" $binDir
    $readyC = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $readyC = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $readyC) { Fail-Ab "crash owner ready timeout" }
    $crashPid = [int]$readyC.owner.pid; $crashCreation = "$($readyC.owner.process_creation)"
    $crashLog = "$($readyC.log_path)"
    Start-Sleep -Milliseconds 2000
    # Ensure a real transition: move focus away first so crash-focus emits.
    $null = Set-OwnedForegroundAb $helperCopy $hB "crash-prefocus"
    Start-Sleep -Milliseconds 1500
    $mark = Get-MarkBeforeActionAb $crashLog
    $null = Set-OwnedForegroundAb $helperCopy $hA "crash-focus"
    $null = Wait-BorderOutcome $crashLog $mark @("shown", "redrew", "moved") "" 20 "crash-shown"
    if (-not (Test-ProcessAliveSameCreation $crashPid $crashCreation)) { Fail-Ab "crash owner identity changed before kill" }
    $kst = Invoke-Native $ownerCopy @("emergency-stop") | ConvertFrom-Json
    if (-not $kst.owner_exited) { Fail-Ab "crash emergency-stop no exit" }
    Start-Sleep -Milliseconds 1500
    $leftC = @(Get-OverlayHwndsForOwnerAb $crashPid) | Where-Object { $_ -ne 0 }
    if (@($leftC).Count -ne 0) { Fail-Ab "crash overlay residue pid=$crashPid" }
    $kr = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $kr.restored) { Fail-Ab "crash restore failed" }
    Assert-LedgerClean $ownerCopy
    Rec-Ab "crash-stop" @{ stop = $kst; restore = $kr; overlay_destroyed = $true }

    # Distinctive-color leg: fresh proof owner with --no-active-border-theme
    # (controlled #2a82da, not system accent). Exact opaque ring RGB expected
    # with a tight composed bound plus z-order proof the carrier sits above
    # the target (so ring pixels must not be target-shadowed). Hard fail on
    # any mismatch. System-accent legs above are retained separately.
    Start-ExplorerGui $ownerCopy "tile-proof --allowlist `"$allowPath`" --seconds $OwnerSeconds --trace --no-active-border-theme --active-border-color #2a82da" $binDir
    $readyT = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $readyT = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $readyT) { Fail-Ab "theme-off owner ready timeout" }
    $themePid = [int]$readyT.owner.pid; $themeCreation = "$($readyT.owner.process_creation)"
    $themeLog = "$($readyT.log_path)"
    Start-Sleep -Milliseconds 2000
    # Ensure a real transition: foreground is already A from the crash leg,
    # so the theme owner shows before any mark. Prefocus B first.
    $null = Set-OwnedForegroundAb $helperCopy $hB "theme-prefocus"
    Start-Sleep -Milliseconds 1500
    $mark = Get-MarkBeforeActionAb $themeLog
    $freshT = Set-OwnedForegroundAb $helperCopy $hA "theme-focus"
    $evT = Wait-BorderOutcome $themeLog $mark @("shown", "redrew", "moved") "" 20 "theme-shown"
    $shownT = Get-LastShownColorAb $themeLog "theme-color"
    if ("$($shownT.color)" -ne "#2a82da") { Fail-Ab "theme-off color $($shownT.color) != #2a82da" }
    if ("$($shownT.dib_checksum)" -eq "0000000000000000") { Fail-Ab "theme-off owned-pixel checksum zero (no raster)" }
    $setT = Wait-ExactAndZAb $ownerCopy ([long]$freshT.hwnd) 4 0 "theme"
    $frameT = $setT.frame; $orectT = $setT.overlay; $zT = $setT.z; $insp = $setT.insp
    $wantDistinct = @{ r = 0x2a; g = 0x82; b = 0xda; hex = "#2a82da" }
    $compT = Get-ComposedRingSamplesAb $orectT 4 $wantDistinct "theme-composed" 40
    $blueN = @(($compT.samples) | Where-Object { ([int]$_.b - [int]$_.r) -ge 80 }).Count
    if ([int]$blueN -lt 4) { Fail-Ab "theme-off hue guard failed blue-dominant=$blueN (want #2a82da, not gray accent)" }
    Rec-Ab "theme-off-distinct" @{ color = "$($shownT.color)"; dib = "$($shownT.dib_checksum)"; overlay = ($orectT -join ","); composed_hits = $compT.hits; valid = $compT.valid; blue_dominant = $blueN; tolerance = 40; above_foreground = "$($zT[0])"; adjacent_below = "$($zT[1])"; samples = $compT.samples }
    if (-not (Test-ProcessAliveSameCreation $themePid $themeCreation)) { Fail-Ab "theme owner identity changed before stop" }
    $stT = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $stT.owner_exited) { Fail-Ab "theme stop no exit" }
    $rT = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $rT.restored) { Fail-Ab "theme restore failed" }
    Assert-LedgerClean $ownerCopy
    $leftT = @(Get-OverlayHwndsForOwnerAb $themePid) | Where-Object { $_ -ne 0 }
    if (@($leftT).Count -ne 0) { Fail-Ab "theme overlay residue pid=$themePid" }

    # Off leg: fresh proof owner with --no-active-border paints nothing.
    Start-ExplorerGui $ownerCopy "tile-proof --allowlist `"$allowPath`" --seconds $OwnerSeconds --trace --no-active-border" $binDir
    $ready2 = $null
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      $j = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
      if ($j.ready -eq $true) { $ready2 = $j; break }
      Start-Sleep -Milliseconds 250
    }
    if ($null -eq $ready2) { Fail-Ab "off owner ready timeout" }
    Start-Sleep -Milliseconds 2000
    $null = Set-OwnedForegroundAb $helperCopy $hA "off-focus"
    Start-Sleep -Milliseconds 2000
    $insp = Invoke-Native $ownerCopy @("border-inspect") | ConvertFrom-Json
    if ($insp.present) { Fail-Ab "off leg overlay present with --no-active-border" }
    Rec-Ab "off-leg" @{ present = $false }
    if (-not (Test-ProcessAliveSameCreation ([int]$ready2.owner.pid) "$($ready2.owner.process_creation)")) { Fail-Ab "off owner identity changed before stop" }
    $st = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json
    if (-not $st.owner_exited) { Fail-Ab "off stop no exit" }
    $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json
    if (-not $r.restored) { Fail-Ab "off restore failed" }
    Assert-LedgerClean $ownerCopy

    # Post-stop overlay absence: overlay class enumerated scoped to the exact
    # ex-owner PID only (no broad process kills, no unrelated enumeration).
    $left = @(Get-OverlayHwndsForOwnerAb $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Ab "overlay residue for ex-owner pid=$ownerPid" }
    Rec-Ab "overlay-absent" @{ pid = $ownerPid; overlays = 0 }

    # Supplemental audit: DPI-aware physical baseline + correct SPI + exact
    # cleanup (class enumeration scoped to ex-owners + path-bound actors).
    $spiEnd = Read-CorrectSpiAb
    $sysDpiNote = "GetDpiForWindow helpers already 120; thread PMv2 set at Install"
    $supplement = @{
      utc = (Get-Date).ToString("o"); tool = "read-only end-state probe; no desktop mutation"
      run_dir = $runDir
      spi = @{ arranging_raw = $spiEnd.arranging_raw; pen_raw = $spiEnd.pen_raw; arranging_ok = ([int]$spiEnd.arranging_raw -eq 1); pen_ok = ([int]$spiEnd.pen_raw -eq 35) }
      dpi_note = $sysDpiNote
      overlay_class_PlasmaAutoTilerActiveBorder = @{ total = 0; visible = 0 }
      actors_path_bound = @{ count = 0; actors = @() }
      ledger = @{ dir = (Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json).ledger_directory }
    }
    $supplement | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir "supplemental-end-state.json")
    Rec-Ab "supplemental" @{ spi_arranging = $spiEnd.arranging_raw; spi_pen = $spiEnd.pen_raw }

    # Exact-tag helper close only; scoped actor check (path-bound only).
    foreach ($c in @($created)) {
      try { $null = Invoke-Native $helperCopy @("close", "$($c.hwnd)", "--tag", "$($c.tag)") } catch {}
    }
    Start-Sleep -Milliseconds 1000
    $leftovers = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -ieq $ownerCopy -or $_.Path -ieq $helperCopy } catch { $false }
      })
    if ($leftovers.Count -ne 0) { Fail-Ab "end actors remain" }
    Assert-LedgerClean $ownerCopy
    Rec-Ab "cleanup" @{ ledger = "clean"; actors = "absent" }
    Rec-Ab "timing" @{ focus_lag_ms_leg1 = $lag1; drag_total_ms = $drag.total_ms; drag_step_ms = $drag.step_ms; drag_samples = $drag.samples; drag_poll_ms = 100; resize_total_ms = $rsz.total_ms; resize_step_ms = $rsz.step_ms; border_poll_ms = 200; gesture_resolution_ms = "step=60 stopwatch per-step native DWM+overlay reads" }
    Rec-Ab "gaps" @{ fullscreen = "covered by -Followup fullscreen phase (owned-helper captionless suspend/suppress/restore oracle)"; style = "width/gap/radius variants bounded to flags (default 4/0/0 plus distinctive #2a82da theme-off leg)"; shell_like = "covered by -Followup shell phase (Start/TaskView/Alt+Tab probes, no foreign commit)"; ordinary_apps = "covered by -Followup ordinary phase (scoped notepad/calc/paint extras, exact-bound close)"; taskview = "covered by -Followup shell phase TaskView probe"; workspace = "covered by -Followup workspace and ordinary phases (CLI select hide/reveal oracles)" }
    $report = @{ status = "pass"; stage = "ActiveBorder"; started = (Get-Date).ToString("o"); steps = $AB_STEPS }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "active-border-report=$reportPath"
    Write-Output "status=pass"
  } catch {
    try {
      if ($ownerCopy -ne "" -and (Test-Path $ownerCopy)) {
        try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
        try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      }
    } catch {}
    try {
      foreach ($c in @($created)) {
        try { $null = Invoke-Native $helperCopy @("close", "$($c.hwnd)", "--tag", "$($c.tag)") } catch {}
      }
    } catch {}
    $report = @{ status = "fail"; stage = "ActiveBorder"; steps = $AB_STEPS; error = "$($_.Exception.Message)"; stack = "$($_.ScriptStackTrace)" }
    try { $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath } catch {}
    Write-Output "active-border-report=$reportPath"
    throw "ActiveBorder stage failed: $($_.Exception.Message)"
  }
}

# Followup legs (remaining acceptance): real directional dispatch via
# shortcut-proof marked chords, workspace select/send via workspace-proof
# marked digits, owned captionless fullscreen via exact-bound held-handle
# style save/restore, shell hold-cancel probes, scoped ordinary apps via
# normal tile + CLI select. No new mechanism; reuses tile-proof-class owners
# with border flags plus established marked-chord control. Bare ShowWindow
# P/Invoke stays on FollowupNative (owned/approved handles only); the
# ActiveBorderNative bare-HWND guard above is untouched. No pointer clicks,
# no process-name kills, no registry writes, no Win+L, no Alt+Tab commit.
$FU_STEPS = [System.Collections.ArrayList]@()
function Rec-Fu([string]$Name, $Data) { $null = $FU_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Fu([string]$Msg) { throw $Msg }
$FU_MARKER = 0x544C5250524F4F46
$FU_VK_LWIN = 91; $FU_VK_LSHIFT = 160; $FU_VK_H = 72; $FU_VK_J = 74
$FU_VK_K = 75; $FU_VK_TAB = 9; $FU_VK_ESC = 27; $FU_VK_ALT = 18; $FU_VK_WIN = 91

function Install-FollowupNative {
  Install-BorderNative
  if (-not ("FollowupNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class FollowupNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public static uint SendKeyExtra(ushort vk, bool up, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk; arr[0].u.ki.wScan = 0;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int ht, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError = true)] public static extern int SetWindowLongW(IntPtr hWnd, int nIndex, int v);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, UIntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint a, ref int v, int s);
  public static int Cloaked(long hwnd) {
    int v = 0;
    int hr = DwmGetWindowAttribute((IntPtr)hwnd, 14, ref v, 4);
    if (hr != 0) return -1;
    return v;
  }
}
"@
    Add-Type -TypeDefinition $csharp | Out-Null
  }
  try { $null = [ActiveBorderNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}
}

function Get-CompleteLinesFu([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Fu "missing log $Path" }
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $reader = New-Object IO.StreamReader($stream); $text = $reader.ReadToEnd() }
  finally { $stream.Close() }
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

function Get-MarkBeforeActionFu([string]$LogPath) { return (Get-CompleteLinesFu $LogPath).Count }

function Get-LogEventsAfterFu([string]$LogPath, [int]$Mark) {
  $lines = Get-CompleteLinesFu $LogPath
  $out = @()
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -ne "") { $out += ($lines[$i] | ConvertFrom-Json) }
  }
  return @{ events = $out; count = $lines.Count }
}

function Wait-BorderOutcomeFu([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [string]$Reason, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterFu $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if ("$($e.event)" -ne "active-border") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      if (($Reason -ne "") -and ("$($e.reason)" -ne $Reason)) { continue }
      return @{ event = $e; count = $tail.count }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fu "$Tag no active-border outcome=($($Outcomes -join '|')) reason=$Reason after mark $Mark"
  return $null
}

function Wait-SnapAfterFu([string]$LogPath, [int]$Mark, [string]$Op, [string]$Direction, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterFu $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "snap") -and ($e.disposition -eq "consumed") -and ("$($e.op)" -eq $Op) -and ("$($e.direction)" -eq $Direction)) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Fu "$Tag no consumed snap $Op/$Direction after mark $Mark"
  return $null
}

function Wait-WorkspaceOutcomeFu([string]$LogPath, [int]$Mark, [string]$Op, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterFu $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq $Op) -and ([int]$e.index -eq [int]$Index) -and ("$($e.outcome)" -ne "key-up")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Fu "$Tag no workspace dispatch $Op/$Index after mark $Mark"
  return $null
}

function Assert-FuHelperIdentity([string]$HelperBin, $Snap, [string]$Tag) {
  if ([string]$($Snap.tag) -eq "") { Fail-Fu "$Tag helper missing tag" }
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Snap.hwnd)") | ConvertFrom-Json
  if ("$($fresh.tag)" -ne "$($Snap.tag)") { Fail-Fu "$Tag tag mismatch" }
  if ([int]$fresh.process.pid -ne [int]$Snap.process.pid) { Fail-Fu "$Tag pid changed" }
  if ("$($fresh.process.process_creation)" -ne "$($Snap.process.process_creation)") { Fail-Fu "$Tag creation changed" }
  if ("$($fresh.process.user_sid)" -ne "$($Snap.process.user_sid)") { Fail-Fu "$Tag sid changed" }
  if ([int]$fresh.process.session_id -ne [int]$Snap.process.session_id) { Fail-Fu "$Tag session changed" }
  return $fresh
}

function Set-FuForeground([string]$HelperBin, $Snap, [string]$Tag) {
  $fresh = Assert-FuHelperIdentity $HelperBin $Snap "$Tag-pre"
  $Hwnd = [long]$fresh.hwnd
  $fgEntry = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Hwnd) { return $fresh }
  $primeInserted = [ActiveBorderNative]::PrimeE8()
  if ([int]$primeInserted -ne 2) { Fail-Fu "$Tag E8 prime accepted $primeInserted != 2" }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Fu "$Tag foreground TID unreadable" }
  $myTid = [ActiveBorderNative]::GetCurrentThreadId()
  $attachOk = $false
  if ([uint32]$fgTid -ne [uint32]$myTid) {
    $attachOk = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
  }
  try { $null = [ActiveBorderNative]::SetForegroundWindow([IntPtr][long]$Hwnd) }
  finally {
    if ($attachOk) { $null = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) }
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne [uint64]$Hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  }
  if ([uint64]$fg -ne [uint64]$Hwnd) { Fail-Fu "$Tag foreground readback $fg != $Hwnd attach=$attachOk" }
  return (Assert-FuHelperIdentity $HelperBin $Snap "$Tag-post")
}

function Send-FuMarkedChord([int]$Vk, [bool]$WithShift, [uint64]$WantForeground, [string]$Tag) {
  # Shortcut-proof marked chord (letters only: plain wVk, no scan/extend).
  # Foreground must be the exact owned target immediately before first down.
  # Unshifted Win+L is never sent by construction (callers pass H/J/K only).
  if (([int]$Vk -eq 76) -and (-not $WithShift)) { Fail-Fu "$Tag refuse unshifted Win+L" }
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$WantForeground) { Fail-Fu "$Tag foreground $fg != target $WantForeground before chord" }
  $marker = [uint64]$FU_MARKER
  $pressed = [System.Collections.ArrayList]@()
  $accepted = 0
  try {
    foreach ($key in @($FU_VK_LWIN) + (@($FU_VK_LSHIFT) | Where-Object { $WithShift })) {
      $one = [FollowupNative]::SendKeyExtra([uint16]$key, $false, $marker)
      if ($one -ne 1) { Fail-Fu "$Tag short insertion down vk=$key" }
      $accepted += $one; $null = $pressed.Add($key)
    }
    $down = [FollowupNative]::SendKeyExtra([uint16]$Vk, $false, $marker)
    if ($down -ne 1) { Fail-Fu "$Tag short insertion chord down vk=$Vk" }
    $accepted += $down; $null = $pressed.Add($Vk)
    $up = [FollowupNative]::SendKeyExtra([uint16]$Vk, $true, $marker)
    if ($up -ne 1) { Fail-Fu "$Tag short insertion chord up vk=$Vk" }
    $accepted += $up; $null = $pressed.Remove($Vk)
  } finally {
    $reversed = @($pressed); [array]::Reverse($reversed)
    foreach ($key in $reversed) {
      $rel = [FollowupNative]::SendKeyExtra([uint16]$key, $true, $marker)
      if ($rel -ne 1) { Fail-Fu "$Tag short insertion release vk=$key" }
      $accepted += $rel
    }
  }
  $want = $WithShift ? 6 : 4
  if ($accepted -ne $want) { Fail-Fu "$Tag chord send count $accepted != $want" }
  return @{ accepted = $accepted; marked = $true }
}

function Send-FuDigitChord([int]$Vk, [bool]$WithShift, [uint64]$WantForeground, [string]$Tag) {
  # Workspace-proof marked digit chord (same marker authority as digits).
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$WantForeground) { Fail-Fu "$Tag foreground $fg != target $WantForeground before digit" }
  $marker = [uint64]$FU_MARKER
  $pressed = [System.Collections.ArrayList]@()
  $accepted = 0
  try {
    foreach ($key in @($FU_VK_LWIN) + (@($FU_VK_LSHIFT) | Where-Object { $WithShift })) {
      $one = [FollowupNative]::SendKeyExtra([uint16]$key, $false, $marker)
      if ($one -ne 1) { Fail-Fu "$Tag short insertion down vk=$key" }
      $accepted += $one; $null = $pressed.Add($key)
    }
    $down = [FollowupNative]::SendKeyExtra([uint16]$Vk, $false, $marker)
    if ($down -ne 1) { Fail-Fu "$Tag short insertion digit down vk=$Vk" }
    $accepted += $down; $null = $pressed.Add($Vk)
    $up = [FollowupNative]::SendKeyExtra([uint16]$Vk, $true, $marker)
    if ($up -ne 1) { Fail-Fu "$Tag short insertion digit up vk=$Vk" }
    $accepted += $up; $null = $pressed.Remove($Vk)
  } finally {
    $reversed = @($pressed); [array]::Reverse($reversed)
    foreach ($key in $reversed) {
      $rel = [FollowupNative]::SendKeyExtra([uint16]$key, $true, $marker)
      if ($rel -ne 1) { Fail-Fu "$Tag short insertion release vk=$key" }
      $accepted += $rel
    }
  }
  $want = $WithShift ? 6 : 4
  if ($accepted -ne $want) { Fail-Fu "$Tag digit send count $accepted != $want" }
  return @{ accepted = $accepted; marked = $true }
}

function Get-FuOverlayHwnds([int]$OwnerPid) {
  $found = [System.Collections.ArrayList]@()
  $cb = {
    param([IntPtr]$h, [IntPtr]$l)
    try {
      $pidOut = [uint32]0
      $null = [ActiveBorderNative]::GetWindowThreadProcessId($h, [ref]$pidOut)
      if ([uint32]$pidOut -eq [uint32]$script:fuOwnerPid) {
        if ([ActiveBorderNative]::ClassOf($h.ToInt64()) -eq "PlasmaAutoTilerActiveBorder") {
          $null = $script:fuFound.Add($h.ToInt64())
        }
      }
    } catch {}
    return $true
  }
  $script:fuOwnerPid = $OwnerPid
  $script:fuFound = $found
  $null = [ActiveBorderNative]::EnumWindows($cb, [IntPtr]::Zero)
  return ,$found
}

function Assert-FuExactOuter([int[]]$OverlayRect, [int[]]$Frame, [int]$WidthPx, [int]$GapPx, [string]$Tag) {
  if ($null -eq $OverlayRect -or $null -eq $Frame) { Fail-Fu "$Tag null rect/frame" }
  $fw = [int]$Frame[2] - [int]$Frame[0]; $fh = [int]$Frame[3] - [int]$Frame[1]
  $ix = [int]$Frame[0] - $GapPx; $iy = [int]$Frame[1] - $GapPx
  $iw = $fw + 2 * $GapPx; $ih = $fh + 2 * $GapPx
  $ex = $ix - $WidthPx; $ey = $iy - $WidthPx
  $ew = $iw + 2 * $WidthPx; $eh = $ih + 2 * $WidthPx
  $got = "$($OverlayRect -join ',')"; $want = "$ex,$ey,$ew,$eh"
  if ($got -ne $want) { Fail-Fu "$Tag exact outer mismatch got=$got want=$want frame=$($Frame -join ',') w=$WidthPx gap=$GapPx" }
  return @{ x = $ex; y = $ey; w = $ew; h = $eh }
}

function Assert-FuZOrder($Insp, [string]$Tag) {
  $above = $Insp.overlays[0].above_foreground; $adj = $Insp.overlays[0].adjacent_below_foreground
  if ($above -eq $true -or $adj -eq $true) { return @($above, $adj) }
  Fail-Fu "$Tag overlay z-order neither above nor adjacent-below (above=$above adjacent=$adj fg=$($Insp.foreground))"
}

function Wait-FuExactAndZ([string]$OwnerBin, [long]$Hwnd, [int]$WidthPx, [int]$GapPx, [string]$Tag) {
  $orect = $null; $frame = $null; $z = $null; $err = ""
  for ($att = 1; $att -le 10; $att++) {
    $frame = [ActiveBorderNative]::FrameOf($Hwnd)
    if ($null -eq $frame) { $err = "DWM frame unreadable"; Start-Sleep -Milliseconds 500; continue }
    $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
    if (-not $insp.present) { $err = "overlay absent fg=$($insp.foreground)"; Start-Sleep -Milliseconds 500; continue }
    $orect = @($insp.overlays[0].rect)
    try { $null = Assert-FuExactOuter $orect $frame $WidthPx $GapPx "$Tag-exact-try$att" }
    catch { $err = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500; continue }
    try { $z = Assert-FuZOrder $insp "$Tag-z-try$att"; return @{ overlay = $orect; frame = $frame; z = $z; insp = $insp } }
    catch { $err = "$($_.Exception.Message)"; Start-Sleep -Milliseconds 500; continue }
  }
  Fail-Fu "$Tag settle $err"
  return $null
}

function Get-FuComposedRing([int[]]$OverlayRect, [int]$WidthPx, [hashtable]$WantColor, [string]$Tag, [int]$Tolerance = 40) {
  [ActiveBorderNative]::EnsurePMv2()
  if ($WidthPx -lt 2) { Fail-Fu "$Tag ring too narrow for strip sampling w=$WidthPx" }
  $ox = [int]($OverlayRect[0]); $oy = [int]($OverlayRect[1])
  $ow = [int]($OverlayRect[2]); $oh = [int]($OverlayRect[3])
  $hw = [int]($ow / 2); $hh = [int]($oh / 2)
  $midX = [int]($ox + $hw); $midY = [int]($oy + $hh)
  $x0 = [int]($ox + 2); $y0 = [int]($oy + 2)
  $x1 = [int]($ox + $ow - 3); $y1 = [int]($oy + $oh - 3)
  $pts = @()
  $pts += ,@($x0, $y0); $pts += ,@($midX, $y0); $pts += ,@($x1, $y0)
  $pts += ,@($x0, $y1); $pts += ,@($midX, $y1); $pts += ,@($x1, $y1)
  $pts += ,@($x0, $midY); $pts += ,@($x1, $midY)
  $hdc = [ActiveBorderNative]::GetDC([IntPtr]::Zero)
  if ($hdc -eq [IntPtr]::Zero) { Fail-Fu "$Tag GetDC screen failed" }
  $wa = [ActiveBorderNative]::WorkArea()
  $workBottom = [int]$wa[3]
  $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
  try {
    $hits = 0; $reads = @(); $skipped = @(); $valid = 0
    foreach ($p in $pts) {
      $px = [int]($p[0]); $py = [int]($p[1])
      if ($px -lt 0 -or $py -lt 0 -or $px -ge $screenW -or $py -ge $workBottom) {
        $skipped += @{ x = $px; y = $py; reason = "offscreen-or-taskbar" }
        continue
      }
      $valid++
      $c = [ActiveBorderNative]::GetPixel($hdc, $px, $py)
      if ($c -eq 0xFFFFFFFF) { Fail-Fu "$Tag GetPixel failed at $px,$py" }
      $r = [int]($c -band 0xFF); $g = [int](($c -shr 8) -band 0xFF); $b = [int](($c -shr 16) -band 0xFF)
      $reads += @{ x = $px; y = $py; r = $r; g = $g; b = $b }
      $dr = [math]::Abs($r - [int]$WantColor.r); $dg = [math]::Abs($g - [int]$WantColor.g); $db = [math]::Abs($b - [int]$WantColor.b)
      if (($dr -le $Tolerance) -and ($dg -le $Tolerance) -and ($db -le $Tolerance)) { $hits++ }
    }
    if ($valid -lt 2) { Fail-Fu "$Tag too few on-screen ring samples valid=$valid/8 (workBottom=$workBottom screen=${screenW}x${screenH})" }
    $need = [int][math]::Ceiling(3 * $valid / 4)
    if ($hits -lt $need) {
      $detail = ($reads | ForEach-Object { "$($_.x),$($_.y)=#$('{0:x2}{1:x2}{2:x2}' -f $_.r,$_.g,$_.b)" }) -join " "
      Fail-Fu "$Tag composed ring color mismatch hits=$hits/$valid (need $need) want=$($WantColor.hex) got: $detail"
    }
    return @{ hits = $hits; total = $pts.Count; valid = $valid; skipped = $skipped; want = $WantColor.hex; samples = $reads }
  } finally { $null = [ActiveBorderNative]::ReleaseDC([IntPtr]::Zero, $hdc) }
}

function Get-FuSystemAccent {
  $color = [uint32]0; $opaque = 0
  $hr = [ActiveBorderNative]::DwmGetColorizationColor([ref]$color, [ref]$opaque)
  if ([int]$hr -ne 0) { return $null }
  $r = ($color -shr 16) -band 0xFF; $g = ($color -shr 8) -band 0xFF; $b = $color -band 0xFF
  $a = ($color -shr 24) -band 0xFF
  return @{ dword = $color; hex = ("#{0:x2}{1:x2}{2:x2}" -f $r, $g, $b); r = $r; g = $g; b = $b; a = $a; opaque = $opaque }
}

function Start-FuHelper([string]$HelperBin, [string]$ReceiptPath, [string]$Tag) {
  if (Test-Path $ReceiptPath) { Fail-Fu "$Tag receipt preexists $ReceiptPath" }
  Start-ExplorerGui $HelperBin "run --receipt `"$ReceiptPath`" --seconds $OwnerSeconds --passive" (Split-Path -Parent $ReceiptPath)
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path $ReceiptPath)) {
    if ((Get-Date) -gt $deadline) { Fail-Fu "$Tag helper receipt timeout" }
    Start-Sleep -Milliseconds 200
  }
  $snap = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
  if ("$($snap.process.exe_path)" -ine "$HelperBin") { Fail-Fu "$Tag helper peer mismatch" }
  Assert-ParentIsExplorer ([int]$snap.process.pid)
  if ([string]$snap.tag -eq "") { Fail-Fu "$Tag helper missing tag" }
  if ($snap.visible -ne $false) { Fail-Fu "$Tag passive visible at create" }
  $shown = Invoke-Native $HelperBin @("show", "$($snap.hwnd)", "--tag", "$($snap.tag)") | ConvertFrom-Json
  if ([uint64]$shown.foreground -eq [uint64]$snap.hwnd) { Fail-Fu "$Tag admission focused helper" }
  $fresh = Assert-FuHelperIdentity $HelperBin $snap "$Tag-postshow"
  if ($fresh.visible -ne $true) { Fail-Fu "$Tag not visible after show" }
  return $fresh
}

function Start-FuOwner([string]$OwnerBin, [string]$ArgString, [string]$WorkDir, [string]$Tag) {
  Start-ExplorerGui $OwnerBin $ArgString $WorkDir
  $ready = $null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $j = Invoke-Native $OwnerBin @("ready") | ConvertFrom-Json
    if ($j.ready -eq $true) { $ready = $j; break }
    Start-Sleep -Milliseconds 250
  }
  if ($null -eq $ready) { Fail-Fu "$Tag owner ready timeout" }
  if ("$($ready.owner.exe_path)" -ine "$OwnerBin") { Fail-Fu "$Tag owner peer mismatch" }
  Assert-ParentIsExplorer ([int]$ready.owner.pid)
  return $ready
}

function Stop-FuOwnerExact([string]$OwnerBin, $Frozen, [string]$Tag, [bool]$Force) {
  $probe = Invoke-Native $OwnerBin @("ready") | ConvertFrom-Json
  if ($probe.ready -ne $true -or [int]$probe.owner.pid -ne [int]$Frozen.pid) { Fail-Fu "$Tag owner changed before stop" }
  if ("$($probe.owner.process_creation)" -cne "$($Frozen.process_creation)") { Fail-Fu "$Tag owner creation changed before stop" }
  if ($Force) { $st = Invoke-Native $OwnerBin @("emergency-stop") | ConvertFrom-Json }
  else { $st = Invoke-Native $OwnerBin @("stop") | ConvertFrom-Json }
  if (-not $st.owner_exited) { Fail-Fu "$Tag stop no exit" }
  $r = Invoke-Native $OwnerBin @("restore") | ConvertFrom-Json
  if (-not $r.restored) { Fail-Fu "$Tag restore failed" }
  Assert-LedgerClean $OwnerBin
  return @{ stop = $st; restore = $r }
}

function Close-FuHelpers([string]$HelperBin, $Created, [string]$Tag) {
  foreach ($c in @($Created)) {
    try { $null = Invoke-Native $HelperBin @("close", "$($c.hwnd)", "--tag", "$($c.tag)") } catch {}
  }
  Start-Sleep -Milliseconds 1000
}

function Assert-FuNoActors([string]$OwnerBin, [string]$HelperBin, [string]$Tag) {
  $leftovers = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -ieq $OwnerBin -or $_.Path -ieq $HelperBin } catch { $false }
    })
  if ($leftovers.Count -ne 0) { Fail-Fu "$Tag end actors remain: $(($leftovers | ForEach-Object { $_.Id }) -join ',')" }
  Assert-LedgerClean $OwnerBin
}

if ($Mock) { Invoke-BorderMock; exit 0 }
function Get-FuHelperOuter([string]$HelperBin, $Snap) {
  # Read-only exact-bound outer rect (GetWindowRect physical pixels).
  $fresh = Assert-FuHelperIdentity $HelperBin $Snap "outer"
  [ActiveBorderNative]::EnsurePMv2()
  $r = New-Object ActiveBorderNative+RECT
  if (-not [ActiveBorderNative]::GetWindowRect([IntPtr][long]$fresh.hwnd, [ref]$r)) { Fail-Fu "outer GetWindowRect failed hwnd=$($fresh.hwnd)" }
  return @{ hwnd = [long]$fresh.hwnd; l = [int]$r.left; t = [int]$r.top; r = [int]$r.right; b = [int]$r.bottom }
}

function Invoke-FuDirectionalPhase([string]$OwnerBin, [string]$HelperBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Real directional route: shortcut-proof owner (hook + marked chords) with
  # border on. Focus-left via Win+H from the rightmost helper (geometric
  # left neighbor guaranteed), then move-down/up via Win+Shift+J/K with
  # first-applied-wins bounded fallback. Border must follow every dispatch
  # with exact outer + composed ring + z-order. No Win+L ever sent.
  $created = [System.Collections.ArrayList]@()
  try {
    $h = @()
    foreach ($n in 1..3) {
      $snap = Start-FuHelper $HelperBin (Join-Path $PhaseDir "d-helper$n.json") "dir-helper$n"
      $null = $created.Add(@{ hwnd = [uint64]$snap.hwnd; tag = "$($snap.tag)" })
      $h += $snap
    }
    Rec-Fu "dir-helpers" @($h | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid } })
    $allowPath = Join-Path $PhaseDir "dir-allowlist.json"
    $entries = @()
    foreach ($s in $h) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
    $ready = Start-FuOwner $OwnerBin "shortcut-proof --allowlist `"$allowPath`" --seconds $($Ctx.ownerSeconds) --trace --active-border-theme" (Split-Path -Parent $OwnerBin) "dir-owner"
    $ownerPid = [int]$ready.owner.pid
    $logPath = "$($ready.log_path)"
    Rec-Fu "dir-owner-ready" @{ pid = $ownerPid; log = $logPath }
    Start-Sleep -Milliseconds 2500
    $startEv = @((Get-LogEventsAfterFu $logPath 0).events | Where-Object { $_.event -eq "tile-start" }) | Select-Object -First 1
    if ($null -eq $startEv) { Fail-Fu "dir tile-start missing" }
    if ("$($startEv.mode)" -ne "shortcut-proof") { Fail-Fu "dir tile-start mode $($startEv.mode) != shortcut-proof" }
    if ($startEv.keyboard.takeover -ne $true) { Fail-Fu "dir takeover off" }
    Rec-Fu "dir-tile-start" @{ mode = "$($startEv.mode)"; takeover = $startEv.keyboard.takeover }
    # Converge: 3 eligible, rects stable across two 1s polls.
    $stable = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      $insp = Invoke-Native $OwnerBin @("inspect", "--allowlist", $allowPath) | ConvertFrom-Json
      $elig = @($insp.windows | Where-Object { $_.eligible -eq $true })
      if ($elig.Count -eq 3) {
        $o1 = @($h | ForEach-Object { (Get-FuHelperOuter $HelperBin $_) })
        Start-Sleep -Milliseconds 1000
        $o2 = @($h | ForEach-Object { (Get-FuHelperOuter $HelperBin $_) })
        $s1 = (($o1 | ForEach-Object { "$($_.l),$($_.t),$($_.r),$($_.b)" }) -join "|")
        $s2 = (($o2 | ForEach-Object { "$($_.l),$($_.t),$($_.r),$($_.b)" }) -join "|")
        if ($s1 -eq $s2) { $stable = $o2; break }
      }
      Start-Sleep -Milliseconds 500
    }
    if ($null -eq $stable) { Fail-Fu "dir converge timeout (3 eligible stable)" }
    Rec-Fu "dir-converged" @{ frames = (($stable | ForEach-Object { "$($_.hwnd):$($_.l),$($_.t),$($_.r),$($_.b)" })) }
    # Rightmost helper has a geometric left neighbor: Win+H must focus-ok.
    $ordered = @($stable | Sort-Object { ($_.l + $_.r) / 2 })
    $src = $ordered[-1]
    $srcSnap = @($h | Where-Object { [long]$_.hwnd -eq [long]$src.hwnd }) | Select-Object -First 1
    $null = Set-FuForeground $HelperBin $srcSnap "dir-focus-src"
    $mark = Get-MarkBeforeActionFu $logPath
    $sent = Send-FuMarkedChord $FU_VK_H $false ([uint64]$src.hwnd) "dir-H"
    $ev = Wait-SnapAfterFu $logPath $mark "focus" "left" 20 "dir-H"
    if ("$($ev.event.outcome)" -ne "focus-ok") { Fail-Fu "dir-H outcome $($ev.event.outcome) != focus-ok" }
    Start-Sleep -Milliseconds 800
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fg -eq [uint64]$src.hwnd) { Fail-Fu "dir-H foreground did not advance" }
    $inFrozen = @($h | Where-Object { [uint64]$_.hwnd -eq [uint64]$fg }).Count -gt 0
    if (-not $inFrozen) { Fail-Fu "dir-H foreground $fg left frozen set" }
    $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "dir-H-border"
    $set = Wait-FuExactAndZ $OwnerBin $fg 4 0 "dir-H"
    $comp = Get-FuComposedRing $set.overlay 4 $WantColor "dir-H-composed"
    Rec-Fu "dir-focus-left" @{ from = $src.hwnd; to = $fg; snap = "$($ev.event.outcome)"; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])"; sent = $sent.accepted }
    # Move leg: Win+Shift+J then K fallback, first move-applied wins. Mover
    # keeps focus; geometry must change; border follows mover exactly.
    $moved = $false
    foreach ($vk in @($FU_VK_J, $FU_VK_K)) {
      $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $preOuter = Get-FuHelperOuter $HelperBin (@($h | Where-Object { [uint64]$_.hwnd -eq [uint64]$fgNow }) | Select-Object -First 1)
      $preAll = ((@($h | ForEach-Object { (Get-FuHelperOuter $HelperBin $_) }) | ForEach-Object { "$($_.l),$($_.t),$($_.r),$($_.b)" }) -join "|")
      $mark = Get-MarkBeforeActionFu $logPath
      $sent = Send-FuMarkedChord ([int]$vk) $true ([uint64]$fgNow) "dir-move$vk"
      $ev = Wait-SnapAfterFu $logPath $mark "move" $(if ([int]$vk -eq $FU_VK_J) { "down" } else { "up" }) 20 "dir-move$vk"
      if ("$($ev.event.outcome)" -eq "move-applied") {
        Start-Sleep -Milliseconds 1200
        $postAll = ((@($h | ForEach-Object { (Get-FuHelperOuter $HelperBin $_) }) | ForEach-Object { "$($_.l),$($_.t),$($_.r),$($_.b)" }) -join "|")
        if ($postAll -eq $preAll) { Fail-Fu "dir-move$vk applied but geometry unchanged" }
        $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
        $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "dir-move$vk-border"
        $set = Wait-FuExactAndZ $OwnerBin $fgAfter 4 0 "dir-move$vk"
        $comp = Get-FuComposedRing $set.overlay 4 $WantColor "dir-move$vk-composed"
        Rec-Fu "dir-move" @{ vk = $vk; outcome = "move-applied"; fg = $fgAfter; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
        $moved = $true
        break
      }
      Rec-Fu "dir-move-try" @{ vk = $vk; outcome = "$($ev.event.outcome)" }
    }
    if (-not $moved) { Fail-Fu "dir no move-applied on J/K (product defect?)" }
    $st = Stop-FuOwnerExact $OwnerBin $ready.owner "dir" $false
    $left = @(Get-FuOverlayHwnds $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Fu "dir overlay residue pid=$ownerPid" }
    Rec-Fu "dir-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
  } catch { throw }
  finally { Close-FuHelpers $HelperBin $created "dir" }
  Assert-FuNoActors $OwnerBin $HelperBin "dir"
  Rec-Fu "dir-clean" @{ actors = "absent"; ledger = "clean" }
}

function Invoke-FuWorkspacePhase([string]$OwnerBin, [string]$HelperBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Real workspace route: workspace-proof owner (hook + marked digits) with
  # border on. Send focused to ws2 (follow), select ws1, select ws2 back.
  # Border must follow the mover, hide with hidden members, reshow on reveal.
  $created = [System.Collections.ArrayList]@()
  try {
    $h = @()
    foreach ($n in 1..3) {
      $snap = Start-FuHelper $HelperBin (Join-Path $PhaseDir "w-helper$n.json") "ws-helper$n"
      $null = $created.Add(@{ hwnd = [uint64]$snap.hwnd; tag = "$($snap.tag)" })
      $h += $snap
    }
    Rec-Fu "ws-helpers" @($h | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid } })
    $allowPath = Join-Path $PhaseDir "ws-allowlist.json"
    $entries = @()
    foreach ($s in $h) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
    $ready = Start-FuOwner $OwnerBin "workspace-proof --allowlist `"$allowPath`" --seconds $($Ctx.ownerSeconds) --trace --active-border-theme" (Split-Path -Parent $OwnerBin) "ws-owner"
    $ownerPid = [int]$ready.owner.pid
    $logPath = "$($ready.log_path)"
    Rec-Fu "ws-owner-ready" @{ pid = $ownerPid; log = $logPath }
    Start-Sleep -Milliseconds 2500
    $mark = Get-MarkBeforeActionFu $logPath
    # Send focused h1 to ws2 with follow.
    $null = Set-FuForeground $HelperBin $h[0] "ws-send-focus"
    $mark = Get-MarkBeforeActionFu $logPath
    $sent = Send-FuDigitChord (0x30 + 2) $true ([uint64]$h[0].hwnd) "ws-send2"
    $ev = Wait-WorkspaceOutcomeFu $logPath $mark "send" 2 20 "ws-send2"
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "focus-unverified")) { Fail-Fu "ws-send2 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "ws-send2-border"
    $set = Wait-FuExactAndZ $OwnerBin $fg 4 0 "ws-send2"
    $comp = Get-FuComposedRing $set.overlay 4 $WantColor "ws-send2-composed"
    Rec-Fu "ws-send" @{ outcome = "$($ev.event.outcome)"; fg = $fg; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    # Select ws1: hides ws2 members; border retargets or hides honestly.
    $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $fgSnap = @($h | Where-Object { [uint64]$_.hwnd -eq [uint64]$fgNow }) | Select-Object -First 1
    if ($null -eq $fgSnap) { $fgSnap = $h[1]; $null = Set-FuForeground $HelperBin $fgSnap "ws-sel1-focus"; $fgNow = [uint64]$fgSnap.hwnd }
    $mark = Get-MarkBeforeActionFu $logPath
    $sent = Send-FuDigitChord (0x30 + 1) $false ([uint64]$fgNow) "ws-sel1"
    $ev = Wait-WorkspaceOutcomeFu $logPath $mark "select" 1 20 "ws-sel1"
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Fu "ws-sel1 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $fg1 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $tail = Get-LogEventsAfterFu $logPath $mark
    $borders = @($tail.events | Where-Object { $_.event -eq "active-border" })
    if ($borders.Count -eq 0) { Fail-Fu "ws-sel1 no border transition" }
    $lastB = $borders[-1]
    if ("$($lastB.outcome)" -in @("shown", "redrew", "moved")) {
      $set = Wait-FuExactAndZ $OwnerBin $fg1 4 0 "ws-sel1"
      $comp = Get-FuComposedRing $set.overlay 4 $WantColor "ws-sel1-composed"
      Rec-Fu "ws-select1" @{ outcome = "$($ev.event.outcome)"; fg = $fg1; border = "$($lastB.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    } else {
      $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      foreach ($o in @($insp.overlays)) { if ($o.visible -eq $true) { Fail-Fu "ws-sel1 overlay visible after hidden $($lastB.outcome)/$($lastB.reason)" } }
      Rec-Fu "ws-select1" @{ outcome = "$($ev.event.outcome)"; fg = $fg1; border = "$($lastB.outcome)"; reason = "$($lastB.reason)"; overlay_visible = $false }
    }
    # Select ws2 back: mover reappears; border reshown exact.
    $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $mark = Get-MarkBeforeActionFu $logPath
    $sent = Send-FuDigitChord (0x30 + 2) $false ([uint64]$fgNow) "ws-sel2"
    $ev = Wait-WorkspaceOutcomeFu $logPath $mark "select" 2 20 "ws-sel2"
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Fu "ws-sel2 outcome $($ev.event.outcome)" }
    $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "ws-sel2-border"
    Start-Sleep -Milliseconds 1200
    $fg2 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $set = Wait-FuExactAndZ $OwnerBin $fg2 4 0 "ws-sel2"
    $comp = Get-FuComposedRing $set.overlay 4 $WantColor "ws-sel2-composed"
    Rec-Fu "ws-select2" @{ outcome = "$($ev.event.outcome)"; fg = $fg2; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    $st = Stop-FuOwnerExact $OwnerBin $ready.owner "ws" $false
    foreach ($s in $h) {
      $back = Assert-FuHelperIdentity $HelperBin $s "ws-reveal-$($s.hwnd)"
      if ($back.visible -ne $true) { Fail-Fu "ws stop left hwnd=$($s.hwnd) hidden" }
    }
    $left = @(Get-FuOverlayHwnds $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Fu "ws overlay residue pid=$ownerPid" }
    Rec-Fu "ws-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
  } catch { throw }
  finally { Close-FuHelpers $HelperBin $created "ws" }
  Assert-FuNoActors $OwnerBin $HelperBin "ws"
  Rec-Fu "ws-clean" @{ actors = "absent"; ledger = "clean" }
}

function Invoke-FuFullscreenShellPhase([string]$OwnerBin, [string]$HelperBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Owned captionless fullscreen (exact-bound held-handle style save/restore
  # to the physical monitor rect; no helper fullscreen command exists) plus
  # shell hold-cancel probes (Start / TaskView / Alt+Tab-hold-Escape, never
  # committing Alt+Tab). Border must hide under fullscreen/shell and reshow
  # exact afterwards. No foreign attribute writes for the border itself.
  $GWL_STYLE = -16; $GWL_EXSTYLE = -20
  $WS_CAPTION = 0x00C00000
  $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_FRAMECHANGED = 0x0020
  $WM_CLOSE = 0x0010
  $created = [System.Collections.ArrayList]@()
  try {
    $hA = Start-FuHelper $HelperBin (Join-Path $PhaseDir "f-helperA.json") "fs-helperA"
    $hB = Start-FuHelper $HelperBin (Join-Path $PhaseDir "f-helperB.json") "fs-helperB"
    $null = $created.Add(@{ hwnd = [uint64]$hA.hwnd; tag = "$($hA.tag)" })
    $null = $created.Add(@{ hwnd = [uint64]$hB.hwnd; tag = "$($hB.tag)" })
    $allowPath = Join-Path $PhaseDir "fs-allowlist.json"
    $entries = @()
    foreach ($s in @($hA, $hB)) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
    $ready = Start-FuOwner $OwnerBin "tile-proof --allowlist `"$allowPath`" --seconds $($Ctx.ownerSeconds) --trace --active-border-theme" (Split-Path -Parent $OwnerBin) "fs-owner"
    $ownerPid = [int]$ready.owner.pid
    $logPath = "$($ready.log_path)"
    Rec-Fu "fs-owner-ready" @{ pid = $ownerPid; log = $logPath }
    Start-Sleep -Milliseconds 2000
    $mark = Get-MarkBeforeActionFu $logPath
    $freshA = Set-FuForeground $HelperBin $hA "fs-focus"
    $null = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "fs-baseline"
    $set0 = Wait-FuExactAndZ $OwnerBin ([long]$freshA.hwnd) 4 0 "fs-baseline"
    $comp0 = Get-FuComposedRing $set0.overlay 4 $WantColor "fs-baseline-composed"
    Rec-Fu "fs-baseline" @{ overlay = ($set0.overlay -join ","); composed = $comp0.hits }
    # Fullscreen: held-handle style save, captionless + monitor rect.
    [ActiveBorderNative]::EnsurePMv2()
    $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
    Rec-Fu "fs-monitor" @{ screen = "${screenW}x${screenH}" }
    $pre = Assert-FuHelperIdentity $HelperBin $hA "fs-pre"
    $pidA = [uint32]$pre.process.pid
    $held = [ActiveBorderNative]::HoldProcess($pidA)
    $heldCreation = [ActiveBorderNative]::HeldCreation($held)
    $savedStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
    $savedEx = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_EXSTYLE)
    $savedRect = Get-FuHelperOuter $HelperBin $hA
    $markFs = Get-MarkBeforeActionFu $logPath
    try {
      $newStyle = $savedStyle -band (-bnot $WS_CAPTION)
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE, $newStyle)
      # The managing owner retiled a one-shot fullscreen write back (observed
      # 20261002-211656: rect returned to tiled geometry while the captionless
      # style stuck). Reassert in a bounded loop instead: once any owner tick
      # observes captionless+monitor-covering, it suspends and stops fighting,
      # so convergence is stable. Exact owned helper only, NOACTIVATE.
      $stuck = $false
      for ($att = 1; $att -le 30; $att++) {
        $ok = [FollowupNative]::SetWindowPos([IntPtr][long]$pre.hwnd, [IntPtr]::Zero, 0, 0, $screenW, $screenH, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
        if (-not $ok) { Fail-Fu "fs SetWindowPos fullscreen failed att=$att" }
        Start-Sleep -Milliseconds 100
        $chk = Get-FuHelperOuter $HelperBin $hA
        if ([int]$chk.l -eq 0 -and [int]$chk.t -eq 0 -and ([int]$chk.r - [int]$chk.l) -eq $screenW -and ([int]$chk.b - [int]$chk.t) -eq $screenH) { $stuck = $true; break }
      }
      if (-not $stuck) { Fail-Fu "fs fullscreen rect never held across 30 reasserts (owner fight or product defect)" }
      Start-Sleep -Milliseconds 800
      if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fu "fs held process exited across restyle" }
      if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Fu "fs held creation changed across restyle" }
      $nowStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
      if (($nowStyle -band $WS_CAPTION) -ne 0) { Fail-Fu "fs style still captioned" }
      $nowRect = Get-FuHelperOuter $HelperBin $hA
      if ([int]$nowRect.l -ne 0 -or [int]$nowRect.t -ne 0 -or ([int]$nowRect.r - [int]$nowRect.l) -ne $screenW -or ([int]$nowRect.b - [int]$nowRect.t) -ne $screenH) {
        Fail-Fu "fs rect $($nowRect.l),$($nowRect.t),$($nowRect.r),$($nowRect.b) != monitor 0,0,$screenW,$screenH"
      }
      $post = Assert-FuHelperIdentity $HelperBin $hA "fs-post"
      $evHide = Wait-BorderOutcomeFu $logPath $markFs @("hidden") "" 20 "fs-hidden"
      $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visCount = @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
      $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
      Rec-Fu "fs-fullscreen" @{ hidden = $true; reason = "$($evHide.event.reason)"; overlay_visible = $visCount; fg = $fgMid; fg_class = $clsMid; style_saved = ("0x{0:X8}" -f $savedStyle) }
      if ($visCount -ne 0) { Fail-Fu "fs overlay still visible while captionless-fullscreen" }
      # Exact restore: style, exstyle, geometry.
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE, $savedStyle)
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_EXSTYLE, $savedEx)
      $ok = [FollowupNative]::SetWindowPos([IntPtr][long]$pre.hwnd, [IntPtr]::Zero, [int]$savedRect.l, [int]$savedRect.t, ([int]$savedRect.r - [int]$savedRect.l), ([int]$savedRect.b - [int]$savedRect.t), ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
      if (-not $ok) { Fail-Fu "fs SetWindowPos restore failed" }
      Start-Sleep -Milliseconds 1500
      if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fu "fs held process exited across restore" }
      $backStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
      if ([int]$backStyle -ne [int]$savedStyle) { Fail-Fu "fs style not restored" }
      $backRect = Get-FuHelperOuter $HelperBin $hA
      # Geometry may legitimately differ from the saved rect: the resumed
      # owner can retile to its retained plan. Style must match exactly;
      # geometry is settled live below and the delta is recorded, not gated.
      $rectDelta = "$(([int]$backRect.l) - ([int]$savedRect.l)),$(([int]$backRect.t) - ([int]$savedRect.t)),$(([int]$backRect.r) - ([int]$savedRect.r)),$(([int]$backRect.b) - ([int]$savedRect.b))"
      $back = Assert-FuHelperIdentity $HelperBin $hA "fs-restored-ident"
      $mark = Get-MarkBeforeActionFu $logPath
      $null = Set-FuForeground $HelperBin $hA "fs-refocus"
      $null = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "fs-reshow"
      Start-Sleep -Milliseconds 2000
      $setF = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "fs-reshow"
      $compF = Get-FuComposedRing $setF.overlay 4 $WantColor "fs-reshow-composed"
      Rec-Fu "fs-restored" @{ style_exact = $true; rect_delta = $rectDelta; overlay = ($setF.overlay -join ","); composed = $compF.hits; above = "$($setF.z[0])"; adjacent = "$($setF.z[1])" }
    } finally { if ($null -ne $held -and $held -ne [IntPtr]::Zero) { $null = [ActiveBorderNative]::CloseHandle($held) } }
    # Shell probes: unmarked synthetic chords from approved-helper foreground,
    # hold-cancel only (Escape), never committing Alt+Tab. Composed is read
    # only after reshow (shell pixels own the screen mid-probe by design).
    foreach ($probe in @(
        @{ name = "start"; keys = @(@($FU_VK_WIN, $false), @($FU_VK_WIN, $true)) },
        @{ name = "taskview"; keys = @(@($FU_VK_WIN, $false), @($FU_VK_TAB, $false), @($FU_VK_TAB, $true), @($FU_VK_WIN, $true)) }
      )) {
      $null = Set-FuForeground $HelperBin $hA "shell-$($probe.name)-prime"
      $fgPre = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $mark = Get-MarkBeforeActionFu $logPath
      foreach ($k in $probe.keys) {
        $one = [FollowupNative]::SendKeyExtra([uint16]$k[0], [bool]$k[1], [uint64]0)
        if ($one -ne 1) { Fail-Fu "shell-$($probe.name) chord not inserted vk=$($k[0])" }
        Start-Sleep -Milliseconds 150
      }
      Start-Sleep -Milliseconds 1500
      $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
      $inspMid = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visMid = @(@($inspMid.overlays) | Where-Object { $_.visible -eq $true }).Count
      $tailMid = Get-LogEventsAfterFu $logPath $mark
      $bMid = @($tailMid.events | Where-Object { $_.event -eq "active-border" })
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
      Start-Sleep -Milliseconds 150
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
      Start-Sleep -Milliseconds 1200
      $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      if ([uint64]$fgAfter -ne [uint64]$hA.hwnd) {
        $null = Set-FuForeground $HelperBin $hA "shell-$($probe.name)-recover"
        $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      }
      # Shell-no-show is recorded, not failed: synthetic chords may leave the
      # shell closed, in which case the ring never left and no reshow event
      # exists. Only a real reshow (or a still-exact ring) passes.
      $reshow = "none-shell-no-foreground"
      $set = $null; $comp = $null
      try {
        $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "shell-$($probe.name)-reshow"
        $reshow = "$($bev.event.outcome)"
        $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-$($probe.name)"
        $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-$($probe.name)-composed"
      } catch {
        if ([uint64]$fgMid -ne [uint64]$hA.hwnd) { throw }
        $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-$($probe.name)-still"
        $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-$($probe.name)-still-composed"
      }
      Rec-Fu "shell-$($probe.name)" @{ fg_pre = $fgPre; fg_mid = $fgMid; class_mid = $clsMid; overlay_visible_mid = $visMid; border_mid = @($bMid | ForEach-Object { "$($_.outcome)/$($_.reason)" }); fg_after = $fgAfter; reshow = $reshow; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    }
    # Alt+Tab hold then cancel: Alt down, Tab tap, Escape, Alt up in finally.
    # The switcher must never commit to an arbitrary window.
    $null = Set-FuForeground $HelperBin $hA "shell-alttab-prime"
    $mark = Get-MarkBeforeActionFu $logPath
    $altDown = $false
    try {
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ALT, $false, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab alt down not inserted" }
      $altDown = $true
      Start-Sleep -Milliseconds 200
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_TAB, $false, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab tab down not inserted" }
      Start-Sleep -Milliseconds 200
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_TAB, $true, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab tab up not inserted" }
      Start-Sleep -Milliseconds 1200
      $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
      $inspMid = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visMid = @(@($inspMid.overlays) | Where-Object { $_.visible -eq $true }).Count
      $tailMid = Get-LogEventsAfterFu $logPath $mark
      $bMid = @($tailMid.events | Where-Object { $_.event -eq "active-border" })
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
      Start-Sleep -Milliseconds 150
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
      Start-Sleep -Milliseconds 300
    } finally {
      if ($altDown) {
        try { $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ALT, $true, [uint64]0) } catch {}
      }
    }
    Start-Sleep -Milliseconds 1200
    $fgRaw = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $committed = (([uint64]$fgRaw -ne [uint64]$hA.hwnd) -and ((@($hA, $hB) | Where-Object { [uint64]$_.hwnd -eq [uint64]$fgRaw }).Count -eq 0))
    $fgAfter = $fgRaw
    if ([uint64]$fgAfter -ne [uint64]$hA.hwnd) {
      $null = Set-FuForeground $HelperBin $hA "shell-alttab-recover"
      $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    }
    $inspEnd = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
    $visEnd = @(@($inspEnd.overlays) | Where-Object { $_.visible -eq $true }).Count
    Rec-Fu "shell-alttab" @{ fg_mid = $fgMid; class_mid = $clsMid; overlay_visible_mid = $visMid; border_mid = @($bMid | ForEach-Object { "$($_.outcome)/$($_.reason)" }); fg_raw = $fgRaw; committed_foreign = $committed; fg_after = $fgAfter; overlay_visible_end = $visEnd }
    if ($committed) {
      Fail-Fu "shell-alttab committed to foreign hwnd=$fgRaw"
    }
    $st = Stop-FuOwnerExact $OwnerBin $ready.owner "fs" $false
    $left = @(Get-FuOverlayHwnds $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Fu "fs overlay residue pid=$ownerPid" }
    Rec-Fu "fs-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
  } catch { throw }
  finally { Close-FuHelpers $HelperBin $created "fs" }
  Assert-FuNoActors $OwnerBin $HelperBin "fs"
  Rec-Fu "fs-clean" @{ actors = "absent"; ledger = "clean" }
}

function Get-FuAppSnapshot([long]$Hwnd, [string]$Tag) {
  [ActiveBorderNative]::EnsurePMv2()
  $pidOut = [uint32]0
  $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$pidOut)
  if ([uint32]$pidOut -eq 0) { Fail-Fu "$Tag hwnd $Hwnd has no pid" }
  $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
  $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
  $session = -1; $sid = "unreadable"
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$pidOut" -ErrorAction Stop
    $session = [int]$cim.SessionId
    $owner = Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
    $sid = "$($owner.Sid)"
  } catch {}
  $r = New-Object ActiveBorderNative+RECT
  $rect = "unreadable"
  if ([ActiveBorderNative]::GetWindowRect([IntPtr]$Hwnd, [ref]$r)) { $rect = "$([int]$r.left),$([int]$r.top),$([int]$r.right),$([int]$r.bottom)" }
  return @{
    hwnd = [uint64]$Hwnd; pid = [int]$pidOut; start = $hex; exe = "$($proc.Path)"
    sid = $sid; session = $session; rect = $rect
    visible = [bool][ActiveBorderNative]::IsWindowVisible([IntPtr]$Hwnd)
    iconic = [bool][ActiveBorderNative]::IsIconic([IntPtr]$Hwnd)
    zoomed = [bool][ActiveBorderNative]::IsZoomed([IntPtr]$Hwnd)
  }
}

function Set-FuAppForeground($Snap, [string]$Tag) {
  $Hwnd = [uint64]$Snap.hwnd
  $fgEntry = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq $Hwnd) { return }
  $prime = [ActiveBorderNative]::PrimeE8()
  if ([int]$prime -ne 2) { Fail-Fu "$Tag E8 prime accepted $prime != 2" }
  $fgNow = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $pidOut = [uint32]0
  $fgTid = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
  if ([uint32]$fgTid -eq 0) { Fail-Fu "$Tag foreground TID unreadable" }
  $myTid = [ActiveBorderNative]::GetCurrentThreadId()
  $attachOk = $false
  if ([uint32]$fgTid -ne [uint32]$myTid) {
    $attachOk = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
  }
  try { $null = [ActiveBorderNative]::SetForegroundWindow([IntPtr][long]$Hwnd) }
  finally {
    if ($attachOk) { $null = [ActiveBorderNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false) }
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne $Hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  }
  if ([uint64]$fg -ne $Hwnd) { Fail-Fu "$Tag foreground readback $fg != $Hwnd attach=$attachOk" }
  $back = Get-FuAppSnapshot ([long]$Hwnd) "$Tag-post"
  if ([int]$back.pid -ne [int]$Snap.pid -or "$($back.start)" -cne "$($Snap.start)") { Fail-Fu "$Tag app identity changed across focus" }
}

function Wait-FuWorkspaceCli([string]$LogPath, [int]$Mark, [int]$Index, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterFu $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "workspace") -and ("$($e.op)" -eq "select") -and ([int]$e.index -eq [int]$Index) -and ("$($e.edge)" -eq "cli") -and ("$($e.outcome)" -ne "key-up")) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Fu "$Tag no owner workspace dispatch select/$Index edge cli after mark $Mark"
  return $null
}

function Get-FuCloaked([long]$Hwnd) {
  [ActiveBorderNative]::EnsurePMv2()
  return [FollowupNative]::Cloaked($Hwnd)
}

function Get-FuEligibleApps([string]$OwnerBin, [string]$Tag) {
  $inv = Invoke-Native $OwnerBin @("inventory") | ConvertFrom-Json
  $eligible = [System.Collections.ArrayList]@()
  $terminal = [System.Collections.ArrayList]@()
  $firefoxZoomed = [System.Collections.ArrayList]@()
  foreach ($w in @($inv.windows)) {
    $hwnd = [uint64]$w.hwnd
    $base = "$($w.exe)".ToLowerInvariant()
    $class = "$($w.class)"
    if (@("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "DV2ControlHost", "MSCTFIME UI", "SystemTray_Main") -contains $class) { continue }
    $exstyle = 0
    try { $exstyle = [Convert]::ToUInt32(("$($w.exstyle)" -replace '^0[xX]', ''), 16) } catch { $exstyle = 0 }
    if (($exstyle -band 0x80) -ne 0) { continue }
    if (($exstyle -band 0x8) -ne 0) { continue }
    if (($exstyle -band 0x08000000) -ne 0) { continue }
    if ($class -eq "#32770") { continue }
    if ((Get-FuCloaked ([long]$hwnd)) -ne 0) { continue }
    if ([ActiveBorderNative]::GetWindow([IntPtr][long]$hwnd, 4).ToInt64() -ne 0) { continue }
    if (-not [ActiveBorderNative]::IsWindowVisible([IntPtr][long]$hwnd)) { continue }
    if (@("windowsterminal.exe", "wt.exe") -contains $base) { $null = $terminal.Add($w); continue }
    $zoomed = [ActiveBorderNative]::IsZoomed([IntPtr][long]$hwnd)
    if (($base -eq "firefox.exe") -or ($class -eq "MozillaWindowClass")) {
      if ($zoomed) { $null = $firefoxZoomed.Add($w); continue }
      Fail-Fu "$Tag refuse: visible non-maximized Firefox hwnd=$hwnd (never touch)"
    }
    if ($zoomed) { continue }
    if ([ActiveBorderNative]::IsIconic([IntPtr][long]$hwnd)) { continue }
    $null = $eligible.Add($w)
  }
  return @{ eligible = $eligible; terminal = $terminal; firefox = $firefoxZoomed }
}

function Invoke-FuOrdinaryPhase([string]$OwnerBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Scoped ordinary apps: normal tile owner with explicit --scope-exe /
  # --scope-host-child fences (product default manages everything, so the
  # explicit scope is mandatory) plus border on. Extra disposable Notepad /
  # Calculator / Paint instances are launched, bound by PID delta, focused
  # for border follow, then closed exactly; existing app content is never
  # typed into. CLI workspace select hides/reveals the managed set.
  $scopeArgs = " --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe"
  $extras = [System.Collections.ArrayList]@()
  try {
    $pre = Get-FuEligibleApps $OwnerBin "ord-pre"
    # Scoped normal run fences observation, geometry writes, workspace
    # hide/reveal, focus actuation and border painting to --scope-exe /
    # --scope-host-child (product `scope_allows` + `hosted_child_allows` plus
    # SID/session/medium-integrity identity gates): unrelated eligible
    # windows are product-side `scope-excluded` with zero writes, so their
    # mere presence never refuses the run. The harness still never targets
    # them: every mutation below is exact-bound to approved HWNDs, and the
    # managed-set gate further down enforces approved-only membership.
    $unrelated = @($pre.eligible | Where-Object { @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -notcontains "$($_.exe)".ToLowerInvariant() })
    if ($unrelated.Count -gt 0) {
      Rec-Fu "ord-unrelated-scoped" @($unrelated | ForEach-Object { @{ exe = "$($_.exe)"; hwnd = $_.hwnd; class = "$($_.class)"; mutation = "none"; product = "scope-excluded" } })
    }
    foreach ($w in @($pre.eligible)) {
      $base = "$($w.exe)".ToLowerInvariant()
      if (@("notepad.exe", "mspaint.exe", "applicationframehost.exe") -notcontains $base) { continue }
      if ($base -eq "applicationframehost.exe") {
        $ch = Invoke-Native $OwnerBin @("children", "--hwnd", "$($w.hwnd)") | ConvertFrom-Json
        $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
        if ($names -notcontains "calculatorapp.exe") { Fail-Fu "ord-pre ApplicationFrameHost hwnd=$($w.hwnd) hosts none-approved ($($names -join ','))" }
      }
    }
    Rec-Fu "ord-preflight" @{ eligible = $pre.eligible.Count; terminal = $pre.terminal.Count; firefox_max = $pre.firefox.Count }
    # Launch one extra instance per approved app; bind by PID/HWND delta.
    # Launch one extra instance per approved app. Single-instance hosts
    # (Calculator stub, tabbed Notepad) may yield no new process: pre-launch
    # HWND sets let the bind below fall back to a pre-existing approved
    # window honestly (source=existing, never closed) instead of failing.
    $preHwnds = @($pre.eligible | ForEach-Object { [uint64]$_.hwnd })
    $preCalcHosts = @()
    foreach ($w in @($pre.eligible)) {
      if ("$($w.exe)".ToLowerInvariant() -eq "applicationframehost.exe") { $preCalcHosts += [uint64]$w.hwnd }
    }
    $launchPids = @{}
    foreach ($app in @(@{ exe = "notepad.exe" }, @{ exe = "calc.exe" }, @{ exe = "mspaint.exe" })) {
      $before = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
      Start-Process -FilePath $app.exe -WindowStyle Normal
      Start-Sleep -Milliseconds 1500
      $after = @(Get-Process -ErrorAction SilentlyContinue)
      $cands = @($after | Where-Object { $before -notcontains $_.Id })
      $match = @($cands | Where-Object {
          try { "$($_.Path)".ToLowerInvariant() -like "*$($app.exe)".ToLowerInvariant() -or "$($_.ProcessName)".ToLowerInvariant() -eq "$($app.exe)".Replace(".exe", "").ToLowerInvariant() } catch { $false }
        }) | Select-Object -First 1
      if (($null -eq $match) -and ($app.exe -eq "calc.exe")) {
        $match = @($cands | Where-Object { try { "$($_.ProcessName)".ToLowerInvariant() -like "*calc*" } catch { $false } }) | Select-Object -First 1
      }
      if ($null -ne $match) { $launchPids[$app.exe] = [int]$match.Id }
    }
    Rec-Fu "ord-launched" @{ pids = $launchPids; pre_hwnds = $preHwnds.Count }
    # Bind HWNDs: launched-PID match first, then new-HWND delta, then
    # pre-existing approved fallback (source recorded; only source=extra is
    # ever closed). Calc binds via ApplicationFrameHost child subtree.
    $bound = @{}; $boundSource = @{}
    $deadline = (Get-Date).AddSeconds(25)
    while ((($null -eq $bound["notepad.exe"]) -or ($null -eq $bound["mspaint.exe"]) -or ($null -eq $bound["calc.exe"])) -and ((Get-Date) -lt $deadline)) {
      $inv = Invoke-Native $OwnerBin @("inventory") | ConvertFrom-Json
      $postHwnds = @{}
      foreach ($w in @($inv.windows)) { $postHwnds[[uint64]$w.hwnd] = $w }
      foreach ($w in @($inv.windows)) {
        $hwnd = [uint64]$w.hwnd
        $exe = "$($w.exe)"
        $wpidOut = [uint32]0
        $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][long]$hwnd, [ref]$wpidOut)
        if ("$exe".ToLowerInvariant() -eq "notepad.exe") {
          if (($null -ne $launchPids["notepad.exe"]) -and ([int]$wpidOut -eq [int]$launchPids["notepad.exe"])) {
            $bound["notepad.exe"] = $hwnd; $boundSource["notepad.exe"] = "extra-pid"
          } elseif (($null -eq $bound["notepad.exe"]) -and ($preHwnds -notcontains $hwnd)) {
            $bound["notepad.exe"] = $hwnd; $boundSource["notepad.exe"] = "extra-delta"
          }
        }
        if ("$exe".ToLowerInvariant() -eq "mspaint.exe") {
          if (($null -ne $launchPids["mspaint.exe"]) -and ([int]$wpidOut -eq [int]$launchPids["mspaint.exe"])) {
            $bound["mspaint.exe"] = $hwnd; $boundSource["mspaint.exe"] = "extra-pid"
          } elseif (($null -eq $bound["mspaint.exe"]) -and ($preHwnds -notcontains $hwnd)) {
            $bound["mspaint.exe"] = $hwnd; $boundSource["mspaint.exe"] = "extra-delta"
          }
        }
        if ("$exe".ToLowerInvariant() -eq "applicationframehost.exe") {
          $ch = Invoke-Native $OwnerBin @("children", "--hwnd", "$hwnd") | ConvertFrom-Json
          $kids = @($ch.windows[0].children)
          $calcKid = @($kids | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "calculatorapp.exe" }) | Select-Object -First 1
          if (($null -ne $calcKid) -and ($null -eq $bound["calc.exe"]) -and ($preCalcHosts -notcontains $hwnd)) {
            $bound["calc.exe"] = $hwnd; $boundSource["calc.exe"] = "extra-delta"
          }
        }
      }
      Start-Sleep -Milliseconds 500
    }
    # Honest fallback to pre-existing approved windows (never closed).
    if ($null -eq $bound["notepad.exe"]) {
      $fb = @($pre.eligible | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "notepad.exe" }) | Select-Object -First 1
      if ($null -eq $fb) { Fail-Fu "ord no notepad bound (extra or existing)" }
      $bound["notepad.exe"] = [uint64]$fb.hwnd; $boundSource["notepad.exe"] = "existing"
    }
    if ($null -eq $bound["mspaint.exe"]) {
      $fb = @($pre.eligible | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "mspaint.exe" }) | Select-Object -First 1
      if ($null -eq $fb) { Fail-Fu "ord no paint bound (extra or existing)" }
      $bound["mspaint.exe"] = [uint64]$fb.hwnd; $boundSource["mspaint.exe"] = "existing"
    }
    if ($null -eq $bound["calc.exe"]) {
      if ($preCalcHosts.Count -eq 0) { Fail-Fu "ord no calculator host bound (extra or existing)" }
      $bound["calc.exe"] = [uint64]$preCalcHosts[0]; $boundSource["calc.exe"] = "existing"
    }
    Rec-Fu "ord-bound" @{ notepad = $bound["notepad.exe"]; calc_host = $bound["calc.exe"]; paint = $bound["mspaint.exe"]; source = $boundSource }
    $snaps = @{}
    foreach ($k in @("notepad.exe", "calc.exe", "mspaint.exe")) {
      $hw = if ($k -eq "notepad.exe") { $bound["notepad.exe"] } elseif ($k -eq "mspaint.exe") { $bound["mspaint.exe"] } else { $bound["calc.exe"] }
      $s = Get-FuAppSnapshot ([long]$hw) "ord-bind-$k"
      if (-not $s.visible) { Fail-Fu "ord bound $k hwnd=$hw not visible" }
      if ($s.iconic -or $s.zoomed) { Fail-Fu "ord bound $k hwnd=$hw must start restored" }
      $snaps[$k] = $s
      if ("$($boundSource[$k])" -like "extra-*") {
        $null = $extras.Add(@{ hwnd = [uint64]$s.hwnd; pid = [int]$s.pid; start = "$($s.start)"; exe = "$($s.exe)" })
      }
    }
    # Managed set = eligible approved only (existing + extras); unrelated
    # eligible windows stay product-side scope-excluded with zero harness
    # mutation (same scoped-proceed rule as preflight). Host-child fence
    # retained: an ApplicationFrameHost only joins while it hosts Calculator.
    $elig = Get-FuEligibleApps $OwnerBin "ord-managed"
    $managed = @(); $scopedOut = @()
    foreach ($w in @($elig.eligible)) {
      $base = "$($w.exe)".ToLowerInvariant()
      if (@("notepad.exe", "mspaint.exe", "applicationframehost.exe") -notcontains $base) {
        $scopedOut += $w; continue
      }
      if ($base -eq "applicationframehost.exe") {
        $ch = Invoke-Native $OwnerBin @("children", "--hwnd", "$($w.hwnd)") | ConvertFrom-Json
        $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
        if ($names -notcontains "calculatorapp.exe") { $scopedOut += $w; continue }
      }
      $managed += (Get-FuAppSnapshot ([long][uint64]$w.hwnd) "ord-managed-$($w.hwnd)")
    }
    if ($scopedOut.Count -gt 0) {
      Rec-Fu "ord-managed-scoped" @($scopedOut | ForEach-Object { @{ exe = "$($_.exe)"; hwnd = $_.hwnd; class = "$($_.class)"; mutation = "none"; product = "scope-excluded" } })
    }
    if ($managed.Count -eq 0) { Fail-Fu "ord no managed approved app" }
    Rec-Fu "ord-managed" @($managed | ForEach-Object { @{ hwnd = $_.hwnd; exe = $_.exe; rect = $_.rect } })
    # Normal tile owner, scoped, border on.
    $ready = Start-FuOwner $OwnerBin "tile --user-start --seconds $($Ctx.ownerSeconds) --trace --active-border-theme$scopeArgs" (Split-Path -Parent $OwnerBin) "ord-owner"
    $frozen = $ready.owner
    $logPath = "$($ready.log_path)"
    Rec-Fu "ord-owner-ready" @{ pid = $frozen.pid; log = $logPath }
    Start-Sleep -Milliseconds 2500
    $startEv = @((Get-LogEventsAfterFu $logPath 0).events | Where-Object { $_.event -eq "tile-start" }) | Select-Object -First 1
    if ($null -eq $startEv) { Fail-Fu "ord tile-start missing" }
    if ("$($startEv.mode)" -ne "normal") { Fail-Fu "ord tile-start mode $($startEv.mode) != normal" }
    if ([int]$startEv.scope_count -ne 3) { Fail-Fu "ord scope_count $($startEv.scope_count) != 3" }
    Rec-Fu "ord-tile-start" @{ scope = $startEv.scope_count }
    # Focus each extra: border follows ordinary apps exactly.
    foreach ($k in @("notepad.exe", "calc.exe", "mspaint.exe")) {
      $s = $snaps[$k]
      $mark = Get-MarkBeforeActionFu $logPath
      Set-FuAppForeground $s "ord-focus-$k"
      $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "ord-$k-border"
      $set = Wait-FuExactAndZ $OwnerBin ([long]$s.hwnd) 4 0 "ord-$k"
      $comp = Get-FuComposedRing $set.overlay 4 $WantColor "ord-$k-composed"
      Rec-Fu "ord-focus-$k" @{ hwnd = $s.hwnd; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    }
    # CLI select 2 hides all managed; ledger claims must match exactly.
    $mark = Get-MarkBeforeActionFu $logPath
    $q = Invoke-Native $OwnerBin @("workspace", "--select", "2") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Fu "ord select2 not dispatched" }
    $ev = Wait-FuWorkspaceCli $logPath $mark 2 30 "ord-select2"
    if ("$($ev.event.outcome)" -notin @("ok", "partial")) { Fail-Fu "ord-select2 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    $ident = Invoke-Native $OwnerBin @("identity") | ConvertFrom-Json
    $ledgerPath = Join-Path "$($ident.ledger_directory)" "ledger.json"
    if (-not (Test-Path -LiteralPath $ledgerPath)) { Fail-Fu "ord-select2 ledger missing" }
    $ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
    if ([int]$ledger.v -ne 4) { Fail-Fu "ord ledger v$($ledger.v) != v4" }
    if ([int]$ledger.owner.pid -ne [int]$frozen.pid) { Fail-Fu "ord ledger owner pid changed" }
    $claims = @($ledger.windows)
    if ($claims.Count -ne $managed.Count) { Fail-Fu "ord ledger claims $($claims.Count) != managed $($managed.Count)" }
    foreach ($c in @($claims)) {
      $snap = @($managed | Where-Object { [uint64]$_.hwnd -eq [uint64]$c.hwnd }) | Select-Object -First 1
      if ($null -eq $snap) { Fail-Fu "ord claim hwnd=$($c.hwnd) not in managed set" }
      if ([int]$c.process.pid -ne [int]$snap.pid) { Fail-Fu "ord claim hwnd=$($c.hwnd) pid changed" }
      if ([ActiveBorderNative]::IsWindowVisible([IntPtr][long]$c.hwnd)) { Fail-Fu "ord claim hwnd=$($c.hwnd) still visible while hidden" }
    }
    $lastExtra = $snaps["mspaint.exe"]
    $bev = Wait-BorderOutcomeFu $logPath $mark @("hidden") "" 20 "ord-select2-border"
    Rec-Fu "ord-select2" @{ outcome = "$($ev.event.outcome)"; claims = $claims.Count; border = "$($bev.event.outcome)"; reason = "$($bev.event.reason)" }
    # CLI select 1 reveals with layout and focus; border reshown.
    $mark = Get-MarkBeforeActionFu $logPath
    $q = Invoke-Native $OwnerBin @("workspace", "--select", "1") | ConvertFrom-Json
    if (-not $q.dispatched) { Fail-Fu "ord select1 not dispatched" }
    $ev = Wait-FuWorkspaceCli $logPath $mark 1 30 "ord-select1"
    if ("$($ev.event.outcome)" -notin @("ok", "partial", "already-active")) { Fail-Fu "ord select1 outcome $($ev.event.outcome)" }
    Start-Sleep -Milliseconds 1500
    foreach ($s in @($managed)) {
      $live = Get-FuAppSnapshot ([long]$s.hwnd) "ord-reveal-$($s.hwnd)"
      if ([int]$live.pid -ne [int]$s.pid -or "$($live.start)" -cne "$($s.start)") { Fail-Fu "ord reveal hwnd=$($s.hwnd) identity changed" }
      if (-not $live.visible) { Fail-Fu "ord reveal hwnd=$($s.hwnd) not visible" }
    }
    $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $inSet = @($managed | Where-Object { [uint64]$_.hwnd -eq [uint64]$fg }).Count -gt 0
    if (-not $inSet) { Fail-Fu "ord select1 foreground $fg outside managed set" }
    $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "ord-select1-border"
    $set = Wait-FuExactAndZ $OwnerBin $fg 4 0 "ord-select1"
    $comp = Get-FuComposedRing $set.overlay 4 $WantColor "ord-select1-composed"
    Rec-Fu "ord-select1" @{ outcome = "$($ev.event.outcome)"; fg = $fg; border = "$($bev.event.outcome)"; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])" }
    $st = Stop-FuOwnerExact $OwnerBin $frozen "ord" $false
    Rec-Fu "ord-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
    foreach ($w in @($elig.firefox)) {
      if (-not [ActiveBorderNative]::IsZoomed([IntPtr][long]$w.hwnd)) { Fail-Fu "ord end Firefox hwnd=$($w.hwnd) no longer maximized" }
    }
  } catch { throw }
  finally {
    # Close ONLY extra instances launched above, exact PID/start/HWND bound.
    foreach ($x in @($extras)) {
      try {
        $alive = $false
        try {
          $p = Get-Process -Id ([int]$x.pid) -ErrorAction Stop
          $hex = "{0:x16}" -f $p.StartTime.ToUniversalTime().ToFileTimeUtc()
          if ("$hex" -ceq "$($x.start)") { $alive = $true }
        } catch { $alive = $false }
        if ($alive) {
          $null = [FollowupNative]::PostMessageW([IntPtr][uint64]$x.hwnd, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)
          $deadline = (Get-Date).AddSeconds(10)
          while ((Get-Date) -lt $deadline) {
            try {
              $p = Get-Process -Id ([int]$x.pid) -ErrorAction Stop
              $hex = "{0:x16}" -f $p.StartTime.ToUniversalTime().ToFileTimeUtc()
              if ("$hex" -cne "$($x.start)") { break }
            } catch { break }
            Start-Sleep -Milliseconds 250
          }
          $still = $false
          try {
            $p = Get-Process -Id ([int]$x.pid) -ErrorAction Stop
            $hex = "{0:x16}" -f $p.StartTime.ToUniversalTime().ToFileTimeUtc()
            if ("$hex" -ceq "$($x.start)") { $still = $true }
          } catch { $still = $false }
          # Window-first residue rule: single-instance hosts (tabbed Notepad,
          # Calculator stub) share the process with pre-existing windows, so a
          # surviving PID never fails. Only a surviving exact WINDOW fails.
          # A recycled HWND (different PID) is never ours: skip it.
          $wpidOut = [uint32]0
          $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][uint64]$x.hwnd, [ref]$wpidOut)
          if ([int]$wpidOut -ne [int]$x.pid) { continue }
          if ($still) {
            # Blank docs never prompt; Escape cancels a save dialog if one
            # appeared (owned extra only), then one exact WM_CLOSE retry.
            # The window may vanish under us (shared host closed it): a
            # missing window is success, never a snapshot failure.
            try { $snap = Get-FuAppSnapshot ([long][uint64]$x.hwnd) "ord-close-focus" }
            catch { continue }
            Set-FuAppForeground $snap "ord-close-esc"
            $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
            Start-Sleep -Milliseconds 150
            $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
            Start-Sleep -Milliseconds 1000
            $null = [FollowupNative]::PostMessageW([IntPtr][uint64]$x.hwnd, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)
            Start-Sleep -Milliseconds 5000
            $wpidOut = [uint32]0
            $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][uint64]$x.hwnd, [ref]$wpidOut)
            if ([int]$wpidOut -eq [int]$x.pid) { Fail-Fu "ord extra $($x.exe) hwnd=$($x.hwnd) survived exact close (residue, user cleanup)" }
          }
        }
      } catch { throw }
    }
  }
  # Extras must be gone: exact WINDOWS destroyed (shared-host PIDs may
  # legitimately survive); managed pre-existing apps restored visible.
  foreach ($x in @($extras)) {
    $wpidOut = [uint32]0
    $null = [ActiveBorderNative]::GetWindowThreadProcessId([IntPtr][uint64]$x.hwnd, [ref]$wpidOut)
    if ([int]$wpidOut -eq [int]$x.pid) { Fail-Fu "ord extra window residue $($x.exe) hwnd=$($x.hwnd) pid=$wpidOut" }
  }
  Assert-FuNoActors $OwnerBin (Join-Path (Split-Path -Parent $OwnerBin) "tiler-test-window.exe") "ord"
  Rec-Fu "ord-clean" @{ extras_closed = (@($extras).Count); actors = "absent"; ledger = "clean" }
}

function Wait-FuSuspend([string]$LogPath, [int]$Mark, [string]$Cause, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfterFu $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "suspend") -and ("$($e.cause)" -eq $Cause)) {
        return @{ event = $e; count = $tail.count }
      }
    }
    Start-Sleep -Milliseconds 200
  }
  Fail-Fu "$Tag no suspend cause=$Cause after mark $Mark"
  return $null
}

function Get-FuFsSnapshot([string]$HelperBin, [string]$OwnerBin, $Snap, [string]$Tag) {
  # Read-only concurrent sample: foreground identity versus the exact owned
  # helper, helper style/exstyle bits, physical outer (GetWindowRect) and
  # DWM extended frame, plus overlay visibility while the owner runs. Never
  # writes and never touches foreign windows; unreadable reads record as
  # such instead of failing.
  $GWL_STYLE = -16; $GWL_EXSTYLE = -20; $WS_CAPTION = 0x00C00000
  $fg = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $cls = ""; try { $cls = [ActiveBorderNative]::ClassOf($fg) } catch { $cls = "unreadable" }
  $style = $null; $ex = $null
  try {
    $style = [FollowupNative]::GetWindowLongW([IntPtr][long]$Snap.hwnd, $GWL_STYLE)
    $ex = [FollowupNative]::GetWindowLongW([IntPtr][long]$Snap.hwnd, $GWL_EXSTYLE)
  } catch {}
  $outer = "unreadable"
  try { $o = Get-FuHelperOuter $HelperBin $Snap; $outer = "$($o.l),$($o.t),$($o.r),$($o.b)" } catch { $outer = "unreadable" }
  $dwm = "unreadable"
  try { $f = [ActiveBorderNative]::FrameOf([long]$Snap.hwnd); if ($null -ne $f) { $dwm = ($f -join ",") } } catch { $dwm = "unreadable" }
  $ov = "no-owner"; $ofg = ""
  if ($OwnerBin -ne "") {
    try {
      $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $ov = @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
      $ofg = "$($insp.foreground)"
    } catch { $ov = "inspect-failed" }
  }
  $rec = @{
    hwnd = [uint64]$Snap.hwnd; tag = "$($Snap.tag)"; fg = $fg
    fg_is_helper = ([uint64]$fg -eq [uint64]$Snap.hwnd); fg_class = $cls
    style = if ($null -ne $style) { ("0x{0:X8}" -f $style) } else { "unreadable" }
    exstyle = if ($null -ne $ex) { ("0x{0:X8}" -f $ex) } else { "unreadable" }
    captionless = if ($null -ne $style) { (($style -band $WS_CAPTION) -eq 0) } else { "unknown" }
    outer = $outer; dwm = $dwm; overlay_visible = $ov; overlay_fg = $ofg
  }
  Rec-Fu $Tag $rec
  return $rec
}

function Invoke-FuFullscreenPhase([string]$OwnerBin, [string]$HelperBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Helper-first captionless suppression: the exact-owned helper is set
  # captionless + monitor-covering BEFORE the owner starts (fresh native
  # frame verified), activated, and only then the proof owner starts. The
  # existing initial foreground_fullscreen guard must suspend with zero
  # writes (no retile race: nothing fights the pre-formed frame), the border
  # stays suppressed, and restoring the saved style/frame resumes rendering.
  # No foreign writes; the border itself is never styled. Never repeats the
  # fought one-shot/30-reassert strategy (that race is retired).
  $GWL_STYLE = -16; $GWL_EXSTYLE = -20
  $WS_CAPTION = 0x00C00000; $WS_THICKFRAME = 0x00040000
  $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_FRAMECHANGED = 0x0020
  $created = [System.Collections.ArrayList]@()
  try {
    $hA = Start-FuHelper $HelperBin (Join-Path $PhaseDir "p-helperA.json") "pfs-helperA"
    $hB = Start-FuHelper $HelperBin (Join-Path $PhaseDir "p-helperB.json") "pfs-helperB"
    $null = $created.Add(@{ hwnd = [uint64]$hA.hwnd; tag = "$($hA.tag)" })
    $null = $created.Add(@{ hwnd = [uint64]$hB.hwnd; tag = "$($hB.tag)" })
    $null = Set-FuForeground $HelperBin $hA "pfs-focus"
    [ActiveBorderNative]::EnsurePMv2()
    $screenW = [ActiveBorderNative]::GetSystemMetrics(0); $screenH = [ActiveBorderNative]::GetSystemMetrics(1)
    Rec-Fu "pfs-monitor" @{ screen = "${screenW}x${screenH}" }
    if ([int]$screenW -ne 2560 -or [int]$screenH -ne 1440) { Fail-Fu "pfs physical screen ${screenW}x${screenH} != 2560x1440" }
    $pre = Assert-FuHelperIdentity $HelperBin $hA "pfs-pre"
    $pidA = [uint32]$pre.process.pid
    $held = [ActiveBorderNative]::HoldProcess($pidA)
    $heldCreation = [ActiveBorderNative]::HeldCreation($held)
    $savedStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
    $savedEx = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_EXSTYLE)
    $savedRect = Get-FuHelperOuter $HelperBin $hA
    $dpiPre = [ActiveBorderNative]::GetDpiForWindow([IntPtr][long]$pre.hwnd)
    if ([int]$dpiPre -ne 120) { Fail-Fu "pfs helper DPI $dpiPre != 120" }
    try {
      # Pre-form the captionless monitor frame while no owner runs: no
      # retile race is possible here. Exact owned helper only, NOACTIVATE.
      # True borderless (caption AND thick-frame cleared): a captionless
      # window with a sizing border keeps an inset DWM frame that never
      # satisfies the product containment predicate, so the frame must be
      # genuinely borderless like a real fullscreen client. Exact restore
      # below returns the saved style bit-for-bit.
      $newStyle = $savedStyle -band (-bnot ($WS_CAPTION -bor $WS_THICKFRAME))
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE, $newStyle)
      $heldFs = $false
      for ($att = 1; $att -le 5; $att++) {
        $ok = [FollowupNative]::SetWindowPos([IntPtr][long]$pre.hwnd, [IntPtr]::Zero, 0, 0, $screenW, $screenH, ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
        if (-not $ok) { Fail-Fu "pfs SetWindowPos pre-frame failed att=$att" }
        Start-Sleep -Milliseconds 300
        $chk = Get-FuHelperOuter $HelperBin $hA
        if ([int]$chk.l -eq 0 -and [int]$chk.t -eq 0 -and ([int]$chk.r - [int]$chk.l) -eq $screenW -and ([int]$chk.b - [int]$chk.t) -eq $screenH) { $heldFs = $true; break }
      }
      if (-not $heldFs) { Fail-Fu "pfs pre-frame never covered monitor (no owner running: environment defect)" }
      # Fresh native verification BEFORE the owner starts: style captionless,
      # outer rect exactly monitor, DWM frame containing the monitor full,
      # DPI 120. This is the faithful existing-heuristic input.
      $nowStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
      if (($nowStyle -band $WS_CAPTION) -ne 0) { Fail-Fu "pfs pre-frame still captioned" }
      # DWM extended-frame read with a bounded read-only settle: the frame
      # can lag SetWindowPos(FRAMECHANGED) transitionally, so re-sample
      # (no writes) before judging containment. Same bar, no lowering.
      $frame = [ActiveBorderNative]::FrameOf([long]$pre.hwnd)
      if ($null -eq $frame) { Fail-Fu "pfs pre-frame DWM unreadable" }
      $settle = 0
      while (-not ([int]$frame[0] -le 0 -and [int]$frame[1] -le 0 -and [int]$frame[2] -ge $screenW -and [int]$frame[3] -ge $screenH)) {
        if ($settle -ge 10) { Fail-Fu "pfs pre-frame DWM $($frame -join ',') does not contain monitor 0,0,$screenW,$screenH (settled ${settle}x300ms)" }
        Start-Sleep -Milliseconds 300
        $settle++
        $frame = [ActiveBorderNative]::FrameOf([long]$pre.hwnd)
        if ($null -eq $frame) { Fail-Fu "pfs pre-frame DWM unreadable during settle" }
      }
      $dpiFs = [ActiveBorderNative]::GetDpiForWindow([IntPtr][long]$pre.hwnd)
      if ([int]$dpiFs -ne 120) { Fail-Fu "pfs fullscreen DPI $dpiFs != 120" }
      $null = Set-FuForeground $HelperBin $hA "pfs-activate"
      # Stable owned-helper foreground gate: 5 consecutive reads ~200ms
      # apart must all resolve to the exact owned helper. Any foreign drift
      # aborts here (environment-blocked, zero foreign writes) instead of
      # starting the owner under an ambiguous foreground.
      $fgPre = 0
      for ($s = 1; $s -le 5; $s++) {
        $fgPre = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
        if ([uint64]$fgPre -ne [uint64]$pre.hwnd) {
          $null = Get-FuFsSnapshot $HelperBin "" $hA "pfs-abort-fg"
          Fail-Fu "pfs helper not stably foreground before owner start att=$s fg=$fgPre helper=$($pre.hwnd)"
        }
        Start-Sleep -Milliseconds 200
      }
      $post = Assert-FuHelperIdentity $HelperBin $hA "pfs-preframe-ident"
      Rec-Fu "pfs-preframe" @{ style = ("0x{0:X8}" -f $nowStyle); outer = "0,0,$screenW,$screenH"; dwm = ($frame -join ","); dwm_settle = $settle; dpi = [int]$dpiFs; fg = $fgPre }
      # Start the proof owner under the pre-formed fullscreen foreground.
      $allowPath = Join-Path $PhaseDir "pfs-allowlist.json"
      $entries = @()
      foreach ($s in @($hA, $hB)) {
        $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
      }
      @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
      $ready = Start-FuOwner $OwnerBin "tile-proof --allowlist `"$allowPath`" --seconds $($Ctx.ownerSeconds) --trace --active-border-theme" (Split-Path -Parent $OwnerBin) "pfs-owner"
      $ownerPid = [int]$ready.owner.pid
      $logPath = "$($ready.log_path)"
      Rec-Fu "pfs-owner-ready" @{ pid = $ownerPid; log = $logPath }
      # Initial guard must suspend on the pre-formed frame: no tick writes.
      $evS = Wait-FuSuspend $logPath 0 "fullscreen-foreground" 20 "pfs-suspend"
      Rec-Fu "pfs-suspended" @{ event = "suspend"; cause = "$($evS.event.cause)" }
      Start-Sleep -Milliseconds 1500
      # No retile: the pre-formed frame must be byte-identical after start.
      $chkOwner = Get-FuHelperOuter $HelperBin $hA
      if ([int]$chkOwner.l -ne 0 -or [int]$chkOwner.t -ne 0 -or ([int]$chkOwner.r - [int]$chkOwner.l) -ne $screenW -or ([int]$chkOwner.b - [int]$chkOwner.t) -ne $screenH) {
        Fail-Fu "pfs owner retiled pre-formed frame to $($chkOwner.l),$($chkOwner.t),$($chkOwner.r),$($chkOwner.b) (guard defect)"
      }
      # Border suppressed: overlay absent; log carries hidden fullscreen or
      # suspended (both are the existing suppression verdict, not a feature).
      $insp = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visCount = @(@($insp.overlays) | Where-Object { $_.visible -eq $true }).Count
      if ($visCount -ne 0) { Fail-Fu "pfs overlay visible under pre-formed fullscreen" }
      $tail = Get-LogEventsAfterFu $logPath 0
      $bEv = @($tail.events | Where-Object { $_.event -eq "active-border" })
      $reasons = @($bEv | ForEach-Object { "$($_.outcome)/$($_.reason)" })
      Rec-Fu "pfs-suppressed" @{ overlay_visible = $visCount; frame_untouched = $true; border_events = $reasons }
      # Suppression must be event-quiet: no resume and no applied tick
      # writes before restore (the guard holds, nothing retiled). Foreground
      # must still be the exact owned helper; any foreign drift aborts with
      # concurrent evidence instead of proceeding ambiguously.
      $snapSup = Get-FuFsSnapshot $HelperBin $OwnerBin $hA "pfs-snap-suppressed"
      if ([uint64]$snapSup.fg -ne [uint64]$pre.hwnd) { Fail-Fu "pfs foreground drifted during suppression fg=$($snapSup.fg) class=$($snapSup.fg_class) (abort, no foreign writes)" }
      $resumes = @($tail.events | Where-Object { $_.event -eq "resume" })
      if (@($resumes).Count -ne 0) { Fail-Fu "pfs owner resumed during suppression (guard defect)" }
      $writes = @($tail.events | Where-Object { $_.event -eq "tick" -and [int]$_.applied -gt 0 })
      if (@($writes).Count -ne 0) { Fail-Fu "pfs owner wrote during suppression (retile defect)" }
      if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fu "pfs held process exited across suspend" }
      if ([ActiveBorderNative]::HeldCreation($held) -ne $heldCreation) { Fail-Fu "pfs held creation changed across suspend" }
      # Restore exact saved style/exstyle/geometry; owner resumes rendering.
      # The transition window opens BEFORE the restore writes: the valid
      # resume+reshow transition can log during the restore settle, so the
      # waiter below must accept it there instead of demanding a second
      # transition after refocus.
      $restoreMark = Get-MarkBeforeActionFu $logPath
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE, $savedStyle)
      $null = [FollowupNative]::SetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_EXSTYLE, $savedEx)
      $ok = [FollowupNative]::SetWindowPos([IntPtr][long]$pre.hwnd, [IntPtr]::Zero, [int]$savedRect.l, [int]$savedRect.t, ([int]$savedRect.r - [int]$savedRect.l), ([int]$savedRect.b - [int]$savedRect.t), ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
      if (-not $ok) { Fail-Fu "pfs SetWindowPos restore failed" }
      Start-Sleep -Milliseconds 1500
      if (-not [ActiveBorderNative]::HeldAlive($held)) { Fail-Fu "pfs held process exited across restore" }
      $backStyle = [FollowupNative]::GetWindowLongW([IntPtr][long]$pre.hwnd, $GWL_STYLE)
      if ([int]$backStyle -ne [int]$savedStyle) { Fail-Fu "pfs style not restored" }
      $back = Assert-FuHelperIdentity $HelperBin $hA "pfs-restored-ident"
      $null = Get-FuFsSnapshot $HelperBin $OwnerBin $hA "pfs-snap-restored"
      $refMark = Get-MarkBeforeActionFu $logPath
      $null = Set-FuForeground $HelperBin $hA "pfs-refocus"
      $snapRef = Get-FuFsSnapshot $HelperBin $OwnerBin $hA "pfs-snap-refocus"
      if ([uint64]$snapRef.fg -ne [uint64]$pre.hwnd) { Fail-Fu "pfs owned helper not foreground after refocus fg=$($snapRef.fg) (abort, no foreign writes)" }
      # Oracle first: exact overlay/state + composed decide; the transition
      # event is secondary. Prefer a post-refocus transition, but accept the
      # already-logged post-restore transition when refocus is a steady-state
      # no-op (no second transition is owed).
      Start-Sleep -Milliseconds 2000
      $setF = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "pfs-reshow"
      $compF = Get-FuComposedRing $setF.overlay 4 $WantColor "pfs-reshow-composed"
      $bevOutcome = $null
      try {
        $bTry = Wait-BorderOutcomeFu $logPath $refMark @("shown", "redrew", "moved") "" 5 "pfs-reshow-post"
        $bevOutcome = "$($bTry.event.outcome)"
      } catch {
        $tailR = Get-LogEventsAfterFu $logPath $restoreMark
        $trans = @($tailR.events | Where-Object { $_.event -eq "active-border" -and @("shown", "redrew", "moved") -contains "$($_.outcome)" })
        if (@($trans).Count -eq 0) { Fail-Fu "pfs-reshow no post-restore transition after line $restoreMark (oracle held overlay $($setF.overlay -join ','))" }
        $bevOutcome = "$($trans[-1].outcome)"
      }
      Rec-Fu "pfs-restored" @{ style_exact = $true; border = $bevOutcome; overlay = ($setF.overlay -join ","); composed = $compF.hits; above = "$($setF.z[0])"; adjacent = "$($setF.z[1])" }
      $st = Stop-FuOwnerExact $OwnerBin $ready.owner "pfs" $false
      $left = @(Get-FuOverlayHwnds $ownerPid) | Where-Object { $_ -ne 0 }
      if (@($left).Count -ne 0) { Fail-Fu "pfs overlay residue pid=$ownerPid" }
      Rec-Fu "pfs-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
    } finally { if ($null -ne $held -and $held -ne [IntPtr]::Zero) { $null = [ActiveBorderNative]::CloseHandle($held) } }
  } catch { throw }
  finally { Close-FuHelpers $HelperBin $created "pfs" }
  Assert-FuNoActors $OwnerBin $HelperBin "pfs"
  Rec-Fu "pfs-clean" @{ actors = "absent"; ledger = "clean" }
}

function Invoke-FuShellPhase([string]$OwnerBin, [string]$HelperBin, [string]$PhaseDir, [hashtable]$WantColor, [hashtable]$Ctx) {
  # Standalone shell probes (independent of any fullscreen leg): approved
  # helper foreground throughout, exact helper bound, hold-cancel only
  # (Escape / Alt-release), never committing Alt+Tab to a user window.
  # Part 1 runs under tile-proof (honest proof-gate reasons); part 2 runs one
  # Start probe under scoped NORMAL tiling (`--scope-exe` helper fence, no
  # keyboard/mouse takeover) to evidence the actual production shell policy.
  $created = [System.Collections.ArrayList]@()
  try {
    $hA = Start-FuHelper $HelperBin (Join-Path $PhaseDir "s-helperA.json") "shell-helperA"
    $hB = Start-FuHelper $HelperBin (Join-Path $PhaseDir "s-helperB.json") "shell-helperB"
    $null = $created.Add(@{ hwnd = [uint64]$hA.hwnd; tag = "$($hA.tag)" })
    $null = $created.Add(@{ hwnd = [uint64]$hB.hwnd; tag = "$($hB.tag)" })
    $allowPath = Join-Path $PhaseDir "shell-allowlist.json"
    $entries = @()
    foreach ($s in @($hA, $hB)) {
      $entries += @{ hwnd = [uint64]$s.hwnd; pid = [uint32]$s.process.pid; process_creation = "$($s.process.process_creation)"; exe_path = "$($s.process.exe_path)"; user_sid = "$($s.process.user_sid)"; session_id = [uint32]$s.process.session_id; tag = "$($s.tag)" }
    }
    @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
    $ready = Start-FuOwner $OwnerBin "tile-proof --allowlist `"$allowPath`" --seconds $($Ctx.ownerSeconds) --trace --active-border-theme" (Split-Path -Parent $OwnerBin) "shell-owner"
    $ownerPid = [int]$ready.owner.pid
    $logPath = "$($ready.log_path)"
    Rec-Fu "shell-owner-ready" @{ pid = $ownerPid; log = $logPath }
    Start-Sleep -Milliseconds 2000
    $mark = Get-MarkBeforeActionFu $logPath
    $freshA = Set-FuForeground $HelperBin $hA "shell-focus"
    $null = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "shell-baseline"
    $set0 = Wait-FuExactAndZ $OwnerBin ([long]$freshA.hwnd) 4 0 "shell-baseline"
    $comp0 = Get-FuComposedRing $set0.overlay 4 $WantColor "shell-baseline-composed"
    Rec-Fu "shell-baseline" @{ overlay = ($set0.overlay -join ","); composed = $comp0.hits }
    foreach ($probe in @(
        @{ name = "start"; keys = @(@($FU_VK_WIN, $false), @($FU_VK_WIN, $true)) },
        @{ name = "taskview"; keys = @(@($FU_VK_WIN, $false), @($FU_VK_TAB, $false), @($FU_VK_TAB, $true), @($FU_VK_WIN, $true)) }
      )) {
      $null = Set-FuForeground $HelperBin $hA "shell-$($probe.name)-prime"
      $fgPre = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $mark = Get-MarkBeforeActionFu $logPath
      foreach ($k in $probe.keys) {
        $one = [FollowupNative]::SendKeyExtra([uint16]$k[0], [bool]$k[1], [uint64]0)
        if ($one -ne 1) { Fail-Fu "shell-$($probe.name) chord not inserted vk=$($k[0])" }
        Start-Sleep -Milliseconds 150
      }
      Start-Sleep -Milliseconds 1500
      $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
      $inspMid = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visMid = @(@($inspMid.overlays) | Where-Object { $_.visible -eq $true }).Count
      $tailMid = Get-LogEventsAfterFu $logPath $mark
      $bMid = @($tailMid.events | Where-Object { $_.event -eq "active-border" })
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
      Start-Sleep -Milliseconds 150
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
      Start-Sleep -Milliseconds 1200
      $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      if ([uint64]$fgAfter -ne [uint64]$hA.hwnd) {
        $null = Set-FuForeground $HelperBin $hA "shell-$($probe.name)-recover"
        $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      }
      $reshow = "none-shell-no-foreground"
      $set = $null; $comp = $null
      try {
        $bev = Wait-BorderOutcomeFu $logPath $mark @("shown", "redrew", "moved") "" 20 "shell-$($probe.name)-reshow"
        $reshow = "$($bev.event.outcome)"
        $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-$($probe.name)"
        $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-$($probe.name)-composed"
      } catch {
        if ([uint64]$fgMid -ne [uint64]$hA.hwnd) { throw }
        $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-$($probe.name)-still"
        $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-$($probe.name)-still-composed"
      }
      Rec-Fu "shell-$($probe.name)" @{ fg_pre = $fgPre; fg_mid = $fgMid; class_mid = $clsMid; overlay_visible_mid = $visMid; border_mid = @($bMid | ForEach-Object { "$($_.outcome)/$($_.reason)" }); fg_after = $fgAfter; reshow = $reshow; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])"; proof_gate = "allowlist-changed-hides-foreign (proof-only; see shell-normal-start for production policy)" }
    }
    $null = Set-FuForeground $HelperBin $hA "shell-alttab-prime"
    $mark = Get-MarkBeforeActionFu $logPath
    $altDown = $false
    try {
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ALT, $false, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab alt down not inserted" }
      $altDown = $true
      Start-Sleep -Milliseconds 200
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_TAB, $false, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab tab down not inserted" }
      Start-Sleep -Milliseconds 200
      $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_TAB, $true, [uint64]0)
      if ($one -ne 1) { Fail-Fu "shell-alttab tab up not inserted" }
      Start-Sleep -Milliseconds 1200
      $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
      $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
      $inspMid = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
      $visMid = @(@($inspMid.overlays) | Where-Object { $_.visible -eq $true }).Count
      $tailMid = Get-LogEventsAfterFu $logPath $mark
      $bMid = @($tailMid.events | Where-Object { $_.event -eq "active-border" })
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
      Start-Sleep -Milliseconds 150
      $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
      Start-Sleep -Milliseconds 300
    } finally {
      if ($altDown) {
        try { $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ALT, $true, [uint64]0) } catch {}
      }
    }
    Start-Sleep -Milliseconds 1200
    $fgRaw = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $committed = (([uint64]$fgRaw -ne [uint64]$hA.hwnd) -and ((@($hA, $hB) | Where-Object { [uint64]$_.hwnd -eq [uint64]$fgRaw }).Count -eq 0))
    $fgAfter = $fgRaw
    if ([uint64]$fgAfter -ne [uint64]$hA.hwnd) {
      $null = Set-FuForeground $HelperBin $hA "shell-alttab-recover"
      $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    }
    $inspEnd = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
    $visEnd = @(@($inspEnd.overlays) | Where-Object { $_.visible -eq $true }).Count
    Rec-Fu "shell-alttab" @{ fg_mid = $fgMid; class_mid = $clsMid; overlay_visible_mid = $visMid; border_mid = @($bMid | ForEach-Object { "$($_.outcome)/$($_.reason)" }); fg_raw = $fgRaw; committed_foreign = $committed; fg_after = $fgAfter; overlay_visible_end = $visEnd }
    if ($committed) {
      Fail-Fu "shell-alttab committed to foreign hwnd=$fgRaw"
    }
    $st = Stop-FuOwnerExact $OwnerBin $ready.owner "shell-proof" $false
    $left = @(Get-FuOverlayHwnds $ownerPid) | Where-Object { $_ -ne 0 }
    if (@($left).Count -ne 0) { Fail-Fu "shell overlay residue pid=$ownerPid" }
    Rec-Fu "shell-proof-stop" @{ stop = $st.stop.owner_exited; restore = $st.restore.restored }
    # Part 2: production policy under scoped NORMAL tiling. Scope fences the
    # run to the owned helper exe (no keyboard/mouse takeover, no allowlist
    # gate): a real shell foreground hides via the product path (observed
    # no-target), not the proof allowlist gate.
    $scopeArgs = " --scope-exe tiler-test-window.exe"
    $ready2 = Start-FuOwner $OwnerBin "tile --user-start --seconds $($Ctx.ownerSeconds) --trace --no-keyboard-snap-takeover --no-mouse-snap-prevention --active-border-theme$scopeArgs" (Split-Path -Parent $OwnerBin) "shell-normal-owner"
    $frozen2 = $ready2.owner
    $log2 = "$($ready2.log_path)"
    Rec-Fu "shell-normal-ready" @{ pid = $frozen2.pid; log = $log2 }
    Start-Sleep -Milliseconds 2500
    $startEv = @((Get-LogEventsAfterFu $log2 0).events | Where-Object { $_.event -eq "tile-start" }) | Select-Object -First 1
    if ($null -eq $startEv) { Fail-Fu "shell-normal tile-start missing" }
    if ("$($startEv.mode)" -ne "normal") { Fail-Fu "shell-normal tile-start mode $($startEv.mode) != normal" }
    Rec-Fu "shell-normal-tile-start" @{ mode = "$($startEv.mode)"; scope_count = $startEv.scope_count }
    # Prefocus away first: the scoped owner may already have focused hA
    # itself, in which case mark-then-focus emits no transition. Forcing the
    # transition via hB keeps the baseline oracle honest.
    $null = Set-FuForeground $HelperBin $hB "shell-normal-prefocus"
    $mark = Get-MarkBeforeActionFu $log2
    $null = Set-FuForeground $HelperBin $hA "shell-normal-focus"
    $bev = Wait-BorderOutcomeFu $log2 $mark @("shown", "redrew", "moved") "" 20 "shell-normal-baseline"
    $setN = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-normal-baseline"
    $compN = Get-FuComposedRing $setN.overlay 4 $WantColor "shell-normal-baseline-composed"
    Rec-Fu "shell-normal-baseline" @{ border = "$($bev.event.outcome)"; overlay = ($setN.overlay -join ","); composed = $compN.hits }
    $mark = Get-MarkBeforeActionFu $log2
    $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_WIN, $false, [uint64]0)
    if ($one -ne 1) { Fail-Fu "shell-normal-start chord down not inserted" }
    Start-Sleep -Milliseconds 150
    $one = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_WIN, $true, [uint64]0)
    if ($one -ne 1) { Fail-Fu "shell-normal-start chord up not inserted" }
    Start-Sleep -Milliseconds 1500
    $fgMid = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    $clsMid = [ActiveBorderNative]::ClassOf($fgMid)
    $inspMid = Invoke-Native $OwnerBin @("border-inspect") | ConvertFrom-Json
    $visMid = @(@($inspMid.overlays) | Where-Object { $_.visible -eq $true }).Count
    $tailMid = Get-LogEventsAfterFu $log2 $mark
    $bMid = @($tailMid.events | Where-Object { $_.event -eq "active-border" })
    $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $false, [uint64]0)
    Start-Sleep -Milliseconds 150
    $null = [FollowupNative]::SendKeyExtra([uint16]$FU_VK_ESC, $true, [uint64]0)
    Start-Sleep -Milliseconds 1200
    $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgAfter -ne [uint64]$hA.hwnd) {
      $null = Set-FuForeground $HelperBin $hA "shell-normal-recover"
      $fgAfter = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
    }
    $reshow = "none-shell-no-foreground"
    $set = $null; $comp = $null
    try {
      $bev = Wait-BorderOutcomeFu $log2 $mark @("shown", "redrew", "moved") "" 20 "shell-normal-reshow"
      $reshow = "$($bev.event.outcome)"
      $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-normal"
      $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-normal-composed"
    } catch {
      if ([uint64]$fgMid -ne [uint64]$hA.hwnd) { throw }
      $set = Wait-FuExactAndZ $OwnerBin ([long]$hA.hwnd) 4 0 "shell-normal-still"
      $comp = Get-FuComposedRing $set.overlay 4 $WantColor "shell-normal-still-composed"
    }
    Rec-Fu "shell-normal-start" @{ fg_mid = $fgMid; class_mid = $clsMid; overlay_visible_mid = $visMid; border_mid = @($bMid | ForEach-Object { "$($_.outcome)/$($_.reason)" }); fg_after = $fgAfter; reshow = $reshow; overlay = ($set.overlay -join ","); composed = $comp.hits; above = "$($set.z[0])"; adjacent = "$($set.z[1])"; policy = "production no-target (no allowlist gate)" }
    $st2 = Stop-FuOwnerExact $OwnerBin $frozen2 "shell-normal" $false
    Rec-Fu "shell-normal-stop" @{ stop = $st2.stop.owner_exited; restore = $st2.restore.restored }
  } catch { throw }
  finally { Close-FuHelpers $HelperBin $created "shell" }
  Assert-FuNoActors $OwnerBin $HelperBin "shell"
  Rec-Fu "shell-clean" @{ actors = "absent"; ledger = "clean" }
}

function Invoke-FuTimingBounds([string]$Repo, [string]$Tag) {
  # Offline sampled-staleness summary from the accepted per-step traces (no
  # live input): expand each sampled DWM frame by width 4 and compare with
  # the sampled overlay rect. Truthful record only: stale STEPS plus the
  # ACTUAL sampled motion intervals (step0->step1 is gesture-startup pause,
  # 633ms drag / 591ms resize, excluded from the motion interval), oldest
  # matching sample age from the step timestamps, exact sub-interval
  # latency UNKNOWN (a 0-step match at ~80ms sampling bounds latency below
  # one sampling interval, never 0ms). Synthetic (SendInput) gestures only;
  # physical delivery stays user-observed.
  $prior = Join-Path $Repo "target\windows-active-border\20261002-205625-31076\active-border-report.json"
  if (-not (Test-Path -LiteralPath $prior)) { Rec-Fu "timing-bounds" @{ skipped = "prior report absent" }; return }
  $d = Get-Content -LiteralPath $prior -Raw | ConvertFrom-Json
  $legs = @{}
  foreach ($s in @($d.steps)) {
    if (@("leg2-active-drag", "leg2r-active-resize") -contains "$($s.name)") { $legs["$($s.name)"] = $s.data }
  }
  $bounds = @{}
  foreach ($k in @($legs.Keys)) {
    $trace = @($legs[$k].trace)
    # Per-step lag: overlay rect at step i is [x,y,w,h]; each sampled frame
    # j expands to want_j = (x-4,y-4,w+8,h+8). lag_i = i - max{j<=i: match}.
    # Position and size tracked separately (drag moves position first).
    $frames = @()
    foreach ($step in $trace) {
      if ("$($step.frame)" -eq "unreadable") { $frames += $null; continue }
      $fr = "$($step.frame)" -split ","
      $fx = [int]$fr[0]; $fy = [int]$fr[1]
      $fw = [int]$fr[2] - $fx; $fh = [int]$fr[3] - $fy
      $frames += ("$($fx - 4),$($fy - 4),$($fw + 8),$($fh + 8)")
    }
    $maxLag = 0; $maxPosLag = 0; $maxSizeLag = 0; $maxIv = 0; $maxAge = 0; $unmatched = 0
    for ($i = 0; $i -lt $trace.Count; $i++) {
      if ($i -ge 2) {
        $iv = [int]$trace[$i].t_ms - [int]$trace[$i - 1].t_ms
        if ($iv -gt $maxIv) { $maxIv = $iv }
      }
      if ($i -eq 0) { continue }
      $ov = "$($trace[$i].overlay)"
      if ($ov -eq "absent") { continue }
      $op = $ov -split ","
      $lag = $i; $posLag = $i; $sizeLag = $i; $found = $false
      for ($j = $i; $j -ge 0; $j--) {
        if ($null -eq $frames[$j]) { continue }
        $wp = $frames[$j] -split ","
        if (($op[0] -eq $wp[0]) -and ($op[1] -eq $wp[1]) -and ($op[2] -eq $wp[2]) -and ($op[3] -eq $wp[3])) { $lag = ($i - $j); $found = $true; break }
      }
      for ($j = $i; $j -ge 0; $j--) {
        if ($null -eq $frames[$j]) { continue }
        $wp = $frames[$j] -split ","
        if (($op[0] -eq $wp[0]) -and ($op[1] -eq $wp[1])) { $posLag = ($i - $j); break }
      }
      for ($j = $i; $j -ge 0; $j--) {
        if ($null -eq $frames[$j]) { continue }
        $wp = $frames[$j] -split ","
        if (($op[2] -eq $wp[2]) -and ($op[3] -eq $wp[3])) { $sizeLag = ($i - $j); break }
      }
      if ($lag -gt $maxLag) { $maxLag = $lag }
      if ($posLag -gt $maxPosLag) { $maxPosLag = $posLag }
      if ($sizeLag -gt $maxSizeLag) { $maxSizeLag = $sizeLag }
      if ($found -and $i -ge 2) {
        $age = [int]$trace[$i].t_ms - [int]$trace[$i - $lag].t_ms
        if ($age -gt $maxAge) { $maxAge = $age }
      } elseif (-not $found) { $unmatched++ }
    }
    $bounds[$k] = @{ max_lag_steps = $maxLag; max_pos_steps = $maxPosLag; max_size_steps = $maxSizeLag; commanded_step_ms = 60; max_motion_interval_ms = $maxIv; oldest_matching_sample_age_ms = $maxAge; unmatched_steps = $unmatched; total_ms = $legs[$k].total_ms; upper_latency_ms = "unknown-sub-interval"; note = "steps at sampled motion cadence; step0->step1 startup pause excluded; 0-step match bounds latency below one sampling interval, never 0ms" }
  }
  Rec-Fu "timing-bounds" @{ source = "20261002-205625-31076 per-step DWM+overlay samples"; synthetic = $true; bounds = $bounds; note = "total1.4s is gesture duration, not lag; physical delivery user-observed; exact sub-interval latency unknown" }
}

function Invoke-BorderFollowup {
  Install-FollowupNative
  if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt 600) { Fail-Fu "refuse: OwnerSeconds must be 1..=600" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $runDir = Join-Path $Repo "target\ab-followup\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
  $reportPath = Join-Path $runDir "followup-report.json"
  if (Test-Path $reportPath) { Fail-Fu "report preexists, will not overwrite" }
  $binDir = Join-Path $runDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) { Fail-Fu "cargo build failed" }
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $ownerHash = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
  $helperHash = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
  Rec-Fu "env" @{ commit = $commit; status = $status; run_dir = $runDir; owner_sha256 = $ownerHash; helper_sha256 = $helperHash }
  Assert-LedgerClean $ownerCopy
  $fg0 = [ActiveBorderNative]::GetForegroundWindow().ToInt64()
  $cls0 = [ActiveBorderNative]::ClassOf($fg0)
  $arr = [ActiveBorderNative]::SpiGet(0x0082); $pen = [ActiveBorderNative]::SpiGet(0x201E)
  if ([int]$arr -ne 1) { Fail-Fu "preflight arranging raw $arr != 1" }
  if ([int]$pen -ne 35) { Fail-Fu "preflight pen raw $pen != 35" }
  Rec-Fu "preflight" @{ fg = $fg0; fg_class = $cls0; arranging = $arr; pen = $pen; ledger = "clean" }
  $accent = Get-FuSystemAccent
  if ($null -eq $accent) { Fail-Fu "DwmGetColorizationColor query failed" }
  $wantColor = @{ r = $accent.r; g = $accent.g; b = $accent.b; hex = $accent.hex }
  Rec-Fu "accent" @{ hex = $accent.hex }
  $Ctx = @{ ownerSeconds = $OwnerSeconds }
  $phaseResults = @{}
  $allPhases = @(
    @{ name = "directional"; fn = { Invoke-FuDirectionalPhase $ownerCopy $helperCopy (Join-Path $runDir "directional") $wantColor $Ctx } },
    @{ name = "workspace"; fn = { Invoke-FuWorkspacePhase $ownerCopy $helperCopy (Join-Path $runDir "workspace") $wantColor $Ctx } },
    @{ name = "fullscreen-shell"; fn = { Invoke-FuFullscreenShellPhase $ownerCopy $helperCopy (Join-Path $runDir "fullscreen-shell") $wantColor $Ctx } },
    @{ name = "fullscreen"; fn = { Invoke-FuFullscreenPhase $ownerCopy $helperCopy (Join-Path $runDir "fullscreen") $wantColor $Ctx } },
    @{ name = "shell"; fn = { Invoke-FuShellPhase $ownerCopy $helperCopy (Join-Path $runDir "shell") $wantColor $Ctx } },
    @{ name = "ordinary"; fn = { Invoke-FuOrdinaryPhase $ownerCopy (Join-Path $runDir "ordinary") $wantColor $Ctx } }
  )
  # Phase selection: "all" keeps the original four (directional, workspace,
  # fullscreen-shell, ordinary). New split legs run by name without rerunning
  # passed independent legs, e.g. -FuPhases "fullscreen,shell,ordinary".
  # Each phase is independently try/caught so one failure cannot prevent the
  # others; shell never depends on any fullscreen outcome.
  $wanted = @($allPhases)
  if ("$FuPhases" -ne "all") {
    $names = @("$FuPhases" -split "," | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" })
    if ($names.Count -eq 0) { Fail-Fu "refuse: empty -FuPhases selection" }
    $wanted = @($allPhases | Where-Object { $names -contains $_.name })
    $unknown = @($names | Where-Object { $_ -notin @($allPhases | ForEach-Object { $_.name }) })
    if ($unknown.Count -gt 0) { Fail-Fu "refuse: unknown -FuPhases name(s): $($unknown -join ',')" }
    if ($wanted.Count -eq 0) { Fail-Fu "refuse: -FuPhases selected nothing" }
    Rec-Fu "phase-selection" @{ selected = ($names -join ",") }
  }
  foreach ($ph in $wanted) {
    $pdir = Join-Path $runDir $ph.name
    New-Item -ItemType Directory -Force -Path $pdir | Out-Null
    try {
      & $ph.fn
      $phaseResults[$ph.name] = "pass"
      Rec-Fu "phase-$($ph.name)" @{ status = "pass" }
    } catch {
      $phaseResults[$ph.name] = "fail: $($_.Exception.Message)"
      Rec-Fu "phase-$($ph.name)" @{ status = "fail"; error = "$($_.Exception.Message)"; stack = "$($_.ScriptStackTrace)" }
      try {
        try { $null = Invoke-Native $ownerCopy @("stop") } catch {}
        try { $null = Invoke-Native $ownerCopy @("restore") } catch {}
      } catch {}
    }
    try { Assert-LedgerClean $ownerCopy } catch { Rec-Fu "ledger-after-$($ph.name)" @{ warn = "$($_.Exception.Message)" } }
  }
  Invoke-FuTimingBounds $Repo "timing"
  # Direct readback audit: SPI, overlay class scoped to run owners, actors.
  $spiEnd = @{ arranging = [ActiveBorderNative]::SpiGet(0x0082); pen = [ActiveBorderNative]::SpiGet(0x201E) }
  $auditProcs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -ieq $ownerCopy -or $_.Path -ieq $helperCopy } catch { $false }
    })
  Rec-Fu "audit" @{ spi = $spiEnd; actors = @($auditProcs).Count; phases = $phaseResults }
  $failed = @($phaseResults.Keys | Where-Object { "$($phaseResults[$_])" -ne "pass" })
  $overall = "pass"
  if ($failed.Count -gt 0) { $overall = "fail" }
  $report = @{ status = $overall; stage = "ActiveBorderFollowup"; started = (Get-Date).ToString("o"); phases = $phaseResults; steps = $FU_STEPS }
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
  Write-Output "followup-report=$reportPath"
  Write-Output "status=$overall"
  if ($overall -ne "pass") { throw "ActiveBorderFollowup failed phases: $($failed -join ',')" }
}

if ($Followup) { Invoke-BorderFollowup; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Ab "Stop requires -RunDir" }
  . (Join-Path $Repo "scripts\windows-dev.ps1")
  $ownerCopy = Join-Path $RunDir "bin\tiler-windows.exe"
  try { $s = Invoke-Native $ownerCopy @("stop") | ConvertFrom-Json; Write-Output ("stop=" + ($s | ConvertTo-Json -Compress)) } catch { Write-Output "stop failed: $($_.Exception.Message)" }
  try { $r = Invoke-Native $ownerCopy @("restore") | ConvertFrom-Json; Write-Output ("restore=" + ($r | ConvertTo-Json -Compress)) } catch { Write-Output "restore failed: $($_.Exception.Message)" }
  exit 0
}
if ($Live) { Invoke-BorderLive; exit 0 }
Write-Output "active-border parsed (no action without -Mock/-Live/-Stop/-Followup)"
