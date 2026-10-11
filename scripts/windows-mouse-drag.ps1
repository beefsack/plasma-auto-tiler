param(
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 300,
  [ValidateSet("All", "TitleDrag", "Cancel", "Zero", "SelfCentre", "SameOutput", "WinDrag", "WinAll", "PreviewProbe", "PreviewCrash")]
  [string]$Stage = "All"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# Reuse Explorer desktop broker plus exact-owner helpers. Only stable
# windows-dev.ps1 helpers are sourced (no AST imports from other harnesses:
# every helper signature used here is defined in this file or in
# windows-dev.ps1, whose surface is pinned by the mock contract test).
. (Join-Path $Repo "scripts\windows-dev.ps1")
if ("$($MyInvocation.InvocationName)" -eq ".") { return }

# Scoped ordinary-app title-bar drag verification over the normal `tile` loop.
# Title-bar slice only (item 7 first unit): the native-loop Win+Left producer
# is discarded; a later Win unit lands a project-driven movement path.
# Three borrowed approved apps (Notepad, Calculator via ApplicationFrameHost,
# Paint) are bound by exact HWND; the explicit `--scope-exe` filter keeps the
# hosting Terminal (and everything else) untouched. Native title-bar drags
# route through the shared settle-time Engine `DragDrop` with producer
# `native`; Esc/zero/self/centre/outside restore with no plan. Item 8
# (preview): a separate topmost filled target-slot carrier on both
# producers, same Engine resolver/prior/hints as the drop.
#
#   pwsh -NoProfile -File scripts/windows-mouse-drag.ps1 -Mock
#   pwsh -NoProfile -File scripts/windows-mouse-drag.ps1 -Live [-Stage <name>] [-OwnerSeconds 600]
#   pwsh -NoProfile -File scripts/windows-mouse-drag.ps1 -Stop -RunDir '<dir>'
#
# Title stages (-All and the six singletons) are the accepted slice and stay
# stable. -WinDrag runs the seven project Win+Left rows on the same 3-app
# fixture (plus a caption-regression title drop at the end); -WinAll runs the
# six title rows first, then the Win rows. Win rows need a longer owner
# budget: pass -OwnerSeconds 600 for -WinAll. -PreviewProbe runs the sticky
# group-edge journey; -PreviewCrash kills the exact owner mid-hold with the
# preview visible, then the shared legs verify forced-loss recovery.
#
# Safety: explicit flags mandatory; bare invocation parses and exits. Live
# borrows the three approved ordinary apps by exact HWND (existing windows
# are never closed; created ones close after via exact-HWND WM_CLOSE) plus
# temporary minimize/restore of approved extras, under a scoped normal owner
# (`--scope-exe` plus the Calculator child-host gate, never the hosting
# Terminal tree). NEVER closes/kills/types
# into the hosting Terminal/process tree (moving/tiling it is allowed). No
# process-name kills, no registry/policy writes, no app content. Synthetic
# input is unmarked absolute mouse only (physical-equivalent pointer path).
# Injected Esc never sets the product cancel edge (the product hook filters
# injected keys; the native modal loop still cancels and settle reads back
# no-change with restored geometry). Foreground work uses E8-prime +
# AttachThreadInput + one SetForegroundWindow on the exact bound target.
# Out-of-hook stop only (`stop` then `restore`). End state: zero run
# actors; ledger/stop clean; SPI arranging 1, pen 35.

$MD_STEPS = [System.Collections.ArrayList]@()
function Rec-Md([string]$Name, $Data) { $null = $MD_STEPS.Add(@{ name = $Name; data = $Data }) }
function Fail-Md([string]$Msg) { throw $Msg }

$MD_SCOPE_ARGS = " --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe"
$MD_VK_ESC = 27
$MD_VK_LWIN = 0x5B; $MD_VK_RWIN = 0x5C
$MD_MOUSE_MOVE = 0x0001; $MD_MOUSE_ABS = 0x8000; $MD_MOUSE_DOWN = 0x0002; $MD_MOUSE_UP = 0x0004
$MD_INPUT_SIZE_X64 = 40
$MD_MAX_OWNER_SECONDS = 600

function Install-MdNative {
  if (-not ("MouseDragNative" -as [type])) {
    $csharp = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class MouseDragNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  public static void EnsurePMv2() {
    try { SetThreadDpiAwarenessContext((IntPtr)(-4)); } catch {}
  }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeoutW(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lp, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder b, int n);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  public static string ClassOf(long hwnd) {
    StringBuilder b = new StringBuilder(256);
    int n = GetClassNameW((IntPtr)hwnd, b, b.Capacity);
    if (n <= 0) return "";
    return b.ToString();
  }
  public static uint SendMouse(uint flags, int nx, int ny) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 0;
    arr[0].u.mi.dx = nx; arr[0].u.mi.dy = ny;
    arr[0].u.mi.mouseData = 0; arr[0].u.mi.dwFlags = flags;
    arr[0].u.mi.time = 0; arr[0].u.mi.dwExtraInfo = (UIntPtr)0;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint SendKey(ushort vk, bool up) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk; arr[0].u.ki.wScan = 0;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0; arr[0].u.ki.dwExtraInfo = (UIntPtr)0;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint PrimeE8() { return SendKey(0xE8, false) + SendKey(0xE8, true); }
  public static int SizeOfInput() { return Marshal.SizeOf(typeof(INPUT)); }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint p);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, UIntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint a, ref RECT v, int s);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SystemParametersInfo(uint a, uint b, ref int c, uint d);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string c, string w);
  public static int[] OuterOf(long hwnd) {
    RECT r;
    if (!GetWindowRect((IntPtr)hwnd, out r)) return null;
    return new int[] { r.left, r.top, r.right, r.bottom };
  }
  public static int[] FrameOf(long hwnd) {
    RECT r = new RECT();
    if (DwmGetWindowAttribute((IntPtr)hwnd, 9, ref r, Marshal.SizeOf(typeof(RECT))) != 0) return null;
    return new int[] { r.left, r.top, r.right - r.left, r.bottom - r.top };
  }
  public static void CaptureScreen(string path, int x, int y, int w, int h) {
    using (Bitmap bmp = new Bitmap(w, h)) {
      using (Graphics g = Graphics.FromImage(bmp)) { g.CopyFromScreen(x, y, 0, 0, bmp.Size); }
      bmp.Save(path, ImageFormat.Png);
    }
  }
}
"@
    $drawRefs = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.FullName -match '^System\.(Drawing\.Common|Drawing\.Primitives|Private\.Windows\.[A-Za-z]+),' } | Select-Object -ExpandProperty Location)
    Add-Type -ReferencedAssemblies $drawRefs -TypeDefinition $csharp | Out-Null
    # PMv2 thread context so SPI/screen/frame reads are physical pixels.
    try { $null = [MouseDragNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}
  }
  [MouseDragNative]::EnsurePMv2()
}

function Read-MdFile([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $r = New-Object IO.StreamReader($stream); return $r.ReadToEnd() } finally { $stream.Close() }
}

function Get-MdLines([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail-Md "missing log $Path" }
  $text = Read-MdFile $Path
  $complete = @()
  if ([string]::IsNullOrEmpty($text)) { return ,$complete }
  $endsNl = $text.EndsWith("`n")
  $parts = $text -split "`n"
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $last = ($i -eq ($parts.Count - 1))
    if ($last -and -not $endsNl) { break }
    $line = "$($parts[$i])" -replace "`r$", ""
    if ($last -and $line -eq "") { break }
    $complete += $line
  }
  return ,$complete
}

function Get-MdEvents([string]$LogPath, [int]$Mark) {
  $lines = Get-MdLines $LogPath
  $out = @()
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -eq "") { continue }
    $out += ($lines[$i] | ConvertFrom-Json)
  }
  return @{ events = $out; count = $lines.Count }
}

function Wait-MdGesture([string]$LogPath, [int]$Mark, [string[]]$Outcomes, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $cur = $Mark
  while ((Get-Date) -lt $deadline) {
    $got = Get-MdEvents $LogPath $cur
    foreach ($e in $got.events) {
      if ("$($e.event)" -ne "gesture") { continue }
      if ($Outcomes -notcontains "$($e.outcome)") { continue }
      return @{ event = $e; count = $got.count }
    }
    $cur = $got.count
    Start-Sleep -Milliseconds 200
  }
  Fail-Md "$Tag no gesture outcome=($($Outcomes -join '|'))"
  return $null
}

function Get-MdPlanSnapshot($Events) {
  $plans = @{}; $details = @{}
  foreach ($e in @($Events)) {
    if ($e.event -eq "plan") { $plans[[uint64]$e.tick] = $e }
    elseif ($e.event -eq "readback-detail") { $details[[uint64]$e.tick] = $e }
  }
  $ticks = @($plans.Keys | Where-Object { $details.ContainsKey($_) } | Sort-Object -Descending)
  if ($ticks.Count -eq 0) { return $null }
  $tick = [uint64]$ticks[0]
  return @{ tick = $tick; plan = $plans[$tick]; detail = $details[$tick] }
}

function Test-MdFramesMatchPlan($Detail, [array]$FramesXywh, [string]$Tag) {
  # Multiset comparison: every planned desired rect has exactly one native
  # DWM frame and vice versa. Order-independent (no token-to-HWND mapping
  # assumed). Returns $true on match; throws a contract error otherwise so
  # the mock fixture test can assert both directions.
  $want = @($Detail.entries | ForEach-Object { "$($_.desired -join ',')" } | Sort-Object)
  $got = @($FramesXywh | ForEach-Object { "$($_ -join ',')" } | Sort-Object)
  if ($want.Count -ne $got.Count) { Fail-Md "$Tag plan/frame count $($want.Count) != $($got.Count)" }
  for ($i = 0; $i -lt $want.Count; $i++) {
    if ($want[$i] -cne $got[$i]) { Fail-Md "$Tag plan/frame multiset mismatch at ${i}: want $($want[$i]) got $($got[$i])" }
  }
  foreach ($en in @($Detail.entries)) {
    if ($en.matched -ne $true) { Fail-Md "$Tag readback unmatched for $($en.window)" }
  }
  return $true
}

function ConvertTo-MdAbsolute([int]$Px, [int]$Origin, [int]$Span) {
  if ($Span -le 1) { Fail-Md "absolute span invalid" }
  return [int][math]::Round(($Px - $Origin) * 65535.0 / ($Span - 1))
}

function Get-MdVirtualScreen {
  $SM_XVS = 76; $SM_YVS = 77; $SM_CXVS = 78; $SM_CYVS = 79
  return @(
    [MouseDragNative]::GetSystemMetrics($SM_XVS),
    [MouseDragNative]::GetSystemMetrics($SM_YVS),
    [MouseDragNative]::GetSystemMetrics($SM_CXVS),
    [MouseDragNative]::GetSystemMetrics($SM_CYVS)
  )
}

function Get-MdOuter([long]$Hwnd) {
  $r = [MouseDragNative]::OuterOf($Hwnd)
  if ($null -eq $r) { Fail-Md "native outer unreadable hwnd=$Hwnd" }
  return @([int]$r[0], [int]$r[1], [int]$r[2], [int]$r[3])
}

function Get-MdFrame([long]$Hwnd) {
  $f = [MouseDragNative]::FrameOf($Hwnd)
  if ($null -eq $f) { Fail-Md "native DWM frame unreadable hwnd=$Hwnd" }
  return @([int]$f[0], [int]$f[1], [int]$f[2], [int]$f[3])
}

function Find-MdTitlePoint([long]$Hwnd, [int[]]$Outer) {
  # True-caption probe: tabbed Notepad hit-tests HTCAPTION even on tabs, and a
  # tab down+drag tears the tab (no window MOVESIZE) instead of moving the
  # window. Tabs live on the left, min/max buttons (HT 8/9, rejected) at the
  # far right, so the empty caption strip right-of-tabs is probed FIRST, left
  # tab-zone points only as fallback. Every candidate must hit-test HTCAPTION
  # via bounded WM_NCHITTEST (SendMessageTimeoutW, 100ms, fail-closed) on the
  # bound HWND. The WindowFromPoint hit must belong to the bound window:
  # hosted frames (ApplicationFrameHost title-bar child) hit a child, so hits
  # root-resolve (GA_ROOT) to the bound HWND; anything else is cover. Bounded
  # to 12 probes; candidate table (HWND/coords/hit booleans only, no titles)
  # is recorded for diagnosis.
  [MouseDragNative]::EnsurePMv2()
  $WM_NCHITTEST = 0x0084u; $HTCAPTION = 2u; $SMTO_ABORTIFHUNG = 0x0002u
  $left = [int]$Outer[0]; $top = [int]$Outer[1]; $right = [int]$Outer[2]
  $cands = @()
  foreach ($dx in @(320, 260, 220, 200, 360, 420)) { $cands += ,@(($right - $dx), ($top + 10)) }
  foreach ($dx in @(50, 80, 110, 150, 200, 30)) { $cands += ,@(($left + $dx), ($top + 10)) }
  $diag = @()
  $probes = 0
  foreach ($c in $cands) {
    $sx = [int]$c[0]; $sy = [int]$c[1]
    if ($sx -lt $left -or $sx -ge $right) { continue }
    $probes++
    if ($probes -gt 12) { break }
    $pt = New-Object MouseDragNative+POINT; $pt.x = $sx; $pt.y = $sy
    $hit = [MouseDragNative]::WindowFromPoint($pt).ToInt64()
    $markChild = ""
    if ([uint64]$hit -ne [uint64]$Hwnd) {
      $GA_ROOT = 2u
      $root = [MouseDragNative]::GetAncestor([IntPtr]$hit, $GA_ROOT).ToInt64()
      if ([uint64]$root -ne [uint64]$Hwnd) { $diag += ("{0},{1}:cover" -f $sx, $sy); continue }
      $markChild = ":child"
    }
    $lp = ((($sy -band 0xFFFF) -shl 16) -bor ($sx -band 0xFFFF))
    $res = [UIntPtr]::Zero
    $sent = [MouseDragNative]::SendMessageTimeoutW([IntPtr]$Hwnd, $WM_NCHITTEST, [UIntPtr]::Zero, [IntPtr]$lp, $SMTO_ABORTIFHUNG, 100, [ref]$res)
    if ($sent -eq [IntPtr]::Zero) { $diag += ("{0},{1}:hittest-timeout" -f $sx, $sy); continue }
    $code = $res.ToUInt64()
    if ($code -eq $HTCAPTION) { Rec-Md "caption-probe" @{ hwnd = $Hwnd; point = ("{0},{1}" -f $sx, $sy); probes = ($diag -join " "); child = $markChild }; return @($sx, $sy) }
    $diag += ("{0},{1}:ht{2}" -f $sx, $sy, $code)
  }
  Rec-Md "caption-probe-miss" @{ hwnd = $Hwnd; probes = ($diag -join " ") }
  return $null
}

function Assert-MdButtonReleased([string]$Tag) {  # Real button-state gate: VK_LBUTTON (0x01) async high bit must clear.
  # Cursor-position reads cannot prove release, so GetAsyncKeyState is the
  # oracle with a 3s bounded wait, hard fail when still held.
  [MouseDragNative]::EnsurePMv2()
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline) {
    $st = [MouseDragNative]::GetAsyncKeyState(1)
    if (([int]$st -band 0x8000) -eq 0) { return }
    Start-Sleep -Milliseconds 50
  }
  Fail-Md "$Tag left button still down after mouseup"
}

function Get-MdRootHwnd([long]$Hwnd) {
  $GA_ROOT = 2u
  return [MouseDragNative]::GetAncestor([IntPtr]$Hwnd, $GA_ROOT).ToInt64()
}

function Set-MdForeground([long]$Hwnd, [string]$Tag) {
  [void][MouseDragNative]::PrimeE8()
  $selfTid = [MouseDragNative]::GetCurrentThreadId()
  $fg = [MouseDragNative]::GetForegroundWindow()
  $fgTid = 0
  try {
    $pidOut = 0u
    $fgTid = [MouseDragNative]::GetWindowThreadProcessId($fg, [ref]$pidOut)
    if ($fgTid -ne 0) { [void][MouseDragNative]::AttachThreadInput($selfTid, $fgTid, $true) }
    [void][MouseDragNative]::SetForegroundWindow([IntPtr]$Hwnd)
  } finally {
    if ($fgTid -ne 0) { [void][MouseDragNative]::AttachThreadInput($selfTid, $fgTid, $false) }
  }
  # Bounded retry: a transient popup (Start menu from a prior injected
  # Win-up, tooltip) can win the first race; re-assert up to 3 times.
  for ($att = 1; $att -le 3; $att++) {
    $got = [MouseDragNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$got -eq [uint64]$Hwnd) { return }
    Start-Sleep -Milliseconds 500
    [void][MouseDragNative]::PrimeE8()
    [void][MouseDragNative]::SetForegroundWindow([IntPtr]$Hwnd)
  }
  $got = [MouseDragNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$got -ne [uint64]$Hwnd) {
    $cls = ""
    try { $cls = [MouseDragNative]::ClassOf($got) } catch {}
    Fail-Md "$Tag foreground readback $got (class $cls) != $Hwnd"
  }
}

function Send-MdDismissStart([string]$Tag) {
  # Dismiss a Start menu opened by an injected Win release (product never
  # masks injected Win): one injected Esc pair. Injected keys never enter
  # classifier tracking and never set the product cancel edge; the native
  # menu still dismisses. Call only outside gestures, never mid-drag.
  [void][MouseDragNative]::SendKey($MD_VK_ESC, $false)
  Start-Sleep -Milliseconds 150
  [void][MouseDragNative]::SendKey($MD_VK_ESC, $true)
  Start-Sleep -Milliseconds 600
  Rec-Md "$Tag-start-dismissed" @{ injected_esc = "menu-dismiss-no-edge-claim" }
}

function Send-MdMouseMove([int]$X, [int]$Y) {
  $screen = Get-MdVirtualScreen
  $nx = ConvertTo-MdAbsolute $X ([int]$screen[0]) ([int]$screen[2])
  $ny = ConvertTo-MdAbsolute $Y ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "absolute mouse move rejected" }
}

function Send-MdMouseDrag([int]$FromX, [int]$FromY, [int]$ToX, [int]$ToY, [int]$Steps) {
  $screen = Get-MdVirtualScreen
  $fx = ConvertTo-MdAbsolute $FromX ([int]$screen[0]) ([int]$screen[2])
  $fy = ConvertTo-MdAbsolute $FromY ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $fx, $fy) -ne 1) { Fail-Md "drag pre-move rejected" }
  Start-Sleep -Milliseconds 250
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "drag button-down rejected" }
  Start-Sleep -Milliseconds 400
  for ($i = 1; $i -le $Steps; $i++) {
    $x = $FromX + [int](($ToX - $FromX) * $i / $Steps)
    $y = $FromY + [int](($ToY - $FromY) * $i / $Steps)
    $nx = ConvertTo-MdAbsolute $x ([int]$screen[0]) ([int]$screen[2])
    $ny = ConvertTo-MdAbsolute $y ([int]$screen[1]) ([int]$screen[3])
    if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "drag step $i rejected" }
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 400
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "drag button-up rejected" }
  Start-Sleep -Milliseconds 600
}

function Send-MdVerifiedDrag([int]$FromX, [int]$FromY, [int]$ToX, [int]$ToY, [int]$Steps, [long]$Hwnd, [string]$Tag, [string]$OwnerCopy, [array]$Siblings = @(), [string]$LogPath = "", [int]$Mark = 0, [string]$MoverToken = "") {
  # Closed-loop drag: after down plus a short nudge, the bound window's outer
  # rect must actually move (a tab down+drag tears instead of moving) and no
  # new approved top-level HWND may appear (tab tear-out). Either failure
  # releases the button and fails loudly with the evidence, so a fixture
  # point miss can never masquerade as a product gesture failure.
  $screen = Get-MdVirtualScreen
  $fx = ConvertTo-MdAbsolute $FromX ([int]$screen[0]) ([int]$screen[2])
  $fy = ConvertTo-MdAbsolute $FromY ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $fx, $fy) -ne 1) { Fail-Md "$Tag drag pre-move rejected" }
  Start-Sleep -Milliseconds 250
  $inv0 = Invoke-MdNative $OwnerCopy @("inventory") | ConvertFrom-Json
  $n0 = @($inv0.windows | Where-Object { @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -contains "$($_.exe)".ToLowerInvariant() }).Count
  $rect0 = Get-MdOuter $Hwnd
  $siblingFrames = @()
  foreach ($sibling in $Siblings) {
    $siblingFrames += [pscustomobject]@{ hwnd = [long]$sibling.hwnd; frame = ((Get-MdFrame ([long]$sibling.hwnd)) -join ',') }
  }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "$Tag drag button-down rejected" }
  Start-Sleep -Milliseconds 400
  $nudge = [math]::Min(3, $Steps)
  for ($i = 1; $i -le $nudge; $i++) {
    $x = $FromX + [int](($ToX - $FromX) * $i / $Steps)
    $y = $FromY + [int](($ToY - $FromY) * $i / $Steps)
    $nx = ConvertTo-MdAbsolute $x ([int]$screen[0]) ([int]$screen[2])
    $ny = ConvertTo-MdAbsolute $y ([int]$screen[1]) ([int]$screen[3])
    if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "$Tag drag step $i rejected" }
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 500
  $rect1 = Get-MdOuter $Hwnd
  $inv1 = Invoke-MdNative $OwnerCopy @("inventory") | ConvertFrom-Json
  $n1 = @($inv1.windows | Where-Object { @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -contains "$($_.exe)".ToLowerInvariant() }).Count
  if ($n1 -gt $n0) {
    [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
    Assert-MdButtonReleased "$Tag-tear"
    Fail-Md "$Tag tab tear suspected (approved HWNDs $n0 -> $n1)"
  }
  if ("$($rect0 -join ',')" -ceq "$($rect1 -join ',')") {
    [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
    Assert-MdButtonReleased "$Tag-nostart"
    Fail-Md "$Tag drag-start unverified (rect $($rect0 -join ',' ) unmoved after nudge)"
  }
  Rec-Md "$Tag-drag-start" @{ rect = ($rect1 -join ",") }
  foreach ($snapshot in $siblingFrames) {
    if ($snapshot.frame -cne ((Get-MdFrame $snapshot.hwnd) -join ',')) {
      [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
      Fail-Md "$Tag sibling moved before drop hwnd=$($snapshot.hwnd)"
    }
  }
  for ($i = ($nudge + 1); $i -le $Steps; $i++) {
    $x = $FromX + [int](($ToX - $FromX) * $i / $Steps)
    $y = $FromY + [int](($ToY - $FromY) * $i / $Steps)
    $nx = ConvertTo-MdAbsolute $x ([int]$screen[0]) ([int]$screen[2])
    $ny = ConvertTo-MdAbsolute $y ([int]$screen[1]) ([int]$screen[3])
    if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "$Tag drag step $i rejected" }
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 400
  foreach ($snapshot in $siblingFrames) {
    if ($snapshot.frame -cne ((Get-MdFrame $snapshot.hwnd) -join ',')) {
      [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
      Fail-Md "$Tag sibling moved before release hwnd=$($snapshot.hwnd)"
    }
  }
  if ($MoverToken -ne "" -and $LogPath -ne "") {
    # Native caption mid-hold: the separate preview carrier shows the
    # Engine-resolved target slot above windows while the frame follows.
    $releaseHold = { [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) }
    $null = Test-MdPreviewMidHold $OwnerCopy $LogPath $Mark $MoverToken $Hwnd $Tag $releaseHold
  }
  if ($siblingFrames.Count -gt 0) { Rec-Md "$Tag-siblings-held" @{ count = $siblingFrames.Count; samples = 2; stable = $true } }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "$Tag drag button-up rejected" }
  Start-Sleep -Milliseconds 600
}

function Assert-MdWinReleased([string]$Tag) {  # Real Win-state gate: both Win async high bits must clear.
  [MouseDragNative]::EnsurePMv2()
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline) {
    $l = [MouseDragNative]::GetAsyncKeyState($MD_VK_LWIN)
    $r = [MouseDragNative]::GetAsyncKeyState($MD_VK_RWIN)
    if ((([int]$l -band 0x8000) -eq 0) -and (([int]$r -band 0x8000) -eq 0)) { return }
    Start-Sleep -Milliseconds 50
  }
  Fail-Md "$Tag Win key still down after winup"
}

function Send-MdWinDown([string]$Tag) {
  # Synthetic Win hold for the project gesture (unmarked SendInput, same as
  # the native caption proof path; no physical-mask claim). The product
  # keyboard hook filters injected keys, so this never arms classifier or
  # mask state; the mouse hook samples the async level instead.
  if ([MouseDragNative]::SendKey($MD_VK_LWIN, $false) -ne 1) { Fail-Md "$Tag win-down rejected" }
  Start-Sleep -Milliseconds 350
  [MouseDragNative]::EnsurePMv2()
  if (([int][MouseDragNative]::GetAsyncKeyState($MD_VK_LWIN) -band 0x8000) -eq 0) { Fail-Md "$Tag win hold not visible in async state" }
}

function Send-MdWinUp([string]$Tag) {
  # Synthetic Win release: the product mask never fires for injected Win
  # (keyboard hook filters it), so a transient Start menu may appear; the
  # caller records/dismisses it via Test-MdStartQuiet. Never claims a mask.
  if ([MouseDragNative]::SendKey($MD_VK_LWIN, $true) -ne 1) { Fail-Md "$Tag win-up rejected" }
  Start-Sleep -Milliseconds 500
  Assert-MdWinReleased $Tag
}

function Wait-MdWindragOrigins([string]$LogPath, [int]$Mark, [int]$Want, [int]$TimeoutSec, [string]$Tag) {
  # The mouse hook binds only against published tiled origins: wait until
  # the owner reports exactly the managed count, so a drag never starts
  # against a stale/empty feed. The feed line is run-scoped (change-only),
  # so it is scanned from the run start, not the stage mark. Evidence, not
  # a substitute for per-edge owner validation.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $got = Get-MdEvents $LogPath $Mark
    foreach ($e in $got.events) {
      if ("$($e.event)" -eq "windrag-origins" -and [int]$e.count -eq $Want) {
        Rec-Md "$Tag-windrag-feed" @{ count = $Want }
        return
      }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Md "$Tag windrag-origins feed never reached $Want"
}

function Get-MdClientPoint([long]$Hwnd, [string]$Tag) {
  # Client-interior start for Win+Left (the gesture binds anywhere on the
  # window, not just the caption): frame centre. The WindowFromPoint hit
  # must root-resolve (GA_ROOT) to the bound HWND; anything else is cover.
  $frame = Get-MdFrame $Hwnd
  $cx = [int]$frame[0] + [int]([int]$frame[2] / 2)
  $cy = [int]$frame[1] + [int]([int]$frame[3] / 2)
  [MouseDragNative]::EnsurePMv2()
  $pt = New-Object MouseDragNative+POINT
  $pt.x = $cx; $pt.y = $cy
  $hit = [MouseDragNative]::WindowFromPoint($pt).ToInt64()
  $root = $hit
  try { $root = (Get-MdRootHwnd $hit) } catch {}
  if ([uint64]$root -ne [uint64]$Hwnd) { Fail-Md "$Tag client point ($cx,$cy) covered (hit root $root != $Hwnd)" }
  return @($cx, $cy)
}

function Send-MdWinDrag([int]$FromX, [int]$FromY, [int]$ToX, [int]$ToY, [int]$Steps, [long]$Hwnd, [string]$Tag, [string]$OwnerCopy, [array]$Siblings = @(), [string]$LogPath = "", [int]$Mark = 0, [string]$MoverToken = "", [long]$ExpectFg = 0, [bool]$CheckUnderlay = $true, [string]$ShotDir = "", [string]$ShotTag = "") {
  # Project-gesture drag: Win held, left down on the client point, pointer
  # journey, left up, Win up. Opposite of the native verified drag: the
  # mover AND every sibling must stay at source mid-hold (two samples prove
  # the stationary hold before release). Any mid-hold motion releases both
  # buttons/keys and fails loudly.
  $releaseAll = {
    [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
    [void][MouseDragNative]::SendKey($MD_VK_LWIN, $true)
  }
  $screen = Get-MdVirtualScreen
  $fx = ConvertTo-MdAbsolute $FromX ([int]$screen[0]) ([int]$screen[2])
  $fy = ConvertTo-MdAbsolute $FromY ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $fx, $fy) -ne 1) { Fail-Md "$Tag windrag pre-move rejected" }
  Start-Sleep -Milliseconds 250
  $inv0 = Invoke-MdNative $OwnerCopy @("inventory") | ConvertFrom-Json
  $n0 = @($inv0.windows | Where-Object { @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -contains "$($_.exe)".ToLowerInvariant() }).Count
  $mover0 = ((Get-MdFrame $Hwnd) -join ",")
  $frozen = @()
  foreach ($sibling in $Siblings) {
    $frozen += [pscustomobject]@{ hwnd = [long]$sibling.hwnd; frame = ((Get-MdFrame ([long]$sibling.hwnd)) -join ',') }
  }
  Send-MdWinDown "$Tag-winhold"
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { & $releaseAll; Fail-Md "$Tag windrag button-down rejected" }
  Start-Sleep -Milliseconds 500
  for ($i = 1; $i -le $Steps; $i++) {
    $x = $FromX + [int](($ToX - $FromX) * $i / $Steps)
    $y = $FromY + [int](($ToY - $FromY) * $i / $Steps)
    $nx = ConvertTo-MdAbsolute $x ([int]$screen[0]) ([int]$screen[2])
    $ny = ConvertTo-MdAbsolute $y ([int]$screen[1]) ([int]$screen[3])
    if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { & $releaseAll; Fail-Md "$Tag windrag step $i rejected" }
    Start-Sleep -Milliseconds 60
    if ($i -eq [int]($Steps / 2) -or $i -eq $Steps) {
      Start-Sleep -Milliseconds 350
      if ($mover0 -cne ((Get-MdFrame $Hwnd) -join ',')) { & $releaseAll; Fail-Md "$Tag mover moved mid-hold (project gesture must hold source)" }
      foreach ($snapshot in $frozen) {
        if ($snapshot.frame -cne ((Get-MdFrame $snapshot.hwnd) -join ',')) { & $releaseAll; Fail-Md "$Tag sibling moved mid-hold hwnd=$($snapshot.hwnd)" }
      }
      if ($i -eq $Steps -and $MoverToken -ne "" -and $LogPath -ne "") {
        if ($CheckUnderlay) {
        # A/B move-arm readback: a focused Win+Left hold feeds the projected
        # group underlay while held (stationary frames, real union). The
        # underlay carrier must be present+visible and the owner log must
        # carry a shown/moved verdict for the mover token with 2+ members.
        # Unfocused holds never query this (stage C parked).
        try {
          $insp = Invoke-MdNative $OwnerCopy @("underlay-inspect") | ConvertFrom-Json
        } catch { & $releaseAll; Fail-Md "$Tag underlay-inspect failed: $($_.Exception.Message)" }
        if (-not $insp.present) { & $releaseAll; Fail-Md "$Tag underlay carrier absent mid-hold" }
        $vis = @($insp.overlays | Where-Object { $_.visible -eq $true })
        if ($vis.Count -eq 0) { & $releaseAll; Fail-Md "$Tag underlay overlay not visible mid-hold" }
        $fgMid = [MouseDragNative]::GetForegroundWindow().ToInt64()
        if ([uint64]$fgMid -ne [uint64]$Hwnd) { & $releaseAll; Fail-Md "$Tag foreground moved mid-hold (got $fgMid, want $Hwnd)" }
        $found = $null
        $lines = Get-MdLines $LogPath
        for ($li = $Mark; $li -lt $lines.Count; $li++) {
          if ("$($lines[$li])".Trim() -eq "") { continue }
          $ev = ($lines[$li] | ConvertFrom-Json)
          if ("$($ev.event)" -eq "group-underlay" -and "$($ev.target)" -ceq $MoverToken -and "$($ev.outcome)" -in @("shown", "moved", "redrew")) {
            if ([int]$ev.members -ge 2) { $found = $ev }
          }
        }
        if ($null -eq $found) { & $releaseAll; Fail-Md "$Tag no group-underlay union verdict for $MoverToken mid-hold" }
        Rec-Md "$Tag-underlay" @{ target = $MoverToken; members = [int]$found.members; outer = ($found.outer -join ","); foreground = "held-no-activation" }
        }
        $null = Test-MdPreviewMidHold $OwnerCopy $LogPath $Mark $MoverToken ([long]$Hwnd) $Tag $releaseAll ([long]$ExpectFg) $ShotDir $ShotTag
      }
    }
  }
  Start-Sleep -Milliseconds 400
  $inv1 = Invoke-MdNative $OwnerCopy @("inventory") | ConvertFrom-Json
  $n1 = @($inv1.windows | Where-Object { @("notepad.exe", "mspaint.exe", "applicationframehost.exe") -contains "$($_.exe)".ToLowerInvariant() }).Count
  if ($n1 -gt $n0) { & $releaseAll; Assert-MdButtonReleased "$Tag-tear"; Fail-Md "$Tag new approved HWND mid-hold ($n0 -> $n1)" }
  Rec-Md "$Tag-hold-frozen" @{ mover = $true; siblings = $frozen.Count; samples = 2; stationary = $true }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { & $releaseAll; Fail-Md "$Tag windrag button-up rejected" }
  Start-Sleep -Milliseconds 600
  Assert-MdButtonReleased "$Tag-release"
  Send-MdWinUp "$Tag-winrelease"
  Start-Sleep -Milliseconds 600
}

function Test-MdStartQuiet([string]$LogPath, [int]$Mark, [string]$Tag) {
  # A synthetic Win release never sends the product E8 mask, so the OS may
  # transiently open Start: dismiss it (outside any gesture) and record it
  # honestly. Fails only when the log claims a physical product mask for the
  # synthetic hold.
  $fg = [MouseDragNative]::GetForegroundWindow().ToInt64()
  $cls = ""
  try { $cls = [MouseDragNative]::ClassOf($fg) } catch {}
  $dismissed = $false
  if ($cls -like "*Start*" -or $cls -eq "Windows.UI.Core.CoreWindow") {
    Send-MdDismissStart "$Tag"
    $dismissed = $true
  }
  $tail = Get-MdEvents $LogPath $Mark
  foreach ($e in $tail.events) {
    if ("$($e.event)" -eq "snap" -and "$($e.trigger_op)" -eq "windrag" -and "$($e.result)" -eq "mask-ok") {
      Fail-Md "$Tag product mask claimed for synthetic Win hold"
    }
  }
  Rec-Md "$Tag-start" @{ dismissed = $dismissed; foreground_class = $cls; mask_claim = "none" }
}

function Save-MdShot([string]$Dir, [string]$Tag) {
  $screen = Get-MdVirtualScreen
  $path = Join-Path $Dir "shot-$Tag.png"
  [MouseDragNative]::CaptureScreen($path, [int]$screen[0], [int]$screen[1], [int]$screen[2], [int]$screen[3])
  return $path
}

function Read-MdSpi {
  $arr = 0; $pen = 0
  if (-not [MouseDragNative]::SystemParametersInfo(0x0082, 0, [ref]$arr, 0)) { Fail-Md "SPI_GETWINARRANGING failed" }
  if (-not [MouseDragNative]::SystemParametersInfo(0x201E, 0, [ref]$pen, 0)) { Fail-Md "SPI pen visualization failed" }
  return @{ arranging_raw = $arr; pen_raw = $pen }
}

function Get-MdOriginalSnapshot {
  $out = @()
  foreach ($name in @("notepad", "Calculator", "ApplicationFrameHost", "mspaint")) {
    $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
      $hex = ""
      try { $hex = "{0:x16}" -f $p.StartTime.ToUniversalTime().ToFileTimeUtc() } catch { $hex = "unknown" }
      $out += @{ name = $name; pid = $p.Id; start = $hex }
    }
  }
  return ,$out
}

function Assert-MdOriginalIntact($Before, [string]$Tag) {
  foreach ($b in @($Before)) {
    $live = Get-Process -Id $b.pid -ErrorAction SilentlyContinue
    if ($null -eq $live) { Fail-Md "$Tag original $($b.name) pid=$($b.pid) gone" }
    $hex = ""
    try { $hex = "{0:x16}" -f $live.StartTime.ToUniversalTime().ToFileTimeUtc() } catch { Fail-Md "$Tag original $($b.name) unreadable" }
    if ($hex -cne "$($b.start)") { Fail-Md "$Tag original $($b.name) restarted" }
  }
}

function Test-MdNoActors([string]$OwnerCopy, [string]$Tag) {
  $hits = @(Get-Process -Name "tiler-windows", "tiler-test-window" -ErrorAction SilentlyContinue | Where-Object {
    $p = ""
    try { $p = $_.Path } catch { $p = "" }
    ($p -ieq $OwnerCopy)
  })
  if ($hits.Count -ne 0) { Fail-Md "$Tag project actors remain" }
}

function Get-MdOverlayHwnds([int]$OwnerPid) {
  # Exact-owner overlay enumeration: top-level windows owned by the owner PID
  # whose class is a project surface. Border/underlay/preview carriers;
  # ledger audits stay separate via Assert-LedgerClean.
  [MouseDragNative]::EnsurePMv2()
  $found = [System.Collections.ArrayList]@()
  $script:mdOwnerPid = $OwnerPid
  $script:mdFound = $found
  $cb = {
    param([IntPtr]$h, [IntPtr]$l)
    try {
      $pidOut = [uint32]0
      $null = [MouseDragNative]::GetWindowThreadProcessId($h, [ref]$pidOut)
      if ([uint32]$pidOut -eq [uint32]$script:mdOwnerPid) {
        $cls = [MouseDragNative]::ClassOf($h.ToInt64())
        if ($cls -eq "OmniTilerActiveBorder" -or $cls -eq "OmniTilerGroupUnderlay" -or $cls -eq "OmniTilerDropPreview") {
          $null = $script:mdFound.Add($h.ToInt64())
        }
      }
    } catch {}
    return $true
  }
  $null = [MouseDragNative]::EnumWindows($cb, [IntPtr]::Zero)
  return ,$found
}

function Assert-MdNoOverlays([int]$OwnerPid, [string]$OwnerCopy, [string]$Tag) {
  $hwnds = @(Get-MdOverlayHwnds $OwnerPid) | Where-Object { $_ -ne 0 }
  if (@($hwnds).Count -ne 0) { Fail-Md "$Tag overlay HWNDs remain count=$(@($hwnds).Count)" }
  foreach ($cli in @("border-inspect", "underlay-inspect", "preview-inspect")) {
    try {
      $insp = Invoke-MdNative $OwnerCopy @($cli) | ConvertFrom-Json
      if ($null -ne $insp.present -and $insp.present -eq $true) { Fail-Md "$Tag $cli present after stop" }
      if ($null -ne $insp.visible_count -and [int]$insp.visible_count -ne 0) { Fail-Md "$Tag $cli visible after stop" }
    } catch {
      # inspect CLI failing post-stop is not residue; HWND audit above governs.
      Rec-Md "$Tag-$cli-unavailable" @{ cli = $cli }
    }
  }
}

function Get-MdPreviewShownEvent([string]$LogPath, [int]$Mark, [string]$MoverToken, [int]$MaxTick = [int]::MaxValue, [string]$PriorLike = "") {
  # Last Engine-resolved preview event for the mover since the stage mark
  # (shown/redrew/moved only; hidden carries no rect), optionally bounded
  # above by a drop tick so post-finish rows never leak in, and optionally
  # filtered by hover-prior descriptor (e.g. "group-edge:*" for sticky
  # journeys). $null when no sample resolved.
  $found = $null
  $lines = Get-MdLines $LogPath
  for ($li = $Mark; $li -lt $lines.Count; $li++) {
    if ("$($lines[$li])".Trim() -eq "") { continue }
    $ev = ($lines[$li] | ConvertFrom-Json)
    if ("$($ev.event)" -eq "drag-preview" -and "$($ev.window)" -ceq $MoverToken -and "$($ev.outcome)" -in @("shown", "redrew", "moved") -and [int]$ev.tick -le $MaxTick -and ($PriorLike -eq "" -or "$($ev.hover_prior)" -like $PriorLike)) {
      $found = $ev
    }
  }
  return $found
}

function Get-MdPreviewLogRect([string]$LogPath, [int]$Mark, [string]$MoverToken) {
  $ev = Get-MdPreviewShownEvent $LogPath $Mark $MoverToken
  if ($null -eq $ev) { return $null }
  return @([int]$ev.rect[0], [int]$ev.rect[1], [int]$ev.rect[2], [int]$ev.rect[3])
}

function Assert-MdPreviewAgreement([string]$LogPath, [int]$Mark, [string]$MoverToken, [int]$DropTick, [string]$DropPrior, [array]$PostFrame, [string]$Tag) {
  # Preview/drop agreement bound by correlation source: the last resolved
  # preview for this exact mover at or before the drop tick must equal the
  # mover's post-drop frame, and its carried hover-prior descriptor must
  # equal the drop's. No script-global rect variable: log correlation (tick
  # order + mover token) is the binding.
  $ev = Get-MdPreviewShownEvent $LogPath $Mark $MoverToken $DropTick
  if ($null -eq $ev) { Fail-Md "$Tag no resolved preview for $MoverToken at/before tick $DropTick" }
  $rect = @([int]$ev.rect[0], [int]$ev.rect[1], [int]$ev.rect[2], [int]$ev.rect[3])
  if ("$($PostFrame -join ',')" -cne ($rect -join ",")) { Fail-Md "$Tag mover frame $($PostFrame -join ',') != preview $($rect -join ',') (tick $($ev.tick))" }
  if ("$($ev.hover_prior)" -cne $DropPrior) { Fail-Md "$Tag preview prior $($ev.hover_prior) != drop prior $DropPrior (tick $($ev.tick))" }
  Rec-Md "$Tag-preview-agreement" @{ preview = ($rect -join ","); mover = ($PostFrame -join ","); prior = $DropPrior; preview_tick = [int]$ev.tick; drop_tick = $DropTick }
}

function Test-MdPreviewMidHold([string]$OwnerCopy, [string]$LogPath, [int]$Mark, [string]$MoverToken, [long]$Hwnd, [string]$Tag, $ReleaseAll = $null, [long]$ExpectFg = 0, [string]$ShotDir = "", [string]$ShotTag = "") {
  # Mid-hold drop-preview proof: the separate carrier is present+visible,
  # click-through nonactivating toolwindow ABOVE the foreground, its rect
  # equals the Engine-resolved target slot, and the foreground never moves
  # (the preview neither focuses nor activates). ExpectFg overrides the
  # foreground expectation for unfocused holds (actual pre-hold foreground).
  # Returns @{ Rect; Prior } from the Engine log event (exact source binding
  # for later agreement checks).
  $fail = {
    param([string]$Msg)
    if ($null -ne $ReleaseAll) { & $ReleaseAll }
    Fail-Md "$Tag $Msg"
  }
  try {
    $insp = Invoke-MdNative $OwnerCopy @("preview-inspect") | ConvertFrom-Json
  } catch { & $fail "preview-inspect failed: $($_.Exception.Message)"; return $null }
  if (-not $insp.present) { & $fail "preview carrier absent mid-hold"; return $null }
  $vis = @($insp.overlays | Where-Object { $_.visible -eq $true })
  if ($vis.Count -eq 0) { & $fail "preview overlay not visible mid-hold"; return $null }
  $ov = $vis[0]
  $ex = [Convert]::ToUInt32("$($ov.exstyle)", 16)
  foreach ($bit in @(0x80000, 0x20, 0x80, 0x8000000)) {
    if (($ex -band [uint32]$bit) -eq 0) { & $fail ("preview flags missing bit 0x{0:x} (exstyle $($ov.exstyle))" -f $bit); return $null }
  }
  if (($ex -band [uint32]0x8) -eq 0) { & $fail "preview not topmost (exstyle $($ov.exstyle))"; return $null }
  if (-not $ov.above_foreground) { & $fail "preview not above foreground (z-order)"; return $null }
  $rect = @([int]$ov.rect[0], [int]$ov.rect[1], [int]$ov.rect[2], [int]$ov.rect[3])
  if ($rect[2] -le 0 -or $rect[3] -le 0) { & $fail "preview degenerate rect $($rect -join ',')"; return $null }
  $ev = Get-MdPreviewShownEvent $LogPath $Mark $MoverToken
  if ($null -eq $ev) { & $fail "no drag-preview resolved rect for $MoverToken mid-hold"; return $null }
  $logRect = @([int]$ev.rect[0], [int]$ev.rect[1], [int]$ev.rect[2], [int]$ev.rect[3])
  if (($rect -join ",") -cne ($logRect -join ",")) { & $fail "preview rect $($rect -join ',') != Engine $($logRect -join ',')"; return $null }
  $wantFg = $Hwnd
  if ([long]$ExpectFg -ne 0) { $wantFg = $ExpectFg }
  $fgMid = [MouseDragNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgMid -ne [uint64]$wantFg) { & $fail "foreground moved mid-hold (got $fgMid, want $wantFg)"; return $null }
  $shotPath = ""
  if ($ShotDir -ne "" -and $ShotTag -ne "") { $shotPath = Save-MdShot $ShotDir $ShotTag }
  Rec-Md "$Tag-preview" @{ rect = ($rect -join ","); flags = "$($ov.exstyle)"; prior = "$($ev.hover_prior)"; foreground = "stable-no-activation" }
  return @{ Rect = $rect; Prior = "$($ev.hover_prior)"; Tick = [int]$ev.tick; Shot = $shotPath }
}

function Test-MdPreviewBlend([string]$BaselinePng, [string]$MidPng, [array]$Rect, [string]$Tag) {
  # Optional composed-pixel proof: the preview fill (#2A82DA at alpha 64,
  # premultiplied BGRA 37,21,0B,40) blends over the frozen baseline frame.
  # Stationary holds only (the baseline layout must be pixel-identical
  # outside the preview rect). Returns $true on match, $false on mismatch,
  # $null when pixel reads are unavailable (raster proof only, appearance
  # stays user-owned). Never throws.
  try {
    $base = [System.Drawing.Bitmap]::FromFile($BaselinePng)
    $mid = [System.Drawing.Bitmap]::FromFile($MidPng)
    $cx = [int]$Rect[0] + [int]([int]$Rect[2] / 2)
    $cy = [int]$Rect[1] + [int]([int]$Rect[3] / 2)
    if ($cx -lt 0 -or $cy -lt 0 -or $cx -ge $base.Width -or $cy -ge $base.Height -or $cx -ge $mid.Width -or $cy -ge $mid.Height) {
      $base.Dispose(); $mid.Dispose()
      Rec-Md "$Tag-preview-blend" @{ skipped = "coords-outside-shot" }
      return $null
    }
    $b = $base.GetPixel($cx, $cy)
    $m = $mid.GetPixel($cx, $cy)
    $base.Dispose(); $mid.Dispose()
    # Layered composition: out = src_premult + dst * (255 - 64) / 255.
    $chan = @(
      @{ got = [int]$m.B; want = 0x37 + [int]$b.B * 191 / 255 },
      @{ got = [int]$m.G; want = 0x21 + [int]$b.G * 191 / 255 },
      @{ got = [int]$m.R; want = 0x0B + [int]$b.R * 191 / 255 }
    )
    $worst = 0
    foreach ($c in $chan) {
      $d = [math]::Abs([double]$c.got - [double]$c.want)
      if ($d -gt $worst) { $worst = $d }
    }
    if ($worst -le 5) {
      Rec-Md "$Tag-preview-blend" @{ match = $true; worst = [math]::Round($worst, 2); alpha = 64 }
      return $true
    }
    Rec-Md "$Tag-preview-blend" @{ match = $false; worst = [math]::Round($worst, 2); base = "$($b.R),$($b.G),$($b.B)"; mid = "$($m.R),$($m.G),$($m.B)" }
    return $false
  } catch {
    Rec-Md "$Tag-preview-blend" @{ skipped = "$($_.Exception.Message)" }
    return $null
  }
}

function Assert-MdPreviewHidden([string]$OwnerCopy, [string]$LogPath, [int]$Mark, [string]$MoverToken, [string]$Tag) {
  # Refusal/cancel/zero proof: no visible preview carrier and no resolved
  # preview sample since the mark (self/centre/outside show no rectangle;
  # zero/Esc hide before release). An empty mover token matches any window.
  try {
    $insp = Invoke-MdNative $OwnerCopy @("preview-inspect") | ConvertFrom-Json
  } catch { Fail-Md "$Tag preview-inspect failed: $($_.Exception.Message)" }
  $vis = @($insp.overlays | Where-Object { $_.visible -eq $true })
  if ($vis.Count -ne 0) { Fail-Md "$Tag preview overlay visible (must be hidden)" }
  $logRect = Get-MdPreviewLogRect $LogPath $Mark $MoverToken
  if ($MoverToken -eq "") {
    $lines = Get-MdLines $LogPath
    for ($li = $Mark; $li -lt $lines.Count; $li++) {
      if ("$($lines[$li])".Trim() -eq "") { continue }
      $ev = ($lines[$li] | ConvertFrom-Json)
      if ("$($ev.event)" -eq "drag-preview" -and "$($ev.outcome)" -in @("shown", "redrew", "moved")) {
        Fail-Md "$Tag preview resolved for $($ev.window) (must stay hidden)"
      }
    }
  } elseif ($null -ne $logRect) { Fail-Md "$Tag preview resolved $($logRect -join ',') (must stay hidden)" }
  Rec-Md "$Tag-preview-hidden" @{ mover = $MoverToken }
}

function Assert-MdPreviewSettledNow([string]$OwnerCopy, [string]$Tag) {
  # Refusal/cancel settle proof: the carrier shows no rectangle NOW (the
  # settle hides it with the gesture). Mid-transit samples may have resolved
  # en route, so no since-mark sample ban applies here; refusal-with-restore
  # is asserted by the stage itself.
  try {
    $insp = Invoke-MdNative $OwnerCopy @("preview-inspect") | ConvertFrom-Json
  } catch { Fail-Md "$Tag preview-inspect failed: $($_.Exception.Message)" }
  $vis = @($insp.overlays | Where-Object { $_.visible -eq $true })
  if ($vis.Count -ne 0) { Fail-Md "$Tag preview overlay visible after settle (must be hidden)" }
  Rec-Md "$Tag-preview-settled" @{ hidden = $true }
}

function Wait-MdPreviewHidden([string]$OwnerCopy, [string]$Tag) {  # Finish-clear proof: the visible preview carrier must be gone promptly
  # after the drop settles (no late/stale render after Finish).
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $insp = Invoke-MdNative $OwnerCopy @("preview-inspect") | ConvertFrom-Json
    } catch { Fail-Md "$Tag preview-inspect failed: $($_.Exception.Message)" }
    $vis = @($insp.overlays | Where-Object { $_.visible -eq $true })
    if ($vis.Count -eq 0) { Rec-Md "$Tag-preview-cleared" @{ prompt = $true }; return }
    Start-Sleep -Milliseconds 100
  }
  Fail-Md "$Tag preview overlay still visible after finish"
}

function Get-MdEligibleApps([string]$OwnerBin, [string]$Tag) {
  # Borrowed-resource eligibility from the product inventory (no titles): only
  # approved ordinary apps, visible, restored (not iconic/zoomed), top-level
  # approved host with a live CalculatorApp child for ApplicationFrameHost.
  # Terminal/shell/dialog/overlay classes never eligible. Returns rows with
  # hwnd/exe/pid; HWND binding stays exact, never by name.
  $inv = Invoke-MdNative $OwnerBin @("inventory") | ConvertFrom-Json
  $eligible = [System.Collections.ArrayList]@()
  foreach ($w in @($inv.windows)) {
    $hwnd = [uint64]$w.hwnd
    $exe = "$($w.exe)"
    $base = $exe.ToLowerInvariant()
    if (@("notepad.exe", "mspaint.exe", "applicationframehost.exe") -notcontains $base) { continue }
    if ($base -eq "applicationframehost.exe") {
      $ch = Invoke-MdNative $OwnerBin @("children", "--hwnd", "$($w.hwnd)") | ConvertFrom-Json
      $names = @($ch.windows[0].children | ForEach-Object { "$($_.exe)".ToLowerInvariant() })
      if ($names -notcontains "calculatorapp.exe") { continue }
    }
    if (-not [MouseDragNative]::IsWindowVisible([IntPtr][long]$hwnd)) { continue }
    if ([MouseDragNative]::IsIconic([IntPtr][long]$hwnd)) { continue }
    if ([MouseDragNative]::IsZoomed([IntPtr][long]$hwnd)) { continue }
    $pidOut = [uint32]0
    $null = [MouseDragNative]::GetWindowThreadProcessId([IntPtr][long]$hwnd, [ref]$pidOut)
    if ([uint32]$pidOut -eq 0) { continue }
    $null = $eligible.Add(@{ hwnd = [uint64]$hwnd; exe = $exe; pid = [int]$pidOut })
  }
  return ,$eligible
}

function Get-MdAppSnapshot([long]$Hwnd, [string]$Tag) {
  # Exact-HWND baseline: PID/creation/exe plus geometry (outer+DWM frame) and
  # show state. No titles, no content. Borrowed windows restore to this.
  [MouseDragNative]::EnsurePMv2()
  $pidOut = [uint32]0
  $null = [MouseDragNative]::GetWindowThreadProcessId([IntPtr]$Hwnd, [ref]$pidOut)
  if ([uint32]$pidOut -eq 0) { Fail-Md "$Tag hwnd $Hwnd has no pid" }
  $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
  $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
  $outer = Get-MdOuter $Hwnd
  $frame = Get-MdFrame $Hwnd
  return @{
    hwnd = [uint64]$Hwnd; pid = [int]$pidOut; start = $hex; exe = "$($proc.Path)"
    outer = ($outer -join ","); frame = ($frame -join ",")
    visible = [bool][MouseDragNative]::IsWindowVisible([IntPtr]$Hwnd)
    iconic = [bool][MouseDragNative]::IsIconic([IntPtr]$Hwnd)
    zoomed = [bool][MouseDragNative]::IsZoomed([IntPtr]$Hwnd)
  }
}

function Restore-MdBorrowed($Snap, [string]$Tag) {
  # Best-effort borrowed restore: identity rechecked (PID+creation), then
  # show state (unminimize/unmaximize) and outer geometry via SetWindowPos
  # (NOACTIVATE, NOSIZE/ NOMOVE as needed). Exact HWND only, never by name.
  # Returns $true on restored-or-nothing-to-do, $false on geometry/show
  # mismatch or hard failure: the caller flags mismatches as cleanup
  # failures (never a silent pass). Vanished/recycled windows record only.
  try {
    $live = Get-Process -Id ([int]$Snap.pid) -ErrorAction Stop
    $hex = "{0:x16}" -f $live.StartTime.ToUniversalTime().ToFileTimeUtc()
    if ($hex -cne "$($Snap.start)") { Rec-Md "$Tag-recycled" @{ hwnd = $Snap.hwnd }; return $true }
  } catch { Rec-Md "$Tag-gone" @{ hwnd = $Snap.hwnd }; return $true }
  if (-not [MouseDragNative]::IsWindow([IntPtr][long]$Snap.hwnd)) { Rec-Md "$Tag-hwnd-gone" @{ hwnd = $Snap.hwnd }; return $true }
  try {
    if ([MouseDragNative]::IsIconic([IntPtr][long]$Snap.hwnd) -and -not $Snap.iconic) {
      $null = [MouseDragNative]::ShowWindow([IntPtr][long]$Snap.hwnd, 9)
      Start-Sleep -Milliseconds 400
    }
    if ([MouseDragNative]::IsZoomed([IntPtr][long]$Snap.hwnd) -and -not $Snap.zoomed) {
      $null = [MouseDragNative]::ShowWindow([IntPtr][long]$Snap.hwnd, 9)
      Start-Sleep -Milliseconds 400
    }
    $want = @($Snap.outer -split "," | ForEach-Object { [int]$_ })
    $cur = Get-MdOuter ([long]$Snap.hwnd)
    if ("$($cur -join ',')" -cne "$($want -join ',')") {
      $x = [int]$want[0]; $y = [int]$want[1]
      $cx = [int]$want[2] - [int]$want[0]; $cy = [int]$want[3] - [int]$want[1]
      if ($cx -gt 0 -and $cy -gt 0) {
        $SWP_NOACTIVATE = 0x0010u; $SWP_NOZORDER = 0x0004u
        $null = [MouseDragNative]::SetWindowPos([IntPtr][long]$Snap.hwnd, [IntPtr]::Zero, $x, $y, $cx, $cy, ($SWP_NOACTIVATE -bor $SWP_NOZORDER))
        Start-Sleep -Milliseconds 400
        # Readback: a silent SetWindowPos miss must never record "restored".
        # One retry, then a loud mismatch record (fixture hygiene failure,
        # never a pass).
        $back = Get-MdOuter ([long]$Snap.hwnd)
        if ("$($back -join ',')" -cne "$($want -join ',')") {
          $null = [MouseDragNative]::SetWindowPos([IntPtr][long]$Snap.hwnd, [IntPtr]::Zero, $x, $y, $cx, $cy, ($SWP_NOACTIVATE -bor $SWP_NOZORDER))
          Start-Sleep -Milliseconds 400
          $back = Get-MdOuter ([long]$Snap.hwnd)
        }
        if ("$($back -join ',')" -cne "$($want -join ',')") {
          Rec-Md "$Tag-restore-mismatch" @{ hwnd = $Snap.hwnd; want = ($want -join ","); got = ($back -join ",") }
          return $false
        }
      }
    }
    # Show-state readback: unminimize/unmaximize above must have taken effect.
    if (([MouseDragNative]::IsIconic([IntPtr][long]$Snap.hwnd) -and -not $Snap.iconic) -or ([MouseDragNative]::IsZoomed([IntPtr][long]$Snap.hwnd) -and -not $Snap.zoomed)) {
      Rec-Md "$Tag-restore-mismatch" @{ hwnd = $Snap.hwnd; show = "stuck" }
      return $false
    }
    Rec-Md "$Tag-restored" @{ hwnd = $Snap.hwnd }
    return $true
  } catch {
    Rec-Md "$Tag-restore-failed" @{ hwnd = $Snap.hwnd; error = "$($_.Exception.Message)" }
    return $false
  }
}

function Minimize-MdExtras([array]$Eligible, [uint64[]]$Chosen, [string]$Tag) {
  # Title-slice exact-3 fixture: minimize every other eligible approved HWND
  # (extra Notepad tabs, non-Calculator hosts) so the owner manages exactly
  # the chosen Notepad/Calculator/Paint triple. Snapshots stay in
  # $borrowedSnaps; Restore-MdBorrowed unminimizes and restores geometry in
  # the finally path. Returns the minimized HWND list.
  [MouseDragNative]::EnsurePMv2()
  $SW_MINIMIZE = 6
  $minimized = @()
  foreach ($w in @($Eligible)) {
    $hwnd = [uint64]$w.hwnd
    if ($Chosen -contains $hwnd) { continue }
    if (-not [MouseDragNative]::IsWindowVisible([IntPtr][long]$hwnd)) { continue }
    if ([MouseDragNative]::IsIconic([IntPtr][long]$hwnd)) { continue }
    $null = [MouseDragNative]::ShowWindow([IntPtr][long]$hwnd, $SW_MINIMIZE)
    $minimized += $hwnd
  }
  Start-Sleep -Milliseconds 800
  Rec-Md "$Tag-extras-minimized" @{ count = $minimized.Count; hwnds = ($minimized -join ",") }
  return ,$minimized
}

function Set-MdArrangeH([array]$Apps, [array]$Work, [string]$Tag) {
  # Prearrange the chosen triple H[A,B,C]: horizontal thirds of the source
  # work area (physical pixels from tile-start), full work height. No product
  # policy is touched; the Engine retiles on adopt either way. Records the
  # requested thirds for the topology evidence.
  [MouseDragNative]::EnsurePMv2()
  $SWP_NOACTIVATE = 0x0010u; $SWP_NOZORDER = 0x0004u; $SWP_SHOWWINDOW = 0x0040u
  $wx = [int]$Work[0]; $wy = [int]$Work[1]; $ww = [int]$Work[2]; $wh = [int]$Work[3]
  $third = [int]([int]$ww / 3)
  $req = @()
  for ($i = 0; $i -lt $Apps.Count; $i++) {
    $x = $wx + $i * $third
    $w = $third
    if ($i -eq ($Apps.Count - 1)) { $w = $wx + $ww - $x }
    $null = [MouseDragNative]::SetWindowPos([IntPtr][long]$Apps[$i].hwnd, [IntPtr]::Zero, $x, $wy, $w, $wh, ($SWP_NOACTIVATE -bor $SWP_NOZORDER -bor $SWP_SHOWWINDOW))
    $req += ("{0}:{1},{2},{3},{4}" -f $Apps[$i].hwnd, $x, $wy, $w, $wh)
  }
  Start-Sleep -Milliseconds 800
  Rec-Md "$Tag-arrange-h" @{ thirds = ($req -join " ") }
}

function Get-MdMinHintsDetail([string]$LogPath, [int]$Mark) {
  # Latest min-hints-detail seam: per-token native minimums plus reason, for
  # the overconstrained abort gate and the H-fit evidence. Returns token map.
  $got = Get-MdEvents $LogPath $Mark
  $latest = $null
  foreach ($e in $got.events) {
    if ("$($e.event)" -ne "min-hints-detail") { continue }
    $latest = $e
  }
  if ($null -eq $latest) { return $null }
  $map = @{}
  foreach ($en in @($latest.entries)) { $map["$($en.window)"] = @{ min_w = [int]$en.min[0]; min_h = [int]$en.min[1]; reason = "$($en.reason)" } }
  return @{ tick = [uint64]$latest.tick; hints = $map }
}

function Assert-MdNoOverconstrained($Snap, $Hints, [string]$Tag) {
  # Abort gate: every converged plan rect must carry its token's native
  # minimum (desired w/h >= min_w/min_h). A clamped plan still readbacks as
  # matched, so this explicit join is the feasibility proof for the H
  # fixture on this work area. Fails loudly (fixture abort, not a product
  # failure) when the Engine had to clamp.
  if ($null -eq $Hints) { Fail-Md "$Tag no min-hints-detail seam for overconstrained gate" }
  foreach ($en in @($Snap.detail.entries)) {
    $tok = "$($en.window)"
    if (-not $Hints.hints.ContainsKey($tok)) { continue }
    $h = $Hints.hints[$tok]
    $d = @($en.desired)
    if ([int]$d[2] -lt [int]$h.min_w -or [int]$d[3] -lt [int]$h.min_h) {
      Fail-Md "$Tag overconstrained token $tok desired $($d -join ',') below min $($h.min_w),$($h.min_h) (fixture infeasible, abort)"
    }
  }
  Rec-Md "$Tag-no-overconstrained" @{ entries = @($Snap.detail.entries).Count }
}

function Resolve-MdTokenMap($Detail, [array]$Apps, [string]$Tag) {
  # Per-window token->HWND mapping (not a multiset alone): each readback rect
  # must equal exactly one bound native DWM frame, and each bound HWND exactly
  # one entry. Ambiguity or mismatch fails loudly so a multiset coincidence
  # can never masquerade as placement proof.
  $frames = @{}
  foreach ($a in $Apps) { $frames[[uint64]$a.hwnd] = ((Get-MdFrame ([long]$a.hwnd)) -join ",") }
  $map = @{}
  foreach ($en in @($Detail.entries)) {
    $rb = (($en.readback) -join ",")
    $hits = @($frames.Keys | Where-Object { $frames[$_] -ceq $rb })
    if ($hits.Count -ne 1) { Fail-Md "$Tag token $($en.window) readback $rb maps to $($hits.Count) bound HWNDs (need exactly 1)" }
    $map["$($en.window)"] = [uint64]$hits[0]
  }
  if ($map.Count -ne $Apps.Count) { Fail-Md "$Tag token map $($map.Count) != bound $($Apps.Count)" }
  $pairs = @($map.Keys | ForEach-Object { "${_}=$($map[$_])" } | Sort-Object)
  Rec-Md "$Tag-token-map" @{ map = ($pairs -join " ") }
  return $map
}

function New-MdRunDir([string]$Base) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dir = Join-Path $Base "target\windows-mouse-drag\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Invoke-MdNative([string]$Exe, [string[]]$CliArgs) {
  $out = (& $Exe @CliArgs 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { Fail-Md "native exit ${LASTEXITCODE}: $Exe $($CliArgs -join ' ') $out" }
  return "$out".Trim()
}

function Open-MdApp([string]$ExeName, [int[]]$BeforePids, [string]$Tag) {
  $exe = Join-Path $env:SystemRoot "System32\$ExeName"
  if (-not (Test-Path -LiteralPath $exe)) { Fail-Md "$Tag missing system exe $exe" }
  Start-ExplorerGui $exe "" $env:TEMP
  $short = ($ExeName -replace '\.exe$', '')
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $found = Get-Process -Name $short -ErrorAction SilentlyContinue |
      Where-Object { $BeforePids -notcontains $_.Id -and $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
    if ($null -ne $found) {
      Assert-ParentIsExplorer ([int]$found.Id)
      $hex = "{0:x16}" -f $found.StartTime.ToUniversalTime().ToFileTimeUtc()
      return @{ proc = $found; hwnd = [long]$found.MainWindowHandle; pid = [int]$found.Id; creation = $hex; exe = $ExeName; source = "created" }
    }
    Start-Sleep -Milliseconds 300
  }
  Fail-Md "$Tag approved app did not appear: $ExeName"
  return $null
}

function Open-MdCalculator([uint64[]]$BeforeHwnds, [string]$OwnerBin) {
  # Calculator is an ApplicationFrameHost HOSTED CHILD: the Store host
  # process persists and may already exist (Settings today), so PID delta and
  # Win32_ParentProcessId searches are wrong. Bind HWND-delta within the same
  # host: a top-level ApplicationFrameHost HWND (not seen before) with a live
  # CalculatorApp child via the product `children` gate (mirrors the product
  # hosted gate). No process must die for teardown; HWND closure is the clean
  # signal while the host process may persist.
  $before = @($BeforeHwnds)
  $exe = Join-Path $env:SystemRoot "System32\calc.exe"
  Start-ExplorerGui $exe "" $env:TEMP
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    $inv = Invoke-MdNative $OwnerBin @("inventory") | ConvertFrom-Json
    foreach ($w in @($inv.windows)) {
      $hwnd = [uint64]$w.hwnd
      if ($before -contains $hwnd) { continue }
      if ("$($w.exe)".ToLowerInvariant() -ne "applicationframehost.exe") { continue }
      if (-not [MouseDragNative]::IsWindowVisible([IntPtr][long]$hwnd)) { continue }
      $ch = Invoke-MdNative $OwnerBin @("children", "--hwnd", "$hwnd") | ConvertFrom-Json
      $calcKid = @($ch.windows[0].children | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "calculatorapp.exe" }) | Select-Object -First 1
      if ($null -eq $calcKid) { continue }
      $pidOut = [uint32]0
      $null = [MouseDragNative]::GetWindowThreadProcessId([IntPtr][long]$hwnd, [ref]$pidOut)
      # No ParentIsExplorer on the host PID: the Store host predates the run
      # (often svchost-parented) and persists across HWNDs. Launch provenance
      # is the Explorer-brokered calc.exe above; binding is the new top-level
      # HWND plus the live CalculatorApp child via the product children gate.
      $proc = Get-Process -Id ([int]$pidOut) -ErrorAction Stop
      $hex = "{0:x16}" -f $proc.StartTime.ToUniversalTime().ToFileTimeUtc()
      return @{ proc = $proc; hwnd = [long]$hwnd; pid = [int]$pidOut; creation = $hex; exe = "ApplicationFrameHost.exe"; source = "created"; child = [uint64]$calcKid.hwnd }
    }
    Start-Sleep -Milliseconds 500
  }
  Fail-Md "calculator host with CalculatorApp child did not appear"
  return $null
}

function Close-MdApp($App, [string]$Tag) {
  # Exact-HWND WM_CLOSE teardown: borrowed windows are never closed by the
  # caller (guard here too); created windows close by HWND-gone, not process
  # death. The Store host persists after its Calculator HWND closes, and
  # tabbed Notepad keeps its process after one tab closes, so IsWindow-gone
  # (or invisible) is the clean signal. Fails when the HWND survives.
  if ("$($App.source)" -eq "borrowed") { Fail-Md "$Tag refuse: borrowed hwnd $($App.hwnd) must never close" }
  $handle = [long]$App.hwnd
  try {
    $alive = Get-Process -Id ([int]$App.pid) -ErrorAction Stop
    $hex = "{0:x16}" -f $alive.StartTime.ToUniversalTime().ToFileTimeUtc()
    if ($hex -cne "$($App.creation)") { Rec-Md "$Tag-already-recycled" @{ pid = $App.pid }; return }
  } catch { Rec-Md "$Tag-already-closed" @{ pid = $App.pid }; return }
  if (-not [MouseDragNative]::IsWindow([IntPtr]$handle)) { Rec-Md "$Tag-hwnd-already-gone" @{ hwnd = $handle }; return }
  [void][MouseDragNative]::PostMessageW([IntPtr]$handle, 0x0010, [UIntPtr]0, [IntPtr]0)
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    if (-not [MouseDragNative]::IsWindow([IntPtr]$handle)) { return }
    try {
      if (-not [MouseDragNative]::IsWindowVisible([IntPtr]$handle)) { return }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  if ([MouseDragNative]::IsWindow([IntPtr]$handle) -and [MouseDragNative]::IsWindowVisible([IntPtr]$handle)) {
    Fail-Md "$Tag app HWND did not close hwnd $handle pid $($App.pid)"
  }
}

function Get-MdTileStart([string]$LogPath, [string]$Tag) {
  $got = Get-MdEvents $LogPath 0
  $start = $null
  foreach ($e in $got.events) { if ("$($e.event)" -eq "tile-start") { $start = $e } }
  if ($null -eq $start) { Fail-Md "$Tag tile-start missing" }
  if ($null -eq $start.work -or $null -eq $start.full) { Fail-Md "$Tag tile-start missing work/full" }
  return $start
}

function Wait-MdConverged([string]$LogPath, [int]$Mark, [array]$Apps, [int]$TimeoutSec, [string]$Tag) {
  # Converge to the canonical adopted arrangement: the latest
  # plan+readback-detail snapshot has exactly one entry per test app frame
  # (multiset equality) with every entry matched. Work/full come from the
  # owner tile-start event, never from a baseline helper.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $got = Get-MdEvents $LogPath $Mark
    $snap = Get-MdPlanSnapshot $got.events
    if ($null -ne $snap) {
      $frames = @()
      foreach ($a in $Apps) { $frames += , (Get-MdFrame ([long]$a.hwnd)) }
      try {
        if ($snap.detail.entries.Count -eq $Apps.Count) {
          $null = Test-MdFramesMatchPlan $snap.detail $frames "$Tag-converge"
          return @{ tick = $snap.tick; detail = $snap.detail }
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 500
  }
  Fail-Md "$Tag converge timeout (no all-matched 3-app plan)"
  return $null
}

function Assert-MdDropStable($Owner, [array]$Apps, $Snap, [string]$Tag) {
  # Finish-pointer stability: subsequent pointer movement after the drop must
  # not alter the settled frames and must not plan a new Engine mutation.
  $postMark = (Get-MdLines $Owner.log).Count
  $postFrames = @(); foreach ($a in $Apps) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $null = Test-MdFramesMatchPlan $Snap.detail $postFrames "$Tag-stable-plan"
  $pt = New-Object MouseDragNative+POINT
  [void][MouseDragNative]::GetCursorPos([ref]$pt)
  Send-MdMouseMove (([int]$pt.x) + 40) (([int]$pt.y) + 30)
  Start-Sleep -Milliseconds 1500
  $later = @(); foreach ($a in $Apps) { $later += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Apps.Count; $i++) {
    if ("$($postFrames[$i] -join ',')" -cne "$($later[$i] -join ',')") { Fail-Md "$Tag post-drop frame $i moved after finish-pointer motion" }
  }
  $tail = Get-MdEvents $Owner.log $postMark
  foreach ($e in $tail.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "$Tag finish-pointer motion planned an Engine mutation"
    }
  }
  Rec-Md "$Tag-stable" @{ moved = $false }
}

function Invoke-MouseDragMock {
  Install-MdNative
  Rec-Md "scope" @{ ordinary = "scoped-normal-3app"; apps = @("notepad.exe", "ApplicationFrameHost.exe=CalculatorApp.exe", "mspaint.exe"); never = @("terminal", "kills-by-name", "typing"); registry = "none"; content = "none"; screenshots = "run-dir-png-only" }
  $help = Invoke-MdNative (Join-Path $Repo "target\debug\tiler-windows.exe") @("--help")
  foreach ($need in @("tile", "--user-start", "--scope-exe", "stop", "restore")) {
    if ("$help" -notmatch [regex]::Escape($need)) { Fail-Md "mock CLI help missing $need" }
  }
  Rec-Md "cli-surface" @{ tile_user_start = $true; scope_exe = $true }
  $size = [MouseDragNative]::SizeOfInput()
  if ($size -ne $MD_INPUT_SIZE_X64) { Fail-Md "mock INPUT struct size $size, want $MD_INPUT_SIZE_X64" }
  Rec-Md "input-abi" @{ size = $size }
  $t = (& cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --lib drop_fence 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { Fail-Md "mock cargo test drop_fence failed: $t" }
  Rec-Md "portable-tests" @{ suite = "drop_fence"; result = "pass" }
  $t = (& cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --lib win_mouse 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { Fail-Md "mock cargo test win_mouse failed: $t" }
  Rec-Md "portable-tests-windrag" @{ suite = "win_mouse"; result = "pass" }
  $t = (& cargo test --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows --lib windrag_mask 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { Fail-Md "mock cargo test windrag_mask failed: $t" }
  Rec-Md "portable-tests-mask" @{ suite = "windrag_mask"; result = "pass" }
  # Contract fixtures: the harness's own plan/frame matcher must accept an
  # exact multiset (order-independent, all matched) and reject a moved frame,
  # a count mismatch, and an unmatched readback. This exercises parser logic,
  # not source text.
  $detailOk = @{ entries = @(
    @{ window = "w1"; desired = @(0, 0, 800, 600); readback = @(0, 0, 800, 600); matched = $true },
    @{ window = "w2"; desired = @(800, 0, 800, 600); readback = @(800, 0, 800, 600); matched = $true },
    @{ window = "w3"; desired = @(0, 600, 800, 600); readback = @(0, 600, 800, 600); matched = $true }
  )}
  $framesOk = @(@(800, 0, 800, 600), @(0, 600, 800, 600), @(0, 0, 800, 600))
  $null = Test-MdFramesMatchPlan $detailOk $framesOk "mock-fixture-pass"
  Rec-Md "fixture-pass" @{ entries = 3; order = "shuffled-ok" }
  $framesMoved = @(@(800, 0, 800, 600), @(0, 600, 800, 600), @(10, 10, 800, 600))
  try { $null = Test-MdFramesMatchPlan $detailOk $framesMoved "mock-fixture-moved"; Fail-Md "mock fixture moved did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "multiset mismatch") { throw } }
  $detailUnmatched = @{ entries = @(
    @{ window = "w1"; desired = @(0, 0, 800, 600); readback = @(0, 0, 800, 600); matched = $true },
    @{ window = "w2"; desired = @(800, 0, 800, 600); readback = @(801, 0, 800, 600); matched = $false }
  )}
  try { $null = Test-MdFramesMatchPlan $detailUnmatched @(@(0, 0, 800, 600), @(800, 0, 800, 600)) "mock-fixture-unmatched"; Fail-Md "mock fixture unmatched did not throw" }
  catch { if ("$($_.Exception.Message)" -notmatch "unmatched") { throw } }
  Rec-Md "fixture-negative" @{ moved = "rejected"; unmatched = "rejected" }
  # Harness structure contract via own AST: required title-slice stages plus
  # the project Win+Left stages (stationary producer, separate -WinDrag /
  # -WinAll), per-app finally closure with no-throw cleanup legs, taskbar
  # (not offscreen) outside-point, and no registry writes.
  $toks = $null; $errs = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$toks, [ref]$errs)
  if ($errs.Count -ne 0) { Fail-Md "mock self-parse errors $($errs.Count)" }
  $text = Get-Content -LiteralPath $PSCommandPath -Raw
  foreach ($need in @("TitleDrop", "Cancel", "Zero", "Self", "Centre", "Outside", "WinDrop", "WinFocus", "WinCancel", "WinZero", "WinSelf", "WinCentre", "WinOutside", "WinAll", "PreviewProbe", "PreviewCrash", "Sticky", "Crash", "windrag", "windrag-focus", "Test-MdFramesMatchPlan", "Resolve-MdTokenMap", "Close-MdApp", "Get-MdTileStart", "Shell_TrayWnd", "taskbar")) {
    if ($text -notmatch [regex]::Escape($need)) { Fail-Md "mock harness missing $need" }
  }
  if ($text -notmatch "finally") { Fail-Md "mock harness missing per-app finally closure" }
  $regPat = 'Set-Item' + 'Property|New-Item' + 'Property'
  if ($text -match $regPat) { Fail-Md "mock registry/policy write present" }
  $secondOut = ', 25' + '60|25' + '60,'
  if ($text -match $secondOut) { Fail-Md "mock hardcoded second-output origin present" }
  Rec-Md "harness-contract" @{ stages = 15; rows = @("TitleDrop", "Cancel", "Zero", "Self", "Centre", "Outside", "WinDrop", "WinFocus", "WinCancel", "WinZero", "WinSelf", "WinCentre", "WinOutside", "Sticky", "Crash"); outside = "taskbar"; registry = "none"; win_producer = "project-stationary" }
  # Negative cleanup contract: the verdict is written AFTER every cleanup leg
  # ran, so no success can hide a cleanup error. Statically: the finally
  # region (up to the single-verdict marker) holds no bare `throw` that
  # could abort later legs, and the restore helper returns a boolean with a
  # loud mismatch record instead of a silent pass.
  foreach ($need in @("cleanup_errors", "borrowed-restore-mismatch", "cleanup failed: ", "return `$false", "return `$true")) {
    if ($text -notmatch [regex]::Escape($need)) { Fail-Md "mock cleanup contract missing $need" }
  }
  $finIdx = $text.IndexOf("} finally {")
  $verdictIdx = $text.IndexOf("# Single verdict AFTER")
  if ($finIdx -lt 0 -or $verdictIdx -lt 0 -or $verdictIdx -le $finIdx) { Fail-Md "mock cleanup region markers missing" }
  $finRegion = $text.Substring($finIdx, $verdictIdx - $finIdx)
  if ($finRegion -match '(?m)^\s*throw\s*$') { Fail-Md "mock bare throw inside cleanup legs" }
  Rec-Md "cleanup-contract" @{ verdict = "single-post-cleanup"; legs_throw = "none"; mismatch = "loud-fail" }
  $report = @{ status = "pass"; stage = "MouseDragMock"; steps = $MD_STEPS }
  $report | ConvertTo-Json -Depth 8 | Write-Output
}

function New-MdOwnerCopy([string]$ProofDir) {
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail-Md "owner build failed" }
  $ownerCopy = Join-Path $ProofDir "tiler-windows.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  $ownerHash = (Get-FileHash $ownerCopy -Algorithm SHA256).Hash
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  return @{ ownerCopy = $ownerCopy; hash = $ownerHash; commit = $commit }
}

function Start-MdOwnerFromCopy([string]$OwnerCopy, [string]$ProofDir, [int]$Seconds) {
  Start-ExplorerGui $OwnerCopy "tile --user-start --seconds $Seconds --trace$MD_SCOPE_ARGS" $ProofDir
  $ident = (Invoke-MdNative $OwnerCopy @("identity") | ConvertFrom-Json)
  $ready = $null
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    try { $r = (Invoke-MdNative $OwnerCopy @("ready") | ConvertFrom-Json); if ($r.ready -eq $true) { $ready = $r; break } } catch {}
    Start-Sleep -Milliseconds 250
  }
  if ($null -eq $ready) { Fail-Md "scoped owner not ready" }
  if (-not (Test-ExeEqual "$($ready.owner.exe_path)" "$OwnerCopy")) { Fail-Md "owner peer mismatch" }
  Assert-ParentIsExplorer ([int]$ready.owner.pid)
  return @{ ownerCopy = $OwnerCopy; ready = $ready; log = "$($ready.log_path)" }
}

function Start-MdScopedOwner([string]$ProofDir, [int]$Seconds) {
  $copy = New-MdOwnerCopy $ProofDir
  $ownerHash = $copy.hash; $commit = $copy.commit
  $ownerCopy = $copy.ownerCopy
  $started = Start-MdOwnerFromCopy $ownerCopy $ProofDir $Seconds
  return @{ ownerCopy = $ownerCopy; hash = $ownerHash; commit = $commit; ready = $started.ready; log = $started.log }
}

function Invoke-MdTitleDropStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  $mover = $Apps[0]
  Set-MdForeground ([long]$mover.hwnd) "titledrop-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $preMover = ($preFrames[0] -join ",")
  $moverIdx = -1
  for ($i = 0; $i -lt $Managed.Count; $i++) { if ([uint64]$Managed[$i].hwnd -eq [uint64]$mover.hwnd) { $moverIdx = $i } }
  if ($moverIdx -lt 0) { Fail-Md "TitleDrop mover not in managed set" }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "titledrop-before" | Out-Null
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "TitleDrop no WindowFromPoint title hit" }
  # Edge-split target from a LIVE tile, never a blind domain point (domain
  # midpoints can land in inter-tile gaps and refuse as unchanged): 20px
  # inside another window's left tile edge at its vertical centre, inside the
  # 32px group-edge zone so the shared resolver reorgs instead of refusing.
  $refFrame = Get-MdFrame ([long]$Apps[1].hwnd)
  $targetX = [int]$refFrame[0] + 20
  $targetY = [int]$refFrame[1] + [int]([int]$refFrame[3] / 2)
  $domain = $Start.work
  if ($targetX -lt [int]$domain[0] -or $targetX -ge ([int]$domain[0] + [int]$domain[2]) -or $targetY -lt [int]$domain[1] -or $targetY -ge ([int]$domain[1] + [int]$domain[3])) {
    Fail-Md "TitleDrop edge target outside source work area"
  }
  $siblings = @($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd })
  $preMap = Resolve-MdTokenMap ((Get-MdPlanSnapshot (Get-MdEvents $Owner.log 0).events).detail) $Managed "titledrop-pre"
  $moverToken = ""
  foreach ($k in $preMap.Keys) { if ([uint64]$preMap[$k] -eq [uint64]$mover.hwnd) { $moverToken = "$k" } }
  if ($moverToken -eq "") { Fail-Md "TitleDrop mover token not in pre map" }
  Send-MdVerifiedDrag ([int]$title[0]) ([int]$title[1]) $targetX $targetY 12 ([long]$mover.hwnd) "title-drop" $Owner.ownerCopy $siblings $Owner.log $mark $moverToken
  Assert-MdButtonReleased "title-drop"
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-applied") 25 "titledrop"
  if ("$($got.event.producer)" -ne "native") { Fail-Md "TitleDrop producer $($got.event.producer) != native" }
  Wait-MdPreviewHidden $Owner.ownerCopy "titledrop"
  $after = Get-MdEvents $Owner.log $mark
  $snap = Get-MdPlanSnapshot $after.events
  if ($null -eq $snap) { Fail-Md "TitleDrop no plan snapshot" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $null = Test-MdFramesMatchPlan $snap.detail $postFrames "titledrop-plan"
  $null = Resolve-MdTokenMap $snap.detail $Managed "titledrop"
  $hints = Get-MdMinHintsDetail $Owner.log $mark
  Assert-MdNoOverconstrained $snap $hints "titledrop"
  $moved = "$($preFrames[$moverIdx] -join ',')" -cne "$($postFrames[$moverIdx] -join ',')"
  if (-not $moved) { Fail-Md "TitleDrop mover topology unchanged" }
  Assert-MdPreviewAgreement $Owner.log $mark $moverToken ([int]$got.event.tick) "$($got.event.hover_prior)" $postFrames[$moverIdx] "TitleDrop"
  if ("$($got.event.hover_prior)" -cne "none") { Fail-Md "TitleDrop leaf journey carried prior $($got.event.hover_prior) (want none)" }
  Assert-MdDropStable $Owner $Managed $snap "titledrop"
  Save-MdShot $ProofDir "titledrop-after" | Out-Null
  Rec-Md "TitleDrop" @{ outcome = "drag-drop-applied"; producer = "native"; tick = $snap.tick; zone = "other-tile-left-edge" }
}

function Invoke-MdCancelStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  $mover = $Apps[2]
  Set-MdForeground ([long]$mover.hwnd) "cancel-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "cancel-before" | Out-Null
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "cancel no WindowFromPoint title hit" }
  $screen = Get-MdVirtualScreen
  $nx = ConvertTo-MdAbsolute ([int]$title[0]) ([int]$screen[0]) ([int]$screen[2])
  $ny = ConvertTo-MdAbsolute ([int]$title[1]) ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "cancel pre-move rejected" }
  Start-Sleep -Milliseconds 250
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "cancel button-down rejected" }
  Start-Sleep -Milliseconds 400
  Send-MdMouseMove (([int]$title[0]) + 120) (([int]$title[1]) + 60)
  Start-Sleep -Milliseconds 300
  # Injected Esc: the native modal loop still cancels and restores geometry;
  # the product hook filters injected keys so no cancel edge is claimed.
  # Accept either explicit cancel or no-change-with-restore.
  if ([MouseDragNative]::SendKey($MD_VK_ESC, $false) -ne 1) { Fail-Md "esc down rejected" }
  Start-Sleep -Milliseconds 200
  if ([MouseDragNative]::SendKey($MD_VK_ESC, $true) -ne 1) { Fail-Md "esc up rejected" }
  Start-Sleep -Milliseconds 300
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "cancel button-up rejected" }
  Start-Sleep -Milliseconds 800
  Assert-MdButtonReleased "cancel"
  $got = Wait-MdGesture $Owner.log $mark @("gesture-cancelled-esc", "gesture-no-change", "drag-drop-refused") 25 "cancel"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "cancel frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "cancel planned an Engine mutation"
    }
  }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "cancel"
  Save-MdShot $ProofDir "cancel-after" | Out-Null
  Rec-Md "Cancel" @{ outcome = "$($got.event.outcome)"; restored = $true; injected_esc = "native-cancel-no-edge-claim" }
}

function Invoke-MdZeroStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  $mover = $Apps[0]
  Set-MdForeground ([long]$mover.hwnd) "zero-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "zero no WindowFromPoint title hit" }
  # Click without movement: down and up at the same title point.
  $screen = Get-MdVirtualScreen
  $nx = ConvertTo-MdAbsolute ([int]$title[0]) ([int]$screen[0]) ([int]$screen[2])
  $ny = ConvertTo-MdAbsolute ([int]$title[1]) ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "zero pre-move rejected" }
  Start-Sleep -Milliseconds 250
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "zero button-down rejected" }
  Start-Sleep -Milliseconds 400
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "zero button-up rejected" }
  Start-Sleep -Milliseconds 800
  Assert-MdButtonReleased "zero"
  # A zero title click often emits no START at all: stable source plus NO
  # plan snapshot after the click is the acceptance here. Never demand a
  # nonexistent event; a missing event with an appearing plan still fails.
  $zeroOutcome = ""
  try {
    $got = Wait-MdGesture $Owner.log $mark @("gesture-no-change", "gesture-no-start") 20 "zero"
    $zeroOutcome = "$($got.event.outcome)"
  } catch {
    # No gesture verdict at all is the common zero-click shape (no START, no
    # END): fail if ANY gesture event appears after the click. Ordinary
    # background reconcile plans are normal and harmless, so only gesture
    # verdicts count here.
    $afterMiss = Get-MdEvents $Owner.log $mark
    foreach ($e in $afterMiss.events) {
      if ("$($e.event)" -eq "gesture") { Fail-Md "zero click emitted gesture outcome $($e.outcome)" }
    }
    $zeroOutcome = "gesture-no-start"
  }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "zero frame $i changed" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "zero planned an Engine mutation"
    }
  }
  Assert-MdPreviewHidden $Owner.ownerCopy $Owner.log $mark "" "zero"
  Rec-Md "Zero" @{ outcome = $zeroOutcome; restored = $true }
}

function Invoke-MdSelfStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  $mover = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "self-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "self no WindowFromPoint title hit" }
  $frame = Get-MdFrame ([long]$mover.hwnd)
  $selfX = [int]$frame[0] + [int]([int]$frame[2] / 2)
  $selfY = [int]$frame[1] + [int]([int]$frame[3] / 2)
  # Drop back onto the mover's own centre: self refuses with snap-back and
  # no transfer.
  Send-MdVerifiedDrag ([int]$title[0]) ([int]$title[1]) $selfX $selfY 12 ([long]$mover.hwnd) "self" $Owner.ownerCopy
  Assert-MdButtonReleased "self"
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-refused", "gesture-no-change") 25 "self"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "self frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "self planned an Engine mutation"
    }
  }
  Rec-Md "Self" @{ outcome = "$($got.event.outcome)"; restored = $true }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "self"
}

function Invoke-MdCentreStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  # Centre-other is distinct from self: drop the mover onto ANOTHER window's
  # centre (centre-stack target). Refuses with snap-back, no transfer.
  $mover = $Apps[0]
  $target = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "centre-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "centre no WindowFromPoint title hit" }
  $tframe = Get-MdFrame ([long]$target.hwnd)
  $cx = [int]$tframe[0] + [int]([int]$tframe[2] / 2)
  $cy = [int]$tframe[1] + [int]([int]$tframe[3] / 2)
  Send-MdVerifiedDrag ([int]$title[0]) ([int]$title[1]) $cx $cy 12 ([long]$mover.hwnd) "centre" $Owner.ownerCopy
  Assert-MdButtonReleased "centre"
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-refused", "gesture-no-change") 25 "centre"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "centre frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "centre planned an Engine mutation"
    }
  }
  Rec-Md "Centre" @{ outcome = "$($got.event.outcome)"; restored = $true; target = "other-centre" }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "centre"
}

function Invoke-MdOutsideStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  $mover = $Apps[2]
  Set-MdForeground ([long]$mover.hwnd) "sameoutput-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "outside-before" | Out-Null
  $outer = Get-MdOuter ([long]$mover.hwnd)
  $title = Find-MdTitlePoint ([long]$mover.hwnd) $outer
  if ($null -eq $title) { Fail-Md "same-output no WindowFromPoint title hit" }
  # Outside the source work area on this single output: the taskbar strip
  # below the work area (work bottom < full bottom is preflighted as the
  # normal desktop). Never a fictional offscreen point.
  $work = $Start.work; $full = $Start.full
  $targetX = [int]$work[0] + [int]([int]$work[2] / 2)
  $targetY = [int]$work[1] + [int]$work[3] + 10
  if ($targetY -ge ([int]$full[1] + [int]$full[3])) { Fail-Md "same-output taskbar point outside full bounds (no normal taskbar?)" }
  Send-MdVerifiedDrag ([int]$title[0]) ([int]$title[1]) $targetX $targetY 12 ([long]$mover.hwnd) "same-output" $Owner.ownerCopy
  Assert-MdButtonReleased "same-output"
  $got = Wait-MdGesture $Owner.log $mark @("gesture-refused-cross-output", "drag-drop-refused", "gesture-no-change") 25 "same-output"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "same-output frame $i moved" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "same-output planned an Engine mutation"
    }
  }
  Save-MdShot $ProofDir "outside-after" | Out-Null
  Rec-Md "Outside" @{ outcome = "$($got.event.outcome)"; restored = $true; outside = "taskbar" }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "outside"
}

function Invoke-MdReadoptStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  # WinAll only: the six title rows reorganise the adopted layout, so the
  # Win rows re-adopt the deterministic H-thirds fixture before starting.
  # Same arrange/converge/token-map gates as fixture setup; extras stay
  # minimized from setup, so managed must still be exactly the triple.
  Set-MdArrangeH $Apps $Start.work "win-fixture"
  Save-MdShot $ProofDir "win-arranged" | Out-Null
  $eligPost = Get-MdEligibleApps $Owner.ownerCopy "win-managed"
  $reManaged = @()
  foreach ($w in @($eligPost)) {
    $reManaged += @{ hwnd = [long]$w.hwnd; pid = [int]$w.pid }
  }
  foreach ($a in @($Apps)) {
    if (@($reManaged | Where-Object { [uint64]$_.hwnd -eq [uint64]$a.hwnd }).Count -eq 0) {
      Fail-Md "win fixture managed set missing bound app hwnd $($a.hwnd)"
    }
  }
  if ($reManaged.Count -ne 3) { Fail-Md "win fixture managed $($reManaged.Count) != 3" }
  $markR = (Get-MdLines $Owner.log).Count
  $conv = Wait-MdConverged $Owner.log $markR $reManaged 30 "win-adopt"
  $null = Resolve-MdTokenMap $conv.detail $reManaged "win-adopt"
  $hintsR = Get-MdMinHintsDetail $Owner.log $markR
  Assert-MdNoOverconstrained $conv $hintsR "win-adopt"
  Rec-Md "win-adopted" @{ tick = $conv.tick; managed = $reManaged.Count }
  Save-MdShot $ProofDir "win-adopted" | Out-Null
}

function Get-MdFarEndTarget([array]$Managed, [long]$MoverHwnd, [string]$Tag) {
  # Topology-aware edge target: dropping the mover immediately before/after
  # its current tree neighbour is a no-op snap-back, so pick the FAR end
  # from the visual tile order instead. Mover-not-first drops onto the first
  # tile's left edge (insert-first always moves it); mover-first drops onto
  # the last tile's right edge (insert-last always moves it). Both stay 20px
  # inside a live tile edge at its vertical centre, never a blind point.
  $order = @($Managed | Sort-Object { (Get-MdFrame ([long]$_.hwnd))[0] })
  $moverPos = -1
  for ($i = 0; $i -lt $order.Count; $i++) { if ([uint64]$order[$i].hwnd -eq [uint64]$MoverHwnd) { $moverPos = $i } }
  if ($moverPos -lt 0) { Fail-Md "$Tag mover not in visual order" }
  if ($moverPos -gt 0) {
    $refFrame = Get-MdFrame ([long]$order[0].hwnd)
    return @{ X = [int]$refFrame[0] + 20; Y = [int]$refFrame[1] + [int]([int]$refFrame[3] / 2); Zone = "first-tile-left-edge" }
  }
  $refFrame = Get-MdFrame ([long]$order[$order.Count - 1].hwnd)
  return @{ X = (([int]$refFrame[0] + [int]$refFrame[2]) - 20); Y = ([int]$refFrame[1] + [int]([int]$refFrame[3] / 2)); Zone = "last-tile-right-edge" }
}

function Invoke-MdPreviewStickyStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  # Sticky group-edge journey (project producer): hold into a group-gap
  # strip inside the 32px top-edge zone (prior None -> GroupEdge with a
  # sticky Some prior), then step AWAY past 32px but inside the 80px sticky
  # depth (still the same GroupEdge only because the exact prior carried).
  # The drop then applies with that prior and lands exactly on the preview
  # rect. Gap geometry derives from live Engine-projected frames, never
  # hardcoded topology.
  $win = $null
  # Candidate gap strips from live frames: vertical strips (x-sorted pairs
  # with an x gap, y overlap, height>=120; legs run down) and horizontal
  # strips (width>=120; legs run right). Native-frame strips drift from
  # Engine gaps under size-hint share pressure, and inner-group strips can
  # refuse as unplaceable (source removal collapses their group), so each
  # strip is SWEPT empirically (see below): resolution success is itself
  # the placeability proof. Points recorded for diagnosis. Nothing hardcoded.
  $work = $Start.work
  $fr0 = @(); foreach ($a in $Managed) { $f = Get-MdFrame ([long]$a.hwnd); $fr0 += [pscustomobject]@{ x = [int]$f[0]; y = [int]$f[1]; w = [int]$f[2]; h = [int]$f[3] } }
  $cands = @()
  $ordX = @($fr0 | Sort-Object x)
  for ($i = 0; $i -lt ($ordX.Count - 1); $i++) {
    $r1 = $ordX[$i]; $r2 = $ordX[$i + 1]
    if (($r1.x + $r1.w) -lt $r2.x -and $r1.y -lt ($r2.y + $r2.h) -and $r2.y -lt ($r1.y + $r1.h)) {
      $top = [math]::Max([int]$r1.y, [int]$r2.y)
      $bot = [math]::Min([int]($r1.y + $r1.h), [int]($r2.y + $r2.h))
      if (($bot - $top) -ge 120) {
        $gx = [int](($r1.x + $r1.w + $r2.x) / 2)
        $cands += [pscustomobject]@{ X1 = $gx; Y1 = ($top + 12); X2 = $gx; Y2 = ($top + 50); Top = $top;
           Vert = 1 }
      }
    }
  }
  $ordY = @($fr0 | Sort-Object y)
  for ($i = 0; $i -lt ($ordY.Count - 1); $i++) {
    $r1 = $ordY[$i]; $r2 = $ordY[$i + 1]
    if (($r1.y + $r1.h) -lt $r2.y -and $r1.x -lt ($r2.x + $r2.w) -and $r2.x -lt ($r1.x + $r1.w)) {
      $left = [math]::Max([int]$r1.x, [int]$r2.x)
      $right = [math]::Min([int]($r1.x + $r1.w), [int]($r2.x + $r2.w))
      if (($right - $left) -ge 120) {
        $gy = [int](($r1.y + $r1.h + $r2.y) / 2)
        $cands += [pscustomobject]@{ X1 = ($left + 12); Y1 = $gy; X2 = ($left + 50); Y2 = $gy; Top = $left;
           Vert = 0 }
      }
    }
  }
  $cands = @($cands | Sort-Object Top | Select-Object -First 4)
  $cands = @($cands | Where-Object {
    foreach ($p in @(@($_.X1, $_.Y1), @($_.X2, $_.Y2))) {
      if ([int]$p[0] -lt [int]$work[0] -or [int]$p[0] -ge ([int]$work[0] + [int]$work[2]) -or [int]$p[1] -lt [int]$work[1] -or [int]$p[1] -ge ([int]$work[1] + [int]$work[3])) { return $false }
    }
    return $true
  })
  if ($cands.Count -eq 0) { Fail-Md "Sticky no candidate gap strip in live layout" }
  $candPts = @($cands | ForEach-Object { "$($_.X1),$($_.Y1)->$($_.X2),$($_.Y2)" })
  Rec-Md "sticky-candidates" @{ count = $cands.Count; strips = ($candPts -join " ") }
  $releaseAll = {
    [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
    [void][MouseDragNative]::SendKey($MD_VK_LWIN, $true)
  }
  $screen = Get-MdVirtualScreen
  $moveAbs = {
    param([int]$X, [int]$Y, [string]$Why)
    $nx = ConvertTo-MdAbsolute $X ([int]$screen[0]) ([int]$screen[2])
    $ny = ConvertTo-MdAbsolute $Y ([int]$screen[1]) ([int]$screen[3])
    if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "sticky $Why rejected" }
  }
  # Mover misses must not mask a broken inspection CLI: on any leg
  # failure the CLI is re-queried once, and only a working CLI continues
  # the probe (a failing one aborts loudly via the outer release).
  $checkInfra = {
    try { $null = Invoke-MdNative $Owner.ownerCopy @("preview-inspect") | ConvertFrom-Json }
    catch { throw }
  }
  $shotBefore = $false
  try {
  foreach ($m in @($Apps[1], $Apps[0])) {
    $mover = $m
    # A Start menu left open (prior synthetic Win release or desktop state)
    # steals foreground and breaks focus readbacks: dismiss once up front
    # (injected Esc never touches product tracking).
    Send-MdDismissStart "sticky-prefocus"
    Set-MdForeground ([long]$mover.hwnd) "sticky-focus"
    Start-Sleep -Seconds 2
    $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
    $mark = (Get-MdLines $Owner.log).Count
    if (-not $shotBefore) { Save-MdShot $ProofDir "sticky-before" | Out-Null; $shotBefore = $true }
    $preMap = Resolve-MdTokenMap ((Get-MdPlanSnapshot (Get-MdEvents $Owner.log 0).events).detail) $Managed "sticky-pre"
    $moverToken = ""
    foreach ($k in @($preMap.Keys)) { if ([uint64]$preMap[$k] -eq [uint64]$mover.hwnd) { $moverToken = "$k" } }
    if ($moverToken -eq "") { Fail-Md "Sticky mover token not in pre map" }
    $moverIdxS = -1
    for ($i = 0; $i -lt $Managed.Count; $i++) { if ([uint64]$Managed[$i].hwnd -eq [uint64]$mover.hwnd) { $moverIdxS = $i } }
    $frozenMover = ($preFrames[$moverIdxS] -join ",")
    $frozenSibs = @{}
    for ($i = 0; $i -lt $Managed.Count; $i++) {
      if ([uint64]$Managed[$i].hwnd -ne [uint64]$mover.hwnd) { $frozenSibs[[uint64]$Managed[$i].hwnd] = ($preFrames[$i] -join ",") }
    }
    $assertFrozen = {
      foreach ($h in @($frozenSibs.Keys)) {
        if (((Get-MdFrame ([long]$h)) -join ",") -cne $frozenSibs[$h]) { Fail-Md "sticky sibling moved mid-hold hwnd=$h" }
      }
      if (((Get-MdFrame ([long]$mover.hwnd)) -join ",") -cne $frozenMover) { Fail-Md "sticky mover moved mid-hold (must hold source)" }
    }
    $client = Get-MdClientPoint ([long]$mover.hwnd) "sticky"
    # Sweep one line across +-30px around the computed strip point (3px
    # steps, checking only the fresh log tail each step): the first
    # group-edge resolution wins. The computed strip drifts from the true
    # Engine gap under hint share pressure; the sweep self-calibrates.
    # Returns @{X;Y;Event} or $null. Pointer ends at the last swept point.
    $sweepLine = {
      param([int]$FX, [int]$FY, [int]$Vert, [string]$Token)
      $deltas = @(0)
      for ($dd = 3; $dd -le 30; $dd += 3) { $deltas += -$dd; $deltas += $dd }
      $st = @{ Count = (Get-MdLines $Owner.log).Count }
      foreach ($d in $deltas) {
        if ([int]$Vert -eq 1) { $qx = $FX + $d; $qy = $FY } else { $qx = $FX; $qy = $FY + $d }
        if ([int]$qx -lt [int]$work[0] -or [int]$qx -ge ([int]$work[0] + [int]$work[2]) -or [int]$qy -lt [int]$work[1] -or [int]$qy -ge ([int]$work[1] + [int]$work[3])) { continue }
        & $moveAbs $qx $qy "sweep"
        Start-Sleep -Milliseconds 150
        $lines = Get-MdLines $Owner.log
        for ($li = [int]$st.Count; $li -lt $lines.Count; $li++) {
          if ("$($lines[$li])".Trim() -eq "") { continue }
          $ev = ($lines[$li] | ConvertFrom-Json)
          if ("$($ev.event)" -eq "drag-preview" -and "$($ev.window)" -ceq $Token -and "$($ev.outcome)" -in @("shown", "redrew", "moved") -and "$($ev.hover_prior)" -like "group-edge:*") {
            $st.Count = $lines.Count
            return @{ X = $qx; Y = $qy; Event = $ev }
          }
        }
        $st.Count = $lines.Count
      }
      return $null
    }
    & $moveAbs ([int]$client[0]) ([int]$client[1]) "pre-move"
    Start-Sleep -Milliseconds 250
    Send-MdWinDown "sticky-winhold"
    if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { & $releaseAll; Fail-Md "sticky button-down rejected" }
    Start-Sleep -Milliseconds 400
    foreach ($c in $cands) {
      # Sweep across +-30px around the computed strip point first (level
      # 1), then the other level the same way: the first group-edge
      # resolution wins its strip. Strips drift from true Engine gaps
      # under hint pressure; the sweep self-calibrates to the live gap.
      $hit = & $sweepLine ([int]$c.X1) ([int]$c.Y1) ([int]$c.Vert) $moverToken
      $lvl = 1
      if ($null -eq $hit) {
        $hit = & $sweepLine ([int]$c.X2) ([int]$c.Y2) ([int]$c.Vert) $moverToken
        $lvl = 2
      }
      if ($null -eq $hit) { continue }
      # Anchor hold at the hit point, then strict carrier proof (change-only
      # logging suppresses repeats; the proof reads carrier + last line).
      Start-Sleep -Milliseconds 400
      & $assertFrozen
      $full1 = $null
      try { $full1 = Test-MdPreviewMidHold $Owner.ownerCopy $Owner.log $mark $moverToken ([long]$mover.hwnd) "sticky-cand" $null } catch { & $checkInfra; continue }
      if ("$($full1.Prior)" -notlike "group-edge:*") {
        Rec-Md "sticky-cand-miss" @{ prior = "$($full1.Prior)"; leg = 1 }
        continue
      }
      # Leg 2: same across-coordinate as the hit, other level line (38px
      # apart: at most one leg sits outside the 32px normal zone, so
      # agreement proves the sticky extension, not just repetition).
      if ([int]$c.Vert -eq 1) {
        if ($lvl -eq 1) { $p2x = [int]$hit.X; $p2y = [int]$c.Y2 } else { $p2x = [int]$hit.X; $p2y = [int]$c.Y1 }
      } else {
        if ($lvl -eq 1) { $p2x = [int]$c.X2; $p2y = [int]$hit.Y } else { $p2x = [int]$c.X1; $p2y = [int]$hit.Y }
      }
      if ([int]$p2x -lt [int]$work[0] -or [int]$p2x -ge ([int]$work[0] + [int]$work[2]) -or [int]$p2y -lt [int]$work[1] -or [int]$p2y -ge ([int]$work[1] + [int]$work[3])) {
        Rec-Md "sticky-cand-miss" @{ leg = 2; reason = "leg2-outside" }
        continue
      }
      & $moveAbs $p2x $p2y "cand-leg2"
      Start-Sleep -Milliseconds 600
      & $assertFrozen
      $full2 = $null
      try { $full2 = Test-MdPreviewMidHold $Owner.ownerCopy $Owner.log $mark $moverToken ([long]$mover.hwnd) "sticky-cand2" $null } catch {
        & $checkInfra
        Rec-Md "sticky-cand-miss" @{ leg = 2 }
        continue
      }
      if ((($full2.Rect -join ",") -cne ($full1.Rect -join ",")) -or ("$($full2.Prior)" -cne "$($full1.Prior)")) {
        Rec-Md "sticky-cand-miss" @{ leg = 2; rect = ($full2.Rect -join ","); prior = "$($full2.Prior)" }
        continue
      }
      # Strict final proof at the sticky point (flags, z-order, foreground,
      # Engine equality) plus the mid-hold screenshot: aborts on product
      # violation, so systematic failures are never masked as strip misses.
      $null = Test-MdPreviewMidHold $Owner.ownerCopy $Owner.log $mark $moverToken ([long]$mover.hwnd) "sticky-leg2" $releaseAll 0 $ProofDir "sticky-preview-mid"
      $win = @{ Mover = $mover; Token = $moverToken; Mark = $mark; PreMap = $preMap; Rect = $full2.Rect; Prior = "$($full2.Prior)"; Tick = [int]$full2.Tick; Frames = $preFrames }
      Rec-Md "sticky-legs" @{ rect = ($full2.Rect -join ","); prior = "$($full2.Prior)"; sticky = $true; mover = "$($mover.hwnd)" }
      break
    }
    if ($null -ne $win) { break }
    # This mover found nothing: glide home for a zero journey (no plan),
    # release fully, and let the next mover try with a fresh hold.
    & $moveAbs ([int]$client[0]) ([int]$client[1]) "mover-home"
    Start-Sleep -Milliseconds 300
    if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "sticky home button-up rejected" }
    Start-Sleep -Milliseconds 500
    Send-MdWinUp "sticky-mover-release"
    Start-Sleep -Milliseconds 500
  }
  } catch {
    & $releaseAll
    throw
  }
  if ($null -eq $win) { Fail-Md "sticky no mover/strip resolved a sticky group edge" }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { & $releaseAll; Fail-Md "sticky button-up rejected" }
  Start-Sleep -Milliseconds 600
  Assert-MdButtonReleased "sticky-release"
  Send-MdWinUp "sticky-winrelease"
  Start-Sleep -Milliseconds 600
  $got = Wait-MdGesture $Owner.log ([int]$win.Mark) @("drag-drop-applied") 25 "sticky"
  if ("$($got.event.producer)" -ne "windrag") { Fail-Md "Sticky producer $($got.event.producer) != windrag" }
  Wait-MdPreviewHidden $Owner.ownerCopy "sticky"
  $after = Get-MdEvents $Owner.log ([int]$win.Mark)
  $snap = Get-MdPlanSnapshot $after.events
  if ($null -eq $snap) { Fail-Md "Sticky no plan snapshot" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $null = Test-MdFramesMatchPlan $snap.detail $postFrames "sticky-plan"
  $postMap = Resolve-MdTokenMap $snap.detail $Managed "sticky"
  foreach ($k in @($win.PreMap.Keys)) {
    if ([uint64]$postMap[$k] -ne [uint64]$win.PreMap[$k]) { Fail-Md "Sticky token $k remapped ($($win.PreMap[$k]) -> $($postMap[$k]))" }
  }
  $moverIdx = -1
  for ($i = 0; $i -lt $Managed.Count; $i++) { if ([uint64]$Managed[$i].hwnd -eq [uint64]$win.Mover.hwnd) { $moverIdx = $i } }
  Assert-MdPreviewAgreement $Owner.log ([int]$win.Mark) "$($win.Token)" ([int]$got.event.tick) "$($got.event.hover_prior)" $postFrames[$moverIdx] "Sticky"
  if ("$($got.event.hover_prior)" -cne "$($win.Prior)") { Fail-Md "Sticky drop prior $($got.event.hover_prior) != leg prior $($win.Prior)" }
  if ("$($got.event.hover_prior)" -eq "none") { Fail-Md "Sticky drop carried no prior (want group-edge)" }
  $blendBaseS = Join-Path $ProofDir "shot-sticky-before.png"
  $blendMidS = Join-Path $ProofDir "shot-sticky-preview-mid.png"
  if ((Test-Path -LiteralPath $blendBaseS) -and (Test-Path -LiteralPath $blendMidS)) {
    $null = Test-MdPreviewBlend $blendBaseS $blendMidS $win.Rect "sticky"
  } else {
    Rec-Md "sticky-preview-blend" @{ skipped = "shots-unavailable" }
  }
  Assert-MdDropStable $Owner $Managed $snap "sticky"
  Save-MdShot $ProofDir "sticky-after" | Out-Null
  Test-MdStartQuiet $Owner.log ([int]$win.Mark) "sticky"
  Rec-Md "Sticky" @{ outcome = "drag-drop-applied"; producer = "windrag"; prior = "$($got.event.hover_prior)"; tick = $snap.tick }
}

function Invoke-MdPreviewCrashStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed, [int]$OwnerPid) {
  # Bounded exact-owner crash while the preview is VISIBLE (project
  # producer): hold a Win+Left journey to a far-end target, prove the
  # carrier visible with an Engine-resolved rect, screenshot it, then force
  # the exact verified owner down. Process exit must remove every project
  # window (preview/border/underlay HWNDs zero), keep the hosting terminal
  # alive, and leave borrowed geometry untouched (no drop ever settled).
  # The shared finally legs still run restore/ledger/borrowed/overlay
  # audits afterward, even when this row fails (input is released first).
  $mover = $Apps[2]
  Set-MdForeground ([long]$mover.hwnd) "crash-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "crash-before" | Out-Null
  $preMap = Resolve-MdTokenMap ((Get-MdPlanSnapshot (Get-MdEvents $Owner.log 0).events).detail) $Managed "crash-pre"
  $moverToken = ""
  foreach ($k in @($preMap.Keys)) { if ([uint64]$preMap[$k] -eq [uint64]$mover.hwnd) { $moverToken = "$k" } }
  if ($moverToken -eq "") { Fail-Md "Crash mover token not in pre map" }
  $termPid = 0
  try { $termPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId } catch { $termPid = 0 }
  if ($termPid -le 0) { Fail-Md "Crash hosting terminal PID unreadable" }
  Rec-Md "crash-binding" @{ exe = "$($Owner.ownerCopy)"; pid = $ownerPid; creation = "$($Owner.ready.owner.process_creation)"; terminal = $termPid }
  $client = Get-MdClientPoint ([long]$mover.hwnd) "crash"
  $far = Get-MdFarEndTarget $Managed ([long]$mover.hwnd) "Crash"
  $releaseAll = {
    [void][MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0)
    [void][MouseDragNative]::SendKey($MD_VK_LWIN, $true)
  }
  $screen = Get-MdVirtualScreen
  $fx = ConvertTo-MdAbsolute ([int]$client[0]) ([int]$screen[0]) ([int]$screen[2])
  $fy = ConvertTo-MdAbsolute ([int]$client[1]) ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $fx, $fy) -ne 1) { Fail-Md "crash pre-move rejected" }
  Start-Sleep -Milliseconds 250
  Send-MdWinDown "crash-winhold"
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "crash button-down rejected" }
  Start-Sleep -Milliseconds 400
  try {
    for ($i = 1; $i -le 12; $i++) {
      $x = [int]$client[0] + [int](([int]$far.X - [int]$client[0]) * $i / 12)
      $y = [int]$client[1] + [int](([int]$far.Y - [int]$client[1]) * $i / 12)
      $nx = ConvertTo-MdAbsolute $x ([int]$screen[0]) ([int]$screen[2])
      $ny = ConvertTo-MdAbsolute $y ([int]$screen[1]) ([int]$screen[3])
      if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "crash step $i rejected" }
      Start-Sleep -Milliseconds 60
    }
    Start-Sleep -Milliseconds 600
    $mid = Test-MdPreviewMidHold $Owner.ownerCopy $Owner.log $mark $moverToken ([long]$mover.hwnd) "crash" $releaseAll
    if ($null -eq $mid) { throw "crash no preview to kill under" }
    Save-MdShot $ProofDir "crash-preview-visible" | Out-Null
    Rec-Md "crash-preview-visible" @{ rect = ($mid.Rect -join ","); prior = "$($mid.Prior)" }
    $kill = Invoke-MdNative $Owner.ownerCopy @("emergency-stop") | ConvertFrom-Json
    if (-not $kill.owner_exited) { Fail-Md "crash emergency-stop no exit" }
    Rec-Md "crash-kill" @{ pid = $ownerPid; owner_exited = $true }
    $script:mdOwnerDead = $true
  } catch {
    & $releaseAll
    throw
  }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "crash button-up rejected" }
  Start-Sleep -Milliseconds 600
  Assert-MdButtonReleased "crash-release"
  Send-MdWinUp "crash-winrelease"
  Start-Sleep -Milliseconds 800
  Save-MdShot $ProofDir "crash-after-kill" | Out-Null
  # Forced-loss audit: the exact owner process is gone (same exe/PID that
  # was bound before the kill; hosting terminal untouched), no project
  # window of any class survives under any PID, borrowed geometry is
  # untouched (no settle ever ran), and the terminal tree is alive.
  if ($null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) { Fail-Md "crash owner pid $ownerPid still alive" }
  if (@(Get-Process -Name "tiler-windows" -ErrorAction SilentlyContinue).Count -ne 0) { Fail-Md "crash tiler-windows actors remain" }
  [MouseDragNative]::EnsurePMv2()
  $stray = [System.Collections.ArrayList]@()
  $script:mdStray = $stray
  $cb = {
    param([IntPtr]$h, [IntPtr]$l)
    try {
      $cls = [MouseDragNative]::ClassOf($h.ToInt64())
      if ($cls -eq "OmniTilerActiveBorder" -or $cls -eq "OmniTilerGroupUnderlay" -or $cls -eq "OmniTilerDropPreview") {
        $null = $script:mdStray.Add($h.ToInt64())
      }
    } catch {}
    return $true
  }
  $null = [MouseDragNative]::EnumWindows($cb, [IntPtr]::Zero)
  if (@($stray).Count -ne 0) { Fail-Md "crash project overlay HWNDs survive: $($stray -join ',')" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "crash frame $i changed without a drop" }
  }
  if ($null -eq (Get-Process -Id $termPid -ErrorAction SilentlyContinue)) { Fail-Md "crash hosting terminal pid $termPid gone" }
  Rec-Md "Crash" @{ owner_gone = $true; overlays = 0; borrowed_intact = $true; terminal = $termPid }
}

function Invoke-MdWinDropStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {

  # Applied project mover: Win+Left client drag reorganises through the
  # shared Engine drop with producer `windrag`. Identity-specific token
  # mapping is fixed BEFORE/DURING/AFTER (no re-resolve of the wrong
  # subject). The drop target is the far visual end (never the mover's
  # current tree neighbour, which would be a no-op snap-back). The mover is
  # focused, so the mid-hold underlay probe reads back the projected union
  # (A/B move arm; unfocused holds stay C-parked and never query).
  $mover = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "windrop-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $moverIdx = -1
  for ($i = 0; $i -lt $Managed.Count; $i++) { if ([uint64]$Managed[$i].hwnd -eq [uint64]$mover.hwnd) { $moverIdx = $i } }
  if ($moverIdx -lt 0) { Fail-Md "WinDrop mover not in managed set" }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "windrop-before" | Out-Null
  Wait-MdWindragOrigins $Owner.log 0 $Managed.Count 30 "windrop"
  $client = Get-MdClientPoint ([long]$mover.hwnd) "windrop"
  $far = Get-MdFarEndTarget $Managed ([long]$mover.hwnd) "WinDrop"
  $targetX = [int]$far.X
  $targetY = [int]$far.Y
  $zone = "$($far.Zone)"
  $domain = $Start.work
  if ($targetX -lt [int]$domain[0] -or $targetX -ge ([int]$domain[0] + [int]$domain[2]) -or $targetY -lt [int]$domain[1] -or $targetY -ge ([int]$domain[1] + [int]$domain[3])) {
    Fail-Md "WinDrop edge target outside source work area"
  }
  $preMap = Resolve-MdTokenMap ((Get-MdPlanSnapshot (Get-MdEvents $Owner.log 0).events).detail) $Managed "windrop-pre"
  $moverToken = ""
  foreach ($k in @($preMap.Keys)) { if ([uint64]$preMap[$k] -eq [uint64]$mover.hwnd) { $moverToken = "$k" } }
  if ($moverToken -eq "") { Fail-Md "WinDrop mover token not in pre map" }
  $siblings = @($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd })
  Send-MdWinDrag ([int]$client[0]) ([int]$client[1]) $targetX $targetY 12 ([long]$mover.hwnd) "windrop" $Owner.ownerCopy $siblings $Owner.log $mark $moverToken 0 $true $ProofDir "windrop-preview-mid"
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-applied") 25 "windrop"
  if ("$($got.event.producer)" -ne "windrag") { Fail-Md "WinDrop producer $($got.event.producer) != windrag" }
  Wait-MdPreviewHidden $Owner.ownerCopy "windrop"
  $after = Get-MdEvents $Owner.log $mark
  $snap = Get-MdPlanSnapshot $after.events
  if ($null -eq $snap) { Fail-Md "WinDrop no plan snapshot" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $null = Test-MdFramesMatchPlan $snap.detail $postFrames "windrop-plan"
  $postMap = Resolve-MdTokenMap $snap.detail $Managed "windrop"
  foreach ($k in @($preMap.Keys)) {
    if ([uint64]$postMap[$k] -ne [uint64]$preMap[$k]) { Fail-Md "WinDrop token $k remapped ($($preMap[$k]) -> $($postMap[$k]))" }
  }
  $hints = Get-MdMinHintsDetail $Owner.log $mark
  Assert-MdNoOverconstrained $snap $hints "windrop"
  $moved = "$($preFrames[$moverIdx] -join ',')" -cne "$($postFrames[$moverIdx] -join ',')"
  if (-not $moved) { Fail-Md "WinDrop mover topology unchanged" }
  Assert-MdPreviewAgreement $Owner.log $mark $moverToken ([int]$got.event.tick) "$($got.event.hover_prior)" $postFrames[$moverIdx] "WinDrop"
  if ("$($got.event.hover_prior)" -cne "none") { Fail-Md "WinDrop leaf journey carried prior $($got.event.hover_prior) (want none)" }
  $blendBase = Join-Path $ProofDir "shot-windrop-before.png"
  $blendMid = Join-Path $ProofDir "shot-windrop-preview-mid.png"
  $blendEv = Get-MdPreviewShownEvent $Owner.log $mark $moverToken ([int]$got.event.tick)
  if ($null -ne $blendEv -and (Test-Path -LiteralPath $blendBase) -and (Test-Path -LiteralPath $blendMid)) {
    $blendRect = @([int]$blendEv.rect[0], [int]$blendEv.rect[1], [int]$blendEv.rect[2], [int]$blendEv.rect[3])
    $null = Test-MdPreviewBlend $blendBase $blendMid $blendRect "windrop"
  } else {
    Rec-Md "windrop-preview-blend" @{ skipped = "shots-unavailable" }
  }
  Assert-MdDropStable $Owner $Managed $snap "windrop"
  Save-MdShot $ProofDir "windrop-after" | Out-Null
  Test-MdStartQuiet $Owner.log $mark "windrop"
  Rec-Md "WinDrop" @{ outcome = "drag-drop-applied"; producer = "windrag"; tick = $snap.tick; zone = $zone }
}

function Invoke-MdWinFocusStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  # Unfocused mover: Win+Left binds the tiled subject without prior focus;
  # release activates it through the safe focus authority (same gesture
  # mover as KDE). Foreground readback on the mover is the proof.
  $mover = $Apps[2]
  $other = $Apps[1]
  Set-MdForeground ([long]$other.hwnd) "winfocus-other"
  Start-Sleep -Seconds 2
  $fgPre = [MouseDragNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgPre -ne [uint64]$other.hwnd) { Fail-Md "WinFocus setup foreground != other app" }
  $mark = (Get-MdLines $Owner.log).Count
  $client = Get-MdClientPoint ([long]$mover.hwnd) "winfocus"
  $far = Get-MdFarEndTarget $Managed ([long]$mover.hwnd) "WinFocus"
  $targetX = [int]$far.X
  $targetY = [int]$far.Y
  $zoneF = "$($far.Zone)"
  $preMapF = Resolve-MdTokenMap ((Get-MdPlanSnapshot (Get-MdEvents $Owner.log 0).events).detail) $Managed "winfocus-pre"
  $moverTokenF = ""
  foreach ($k in @($preMapF.Keys)) { if ([uint64]$preMapF[$k] -eq [uint64]$mover.hwnd) { $moverTokenF = "$k" } }
  if ($moverTokenF -eq "") { Fail-Md "WinFocus mover token not in pre map" }
  $siblings = @($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd })
  Send-MdWinDrag ([int]$client[0]) ([int]$client[1]) $targetX $targetY 12 ([long]$mover.hwnd) "winfocus" $Owner.ownerCopy $siblings $Owner.log $mark $moverTokenF ([long]$other.hwnd) $false
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-applied") 25 "winfocus"
  if ("$($got.event.producer)" -ne "windrag") { Fail-Md "WinFocus producer $($got.event.producer) != windrag" }
  Wait-MdPreviewHidden $Owner.ownerCopy "winfocus"
  $focusLines = @((Get-MdEvents $Owner.log $mark).events | Where-Object { "$($_.event)" -eq "windrag-focus" -and "$($_.outcome)" -eq "focus-ok" })
  if (@($focusLines).Count -eq 0) { Fail-Md "WinFocus no windrag-focus focus-ok evidence" }
  $fgPost = [MouseDragNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgPost -ne [uint64]$mover.hwnd) { Fail-Md "WinFocus mover not foreground after drop (got $fgPost)" }
  $after = Get-MdEvents $Owner.log $mark
  $snap = Get-MdPlanSnapshot $after.events
  if ($null -eq $snap) { Fail-Md "WinFocus no plan snapshot" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $null = Test-MdFramesMatchPlan $snap.detail $postFrames "winfocus-plan"
  $null = Resolve-MdTokenMap $snap.detail $Managed "winfocus"
  $moverIdxF = -1
  for ($i = 0; $i -lt $Managed.Count; $i++) { if ([uint64]$Managed[$i].hwnd -eq [uint64]$mover.hwnd) { $moverIdxF = $i } }
  Assert-MdPreviewAgreement $Owner.log $mark $moverTokenF ([int]$got.event.tick) "$($got.event.hover_prior)" $postFrames[$moverIdxF] "WinFocus"
  if ("$($got.event.hover_prior)" -cne "none") { Fail-Md "WinFocus leaf journey carried prior $($got.event.hover_prior) (want none)" }
  Test-MdStartQuiet $Owner.log $mark "winfocus"
  Rec-Md "WinFocus" @{ outcome = "drag-drop-applied"; producer = "windrag"; activated = $true; underlay = "not-queried-unfocused-parked"; zone = $zoneF }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "winfocus"
}

function Invoke-MdWinCancelStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  # Injected Esc cancels the tracked project journey (the product keyboard
  # edge stays unset for injected input; the dedicated windrag cancel edge
  # carries it with no command admitted). Source geometry retained, no plan.
  $mover = $Apps[0]
  Set-MdForeground ([long]$mover.hwnd) "wincancel-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $client = Get-MdClientPoint ([long]$mover.hwnd) "wincancel"
  $screen = Get-MdVirtualScreen
  $nx = ConvertTo-MdAbsolute ([int]$client[0]) ([int]$screen[0]) ([int]$screen[2])
  $ny = ConvertTo-MdAbsolute ([int]$client[1]) ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "wincancel pre-move rejected" }
  Start-Sleep -Milliseconds 250
  Send-MdWinDown "wincancel-winhold"
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "wincancel button-down rejected" }
  Start-Sleep -Milliseconds 400
  Send-MdMouseMove (([int]$client[0]) + 120) (([int]$client[1]) + 60)
  Start-Sleep -Milliseconds 300
  if ([MouseDragNative]::SendKey($MD_VK_ESC, $false) -ne 1) { Fail-Md "wincancel esc down rejected" }
  Start-Sleep -Milliseconds 200
  if ([MouseDragNative]::SendKey($MD_VK_ESC, $true) -ne 1) { Fail-Md "wincancel esc up rejected" }
  Start-Sleep -Milliseconds 300
  # Logical-cancel immediacy: the dedicated Esc edge latches on the owner
  # pump and hides the preview while the button is still held (never waits
  # for mouse-up on the stationary gesture).
  try {
    $escInsp = Invoke-MdNative $Owner.ownerCopy @("preview-inspect") | ConvertFrom-Json
  } catch { Fail-Md "wincancel preview-inspect failed: $($_.Exception.Message)" }
  $escVis = @($escInsp.overlays | Where-Object { $_.visible -eq $true })
  if ($escVis.Count -ne 0) { Fail-Md "wincancel preview visible while Esc-held (must hide before up)" }
  Rec-Md "wincancel-preview-esc-hidden" @{ before_up = $true }
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "wincancel button-up rejected" }
  Start-Sleep -Milliseconds 600
  Assert-MdButtonReleased "wincancel"
  Send-MdWinUp "wincancel-winrelease"
  Start-Sleep -Milliseconds 800
  $got = Wait-MdGesture $Owner.log $mark @("gesture-cancelled-esc") 25 "wincancel"
  if ("$($got.event.producer)" -ne "windrag") { Fail-Md "WinCancel producer $($got.event.producer) != windrag" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "wincancel frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "wincancel planned an Engine mutation"
    }
  }
  Test-MdStartQuiet $Owner.log $mark "wincancel"
  Rec-Md "WinCancel" @{ outcome = "gesture-cancelled-esc"; producer = "windrag"; restored = $true; injected_esc = "windrag-edge-no-command" }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "wincancel"
}

function Invoke-MdWinZeroStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  # Press/release without a pointer journey: no plan, no geometry change.
  # Unlike the native zero-click (which may emit no START at all), the
  # project down always arms, so an explicit no-change settle is expected.
  $mover = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "winzero-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $client = Get-MdClientPoint ([long]$mover.hwnd) "winzero"
  $screen = Get-MdVirtualScreen
  $nx = ConvertTo-MdAbsolute ([int]$client[0]) ([int]$screen[0]) ([int]$screen[2])
  $ny = ConvertTo-MdAbsolute ([int]$client[1]) ([int]$screen[1]) ([int]$screen[3])
  if ([MouseDragNative]::SendMouse($MD_MOUSE_MOVE -bor $MD_MOUSE_ABS, $nx, $ny) -ne 1) { Fail-Md "winzero pre-move rejected" }
  Start-Sleep -Milliseconds 250
  Send-MdWinDown "winzero-winhold"
  if ([MouseDragNative]::SendMouse($MD_MOUSE_DOWN, 0, 0) -ne 1) { Fail-Md "winzero button-down rejected" }
  Start-Sleep -Milliseconds 400
  if ([MouseDragNative]::SendMouse($MD_MOUSE_UP, 0, 0) -ne 1) { Fail-Md "winzero button-up rejected" }
  Start-Sleep -Milliseconds 600
  Assert-MdButtonReleased "winzero"
  Send-MdWinUp "winzero-winrelease"
  Start-Sleep -Milliseconds 800
  $got = Wait-MdGesture $Owner.log $mark @("gesture-no-change") 25 "winzero"
  if ("$($got.event.producer)" -ne "windrag") { Fail-Md "WinZero producer $($got.event.producer) != windrag" }
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "winzero frame $i changed" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "winzero planned an Engine mutation"
    }
  }
  Test-MdStartQuiet $Owner.log $mark "winzero"
  Rec-Md "WinZero" @{ outcome = "gesture-no-change"; producer = "windrag"; restored = $true }
  Assert-MdPreviewHidden $Owner.ownerCopy $Owner.log $mark "" "winzero"
}

function Invoke-MdWinSelfStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  # Drop back onto the mover's own centre: self refuses with snap-back and
  # no transfer.
  $mover = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "winself-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $frame = Get-MdFrame ([long]$mover.hwnd)
  $selfX = [int]$frame[0] + [int]([int]$frame[2] / 2)
  $selfY = [int]$frame[1] + [int]([int]$frame[3] / 2)
  # Real journey (not a zero press): start offset inside the client area so
  # the pointer travels back onto the mover's own centre. A zero journey
  # would prove nothing about self-drop refusal.
  $startX = $selfX + 120; $startY = $selfY + 60
  if ($startX -ge ([int]$frame[0] + [int]$frame[2] - 8) -or $startY -ge ([int]$frame[1] + [int]$frame[3] - 8)) {
    $startX = $selfX - 120; $startY = $selfY - 60
  }
  [MouseDragNative]::EnsurePMv2()
  $pt = New-Object MouseDragNative+POINT
  $pt.x = $startX; $pt.y = $startY
  $hit = [MouseDragNative]::WindowFromPoint($pt).ToInt64()
  $root = $hit
  try { $root = (Get-MdRootHwnd $hit) } catch {}
  if ([uint64]$root -ne [uint64]$mover.hwnd) { Fail-Md "winself start point ($startX,$startY) covered (hit root $root != $($mover.hwnd))" }
  Send-MdWinDrag $startX $startY $selfX $selfY 12 ([long]$mover.hwnd) "winself" $Owner.ownerCopy (@($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd }))
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-refused") 25 "winself"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "winself frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "winself planned an Engine mutation"
    }
  }
  Test-MdStartQuiet $Owner.log $mark "winself"
  Rec-Md "WinSelf" @{ outcome = "$($got.event.outcome)"; producer = "windrag"; restored = $true }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "winself"
}

function Invoke-MdWinCentreStage($Owner, [string]$ProofDir, [array]$Apps, [array]$Managed) {
  # Drop the mover onto ANOTHER window's centre (centre-stack target):
  # refuses with snap-back, no transfer.
  $mover = $Apps[0]
  $target = $Apps[1]
  Set-MdForeground ([long]$mover.hwnd) "wincentre-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  $client = Get-MdClientPoint ([long]$mover.hwnd) "wincentre"
  $tframe = Get-MdFrame ([long]$target.hwnd)
  $cx = [int]$tframe[0] + [int]([int]$tframe[2] / 2)
  $cy = [int]$tframe[1] + [int]([int]$tframe[3] / 2)
  Send-MdWinDrag ([int]$client[0]) ([int]$client[1]) $cx $cy 12 ([long]$mover.hwnd) "wincentre" $Owner.ownerCopy (@($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd }))
  $got = Wait-MdGesture $Owner.log $mark @("drag-drop-refused", "gesture-no-change") 25 "wincentre"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "wincentre frame $i not restored" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "wincentre planned an Engine mutation"
    }
  }
  Test-MdStartQuiet $Owner.log $mark "wincentre"
  Rec-Md "WinCentre" @{ outcome = "$($got.event.outcome)"; producer = "windrag"; restored = $true; target = "other-centre" }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "wincentre"
}

function Invoke-MdWinOutsideStage($Owner, [string]$ProofDir, $Start, [array]$Apps, [array]$Managed) {
  # Release over the taskbar strip outside the source work area: same-output
  # fence refuses with snap-back, no transfer.
  $mover = $Apps[2]
  Set-MdForeground ([long]$mover.hwnd) "winoutside-focus"
  Start-Sleep -Seconds 2
  $preFrames = @(); foreach ($a in $Managed) { $preFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  $mark = (Get-MdLines $Owner.log).Count
  Save-MdShot $ProofDir "winoutside-before" | Out-Null
  $client = Get-MdClientPoint ([long]$mover.hwnd) "winoutside"
  $work = $Start.work; $full = $Start.full
  $targetX = [int]$work[0] + [int]([int]$work[2] / 2)
  $targetY = [int]$work[1] + [int]$work[3] + 10
  if ($targetY -ge ([int]$full[1] + [int]$full[3])) { Fail-Md "winoutside taskbar point outside full bounds (no normal taskbar?)" }
  Send-MdWinDrag ([int]$client[0]) ([int]$client[1]) $targetX $targetY 12 ([long]$mover.hwnd) "winoutside" $Owner.ownerCopy (@($Managed | Where-Object { [long]$_.hwnd -ne [long]$mover.hwnd }))
  $got = Wait-MdGesture $Owner.log $mark @("gesture-refused-cross-output", "drag-drop-refused", "gesture-no-change") 25 "winoutside"
  $postFrames = @(); foreach ($a in $Managed) { $postFrames += , (Get-MdFrame ([long]$a.hwnd)) }
  for ($i = 0; $i -lt $Managed.Count; $i++) {
    if ("$($preFrames[$i] -join ',')" -cne "$($postFrames[$i] -join ',')") { Fail-Md "winoutside frame $i moved" }
  }
  $after = Get-MdEvents $Owner.log $mark
  foreach ($e in $after.events) {
    if ("$($e.event)" -eq "gesture" -and "$($e.outcome)" -in @("drag-drop-applied", "pointer-resize-applied")) {
      Fail-Md "winoutside planned an Engine mutation"
    }
  }
  Save-MdShot $ProofDir "winoutside-after" | Out-Null
  Test-MdStartQuiet $Owner.log $mark "winoutside"
  Rec-Md "WinOutside" @{ outcome = "$($got.event.outcome)"; producer = "windrag"; restored = $true; outside = "taskbar" }
  Assert-MdPreviewSettledNow $Owner.ownerCopy "winoutside"
}

function Invoke-MouseDragLive {
  if ($RunDir -ne "") { Fail-Md "refuse: -Live always creates a new run dir; -RunDir is for -Stop only" }
  Install-MdNative
  $proofDir = New-MdRunDir $Repo
  $origApps = Get-MdOriginalSnapshot
  # Preflight: normal desktop with a real taskbar, clean SPI, no stuck input.
  [MouseDragNative]::EnsurePMv2()
  $tray = [MouseDragNative]::FindWindowW("Shell_TrayWnd", $null)
  if ($tray -eq [IntPtr]::Zero -or -not [MouseDragNative]::IsWindowVisible($tray)) { Fail-Md "preflight: no normal desktop taskbar" }
  if (([int][MouseDragNative]::GetAsyncKeyState(1) -band 0x8000) -ne 0) { Fail-Md "preflight: left button stuck down" }
  # A Start menu left open by a prior run's injected Win-up steals foreground
  # and breaks focus readbacks: dismiss once up front (injected Esc never
  # touches product tracking).
  Send-MdDismissStart "preflight"
  $spi = Read-MdSpi
  if ([int]$spi.arranging_raw -ne 1) { Fail-Md "preflight arranging raw $($spi.arranging_raw) != 1" }
  if ([int]$spi.pen_raw -ne 35) { Fail-Md "preflight pen raw $($spi.pen_raw) != 35" }
  Rec-Md "preflight" @{ taskbar = "visible"; arranging = $spi.arranging_raw; pen = $spi.pen_raw }
  $owner = $null; $appN = $null; $appC = $null; $appP = $null
  $borrowedSnaps = @()
  $ownerPid = 0
  # Verdict inputs: the stage error (empty on success) plus every cleanup
  # leg failure. The single report below is written AFTER all cleanup ran,
  # so a success report can never hide a cleanup error.
  $stageError = ""
  $cleanupErrors = @()
  $script:mdOwnerDead = $false
  try {
    # Owner copy first so eligibility (product inventory/children, no titles)
    # binds BEFORE the owner starts: borrowed windows snapshot true baseline.
    $copy = New-MdOwnerCopy $proofDir
    $elig = Get-MdEligibleApps $copy.ownerCopy "preflight"
    # Snapshot EVERY pre-existing eligible window (all Notepad tabs, Paint,
    # hosts): extras minimize pre-start and restore after, so all of them
    # restore show+geometry in finally.
    foreach ($w in @($elig)) {
      $s = Get-MdAppSnapshot ([long]$w.hwnd) "borrow-pre"
      $borrowedSnaps += $s
    }
    $pickN = @($elig | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "notepad.exe" }) | Select-Object -First 1
    $pickP = @($elig | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "mspaint.exe" }) | Select-Object -First 1
    $pickC = @($elig | Where-Object { "$($_.exe)".ToLowerInvariant() -eq "applicationframehost.exe" }) | Select-Object -First 1
    if ($null -ne $pickN) {
      $snap = @($borrowedSnaps | Where-Object { [uint64]$_.hwnd -eq [uint64]$pickN.hwnd }) | Select-Object -First 1
      $appN = @{ hwnd = [long]$pickN.hwnd; pid = [int]$pickN.pid; creation = "$($snap.start)"; exe = "notepad.exe"; source = "borrowed" }
    }
    if ($null -ne $pickP) {
      $snap = @($borrowedSnaps | Where-Object { [uint64]$_.hwnd -eq [uint64]$pickP.hwnd }) | Select-Object -First 1
      $appP = @{ hwnd = [long]$pickP.hwnd; pid = [int]$pickP.pid; creation = "$($snap.start)"; exe = "mspaint.exe"; source = "borrowed" }
    }
    if ($null -ne $pickC) {
      $snap = @($borrowedSnaps | Where-Object { [uint64]$_.hwnd -eq [uint64]$pickC.hwnd }) | Select-Object -First 1
      $appC = @{ hwnd = [long]$pickC.hwnd; pid = [int]$pickC.pid; creation = "$($snap.start)"; exe = "ApplicationFrameHost.exe"; source = "borrowed" }
    }
    # Owner starts inside the try so any start failure still runs the
    # stop/restore/ledger/overlay cleanup below. Missing kinds are created
    # BEFORE the start (HWND-bound, never PID-delta for hosted Calculator);
    # borrowed windows are never opened, never closed.
    if ($null -eq $appN) {
      $beforePids = @(Get-Process -Name "notepad" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
      $appN = Open-MdApp "notepad.exe" $beforePids "notepad"
    }
    if ($null -eq $appC) {
      $invNow = Invoke-MdNative $copy.ownerCopy @("inventory") | ConvertFrom-Json
      $beforeHwnds = @($invNow.windows | ForEach-Object { [uint64]$_.hwnd })
      $appC = Open-MdCalculator $beforeHwnds $copy.ownerCopy
    }
    if ($null -eq $appP) {
      $beforePids = @(Get-Process -Name "mspaint" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
      $appP = Open-MdApp "mspaint.exe" $beforePids "paint"
    }
    $apps = @($appN, $appC, $appP)
    Rec-Md "apps" @{ notepad = @{ pid = $appN.pid; hwnd = $appN.hwnd; source = "$($appN.source)" }; calculator = @{ pid = $appC.pid; hwnd = $appC.hwnd; source = "$($appC.source)" }; paint = @{ pid = $appP.pid; hwnd = $appP.hwnd; source = "$($appP.source)" } }
    Save-MdShot $proofDir "pre-fixture" | Out-Null
    # Exact-3 title fixture, BEFORE the owner starts: minimize approved
    # extras (extra Notepad tabs, non-Calculator hosts) so never-visible
    # extras are never admitted and stay out of the Engine plan (post-start
    # minimization leaves retained membership behind). Snapshots already in
    # $borrowedSnaps restore show+geometry in finally.
    $eligPre = Get-MdEligibleApps $copy.ownerCopy "fixture-pre"
    $chosenHwnds = @($apps | ForEach-Object { [uint64]$_.hwnd })
    $minimizedExtras = Minimize-MdExtras $eligPre $chosenHwnds "fixture"
    $started = Start-MdOwnerFromCopy $copy.ownerCopy $proofDir $OwnerSeconds
    $owner = @{ ownerCopy = $copy.ownerCopy; hash = $copy.hash; commit = $copy.commit; ready = $started.ready; log = $started.log }
    Rec-Md "owner" @{ hash = $owner.hash; commit = $owner.commit; log = $owner.log }
    $ownerPid = [int]$owner.ready.owner.pid
    $machine = @{ ownerCopy = $owner.ownerCopy; ownerFrozen = $owner.ready.owner; scope = $MD_SCOPE_ARGS; log = $owner.log }
    $machine | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $proofDir "machine.json")
    $start = Get-MdTileStart $owner.log "mouse-drag"
    Rec-Md "tile-start" @{ work = ($start.work -join ","); full = ($start.full -join ",") }
    if ([int]$start.work[1] + [int]$start.work[3] -ge ([int]$start.full[1] + [int]$start.full[3])) {
      Fail-Md "preflight: no taskbar strip (work bottom covers full bottom)"
    }
    # Prearrange H[A,B,C] thirds of the source work area for a deterministic
    # adopt start; the Engine retiles on adopt either way. Extras are already
    # minimized (pre-start), so membership is unaffected by moves here.
    Set-MdArrangeH $apps $start.work "fixture"
    Save-MdShot $proofDir "arranged" | Out-Null
    # Managed must now be exactly the chosen triple; anything else aborts the
    # fixture instead of risking a false refused-success.
    $eligPost = Get-MdEligibleApps $owner.ownerCopy "managed"
    $managed = @()
    foreach ($w in @($eligPost)) {
      $managed += @{ hwnd = [long]$w.hwnd; pid = [int]$w.pid }
    }
    foreach ($a in @($apps)) {
      if (@($managed | Where-Object { [uint64]$_.hwnd -eq [uint64]$a.hwnd }).Count -eq 0) {
        Fail-Md "managed set missing bound app hwnd $($a.hwnd)"
      }
    }
    if ($managed.Count -ne 3) { Fail-Md "fixture managed $($managed.Count) != 3 (extras not minimized?)" }
    Rec-Md "managed" @{ count = $managed.Count; movers = 3; extras_minimized = @($minimizedExtras).Count }
    $mark0 = (Get-MdLines $owner.log).Count
    $conv = Wait-MdConverged $owner.log $mark0 $managed 30 "adopt"
    $null = Resolve-MdTokenMap $conv.detail $managed "adopt"
    $hints0 = Get-MdMinHintsDetail $owner.log $mark0
    Assert-MdNoOverconstrained $conv $hints0 "adopt"
    Rec-Md "adopted" @{ tick = $conv.tick; managed = $managed.Count }
    Save-MdShot $proofDir "adopted" | Out-Null
    $runTitle = ($Stage -eq "All" -or $Stage -eq "TitleDrag" -or $Stage -eq "WinAll")
    $runCancel = ($Stage -eq "All" -or $Stage -eq "Cancel" -or $Stage -eq "WinAll")
    $runZero = ($Stage -eq "All" -or $Stage -eq "Zero" -or $Stage -eq "WinAll")
    $runSelf = ($Stage -eq "All" -or $Stage -eq "SelfCentre" -or $Stage -eq "WinAll")
    $runCentre = ($Stage -eq "All" -or $Stage -eq "SelfCentre" -or $Stage -eq "WinAll")
    $runSame = ($Stage -eq "All" -or $Stage -eq "SameOutput" -or $Stage -eq "WinAll")
    $runWin = ($Stage -eq "WinDrag" -or $Stage -eq "WinAll")
    $runProbe = ($Stage -eq "PreviewProbe")
    $runCrash = ($Stage -eq "PreviewCrash")
    if ($runTitle) { Invoke-MdTitleDropStage $owner $proofDir $start $apps $managed }
    if ($runCancel) { Invoke-MdCancelStage $owner $proofDir $apps $managed }
    if ($runZero) { Invoke-MdZeroStage $owner $proofDir $apps $managed }
    if ($runSelf) { Invoke-MdSelfStage $owner $proofDir $apps $managed }
    if ($runCentre) { Invoke-MdCentreStage $owner $proofDir $apps $managed }
    if ($runSame) { Invoke-MdOutsideStage $owner $proofDir $start $apps $managed }
    if ($runWin) {
      if ($Stage -eq "WinAll") { Invoke-MdReadoptStage $owner $proofDir $start $apps $managed }
      Invoke-MdWinDropStage $owner $proofDir $start $apps $managed
      Invoke-MdWinFocusStage $owner $proofDir $start $apps $managed
      Invoke-MdWinCancelStage $owner $proofDir $apps $managed
      Invoke-MdWinZeroStage $owner $proofDir $apps $managed
      Invoke-MdWinSelfStage $owner $proofDir $apps $managed
      Invoke-MdWinCentreStage $owner $proofDir $apps $managed
      Invoke-MdWinOutsideStage $owner $proofDir $start $apps $managed
      Invoke-MdTitleDropStage $owner $proofDir $start $apps $managed
      Rec-Md "WinCaptionRegression" @{ outcome = "drag-drop-applied"; producer = "native" }
    }
    if ($runProbe) {
      # Sticky group-edge journey only. A genuine native resize-hold row
      # was stopped per the two-approach rule: a synthetic modal sizing
      # loop never engages (verified border grab, delivered input, no
      # WinEvents; ownerless throwaway fails identically from child
      # coverage). The frame gate itself is covered by the
      # frame_gate_matches_either_lane_and_rejects_resizes unit test plus
      # a user-owned physical resize-hold check; a dedicated
      # input-mechanics investigation may re-attempt it later.
      Invoke-MdPreviewStickyStage $owner $proofDir $start $apps $managed
    }
    if ($runCrash) {
      Invoke-MdPreviewCrashStage $owner $proofDir $start $apps $managed $ownerPid
    }
    # No SPI acceptance while the owner runs: takeover/prevention owns those
    # values mid-run. Arranging/pen are asserted after restore below.
    Rec-Md "stages-done" @{ stage = $Stage }
  } catch {
    # Preserve the stage error; the single verdict below reports it AFTER
    # every cleanup leg ran, alongside any cleanup failures.
    $stageError = "$($_.Exception.Message)"
  } finally {
    # Teardown order: owner stop/restore FIRST (graceful, else emergency THEN
    # restore), then close ONLY created extras by exact HWND (borrowed never
    # close), then borrowed geometry/show restore, then audits. EVERY leg is
    # attempted with its own record; NOTHING here throws, so one failure
    # cannot skip the rest. Failures append to $cleanupErrors and turn the
    # final report into a failure after all cleanup ran.
    $cleanupErrors = @()
    if ($null -ne $owner) {
      try {
        $st = Invoke-MdNative $owner.ownerCopy @("stop") | ConvertFrom-Json
        if (-not $st.owner_exited) { throw "graceful stop no exit" }
        Rec-Md "stop" @{ owner_exited = $true }
      } catch {
        # An intentional exact-owner crash row already verified the owner
        # gone: a failing stop against the dead PID is expected, not a
        # cleanup error. Anything else takes the emergency path.
        $gone = ($null -eq (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue))
        if ($gone -and $script:mdOwnerDead) {
          Rec-Md "stop-already-gone" @{ expected = $true }
        } else {
          $cleanupErrors += "graceful-stop-failed: $($_.Exception.Message)"
          Rec-Md "stop-graceful-failed" @{ error = "$($_.Exception.Message)" }
          try {
            $e = Invoke-MdNative $owner.ownerCopy @("emergency-stop") | ConvertFrom-Json
            Rec-Md "recovery-emergency" $e
            if (-not $e.owner_exited) { $cleanupErrors += "emergency-stop-no-exit"; Rec-Md "recovery-emergency-no-exit" $e }
          } catch { $cleanupErrors += "emergency-stop-failed: $($_.Exception.Message)"; Rec-Md "recovery-failed" @{ error = "$($_.Exception.Message)" } }
        }
      }
      try {
        $r = Invoke-MdNative $owner.ownerCopy @("restore") | ConvertFrom-Json
        if (-not $r.restored) { throw "restore not restored" }
        Rec-Md "restore" @{ restored = $true }
      } catch {
        $cleanupErrors += "owner-restore-failed: $($_.Exception.Message)"
        Rec-Md "restore-failed" @{ error = "$($_.Exception.Message)" }
      }
      try { Assert-LedgerClean $owner.ownerCopy; Rec-Md "ledger" @{ clean = $true } }
      catch { $cleanupErrors += "ledger-dirty: $($_.Exception.Message)"; Rec-Md "ledger-dirty" @{ error = "$($_.Exception.Message)" } }
    }
    foreach ($a in @($appP, $appC, $appN)) {
      if ($null -ne $a -and "$($a.source)" -eq "created") {
        try { Close-MdApp $a "finally" } catch { $cleanupErrors += "created-close-failed pid $($a.pid): $($_.Exception.Message)"; Rec-Md "finally-close-failed" @{ pid = $a.pid; error = "$($_.Exception.Message)" } }
      }
    }
    foreach ($s in @($borrowedSnaps)) {
      try {
        if (-not (Restore-MdBorrowed $s "borrowed")) { $cleanupErrors += "borrowed-restore-mismatch hwnd $($s.hwnd)" }
      } catch { $cleanupErrors += "borrowed-restore-error hwnd $($s.hwnd): $($_.Exception.Message)"; Rec-Md "borrowed-restore-error" @{ hwnd = $s.hwnd; error = "$($_.Exception.Message)" } }
    }
    if ($null -ne $owner) {
      try { Assert-MdNoOverlays $ownerPid $owner.ownerCopy "mouse-drag" ; Rec-Md "overlays" @{ clean = $true } }
      catch { $cleanupErrors += "overlays-dirty: $($_.Exception.Message)"; Rec-Md "overlays-dirty" @{ error = "$($_.Exception.Message)" } }
    }
  }
  try { Assert-MdOriginalIntact $origApps "mouse-drag" }
  catch { $cleanupErrors += "original-intact: $($_.Exception.Message)" }
  if ($null -ne $owner) {
    try { Test-MdNoActors $owner.ownerCopy "mouse-drag" }
    catch { $cleanupErrors += "actors-remain: $($_.Exception.Message)" }
  }
  # SPI acceptance AFTER restore: arranging raw 1, pen 35 on the real desktop.
  try {
    $spiPost = Read-MdSpi
    Rec-Md "spi-post" @{ arranging = $spiPost.arranging_raw; pen = $spiPost.pen_raw }
    if ([int]$spiPost.arranging_raw -ne 1) { throw "post arranging raw $($spiPost.arranging_raw) != 1" }
    if ([int]$spiPost.pen_raw -ne 35) { throw "post pen raw $($spiPost.pen_raw) != 35" }
  } catch { $cleanupErrors += "spi-post: $($_.Exception.Message)" }
  # Single verdict AFTER every cleanup leg ran: a stage error is preserved,
  # and cleanup failures fail the report even when all stages passed, so a
  # success report never hides a cleanup error.
  $failed = ($stageError -ne "") -or ($cleanupErrors.Count -gt 0)
  $report = @{ status = "pass"; stage = "MouseDragLive"; steps = $MD_STEPS }
  if ($stageError -ne "") { $report.error = $stageError }
  if ($cleanupErrors.Count -gt 0) { $report.cleanup_errors = @($cleanupErrors) }
  if ($failed) { $report.status = "fail" }
  if ($null -ne $proofDir -and $proofDir -ne "") {
    $report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $proofDir "report.json")
  }
  $report | ConvertTo-Json -Depth 8 | Write-Output
  if ($failed) {
    if ($stageError -ne "") { throw $stageError }
    throw ("cleanup failed: " + ($cleanupErrors -join "; "))
  }
}

if ($Mock) { Invoke-MouseDragMock; exit 0 }
if ($Live) { Invoke-MouseDragLive; exit 0 }
if ($Stop) {
  if ($RunDir -eq "") { Fail-Md "refuse: -Stop needs -RunDir <dir>" }
  Install-MdNative
  $machinePath = Join-Path $RunDir "machine.json"
  if (-not (Test-Path -LiteralPath $machinePath)) { Fail-Md "no machine binding $machinePath" }
  $machine = Get-Content -LiteralPath $machinePath -Raw | ConvertFrom-Json
  $payload = "$($machine.ownerCopy)"
  $frozen = $machine.ownerFrozen
  $ready = Invoke-MdNative $payload @("ready") | ConvertFrom-Json
  $same = ($ready.ready -eq $true) -and ([int]$ready.owner.pid -eq [int]$frozen.pid) -and ("$($ready.owner.process_creation)" -ceq "$($frozen.process_creation)")
  if ($same) {
    $st = Invoke-MdNative $payload @("stop") | ConvertFrom-Json
    Write-Output "stop: $($st | ConvertTo-Json -Compress)"
    if (-not $st.owner_exited) { Fail-Md "graceful stop no exit" }
  } else {
    Write-Output "owner already gone or identity changed; no stop attempted"
  }
  $r = Invoke-MdNative $payload @("restore") | ConvertFrom-Json
  Write-Output "restore: $($r | ConvertTo-Json -Compress)"
  if (-not $r.restored) { Fail-Md "restore not restored" }
  Assert-LedgerClean $payload
  Write-Output "stopped clean runDir=$RunDir"
  exit 0
}
Write-Output "windows-mouse-drag parsed (no action without -Mock/-Live/-Stop)"