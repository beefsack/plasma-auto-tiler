param(
  [ValidateSet("OwnedFocusMove", "OwnedMove", "SpiGraceful", "SpiCrash", "NormalSmoke", "SnapSurfaces", "All")]
  [string]$Stage = "All",
  [switch]$Mock,
  [switch]$Live,
  [switch]$Stop,
  [string]$RunDir = "",
  [int]$OwnerSeconds = 180,
  [switch]$NoMouseSnapPrevention
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
# windows-dev.ps1 line 103 returns immediately when dot-sourced
# (InvocationName -eq "."), so sourcing below adds helpers only and runs no
# action block. Verified 2026-10-02; re-check that guard if the file changes.
. (Join-Path $Repo "scripts\windows-dev.ps1")

# Scoped automated verification for the Windows shortcut slice (physical,
# medium, owned helpers only). Reuses the Explorer desktop broker plus the
# exact-owner helpers from windows-dev.ps1. No new system dependencies.
#
#   pwsh -NoProfile -File scripts/windows-shortcuts.ps1 -Mock
#   pwsh -NoProfile -File scripts/windows-shortcuts.ps1 -Stage OwnedFocusMove -Live
#   pwsh -NoProfile -File scripts/windows-shortcuts.ps1 -Stop -RunDir '<dir>'
#
# Safety contract (docs/live-windows-testing.md grants no authority itself):
# - Explicit flags mandatory: -Mock runs the assertion harness with zero
#   native calls and zero SendInput; -Live runs bounded live stages; -Stop
#   runs out-of-hook exact-owner cleanup from a persisted RunDir. Bare
#   invocation only parses and exits.
# - Automatic activation of exact tagged owned helpers (plus one launched
#   Notepad in NormalSmoke) is the authorized activation path. The script
#   never touches Firefox or any original app window.
# - Test-only synthetic input carries exactly SHORTCUT_MARKER in dwExtraInfo
#   and is accepted only by `shortcut-proof` on frozen exact tagged owned
#   helpers. Product `tile` keeps filtering ALL injected.
# - Unshifted Win+L is NEVER sent: the journey table has no such row and
#   Assert-NoWinLJourney refuses any. Gating is asserted by portable tests.
# - All payloads launch via Explorer. Only the frozen exact owner is stopped;
#   no process-name kills. No registry/policy writes, no settings UI actions.
# - OwnerSeconds is 1..600 and every wait carries a deadline.

$SHORTCUT_MARKER = 0x544C5250524F4F46
$MAX_OWNER_SECONDS = 600
$INPUT_STRUCT_SIZE_X64 = 40
$VK_LWIN = 91
$VK_LSHIFT = 160
$VK_CONTROL = 17
$VK_H = 72
$VK_J = 74
$VK_K = 75
$VK_L = 76
$VK_M = 77
$VK_F11 = 122
$VK_LEFT = 37
$VK_UP = 38
$VK_RIGHT = 39
$VK_DOWN = 40
$VK_Z = 90
$VK_ESCAPE = 27
$MOUSEEVENTF_MOVE = 0x0001
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_ABSOLUTE = 0x8000
$GA_ROOT = 2
$SM_XVIRTUALSCREEN = 76
$SM_YVIRTUALSCREEN = 77
$SM_CXVIRTUALSCREEN = 78
$SM_CYVIRTUALSCREEN = 79

$ShortcutSteps = [System.Collections.ArrayList]@()
function Rec-Shortcut([string]$Name, $Data) {
  $null = $ShortcutSteps.Add(@{ name = $Name; data = $Data })
}
function Fail-Shortcut([string]$Msg) {
  throw $Msg
}

# ---------------------------------------------------------------------------
# Pure assertion functions: used by live stages AND the mock harness (which
# exercises each with a passing case plus a failing case that must throw).
# ---------------------------------------------------------------------------

function Get-ShortcutJourney {
  # Move-up (alias K) runs before move-right (arrow): from the canonical
  # adopted layout (stacked left + right column) move-right collapses the
  # topology into three full-height columns with no up candidate, failing
  # the next up-source lookup (20261002-033107-14636). Move-up first keeps a
  # right candidate after the swap, so both rows keep valid Engine topology.
  # Same rows and same acceptance, only order changes.
  return @(
    @{ name = "focus-left-h"; vk = $VK_H; shift = $false; ctrl = $false; op = "focus"; direction = "left"; family = "focus-ok" }
    @{ name = "focus-down-j"; vk = $VK_J; shift = $false; ctrl = $false; op = "focus"; direction = "down"; family = "focus-ok" }
    @{ name = "move-up-shift-k"; vk = $VK_K; shift = $true; ctrl = $false; op = "move"; direction = "up"; family = "move-applied" }
    @{ name = "move-right-shift-arrow"; vk = $VK_RIGHT; shift = $true; ctrl = $false; op = "move"; direction = "right"; family = "move-applied" }
    @{ name = "repeat-down-j"; vk = $VK_J; shift = $false; ctrl = $false; op = "focus"; direction = "down"; family = "repeat"; repeats = 3 }
    @{ name = "edge-noop-left"; vk = $VK_LEFT; shift = $false; ctrl = $false; op = "focus"; direction = "left"; family = "edge-noop" }
    @{ name = "passthrough-extra-modifier"; vk = $VK_H; shift = $false; ctrl = $true; op = "focus"; direction = "left"; family = "passed" }
    @{ name = "passthrough-background"; vk = $VK_H; shift = $false; ctrl = $true; op = "focus"; direction = "left"; family = "background-passed" }
    # Win+M parity item 3 (KDE Meta+M): unshifted toggle only, consumed with
    # a managed origin. Live stages filter by family and ignore this row
    # until a later unit wires a live maximize journey; the mock harness
    # below pins its shape (unshifted M, no Ctrl, toggle family).
    @{ name = "maximize-toggle-m"; vk = $VK_M; shift = $false; ctrl = $false; op = "maximize"; direction = ""; family = "maximize-toggle" }
    # Win+F11 parity item 4 (KDE Meta+F11): unshifted discrete toggle only,
    # consumed with a managed origin; repeats never re-dispatch. Live
    # fullscreen stages filter by this family; the mock harness pins its
    # shape (unshifted F11 0x7A, no Ctrl, toggle family, empty direction).
    @{ name = "fullscreen-toggle-f11"; vk = $VK_F11; shift = $false; ctrl = $false; op = "fullscreen"; direction = ""; family = "fullscreen-toggle" }
  )
}

function Assert-NoWinLJourney($Rows) {
  $Rows = @($Rows)
  if ($Rows.Count -eq 0) {
    Fail-Shortcut "refuse: empty journey"
  }
  foreach ($row in $Rows) {
    if (($row.vk -eq $VK_L) -and (-not $row.shift)) {
      Fail-Shortcut "refuse: journey must never send unshifted Win+L"
    }
  }
}

function Assert-ChordSendCounts([int]$Accepted, [bool]$WithModifier, [int]$RepeatExtra, [string]$Tag) {
  # One SendInput event per key transition: Win down, [mod down], key down,
  # key repeats (each a single down; ups just close the pair per
  # snapkey.rs/winarrow.rs delivered=down+repeat), key up, [mod up], Win up.
  # Plain: 4. One modifier: 6. Each repeat adds exactly 1.
  $base = 4
  if ($WithModifier) {
    $base = 6
  }
  $want = $base + $RepeatExtra
  if ($Accepted -ne $want) {
    Fail-Shortcut "$Tag send count $Accepted != $want"
  }
}

function Assert-InputStructSize([int]$Actual) {
  if ($Actual -ne $INPUT_STRUCT_SIZE_X64) {
    Fail-Shortcut "INPUT size $Actual != $INPUT_STRUCT_SIZE_X64"
  }
}

# Truthful hardware scan codes (Set 1) for the enhanced navigation arrows.
# Sent with KEYEVENTF_EXTENDEDKEY: without the extended flag the driver
# delivers numpad-style navigation and synthesizes non-injected fake Shift
# traffic (AHK SC_FAKE_LSHIFT 0x22A/554) that clears tracked Shift and flips
# Win+Shift+Arrow to focus. Letters, Win, Shift and Ctrl stay plain wVk.
$ARROW_SCAN_TABLE = @{ 37 = 75; 38 = 72; 39 = 77; 40 = 80 }

function Assert-EncodingInvariant([int]$Vk, [bool]$Extended, [int]$Scan, [string]$Tag) {
  # Payload rule enforced by the sender before SendInput and by the mock
  # harness in both polarities: arrows carry EXTENDEDKEY plus their truthful
  # scan, every other chord key is plain wVk scan 0.
  $isArrow = $ARROW_SCAN_TABLE.ContainsKey($Vk)
  if ($isArrow) {
    if (-not $Extended) {
      Fail-Shortcut "$Tag arrow vk=$Vk missing EXTENDEDKEY"
    }
    if ($Scan -ne $ARROW_SCAN_TABLE[$Vk]) {
      Fail-Shortcut "$Tag arrow vk=$Vk scan $Scan != truthful $($ARROW_SCAN_TABLE[$Vk])"
    }
  } else {
    if ($Extended) {
      Fail-Shortcut "$Tag non-arrow vk=$Vk must not set EXTENDEDKEY"
    }
    if ($Scan -ne 0) {
      Fail-Shortcut "$Tag non-arrow vk=$Vk must use scan 0"
    }
  }
}

function Test-ExeEqualLocal([string]$A, [string]$B) {
  return ("$A".Replace("/", "\") -ieq "$B".Replace("/", "\"))
}

function Assert-FullIdentityMatches($Snap, $Frozen, [string]$Tag) {
  # Full 7-field identity vs the frozen receipt: HWND, pid, creation, exe
  # (slash-insensitive), SID, session, lifetime tag. Never pid/tag only.
  if ([uint64]$Snap.hwnd -ne [uint64]$Frozen.hwnd) {
    Fail-Shortcut "$Tag hwnd changed"
  }
  if ([int]$Snap.process.pid -ne [int]$Frozen.process.pid) {
    Fail-Shortcut "$Tag pid changed"
  }
  if ("$($Snap.process.process_creation)" -cne "$($Frozen.process.process_creation)") {
    Fail-Shortcut "$Tag creation changed"
  }
  if (-not (Test-ExeEqualLocal "$($Snap.process.exe_path)" "$($Frozen.process.exe_path)")) {
    Fail-Shortcut "$Tag exe changed"
  }
  if ("$($Snap.process.user_sid)" -cne "$($Frozen.process.user_sid)") {
    Fail-Shortcut "$Tag sid changed"
  }
  if ([int]$Snap.process.session_id -ne [int]$Frozen.process.session_id) {
    Fail-Shortcut "$Tag session changed"
  }
  if ("$($Snap.tag)" -cne "$($Frozen.tag)") {
    Fail-Shortcut "$Tag tag changed"
  }
  if ([string]$Snap.tag -eq "") {
    Fail-Shortcut "$Tag tag empty"
  }
}

function Assert-TileStartMode($Start, [string]$WantMode, [bool]$WantTakeover, [bool]$WantAllowWinL, [string]$Tag) {
  if ("$($Start.mode)" -ne $WantMode) {
    Fail-Shortcut "$Tag mode $($Start.mode) != $WantMode"
  }
  if ([bool]$Start.trace -ne $true) {
    Fail-Shortcut "$Tag trace not active"
  }
  if ([bool]$Start.keyboard.takeover -ne $WantTakeover) {
    Fail-Shortcut "$Tag takeover mismatch"
  }
  if ([bool]$Start.keyboard.allow_win_l -ne $WantAllowWinL) {
    Fail-Shortcut "$Tag allow_win_l mismatch"
  }
}

function Assert-ProofStartArgv($Argv, [string[]]$WantFlags, [string]$Tag) {
  $Argv = @($Argv)
  foreach ($flag in $WantFlags) {
    if (-not ($Argv -contains $flag)) {
      Fail-Shortcut "$Tag proof-start argv missing $flag"
    }
  }
}

function Assert-ProductionLogTokenOnly($Lines) {
  # Production snap/snap-mask/tick lines carry opaque tokens only. Raw native
  # ids live solely in the scoped proof audit. Banned keys never appear.
  $banned = @("hwnd", "pid", "process_creation", "user_sid", "exe_path", "title")
  foreach ($line in @($Lines)) {
    $text = "$line"
    foreach ($key in $banned) {
      if ($text -match "`"$key`"") {
        Fail-Shortcut "production log leaks ${key}: $text"
      }
    }
  }
}

function Assert-FramesEqual($Before, $After, [string]$Tag) {
  $b = ($Before | Sort-Object) -join "|"
  $a = ($After | Sort-Object) -join "|"
  if ($b -cne $a) {
    Fail-Shortcut "$Tag frames changed: [$b] vs [$a]"
  }
}

function Assert-FramesChanged($Before, $After, [string]$Tag) {
  $b = ($Before | Sort-Object) -join "|"
  $a = ($After | Sort-Object) -join "|"
  if ($b -ceq $a) {
    Fail-Shortcut "$Tag frames unchanged, expected native effect"
  }
}

function Assert-RectNonEmpty([string]$Rect, [string]$Tag) {
  # Release evidence must carry a real rectangle on both sides: an empty or
  # zero-area before rect makes FramesChanged vacuous (20261002-035549 read
  # an undefined variable and recorded ",,,"). Four integers with right >
  # left and bottom > top. Pure for the mock harness.
  $parts = @("$Rect" -split ",")
  if ($parts.Count -ne 4) {
    Fail-Shortcut "$Tag rect not l,t,r,b: [$Rect]"
  }
  $nums = @()
  foreach ($p in $parts) {
    $n = 0
    if (-not [int]::TryParse($p.Trim(), [ref]$n)) {
      Fail-Shortcut "$Tag rect not integers: [$Rect]"
    }
    $nums += $n
  }
  if (($nums[2] -le $nums[0]) -or ($nums[3] -le $nums[1])) {
    Fail-Shortcut "$Tag rect empty: [$Rect]"
  }
}

function ConvertTo-AbsoluteNative([int]$Px, [int]$Origin, [int]$Span) {
  # SendInput MOUSEEVENTF_ABSOLUTE normalization over the virtual screen:
  # 0..65535 maps Origin..(Origin+Span-1). Pure for the mock harness.
  if ($Span -le 1) {
    Fail-Shortcut "absolute span $Span invalid"
  }
  return [int][math]::Round(($Px - $Origin) * 65535.0 / ($Span - 1))
}

function Assert-OcclusionClear([uint64]$Ancestor, [uint64]$FrozenHwnd, [string]$Tag) {
  # Click guard decision: the top-level window under the cursor must be the
  # exact frozen helper. Anything else refuses with no click. Pure for mock.
  if ($Ancestor -ne $FrozenHwnd) {
    Fail-Shortcut "$Tag occluded/foreign ancestor $Ancestor != frozen $FrozenHwnd, no click"
  }
}

function Assert-SpiPreimageOwned($Ledger, [string]$Tag) {
  # Ledger v4 with an owned original-TRUE claim: the only state authorizing
  # restoration. Anything else refuses the crash stage. v4 keeps the exact
  # v2 preimage semantics (mouse_snap.original/owned); only the schema
  # version moved (LEDGER_SCHEMA_VERSION=4 in model.rs), so the gate moves
  # with it while owner/pid/SID/session checks stay in the caller.
  if ([int]$Ledger.v -ne 4) {
    Fail-Shortcut "$Tag ledger v$($Ledger.v) != v4"
  }
  if ($null -eq $Ledger.mouse_snap) {
    Fail-Shortcut "$Tag no snap preimage"
  }
  if ([bool]$Ledger.mouse_snap.original -ne $true) {
    Fail-Shortcut "$Tag preimage original not true"
  }
  if ([bool]$Ledger.mouse_snap.owned -ne $true) {
    Fail-Shortcut "$Tag preimage not owned"
  }
}

# ---------------------------------------------------------------------------
# Native interop (live only, except SizeOfInput which never calls SendInput).
# Full INPUT union carries MOUSEINPUT so the x64 union is 32 bytes and INPUT
# is 40: a keyboard-only union yields 32 and silently mistargets SendInput.
# ---------------------------------------------------------------------------

function Install-ShortcutNative {
  if (-not ("ShortcutProofNative" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class ShortcutProofNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData;
    public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT pt);
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int left; public int top; public int right; public int bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static bool RaiseActivate(long hwnd) {
    const uint flags = 0x0002u | 0x0001u;
    return SetWindowPos((IntPtr)hwnd, IntPtr.Zero, 0, 0, 0, 0, flags);
  }
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  public static uint PrimeE8() {
    return SendKey(0xE8, false, 0) + SendKey(0xE8, true, 0);
  }
  [DllImport("user32.dll")]
  public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  public static int SizeOfInput() { return Marshal.SizeOf(typeof(INPUT)); }
  public static uint SendKey(ushort vk, bool up, ulong extra) {
    return SendKeyScan(vk, 0, up, extra);
  }
  public static uint SendKeyScan(ushort vk, ushort scan, bool up, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk;
    arr[0].u.ki.wScan = scan;
    arr[0].u.ki.dwFlags = up ? 0x0002u : 0u;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint SendKeyScanEx(ushort vk, ushort scan, bool up, bool extended, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 1;
    arr[0].u.ki.wVk = vk;
    arr[0].u.ki.wScan = scan;
    uint flags = up ? 0x0002u : 0u;
    if (extended) flags |= 0x0001u;
    arr[0].u.ki.dwFlags = flags;
    arr[0].u.ki.time = 0;
    arr[0].u.ki.dwExtraInfo = (UIntPtr)extra;
    return SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint SendMouse(uint flags, int nx, int ny, ulong extra) {
    INPUT[] arr = new INPUT[1];
    arr[0].type = 0;
    arr[0].u.mi.dx = nx;
    arr[0].u.mi.dy = ny;
    arr[0].u.mi.mouseData = 0;
    arr[0].u.mi.dwFlags = flags;
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

function Read-CompleteTextLocal([string]$Path) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $reader = New-Object IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Close()
  }
}

function Get-CompleteLinesLocal([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail-Shortcut "missing log $Path"
  }
  $text = Read-CompleteTextLocal $Path
  $complete = @()
  if ([string]::IsNullOrEmpty($text)) {
    return ,$complete
  }
  $endsNewline = $text.EndsWith("`n")
  $parts = $text -split "`n"
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $last = ($i -eq ($parts.Count - 1))
    if ($last -and -not $endsNewline) {
      break
    }
    $line = "$($parts[$i])" -replace "`r$", ""
    if ($last -and $line -eq "") {
      break
    }
    $complete += $line
  }
  return ,$complete
}

function Get-LogEventsAfter([string]$LogPath, [int]$Mark) {
  $lines = Get-CompleteLinesLocal $LogPath
  $out = @()
  for ($i = $Mark; $i -lt $lines.Count; $i++) {
    if ("$($lines[$i])".Trim() -ne "") {
      $out += ($lines[$i] | ConvertFrom-Json)
    }
  }
  return @{ events = $out; count = $lines.Count }
}

function Get-PlanSnapshotLocal($Events) {
  $plans = @{}
  $details = @{}
  foreach ($e in @($Events)) {
    if ($e.event -eq "plan") {
      $plans[[uint64]$e.tick] = $e
    } elseif ($e.event -eq "readback-detail") {
      $details[[uint64]$e.tick] = $e
    }
  }
  $ticks = @($plans.Keys | Where-Object { $details.ContainsKey($_) } | Sort-Object -Descending)
  if ($ticks.Count -eq 0) {
    return $null
  }
  $tick = [uint64]$ticks[0]
  return @{ tick = $tick; plan = $plans[$tick]; detail = $details[$tick] }
}

function Set-ExactForeground($Snap, $Frozen, [string]$HelperBin, [string]$Tag) {
  # Authorized automatic activation of one exact tagged owned helper only.
  # Full identity recheck, SetForegroundWindow attempt, exact foreground
  # readback. The setter BOOL is never trusted (a background caller is
  # refused with FALSE while the readback stays authoritative, exactly like
  # product actuate_focus): only the readback decides. Firefox and original
  # apps are never targeted: HWND comes only from the frozen owned-helper
  # receipt passed by the caller.
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $fresh $Frozen "$Tag-prefocus"
  $null = [ShortcutProofNative]::SetForegroundWindow([IntPtr][long]$Frozen.hwnd)
  $fg = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$Frozen.hwnd) {
    Fail-Shortcut "$Tag foreground readback $fg != $($Frozen.hwnd)"
  }
}

function Invoke-GuardedHelperClick($Snap, $Frozen, [string]$HelperBin, [string]$Tag) {
  # Test-harness-only owned-helper mouse activation. No AttachThreadInput,
  # no Alt/focus escalation, no product change: one real (unmarked) mouse
  # click on the known exposed TITLE BAR of one exact frozen helper, so the
  # OS grants foreground rights through ordinary mouse activation (the prior
  # background SetForegroundWindow probe was refused with zero input
  # dispatched). Guards, in order: full identity recheck, non-maximized,
  # caption point inside the rect, WindowFromPoint/GetAncestor(GA_ROOT) ==
  # exact frozen HWND (no click when occluded or foreign), pointer preserved
  # and restored with absolute SendInput only, exactly-inserted release on
  # short insert, bounded single attempt (no repeats), exact foreground
  # readback plus post-click identity. All cursor writes are SendInput
  # MOUSEEVENTF_ABSOLUTE (0..65535 over the virtual screen, x64 INPUT is 40);
  # every other native call is read-only.
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $fresh $Frozen "$Tag-prefocus"
  if ([ShortcutProofNative]::IsZoomed([IntPtr][long]$Frozen.hwnd)) {
    Fail-Shortcut "$Tag helper maximized, title bar not exposed"
  }
  $cx = [int](([int]$fresh.left + [int]$fresh.right) / 2)
  $cy = [int]$fresh.top + 10
  if ($cx -lt [int]$fresh.left -or $cx -gt [int]$fresh.right -or $cy -lt [int]$fresh.top -or $cy -ge [int]$fresh.bottom) {
    Fail-Shortcut "$Tag caption point outside rect"
  }
  $anc = [ShortcutProofNative]::WindowAncestorAt($cx, $cy)
  Assert-OcclusionClear ([uint64]$anc) ([uint64]$Frozen.hwnd) $Tag
  $saved = [ShortcutProofNative]::CursorXY()
  if ($null -eq $saved) {
    Fail-Shortcut "$Tag cursor read failed"
  }
  $vx = [ShortcutProofNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
  $vy = [ShortcutProofNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
  $vw = [ShortcutProofNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
  $vh = [ShortcutProofNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
  $nx = ConvertTo-AbsoluteNative $cx $vx $vw
  $ny = ConvertTo-AbsoluteNative $cy $vy $vh
  $rx = ConvertTo-AbsoluteNative ([int]$saved[0]) $vx $vw
  $ry = ConvertTo-AbsoluteNative ([int]$saved[1]) $vy $vh
  $moveFlags = ($MOUSEEVENTF_MOVE -bor $MOUSEEVENTF_ABSOLUTE)
  if ([ShortcutProofNative]::SendMouse($moveFlags, $nx, $ny, [uint64]0) -ne 1) {
    Fail-Shortcut "$Tag click move short insertion"
  }
  Start-Sleep -Milliseconds 120
  if ([ShortcutProofNative]::SendMouse($MOUSEEVENTF_LEFTDOWN, 0, 0, [uint64]0) -ne 1) {
    $null = [ShortcutProofNative]::SendMouse($moveFlags, $rx, $ry, [uint64]0)
    Fail-Shortcut "$Tag click down short insertion"
  }
  Start-Sleep -Milliseconds 150
  if ([ShortcutProofNative]::SendMouse($MOUSEEVENTF_LEFTUP, 0, 0, [uint64]0) -ne 1) {
    $rel = [ShortcutProofNative]::SendMouse($MOUSEEVENTF_LEFTUP, 0, 0, [uint64]0)
    $null = [ShortcutProofNative]::SendMouse($moveFlags, $rx, $ry, [uint64]0)
    Fail-Shortcut "$Tag click up short insertion release=$rel"
  }
  $deadline = (Get-Date).AddSeconds(5)
  $fg = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  while (([uint64]$fg -ne [uint64]$Frozen.hwnd) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
    $fg = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  }
  if ([ShortcutProofNative]::SendMouse($moveFlags, $rx, $ry, [uint64]0) -ne 1) {
    Fail-Shortcut "$Tag cursor restore short insertion"
  }
  if ([uint64]$fg -ne [uint64]$Frozen.hwnd) {
    Fail-Shortcut "$Tag foreground readback $fg != $($Frozen.hwnd) after click"
  }
  $post = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $post $Frozen "$Tag-postclick"
  return @{ accepted = 4; unmarked = $true; point = "$cx,$cy" }
}

function Get-DirectionalSource([string]$Payload, [string]$AllowPath, [string]$Direction, $Helpers, [string]$Tag) {
  # Valid focus/move source from the canonical adopted geometry: fresh
  # allowlist inspect visible rects ([x,y,w,h] per rect_array). The extremal
  # window opposite the requested direction that has a strict geometric
  # neighbor behind it with perpendicular overlap, so the Engine holds a
  # directional candidate. Fails with layout evidence when no candidate
  # exists anywhere: the caller reports the layout instead of retrying.
  $insp = Invoke-Native $Payload @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json
  $elig = @($insp.windows | Where-Object { $_.eligible -eq $true })
  if ($elig.Count -eq 0) {
    Fail-Shortcut "$Tag no eligible windows"
  }
  $cands = @()
  foreach ($w in $elig) {
    $x = [int]$w.visible[0]; $y = [int]$w.visible[1]; $ww = [int]$w.visible[2]; $hh = [int]$w.visible[3]
    $has = $false
    foreach ($o in $elig) {
      if ([uint64]$o.hwnd -eq [uint64]$w.hwnd) {
        continue
      }
      $ox = [int]$o.visible[0]; $oy = [int]$o.visible[1]; $ow = [int]$o.visible[2]; $oh = [int]$o.visible[3]
      $overlapX = ($x -lt ($ox + $ow)) -and ($ox -lt ($x + $ww))
      $overlapY = ($y -lt ($oy + $oh)) -and ($oy -lt ($y + $hh))
      if (($Direction -eq "left") -and ((($ox + $ow) -le $x) -and $overlapY)) {
        $has = $true
      }
      if (($Direction -eq "right") -and (($ox -ge ($x + $ww)) -and $overlapY)) {
        $has = $true
      }
      if (($Direction -eq "up") -and ((($oy + $oh) -le $y) -and $overlapX)) {
        $has = $true
      }
      if (($Direction -eq "down") -and (($oy -ge ($y + $hh)) -and $overlapX)) {
        $has = $true
      }
    }
    if ($has) {
      $cands += $w
    }
  }
  if ($cands.Count -eq 0) {
    $rects = (@($elig | ForEach-Object { "$($_.hwnd)=$($_.visible -join ',')" }) -join " ")
    Fail-Shortcut "$Tag no $Direction candidate in layout: $rects"
  }
  if ($Direction -eq "left") {
    $sorted = @($cands | Sort-Object { [int]$_.visible[0] } -Descending)
  } elseif ($Direction -eq "right") {
    $sorted = @($cands | Sort-Object { [int]$_.visible[0] })
  } elseif ($Direction -eq "up") {
    $sorted = @($cands | Sort-Object { [int]$_.visible[1] } -Descending)
  } else {
    $sorted = @($cands | Sort-Object { [int]$_.visible[1] })
  }
  $pick = $sorted | Select-Object -First 1
  $frozen = @($Helpers) | Where-Object { [uint64]$_.hwnd -eq [uint64]$pick.hwnd } | Select-Object -First 1
  if ($null -eq $frozen) {
    Fail-Shortcut "$Tag picked $($pick.hwnd) left the frozen set"
  }
  return $frozen
}

function Show-ExactHelper($Snap, $Frozen, [string]$HelperBin, [string]$Tag) {
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $shown = Invoke-Native $HelperBin @("show", "$($Frozen.hwnd)", "--tag", "$($Frozen.tag)") | ConvertFrom-Json
  if ([uint64]$shown.foreground -eq [uint64]$Frozen.hwnd) {
    Fail-Shortcut "$Tag show stole focus"
  }
  $back = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $back $Frozen "$Tag-shown"
  if (-not $back.visible) {
    Fail-Shortcut "$Tag show readback not visible"
  }
}

function Invoke-ExactHelperActivate($Snap, $Frozen, [string]$HelperBin, [string]$Tag) {
  # Harness-only fixture activation of one exact frozen owned helper: raise
  # to the top of the normal z-order (HWND_TOP, never topmost) with
  # activation (SWP_NOMOVE|SWP_NOSIZE, no NOACTIVATE: the NOACTIVATE form
  # returns TRUE but never restacks, proven 20261002-035017 plus a bounded
  # standalone z-probe, and is removed). If the foreground lock refuses the
  # raise, fall back to the proven E8 prime plus AttachThreadInput coupling
  # of the harness thread to the exact foreground TID (GetWindowThreadProcessId
  # return), one SetForegroundWindow and immediate detach. Only the sanctioned
  # E8 pair is ever sent (unmarked, product-filtered); no other keys and no
  # external-app input. Same authorized effect as the existing caption click.
  # Guards, in order: full identity match, non-foreground helper only at
  # entry, fresh pre-inspect identity, post-inspect identity plus unchanged
  # rect, exact-foreground readback plus caption-point ancestor proof.
  # Ordinary apps are never touched: only the frozen owned-helper HWND is
  # passed. No product or test_window ownership gate is altered.
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $fgEntry = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Frozen.hwnd) {
    Fail-Shortcut "$Tag activate refused: frozen helper already holds foreground"
  }
  $pre = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $pre $Frozen "$Tag-preactivate"
  $preRect = "$($pre.left),$($pre.top),$($pre.right),$($pre.bottom)"
  $method = "raise"
  $primeInserted = 0
  $attachOk = $false
  if (-not [ShortcutProofNative]::RaiseActivate([long]$Frozen.hwnd)) {
    Fail-Shortcut "$Tag raise-activate SetWindowPos refused"
  }
  $fgRaised = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgRaised -ne [uint64]$Frozen.hwnd) {
    $method = "attach"
    $primeInserted = [int][ShortcutProofNative]::PrimeE8()
    if ($primeInserted -ne 2) {
      Fail-Shortcut "$Tag E8 prime accepted $primeInserted != 2"
    }
    $fgNow = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
    $pidOut = [uint32]0
    $fgTid = [ShortcutProofNative]::GetWindowThreadProcessId([IntPtr][long]$fgNow, [ref]$pidOut)
    if ([uint32]$fgTid -eq 0) {
      Fail-Shortcut "$Tag foreground TID unreadable"
    }
    $myTid = [ShortcutProofNative]::GetCurrentThreadId()
    $attachOk = [ShortcutProofNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $true)
    try {
      $null = [ShortcutProofNative]::SetForegroundWindow([IntPtr][long]$Frozen.hwnd)
    } finally {
      $null = [ShortcutProofNative]::AttachThreadInput([uint32]$myTid, [uint32]$fgTid, $false)
    }
    $fgRaised = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
    if ([uint64]$fgRaised -ne [uint64]$Frozen.hwnd) {
      Fail-Shortcut "$Tag foreground readback $fgRaised != $($Frozen.hwnd) via $method attach=$attachOk"
    }
  }
  $post = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $post $Frozen "$Tag-postactivate"
  $postRect = "$($post.left),$($post.top),$($post.right),$($post.bottom)"
  if ($postRect -cne $preRect) {
    Fail-Shortcut "$Tag activate moved geometry: [$preRect] vs [$postRect]"
  }
  $cx = [int](([int]$post.left + [int]$post.right) / 2)
  $cy = [int]$post.top + 10
  $anc = [ShortcutProofNative]::WindowAncestorAt($cx, $cy)
  Assert-OcclusionClear ([uint64]$anc) ([uint64]$Frozen.hwnd) "$Tag-activated"
  return @{ hwnd = "$($Frozen.hwnd)"; rect = $postRect; method = $method; prime_inserted = $primeInserted; attach_ok = $attachOk; foreground = "$fgRaised"; ancestor = "$anc"; topmost = $false }
}

function Invoke-OwnedFocusEnsure($Snap, $Frozen, [string]$HelperBin, [string]$Tag) {
  # Occlusion-safe replacement for the caption click in the directional flow:
  # when an unrelated window (e.g. the user's Terminal) covers the helper,
  # the click guard must refuse, so focus is ensured with the non-click
  # raise/attach activation instead. Same gates: full identity before and
  # after, unchanged rect, exact-foreground readback, caption-point ancestor
  # proof. Already-foreground short-circuits with the same readbacks (no
  # setter call at all). No click, no pointer motion, no cursor writes.
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $pre = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $pre $Frozen "$Tag-preactivate"
  $fgEntry = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgEntry -eq [uint64]$Frozen.hwnd) {
    $postRect = "$($pre.left),$($pre.top),$($pre.right),$($pre.bottom)"
    $cx = [int](([int]$pre.left + [int]$pre.right) / 2)
    $cy = [int]$pre.top + 10
    $anc = [ShortcutProofNative]::WindowAncestorAt($cx, $cy)
    Assert-OcclusionClear ([uint64]$anc) ([uint64]$Frozen.hwnd) "$Tag-already"
    return @{ hwnd = "$($Frozen.hwnd)"; rect = $postRect; method = "already-foreground"; prime_inserted = 0; attach_ok = $false; foreground = "$fgEntry"; ancestor = "$anc"; topmost = $false }
  }
  return Invoke-ExactHelperActivate $Snap $Frozen $HelperBin $Tag
}

function Send-MarkedChord([int]$Vk, [bool]$WithShift, [bool]$WithControl, [uint64]$WantForeground, [int]$RepeatExtra, [bool]$Unmarked) {
  # Bounded synthetic chord. Foreground is read freshly immediately before
  # the first down and must equal the intended target. Each SendInput
  # accepted count is asserted (1 per event); on short insertion the
  # try/finally releases exactly the keys actually pressed, then fails.
  # Unmarked ($Unmarked) sends dwExtraInfo 0: release tap, NormalSmoke
  # filter probes, Win+Z/layouts probes and SnapSurfaces inputs. Still
  # SendInput-synthesized, only the marker differs; never physical.
  # Shift uses the left key (LSHIFT VK 0xA0), plain wVk like every modifier.
  # Chord arrows (37-40) are sent as real enhanced keys: truthful scan via
  # MapVirtualKey verified against $ARROW_SCAN_TABLE plus KEYEVENTF_EXTENDEDKEY
  # on down/up/repeats. Without the extended flag the driver delivers
  # numpad-style navigation and synthesizes non-injected fake Shift traffic
  # (SC_FAKE_LSHIFT 0x22A/554) that clears tracked Shift and flips
  # Win+Shift+Arrow to focus. Letters, Win, Shift and Ctrl stay plain wVk.
  $markerValue = [uint64]$SHORTCUT_MARKER
  if ($Unmarked) {
    $markerValue = [uint64]0
  }
  $fg = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fg -ne [uint64]$WantForeground) {
    Fail-Shortcut "foreground $fg != target $WantForeground before input"
  }
  # Chord-key encoding resolved once and enforced before every SendInput:
  # arrows extended with truthful scan, everything else plain wVk scan 0.
  $chordScan = 0
  $chordExt = $false
  if ($ARROW_SCAN_TABLE.ContainsKey([int]$Vk)) {
    $chordExt = $true
    $chordScan = [int][ShortcutProofNative]::MapVirtualKey([uint32]$Vk, 0)
  }
  Assert-EncodingInvariant ([int]$Vk) ([bool]$chordExt) ([int]$chordScan) "chord vk=$Vk"
  $shiftScan = 0
  $pressed = [System.Collections.ArrayList]@()
  $accepted = 0
  # Sender-side per-event receipts: values as passed to SendInput BEFORE the
  # call (vk/scan/edge, extended state and dwFlags) plus the accepted count
  # after. Compared against the callback's proof-keys/proof-mods audit to
  # tell harness construction defects apart from in-flight transforms.
  $receipt = [System.Collections.ArrayList]@()
  try {
    $downOrder = @($VK_LWIN)
    if ($WithShift) {
      $downOrder += $VK_LSHIFT
    }
    if ($WithControl) {
      $downOrder += $VK_CONTROL
    }
    foreach ($key in $downOrder) {
      Assert-EncodingInvariant ([int]$key) $false 0 "modifier vk=$key"
      $one = [ShortcutProofNative]::SendKey([uint16]$key, $false, $markerValue)
      $null = $receipt.Add(@{ vk = [int]$key; scan = 0; up = $false; extended = $false; flags = 0; extra = ("0x{0:X}" -f $markerValue); accepted = [int]$one })
      if ($one -ne 1) {
        Fail-Shortcut "short insertion on down vk=$key"
      }
      $accepted += $one
      $null = $pressed.Add($key)
    }
    $keyDown = [ShortcutProofNative]::SendKeyScanEx([uint16]$Vk, [uint16]$chordScan, $false, [bool]$chordExt, $markerValue)
    $null = $receipt.Add(@{ vk = [int]$Vk; scan = [int]$chordScan; up = $false; extended = [bool]$chordExt; flags = ([bool]$chordExt ? 1 : 0); extra = ("0x{0:X}" -f $markerValue); accepted = [int]$keyDown })
    if ($keyDown -ne 1) {
      Fail-Shortcut "short insertion on chord down vk=$Vk"
    }
    $accepted += $keyDown
    $null = $pressed.Add($Vk)
    for ($r = 0; $r -lt $RepeatExtra; $r++) {
      $rep = [ShortcutProofNative]::SendKeyScanEx([uint16]$Vk, [uint16]$chordScan, $false, [bool]$chordExt, $markerValue)
      $null = $receipt.Add(@{ vk = [int]$Vk; scan = [int]$chordScan; up = $false; extended = [bool]$chordExt; flags = ([bool]$chordExt ? 1 : 0); extra = ("0x{0:X}" -f $markerValue); accepted = [int]$rep; repeat = $r })
      if ($rep -ne 1) {
        Fail-Shortcut "short insertion on repeat $r vk=$Vk"
      }
      $accepted += $rep
    }
    $keyUp = [ShortcutProofNative]::SendKeyScanEx([uint16]$Vk, [uint16]$chordScan, $true, [bool]$chordExt, $markerValue)
    $null = $receipt.Add(@{ vk = [int]$Vk; scan = [int]$chordScan; up = $true; extended = [bool]$chordExt; flags = (([bool]$chordExt ? 1 : 0) -bor 2); extra = ("0x{0:X}" -f $markerValue); accepted = [int]$keyUp })
    if ($keyUp -ne 1) {
      Fail-Shortcut "short insertion on chord up vk=$Vk"
    }
    $accepted += $keyUp
    $null = $pressed.Remove($Vk)
  } finally {
    $reversed = @($pressed)
    [array]::Reverse($reversed)
    foreach ($key in $reversed) {
      if (([int]$key -eq [int]$Vk) -and ($ARROW_SCAN_TABLE.ContainsKey([int]$Vk))) {
        Assert-EncodingInvariant ([int]$key) ([bool]$chordExt) ([int]$chordScan) "release vk=$key"
        $rel = [ShortcutProofNative]::SendKeyScanEx([uint16]$key, [uint16]$chordScan, $true, [bool]$chordExt, $markerValue)
        $null = $receipt.Add(@{ vk = [int]$key; scan = [int]$chordScan; up = $true; extended = [bool]$chordExt; flags = (([bool]$chordExt ? 1 : 0) -bor 2); extra = ("0x{0:X}" -f $markerValue); accepted = [int]$rel })
      } else {
        $rel = [ShortcutProofNative]::SendKey([uint16]$key, $true, $markerValue)
        $null = $receipt.Add(@{ vk = [int]$key; scan = 0; up = $true; extended = $false; flags = 2; extra = ("0x{0:X}" -f $markerValue); accepted = [int]$rel })
      }
      if ($rel -ne 1) {
        Fail-Shortcut "short insertion on release vk=$key"
      }
      $accepted += $rel
    }
  }
  $withMod = ($WithShift -or $WithControl)
  Assert-ChordSendCounts $accepted $withMod $RepeatExtra "chord vk=$Vk"
  return @{ accepted = $accepted; synthetic = $true; marked = (-not $Unmarked); marker = ("0x{0:X}" -f $markerValue); shift_scan = [int]$shiftScan; events = @($receipt) }
}

function Read-PenVisualization {
  # Read-only SPI_GETPENVISUALIZATION probe (0x201E, ULONG). Never sets; the
  # harness only preserves the value (stable 35/ON on this host) across
  # WINARRANGING stages that must never touch the pen target again.
  if (-not ("ShortcutPenProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class ShortcutPenProbe {
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
  return [ShortcutPenProbe]::Get()
}

function Read-SpiArranging {  # Read-only SPI_GETWINARRANGING probe. Never sets; the owner drives SET.
  # MS SystemParametersInfoW docs: SPI_GETWINARRANGING 0x0082 (BOOL),
  # SPI_SETWINARRANGING 0x0083; SPI_GET/SETPENVISUALIZATION 0x201E/0x201F is a
  # different pen target. Local doc cache tool_0f7edd44b001jEAY4xyCyhAzEV
  # lines 374/398 (WINARRANGING) vs 235/263 (PEN).
  if (-not ("ShortcutSpiProbe" -as [type])) {
    $csharp = @"
using System;
using System.Runtime.InteropServices;
public static class ShortcutSpiProbe {
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
  return ([ShortcutSpiProbe]::Get() -ne 0)
}

function Assert-ExactOwner([string]$Payload, $Frozen, [string]$Tag) {
  # Full owner identity revalidation before any stop input: the committed
  # owner must still equal the frozen ready identity. Ambiguity refuses.
  $ready = Invoke-Native $Payload @("ready") | ConvertFrom-Json
  if ($ready.ready -ne $true) {
    Fail-Shortcut "$Tag owner not ready"
  }
  $live = $ready.owner
  if ([int]$live.pid -ne [int]$Frozen.pid) {
    Fail-Shortcut "$Tag owner pid changed"
  }
  if ("$($live.process_creation)" -cne "$($Frozen.process_creation)") {
    Fail-Shortcut "$Tag owner creation changed"
  }
  if (-not (Test-ExeEqual "$($live.exe_path)" "$($Frozen.exe_path)")) {
    Fail-Shortcut "$Tag owner exe changed"
  }
  if ("$($live.user_sid)" -cne "$($Frozen.user_sid)") {
    Fail-Shortcut "$Tag owner sid changed"
  }
  if ([int]$live.session_id -ne [int]$Frozen.session_id) {
    Fail-Shortcut "$Tag owner session changed"
  }
  return $ready
}

function Stop-ExactOwner([string]$Payload, [bool]$Force, [string]$Tag, $Frozen) {
  $null = Assert-ExactOwner $Payload $Frozen $Tag
  if ($Force) {
    $st = Invoke-Native $Payload @("emergency-stop") | ConvertFrom-Json
  } else {
    $st = Invoke-Native $Payload @("stop") | ConvertFrom-Json
  }
  if (-not $st.owner_exited) {
    Fail-Shortcut "$Tag stop no exit"
  }
  $alive = Test-ProcessAliveSameCreation ([int]$Frozen.pid) "$($Frozen.process_creation)"
  if ($alive) {
    Fail-Shortcut "$Tag owner alive after stop"
  }
  $restored = Invoke-Native $Payload @("restore") | ConvertFrom-Json
  if (-not $restored.restored) {
    Fail-Shortcut "$Tag restore failed"
  }
  Assert-LedgerClean $Payload
  return @{ stop = $st; restore = $restored }
}

function Get-FrozenHwnds($Snaps) {
  return @($Snaps | ForEach-Object { [uint64]$_.hwnd })
}

function Get-InspectFrames([string]$Payload, [string]$AllowPath) {
  $insp = Invoke-Native $Payload @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json
  $frames = @()
  foreach ($w in $insp.windows) {
    if ($w.eligible -eq $true) {
      $frames += (($w.visible | ForEach-Object { "$_" }) -join ",")
    }
  }
  return @{ inspect = $insp; frames = @($frames | Sort-Object) }
}

function Wait-ConvergedFrames([string]$Payload, [string]$AllowPath, [array]$Hwnds, [string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  $want = @($Hwnds | ForEach-Object { [uint64]$_ } | Sort-Object)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $last = "no observation yet"
  while ((Get-Date) -lt $deadline) {
    $got = Get-InspectFrames $Payload $AllowPath
    $eligible = @($got.inspect.windows | Where-Object { $_.eligible -eq $true } | ForEach-Object { [uint64]$_.hwnd } | Sort-Object)
    if (($eligible -join "|") -eq ($want -join "|")) {
      $tail = Get-LogEventsAfter $LogPath $Mark
      $snap = Get-PlanSnapshotLocal $tail.events
      if ($snap -ne $null) {
        $desired = @($snap.plan.entries | ForEach-Object { ($_.rect -join ",") } | Sort-Object)
        $bad = @($snap.detail.entries | Where-Object { $_.matched -ne $true })
        $matched = @($snap.detail.entries | Where-Object { $_.matched -eq $true } | ForEach-Object { ($_.readback -join ",") } | Sort-Object)
        $seen = $got.frames
        if (($desired.Count -gt 0) -and ($bad.Count -eq 0) -and (($desired -join "|") -eq ($matched -join "|")) -and (($matched -join "|") -eq ($seen -join "|"))) {
          return @{ inspect = $got.inspect; tick = $snap.tick; desired = $desired; readback = $matched }
        }
        $last = "tick=$($snap.tick) desired=[$($desired -join '|')] readback=[$($matched -join '|')] seen=[$($seen -join '|')] unmatched=$($bad.Count)"
      } else {
        $last = "no plan+readback-detail tick yet"
      }
    } else {
      $last = "eligible=[$($eligible -join '|')] want=[$($want -join '|')]"
    }
    Start-Sleep -Milliseconds 500
  }
  Fail-Shortcut "$Tag converge timeout: $last"
}

function Wait-SnapAfter([string]$LogPath, [int]$Mark, [string]$Op, [string]$Direction, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath $Mark
    foreach ($e in @($tail.events)) {
      if (($e.event -eq "snap") -and ($e.disposition -eq "consumed") -and ("$($e.op)" -eq $Op) -and ("$($e.direction)" -eq $Direction)) {
        return $e
      }
    }
    Start-Sleep -Milliseconds 400
  }
  Fail-Shortcut "$Tag no consumed snap $Op/$Direction after mark $Mark"
  return $null
}

function Wait-NoConsumedSnap([string]$LogPath, [int]$Mark, [int]$TimeoutSec, [string]$Tag) {
  # Pass-through assertion: observe a full window with zero consumed snaps.
  # A consumed event here fails; silence plus unchanged frames passes.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  $tail = Get-LogEventsAfter $LogPath $Mark
  foreach ($e in @($tail.events)) {
    if (($e.event -eq "snap") -and ($e.disposition -eq "consumed")) {
      Fail-Shortcut "$Tag unexpected consumed snap op=$($e.op) dir=$($e.direction) outcome=$($e.outcome)"
    }
  }
}

# ---------------------------------------------------------------------------
# Mock harness: invokes the SAME pure assertion functions with passing cases
# plus failing cases that must throw (rejection proven, not hand-waved).
# Zero native calls, zero SendInput. Add-Type SizeOf is a struct check only.
# ---------------------------------------------------------------------------

function Invoke-ShortcutMock {
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  Rec-Shortcut "input-struct-size" @{ actual = $size; want = $INPUT_STRUCT_SIZE_X64 }
  $rejected = 0
  $rows = Get-ShortcutJourney
  Assert-NoWinLJourney $rows
  Rec-Shortcut "journey-guard" @{ rows = @($rows | ForEach-Object { $_.name }); win_l_sent = $false }
  $moveRows = @($rows | Where-Object { $_.family -eq "move-applied" })
  if ($moveRows.Count -lt 2) {
    Fail-Shortcut "mock journey needs >=2 move rows"
  }
  $arrowMove = @($moveRows | Where-Object { $_.shift -and ([int]$_.vk -ge 37) -and ([int]$_.vk -le 40) })
  if ($arrowMove.Count -lt 1) {
    Fail-Shortcut "mock journey needs a Win+Shift+Arrow move row"
  }
  $aliasMove = @($moveRows | Where-Object { $_.shift -and (@(72, 74, 75, 76) -contains [int]$_.vk) })
  if ($aliasMove.Count -lt 1) {
    Fail-Shortcut "mock journey needs a Win+Shift+HJKL alias move row"
  }
  $focusRows = @($rows | Where-Object { $_.family -eq "focus-ok" })
  if ($focusRows.Count -lt 1) {
    Fail-Shortcut "mock journey needs focus-ok rows for OwnedFocusMove"
  }
  Rec-Shortcut "journey-coverage" @{ moves = $moveRows.Count; arrow = $arrowMove.Count; alias = $aliasMove.Count; focus = $focusRows.Count }
  $maxRows = @($rows | Where-Object { $_.family -eq "maximize-toggle" })
  if ($maxRows.Count -ne 1) {
    Fail-Shortcut "mock journey needs exactly one maximize-toggle row"
  }
  $maxRow = $maxRows[0]
  if (([int]$maxRow.vk -ne $VK_M) -or ($maxRow.shift) -or ($maxRow.ctrl) -or ($maxRow.op -ne "maximize")) {
    Fail-Shortcut "mock maximize-toggle row must be unshifted Win+M with op maximize"
  }
  Rec-Shortcut "journey-maximize" @{ rows = $maxRows.Count; vk = [int]$maxRow.vk }
  try {
    Assert-NoWinLJourney @(@{ vk = $VK_L; shift = $false })
    Fail-Shortcut "negative journey-guard did not throw"
  } catch {
    if ("$($_.Exception.Message)" -notmatch "Win\+L") {
      throw
    }
    $rejected += 1
  }
  Assert-ChordSendCounts 4 $false 0 "mock-plain"
  Assert-ChordSendCounts 6 $true 0 "mock-mod"
  Assert-ChordSendCounts 8 $true 2 "mock-repeat"
  foreach ($bad in @(@{ a = 5; m = $false; r = 0 }, @{ a = 4; m = $true; r = 0 }, @{ a = 7; m = $false; r = 1 })) {
    try {
      Assert-ChordSendCounts $bad.a $bad.m $bad.r "mock-negative"
      Fail-Shortcut "negative send-counts did not throw"
    } catch {
      if ("$($_.Exception.Message)" -notmatch "send count") {
        throw
      }
      $rejected += 1
    }
  }
  try {
    Assert-InputStructSize 32
    Fail-Shortcut "negative struct-size did not throw"
  } catch {
    $rejected += 1
  }
  $fake = @{
    hwnd = 11
    tag = "abc"
    process = @{ pid = 100; process_creation = "c1"; exe_path = "C:/t/h.exe"; user_sid = "S1"; session_id = 1 }
  }
  Assert-FullIdentityMatches $fake $fake "mock-ident"
  $mutated = @{
    hwnd = 11
    tag = "abc"
    process = @{ pid = 101; process_creation = "c1"; exe_path = "C:/t/h.exe"; user_sid = "S1"; session_id = 1 }
  }
  try {
    Assert-FullIdentityMatches $mutated $fake "mock-negative-ident"
    Fail-Shortcut "negative identity did not throw"
  } catch {
    $rejected += 1
  }
  $start = @{ mode = "shortcut-proof"; trace = $true; keyboard = @{ takeover = $true; allow_win_l = $false } }
  Assert-TileStartMode $start "shortcut-proof" $true $false "mock-start"
  try {
    Assert-TileStartMode $start "normal" $true $false "mock-negative-start"
    Fail-Shortcut "negative mode did not throw"
  } catch {
    $rejected += 1
  }
  Assert-ProofStartArgv @("--allowlist", "a.json", "--seconds", "60", "--trace") @("--allowlist", "--seconds", "--trace") "mock-argv"
  try {
    Assert-ProofStartArgv @("--allowlist", "a.json") @("--allowlist", "--seconds") "mock-negative-argv"
    Fail-Shortcut "negative argv did not throw"
  } catch {
    $rejected += 1
  }
  $prodLines = @(
    '{"event":"snap","op":"focus","direction":"left","outcome":"focus-ok","window":"w1"}'
    '{"event":"snap-mask","mask":{"result":"mask-ok","inserted":2}}'
  )
  Assert-ProductionLogTokenOnly $prodLines
  try {
    Assert-ProductionLogTokenOnly @('{"event":"snap","hwnd":123}')
    Fail-Shortcut "negative token-only did not throw"
  } catch {
    $rejected += 1
  }
  Assert-FramesEqual @("1", "2") @("2", "1") "mock-frames-eq"
  Assert-FramesChanged @("1") @("2") "mock-frames-ch"
  try {
    Assert-FramesEqual @("1") @("2") "mock-negative-frames"
    Fail-Shortcut "negative frames did not throw"
  } catch {
    $rejected += 1
  }
  $ledger = @{ v = 4; mouse_snap = @{ original = $true; owned = $true } }
  Assert-SpiPreimageOwned $ledger "mock-spi"
  try {
    Assert-SpiPreimageOwned @{ v = 2; mouse_snap = @{ original = $true; owned = $true } } "mock-negative-spi-version"
    Fail-Shortcut "negative spi version did not throw"
  } catch {
    $rejected += 1
  }
  try {
    Assert-SpiPreimageOwned @{ v = 4; mouse_snap = @{ original = $true; owned = $false } } "mock-negative-spi"
    Fail-Shortcut "negative spi did not throw"
  } catch {
    $rejected += 1
  }
  $n0 = ConvertTo-AbsoluteNative 0 0 2560
  if ($n0 -ne 0) {
    Fail-Shortcut "mock abs zero $n0"
  }
  $nMax = ConvertTo-AbsoluteNative 2559 0 2560
  if ($nMax -ne 65535) {
    Fail-Shortcut "mock abs max $nMax"
  }
  if ($MOUSEEVENTF_MOVE -ne 1 -or $MOUSEEVENTF_LEFTDOWN -ne 2 -or $MOUSEEVENTF_LEFTUP -ne 4 -or $MOUSEEVENTF_ABSOLUTE -ne 32768 -or $GA_ROOT -ne 2) {
    Fail-Shortcut "mock mouse flags"
  }
  Assert-OcclusionClear 42 42 "mock-occl"
  foreach ($badSpan in @(0, 1)) {
    try {
      $null = ConvertTo-AbsoluteNative 5 0 $badSpan
      Fail-Shortcut "negative abs span did not throw"
    } catch {
      if ("$($_.Exception.Message)" -notmatch "absolute span") {
        throw
      }
      $rejected += 1
    }
  }
  # Arrow payload regression: arrows must resolve to EXTENDEDKEY plus their
  # truthful scan (literals, not via the table under test); every other chord
  # key stays plain wVk scan 0. Negative tamperings must throw.
  foreach ($arrow in @(37, 38, 39, 40)) {
    $wantScan = @{ 37 = 75; 38 = 72; 39 = 77; 40 = 80 }[$arrow]
    if ([int]$ARROW_SCAN_TABLE[$arrow] -ne $wantScan) {
      Fail-Shortcut "mock arrow table vk=$arrow != truthful $wantScan"
    }
    Assert-EncodingInvariant $arrow $true $wantScan "mock-arrow-$arrow"
  }
  foreach ($plain in @(72, 74, 75, 76, 91, 160, 17, 90, 27)) {
    Assert-EncodingInvariant $plain $false 0 "mock-plain-$plain"
  }
  foreach ($bad in @(@{ vk = 39; ext = $false; scan = 77 }, @{ vk = 39; ext = $true; scan = 0 }, @{ vk = 72; ext = $true; scan = 0 })) {
    try {
      Assert-EncodingInvariant $bad.vk $bad.ext $bad.scan "mock-negative-encoding"
      Fail-Shortcut "negative encoding did not throw"
    } catch {
      if ("$($_.Exception.Message)" -notmatch "vk=$($bad.vk)") {
        throw
      }
      $rejected += 1
    }
  }
  try {
    Assert-OcclusionClear 7 42 "mock-negative-occl"
    Fail-Shortcut "negative occlusion did not throw"
  } catch {
    if ("$($_.Exception.Message)" -notmatch "occluded/foreign") {
      throw
    }
    $rejected += 1
  }
  Assert-RectNonEmpty "8,8,630,1364" "mock-rect"
  foreach ($badRect in @(",,,", "5,5,5,5", "8,8,4,4")) {
    try {
      Assert-RectNonEmpty $badRect "mock-negative-rect"
      Fail-Shortcut "negative rect did not throw"
    } catch {
      if ("$($_.Exception.Message)" -notmatch "rect") {
        throw
      }
      $rejected += 1
    }
  }
  Rec-Shortcut "mock-negative-rejections" @{ proven = $rejected; want = 21 }
  if ($rejected -ne 21) {
    Fail-Shortcut "mock rejection count $rejected != 21"
  }
  return @{ status = "pass"; stage = "Mock"; steps = $ShortcutSteps }
}

# ---------------------------------------------------------------------------
# Live stages. Every stage runs inside the top-level try/finally in the -Live
# block: failures save a fail report, stop the exact owner, restore, close
# only created exact tagged helpers, and verify SPI/ledger/actors before
# reporting. PASS is written only when every semantic assertion held.
# ---------------------------------------------------------------------------

function New-ShortcutRunDir([string]$Base) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dir = Join-Path $Base "target\windows-shortcuts\$stamp-$PID"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Start-PassiveShortcutHelper([string]$HelperBin, [string]$ProofDir, [string]$Name) {
  $receipt = Join-Path $ProofDir "$Name.json"
  if (Test-Path $receipt) {
    Fail-Shortcut "receipt preexists $receipt"
  }
  $helperArgString = "run --receipt `"$receipt`" --seconds 600 --passive"
  Start-ExplorerGui $HelperBin $helperArgString $ProofDir
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path $receipt)) {
    if ((Get-Date) -gt $deadline) {
      Fail-Shortcut "helper receipt timeout $Name"
    }
    Start-Sleep -Milliseconds 200
  }
  $snap = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if (-not (Test-ExeEqual "$($snap.process.exe_path)" "$HelperBin")) {
    Fail-Shortcut "$Name helper peer mismatch"
  }
  Assert-ParentIsExplorer ([int]$snap.process.pid)
  if ([string]$snap.tag -eq "") {
    Fail-Shortcut "$Name helper missing tag"
  }
  if ($snap.visible -ne $false) {
    Fail-Shortcut "$Name passive helper visible at create"
  }
  return $snap
}

function Get-DisplayBaselineLive([string]$Payload, [string]$AllowPath) {
  # Fresh physical captures: owner tile-start work/full/monitors plus
  # per-window DPI from inspect plus OS build. No hardcoded geometry.
  $readyProbe = Invoke-Native $Payload @("identity") | ConvertFrom-Json
  $os = Get-CimInstance Win32_OperatingSystem
  return @{
    os_build = "$($os.BuildNumber)"
    ledger_directory = "$($readyProbe.ledger_directory)"
    session = "$($readyProbe.process.session_id)"
  }
}

function Invoke-OwnedFocusMoveLive($Ctx, [switch]$SkipFocus) {
  $ownerCopy = $Ctx.ownerCopy
  $helperCopy = $Ctx.helperCopy
  $proofDir = $Ctx.proofDir
  $ownerSeconds = $Ctx.ownerSeconds
  Assert-NoWinLJourney (Get-ShortcutJourney)
  $h1 = Start-PassiveShortcutHelper $helperCopy $proofDir "sc-helper1"
  $h2 = Start-PassiveShortcutHelper $helperCopy $proofDir "sc-helper2"
  $h3 = Start-PassiveShortcutHelper $helperCopy $proofDir "sc-helper3"
  $bg = Start-PassiveShortcutHelper $helperCopy $proofDir "sc-background"
  $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $h2; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $h3; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $bg; bin = $helperCopy })
  Rec-Shortcut "helpers-created" @(@($h1, $h2, $h3, $bg) | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; tag = $_.tag } })
  # Frozen allowlist covers the three managed helpers only; bg stays outside.
  $allowPath = Join-Path $proofDir "shortcut-allowlist.json"
  $entries = @()
  foreach ($s in @($h1, $h2, $h3)) {
    $entries += @{
      hwnd = [uint64]$s.hwnd
      pid = [uint32]$s.process.pid
      process_creation = "$($s.process.process_creation)"
      exe_path = "$($s.process.exe_path)"
      user_sid = "$($s.process.user_sid)"
      session_id = [uint32]$s.process.session_id
      tag = "$($s.tag)"
    }
  }
  @{ windows = $entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  $ownerArgString = "--allowlist `"$allowPath`" --seconds $ownerSeconds --trace"
  if ($Ctx.noMouse) {
    $ownerArgString += " --no-mouse-snap-prevention"
  }
  Start-ExplorerGui $ownerCopy "shortcut-proof $ownerArgString" $binDir
  $ready = Assert-OwnerReady $ownerCopy "shortcut-owned"
  $Ctx.ownerFrozen = $ready.owner
  $Ctx.ownerRunning = $true
  $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Shortcut "owner-ready" @{ pid = $ready.owner.pid; log = $logPath; argv = $ownerArgString }
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $ledgerDir = "$($ident.ledger_directory)"
  $auditPath = Join-Path $ledgerDir "proof-audit-$($ready.owner.process_creation).jsonl"
  if (-not (Test-Path -LiteralPath $auditPath)) {
    Fail-Shortcut "proof audit missing $auditPath"
  }
  $Ctx.auditPath = $auditPath
  $base = Get-DisplayBaselineLive $ownerCopy $allowPath
  Rec-Shortcut "display-baseline" $base
  $mark = (Get-CompleteLinesLocal $logPath).Count
  $start = $null
  foreach ($e in (Get-LogEventsAfter $logPath 0).events) {
    if ($e.event -eq "tile-start") {
      $start = $e
    }
  }
  if ($null -eq $start) {
    Fail-Shortcut "tile-start missing"
  }
  Assert-TileStartMode $start "shortcut-proof" $true $false "shortcut-owned"
  if ($null -eq $start.work -or $null -eq $start.full) {
    Fail-Shortcut "tile-start missing work/full"
  }
  Rec-Shortcut "tile-start" @{ mode = "$($start.mode)"; monitors = $start.monitors; work = ($start.work -join ","); full = ($start.full -join ",") }
  $auditStart = $null
  $auditFrozen = $null
  foreach ($e in (Get-LogEventsAfter $auditPath 0).events) {
    if ($e.event -eq "proof-start") {
      $auditStart = $e
    }
    if ($e.event -eq "proof-frozen") {
      $auditFrozen = $e
    }
  }
  if ($null -eq $auditStart) {
    Fail-Shortcut "proof-start missing"
  }
  Assert-ProofStartArgv $auditStart.argv @("--allowlist", "--seconds", "--trace") "shortcut-owned"
  if ($null -eq $auditFrozen) {
    Fail-Shortcut "proof-frozen missing"
  }
  Rec-Shortcut "proof-audit" @{ argv = $auditStart.argv; digest = "$($auditStart.allowlist_digest)"; count = $auditStart.allowlist_count }
  # Admit the frozen helpers (exact tags, no activation) and converge to the
  # canonical adopted arrangement: Engine plans == all native frames.
  Show-ExactHelper $h1 $h1 $helperCopy "admit-1"
  Show-ExactHelper $h2 $h2 $helperCopy "admit-2"
  Show-ExactHelper $h3 $h3 $helperCopy "admit-3"
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $mark 25 "adopt"
  Rec-Shortcut "adopted" @{ tick = $conv.tick; desired = $conv.desired; readback = $conv.readback }
  $dpi = @($conv.inspect.windows | Where-Object { $_.eligible -eq $true } | ForEach-Object { [int]$_.dpi } | Sort-Object -Unique)
  if ($dpi.Count -ne 1) {
    Fail-Shortcut "DPI not uniform: $($dpi -join ',')"
  }
  Rec-Shortcut "adopted-dpi" @{ dpi = $dpi }
  $sentAccepted = 0
  $clickAccepted = 0
  $activateAccepted = 0
  # Focus journey: per-row valid source from the canonical adopted geometry
  # (extremal window with a geometric neighbor in the row direction, so the
  # Engine holds a directional candidate), guarded mouse-activated for real
  # foreground rights, then the marked chord. Oracle stays semantic: a
  # consumed snap focus-ok whose origin maps to the pre-action foreground,
  # with the new foreground on a different frozen owned HWND and zero
  # geometry change, plus Engine plan == readback == inspect frames.
  # -SkipFocus (OwnedMove stage) bypasses these rows honestly: movement needs
  # no SetForegroundWindow, so moves stay reachable while focus is blocked.
  # The skip is recorded; no focus PASS is ever claimed for a skipped run.
  if ($SkipFocus) {
    Rec-Shortcut "focus-skipped" @{ reason = "OwnedMove bypasses focus-ok rows; focus makes no claim" }
  }
  $focusRows = @((Get-ShortcutJourney) | Where-Object { $_.family -eq "focus-ok" })
  if (-not $SkipFocus) {
  foreach ($row in $focusRows) {
    $src = Get-DirectionalSource $ownerCopy $allowPath $row.direction @($h1, $h2, $h3) "$($row.name)-source"
    $srcSnap = Invoke-Native $helperCopy @("inspect", "$($src.hwnd)") | ConvertFrom-Json
    $activated = Invoke-OwnedFocusEnsure $srcSnap $src $helperCopy "$($row.name)-activate"
    $activateAccepted += [int]$activated.prime_inserted
    Rec-Shortcut "activate-$($row.name)" $activated
    $pre = Get-InspectFrames $ownerCopy $allowPath
    $preFg = [uint64]$src.hwnd
    if ([uint64]$pre.inspect.foreground -ne $preFg) {
      Fail-Shortcut "$($row.name) foreground $($pre.inspect.foreground) != source $preFg after click"
    }
    $sendMark = (Get-CompleteLinesLocal $logPath).Count
    $sent = Send-MarkedChord ([int]$row.vk) ([bool]$row.shift) ([bool]$row.ctrl) $preFg 0 $false
    $sentAccepted += [int]$sent.accepted
    Rec-Shortcut "send-$($row.name)" $sent
    $ev = Wait-SnapAfter $logPath $sendMark $row.op $row.direction 20 "$($row.name)"
    if ("$($ev.outcome)" -ne "focus-ok") {
      Fail-Shortcut "$($row.name) outcome $($ev.outcome) != focus-ok"
    }
    $post = Get-InspectFrames $ownerCopy $allowPath
    $postFg = [uint64]$post.inspect.foreground
    if ($postFg -eq $preFg) {
      Fail-Shortcut "$($row.name) foreground did not advance"
    }
    if (-not ((Get-FrozenHwnds @($h1, $h2, $h3)) -contains $postFg)) {
      Fail-Shortcut "$($row.name) foreground $postFg left the frozen set"
    }
    $postSnap = Invoke-Native $helperCopy @("inspect", "$postFg") | ConvertFrom-Json
    $frozenPost = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq $postFg } | Select-Object -First 1
    Assert-FullIdentityMatches $postSnap $frozenPost "$($row.name)-target"
    Assert-FramesEqual $pre.frames $post.frames "$($row.name)-geometry"
    $tailConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $sendMark 20 "$($row.name)-plan"
    Rec-Shortcut "journey-$($row.name)" @{
      op = $row.op
      direction = $row.direction
      outcome = "$($ev.outcome)"
      from_hwnd = $preFg
      to_hwnd = $postFg
      plan_tick = $tailConv.tick
      desired = $tailConv.desired
      readback = $tailConv.readback
    }
  }
  }
  # Move journey: Engine plan entries == all current native frames per move.
  # Sources are adaptive like focus rows (geometric neighbor required).
  $moveRows = @((Get-ShortcutJourney) | Where-Object { $_.family -eq "move-applied" })
  foreach ($row in $moveRows) {
    $src = Get-DirectionalSource $ownerCopy $allowPath $row.direction @($h1, $h2, $h3) "$($row.name)-source"
    $srcSnap = Invoke-Native $helperCopy @("inspect", "$($src.hwnd)") | ConvertFrom-Json
    $activated = Invoke-OwnedFocusEnsure $srcSnap $src $helperCopy "$($row.name)-activate"
    $activateAccepted += [int]$activated.prime_inserted
    Rec-Shortcut "activate-$($row.name)" $activated
    $pre = Get-InspectFrames $ownerCopy $allowPath
    $preFg = [uint64]$src.hwnd
    if ([uint64]$pre.inspect.foreground -ne $preFg) {
      Fail-Shortcut "$($row.name) foreground $($pre.inspect.foreground) != source $preFg after click"
    }
    $sendMark = (Get-CompleteLinesLocal $logPath).Count
    $sent = Send-MarkedChord ([int]$row.vk) ([bool]$row.shift) ([bool]$row.ctrl) $preFg 0 $false
    $sentAccepted += [int]$sent.accepted
    Rec-Shortcut "send-$($row.name)" $sent
    $ev = Wait-SnapAfter $logPath $sendMark $row.op $row.direction 20 "$($row.name)"
    if ("$($ev.outcome)" -ne "move-applied") {
      Fail-Shortcut "$($row.name) outcome $($ev.outcome) != move-applied"
    }
    $tailConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $sendMark 20 "$($row.name)-plan"
    $postMove = Get-InspectFrames $ownerCopy $allowPath
    if ([uint64]$postMove.inspect.foreground -ne $preFg) {
      Fail-Shortcut "$($row.name) move changed foreground $($postMove.inspect.foreground) != origin $preFg"
    }
    Rec-Shortcut "journey-$($row.name)" @{
      op = $row.op
      direction = $row.direction
      outcome = "$($ev.outcome)"
      origin_still_focused = $true
      plan_tick = $tailConv.tick
      desired = $tailConv.desired
      readback = $tailConv.readback
    }
  }
  # Repeat journey: one hold, repeated downs, all labeled synthetic; repeat
  # edges must dispatch (down + at least one repeat consumed). Consumed
  # edges log regardless of Engine outcome, so any frozen source works.
  $repRow = (Get-ShortcutJourney) | Where-Object { $_.family -eq "repeat" } | Select-Object -First 1
  $pre = Get-InspectFrames $ownerCopy $allowPath
  $repSrc = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq [uint64]$pre.inspect.foreground } | Select-Object -First 1
  if ($null -eq $repSrc) {
    $repSrc = $h1
  }
  $repSnap = Invoke-Native $helperCopy @("inspect", "$($repSrc.hwnd)") | ConvertFrom-Json
  $activated = Invoke-OwnedFocusEnsure $repSnap $repSrc $helperCopy "repeat-activate"
  $activateAccepted += [int]$activated.prime_inserted
  Rec-Shortcut "activate-repeat-down-j" $activated
  $preFg = [uint64]$repSrc.hwnd
  $sendMark = (Get-CompleteLinesLocal $logPath).Count
  $sent = Send-MarkedChord ([int]$repRow.vk) $false $false $preFg ([int]$repRow.repeats) $false
  $sentAccepted += [int]$sent.accepted
  if (-not $sent.synthetic) {
    Fail-Shortcut "repeat input not labeled synthetic"
  }
  Rec-Shortcut "send-repeat-down-j" $sent
  $repDeadline = (Get-Date).AddSeconds(20)
  $consumedEdges = @()
  while ((Get-Date) -lt $repDeadline) {
    $tail = Get-LogEventsAfter $logPath $sendMark
    $consumedEdges = @($tail.events | Where-Object { ($_.event -eq "snap") -and ($_.disposition -eq "consumed") -and ("$($_.op)" -eq "focus") -and ("$($_.direction)" -eq "down") })
    $downs = @($consumedEdges | Where-Object { "$($_.edge)" -eq "down" }).Count
    $reps = @($consumedEdges | Where-Object { "$($_.edge)" -eq "repeat" }).Count
    if (($downs -ge 1) -and ($reps -ge 1)) {
      break
    }
    Start-Sleep -Milliseconds 400
  }
  $downs = @($consumedEdges | Where-Object { "$($_.edge)" -eq "down" }).Count
  $reps = @($consumedEdges | Where-Object { "$($_.edge)" -eq "repeat" }).Count
  if (($downs -lt 1) -or ($reps -lt 1)) {
    Fail-Shortcut "repeat edges down=$downs repeat=$reps, need >=1 each"
  }
  Rec-Shortcut "journey-repeat-down-j" @{ down = $downs; repeat = $reps; synthetic = $true }
  # Edge noop: true geometric boundary with all three members retained.
  # Minimized members keep Engine membership via retained rows (last-known
  # snapshot), so minimizing can never converge to a single-entry plan
  # (desired stays 3 while readback shows 1). Instead pick the geometrically
  # verified left edge among the three eligible rects (no strict left
  # neighbor with perpendicular overlap), focus it non-click, and assert a
  # true unchanged noop: consumed focus/left outcome unchanged, geometry
  # equal, foreground pinned. No minimize/restore and no pointer input.
  $edgeRow = (Get-ShortcutJourney) | Where-Object { $_.family -eq "edge-noop" } | Select-Object -First 1
  $edgeLayout = Invoke-Native $ownerCopy @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json
  $edgeElig = @($edgeLayout.windows | Where-Object { $_.eligible -eq $true })
  if ($edgeElig.Count -ne 3) {
    Fail-Shortcut "edge layout eligible $($edgeElig.Count) != 3"
  }
  $edgeCands = @()
  foreach ($w in $edgeElig) {
    $x = [int]$w.visible[0]; $y = [int]$w.visible[1]; $ww = [int]$w.visible[2]; $hh = [int]$w.visible[3]
    $hasLeft = $false
    foreach ($o in $edgeElig) {
      if ([uint64]$o.hwnd -eq [uint64]$w.hwnd) {
        continue
      }
      $ox = [int]$o.visible[0]; $oy = [int]$o.visible[1]; $ow = [int]$o.visible[2]; $oh = [int]$o.visible[3]
      if ((($ox + $ow) -le $x) -and (($y -lt ($oy + $oh)) -and ($oy -lt ($y + $hh)))) {
        $hasLeft = $true
      }
    }
    if (-not $hasLeft) {
      $edgeCands += $w
    }
  }
  if ($edgeCands.Count -eq 0) {
    $rects = (@($edgeElig | ForEach-Object { "$($_.hwnd)=$($_.visible -join ',')" }) -join " ")
    Fail-Shortcut "edge-noop-left no left-edge candidate in layout: $rects"
  }
  $edgePick = @($edgeCands | Sort-Object { [int]$_.visible[0] } | Select-Object -First 1)[0]
  $edgeSrc = @($h1, $h2, $h3) | Where-Object { [uint64]$_.hwnd -eq [uint64]$edgePick.hwnd } | Select-Object -First 1
  if ($null -eq $edgeSrc) {
    Fail-Shortcut "edge-noop-left picked $($edgePick.hwnd) left the frozen set"
  }
  $edgeSnap = Invoke-Native $helperCopy @("inspect", "$($edgeSrc.hwnd)") | ConvertFrom-Json
  $activated = Invoke-OwnedFocusEnsure $edgeSnap $edgeSrc $helperCopy "edge-source"
  $activateAccepted += [int]$activated.prime_inserted
  Rec-Shortcut "activate-edge-source" $activated
  $edgeMark = (Get-CompleteLinesLocal $logPath).Count
  $edgeConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd, $h2.hwnd, $h3.hwnd) $logPath $edgeMark 20 "edge-base"
  Rec-Shortcut "edge-base" @{ tick = $edgeConv.tick; desired = $edgeConv.desired; edge_hwnd = "$($edgeSrc.hwnd)"; edge_rect = ($edgePick.visible -join ",") }
  $fgNow = [uint64](Invoke-Native $ownerCopy @("inspect", "--allowlist", $AllowPath) | ConvertFrom-Json).foreground
  if ($fgNow -ne [uint64]$edgeSrc.hwnd) {
    Fail-Shortcut "edge source lost foreground"
  }
  $preFrames = (Get-InspectFrames $ownerCopy $allowPath).frames
  $sendMark = (Get-CompleteLinesLocal $logPath).Count
  $sent = Send-MarkedChord ([int]$edgeRow.vk) ([bool]$edgeRow.shift) ([bool]$edgeRow.ctrl) ([uint64]$edgeSrc.hwnd) 0 $false
  $sentAccepted += [int]$sent.accepted
  Rec-Shortcut "send-edge-noop-left" $sent
  $ev = Wait-SnapAfter $logPath $sendMark "focus" "left" 20 "edge-noop-left"
  if ("$($ev.outcome)" -ne "unchanged") {
    Fail-Shortcut "edge outcome $($ev.outcome) != unchanged"
  }
  $post = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preFrames $post.frames "edge-noop-geometry"
  if ([uint64]$post.inspect.foreground -ne [uint64]$edgeSrc.hwnd) {
    Fail-Shortcut "edge noop moved foreground"
  }
  $postSnap = Invoke-Native $helperCopy @("inspect", "$($edgeSrc.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $postSnap $edgeSrc "edge-noop-target"
  Rec-Shortcut "journey-edge-noop-left" @{ outcome = "$($ev.outcome)"; foreground = "$($post.inspect.foreground)"; edge_hwnd = "$($edgeSrc.hwnd)" }
  # Pass-through: Win+Ctrl+H is OS-harmless (no binding) and classifier-clean
  # (extra modifier forces untracked). Foreground is a frozen helper first,
  # then the out-of-allowlist background helper. Bound input only.
  $preFrames = (Get-InspectFrames $ownerCopy $allowPath).frames
  $passSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  $activated = Invoke-OwnedFocusEnsure $passSnap $h1 $helperCopy "passthrough-target"
  $activateAccepted += [int]$activated.prime_inserted
  Rec-Shortcut "activate-passthrough-extra-modifier" $activated
  $sendMark = (Get-CompleteLinesLocal $logPath).Count
  $sent = Send-MarkedChord $VK_H $false $true ([uint64]$h1.hwnd) 0 $false
  $sentAccepted += [int]$sent.accepted
  Rec-Shortcut "send-passthrough-extra-modifier" $sent
  Wait-NoConsumedSnap $logPath $sendMark 8 "passthrough-extra-modifier"
  $post = Get-InspectFrames $ownerCopy $allowPath
  Assert-FramesEqual $preFrames $post.frames "passthrough-extra-geometry"
  if ([uint64]$post.inspect.foreground -ne [uint64]$h1.hwnd) {
    Fail-Shortcut "extra-modifier moved foreground"
  }
  Rec-Shortcut "journey-passthrough-extra-modifier" @{ outcome = "passed"; foreground = "$($post.inspect.foreground)" }
  # The background helper starts passive/invisible, which can never hold
  # foreground (the hook binds origins to the foreground window). Admit it
  # visibly without activation, then activating-raise it to exact foreground
  # (identity/geometry rechecked, never topmost). The redundant caption click
  # is skipped by design once native foreground is proven: same point would
  # risk a double-click pair and the acceptance is identical (unmanaged
  # foreground, active hook, managed tiles still present, zero consumed
  # focus chords). It stays outside the allowlist, so the chord origin is
  # unmanaged and the intent passes through undispatched. Bound input only.
  Show-ExactHelper $bg $bg $helperCopy "background-admit"
  $bgActive = Invoke-ExactHelperActivate $bg $bg $helperCopy "background-activate"
  Rec-Shortcut "activate-passthrough-background" $bgActive
  $preBg = Invoke-Native $helperCopy @("inspect", "$($bg.hwnd)") | ConvertFrom-Json
  $sendMark = (Get-CompleteLinesLocal $logPath).Count
  $sent = Send-MarkedChord $VK_H $false $true ([uint64]$bg.hwnd) 0 $false
  $sentAccepted += [int]$sent.accepted
  Rec-Shortcut "send-passthrough-background" $sent
  Wait-NoConsumedSnap $logPath $sendMark 8 "passthrough-background"
  $postBg = Invoke-Native $helperCopy @("inspect", "$($bg.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $postBg $bg "background-intact"
  $fgAfter = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgAfter -ne [uint64]$bg.hwnd) {
    Fail-Shortcut "background foreground moved"
  }
  Rec-Shortcut "journey-passthrough-background" @{ outcome = "passed"; foreground = "$fgAfter" }
  # Foreground gate on the excluded tagged bg helper: a plain marked Win+Left
  # while the unmanaged helper holds foreground must pass through
  # undispatched (no consumed snap), proving the hook gates on managed
  # foreground only. No geometry oracle: session SPI prevention may suppress
  # the native snap while the owner runs, so before/after is recorded, not
  # asserted. Foreground is then parked back on a managed helper.
  $gatePre = Invoke-Native $helperCopy @("inspect", "$($bg.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $gatePre $bg "background-gate-pre"
  $gateMark = (Get-CompleteLinesLocal $logPath).Count
  $gateSent = Send-MarkedChord $VK_LEFT $false $false ([uint64]$bg.hwnd) 0 $false
  $sentAccepted += [int]$gateSent.accepted
  Rec-Shortcut "send-passthrough-background-plain" $gateSent
  Wait-NoConsumedSnap $logPath $gateMark 8 "passthrough-background-plain"
  $gatePost = Invoke-Native $helperCopy @("inspect", "$($bg.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $gatePost $bg "background-gate-intact"
  $fgGate = [ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ([uint64]$fgGate -ne [uint64]$bg.hwnd) {
    Fail-Shortcut "background gate foreground moved"
  }
  $gateChanged = ("$($gatePre.left),$($gatePre.top),$($gatePre.right),$($gatePre.bottom)" -cne "$($gatePost.left),$($gatePost.top),$($gatePost.right),$($gatePost.bottom)")
  Rec-Shortcut "journey-passthrough-background-plain" @{ outcome = "passed"; foreground = "$fgGate"; native_effect = $gateChanged; note = "no geometry oracle; SPI prevention may suppress native snap; residue closed at cleanup" }
  $parkSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  $parked = Invoke-OwnedFocusEnsure $parkSnap $h1 $helperCopy "background-gate-park"
  $activateAccepted += [int]$parked.prime_inserted
  Rec-Shortcut "activate-background-gate-park" $parked
  Rec-Shortcut "sendinput-accepted-total" @{ accepted = $sentAccepted; note = "accepted counts only; effects asserted from owner logs plus inspect readback" }
  Rec-Shortcut "click-accepted-total" @{ accepted = $clickAccepted; unmarked = $true; note = "guarded title-bar mouse clicks only; no click on occluded/foreign target" }
  Rec-Shortcut "activate-accepted-total" @{ accepted = $activateAccepted; note = "non-click owned-helper focus ensures; prime_inserted counts E8 attach primes only (raise path sends zero input)" }
  # Mask evidence: at least one clean pair stamped inserted==2.
  $tailAll = Get-LogEventsAfter $logPath 0
  $masks = @($tailAll.events | Where-Object { $_.event -eq "snap-mask" })
  $clean = @($masks | Where-Object { [int]$_.mask.inserted -eq 2 })
  if ($clean.Count -lt 1) {
    Fail-Shortcut "no clean mask pair stamped"
  }
  Rec-Shortcut "mask-evidence" @{ pairs = $masks.Count; clean = $clean.Count }
  $prodLines = @($tailAll.events | Where-Object { ($_.event -eq "snap") -or ($_.event -eq "snap-mask") -or ($_.event -eq "tick") } | ForEach-Object { ($_ | ConvertTo-Json -Compress) })
  Assert-ProductionLogTokenOnly $prodLines
  Rec-Shortcut "production-logs" @{ lines = $prodLines.Count; token_only = $true }
  $stopped = Stop-ExactOwner $ownerCopy $false "shortcut-owned" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Shortcut "owner-stop" $stopped
  # Standalone native Snap release check: hook gone (ready false), one safe
  # UNMARKED Win+Left on h1 must reach the OS (geometry changes), then
  # minimize+restore leaves it normal/unmaximized for cleanup.
  $readyAfter = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
  if ($readyAfter.ready -ne $false) {
    Fail-Shortcut "owner still ready after stop"
  }
  $relSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  $activated = Invoke-OwnedFocusEnsure $relSnap $h1 $helperCopy "release-target"
  $activateAccepted += [int]$activated.prime_inserted
  Rec-Shortcut "activate-release-target" $activated
  $relPre = @("$($relSnap.left),$($relSnap.top),$($relSnap.right),$($relSnap.bottom)")
  $relSent = Send-MarkedChord $VK_LEFT $false $false ([uint64]$h1.hwnd) 0 $true
  Rec-Shortcut "release-tap" @{ accepted = $relSent.accepted; unmarked = $true }
  Start-Sleep -Milliseconds 1200
  $relPost = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $relPost $h1 "release-intact"
  $relPostRect = "$($relPost.left),$($relPost.top),$($relPost.right),$($relPost.bottom)"
  Assert-RectNonEmpty "$relPre" "release-before"
  Assert-RectNonEmpty $relPostRect "release-after"
  Assert-FramesChanged $relPre @($relPostRect) "release-native-snap"
  Rec-Shortcut "release-native-snap" @{ before = @($relPre); after = $relPostRect }
  $minRel = Invoke-Native $helperCopy @("minimize", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$minRel.foreground -eq [uint64]$h1.hwnd) {
    Fail-Shortcut "release minimize focused"
  }
  $rstRel = Invoke-Native $helperCopy @("restore", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$rstRel.foreground -eq [uint64]$h1.hwnd) {
    Fail-Shortcut "release restore focused"
  }
  $zoomed = [ShortcutProofNative]::IsZoomed([IntPtr][long]$h1.hwnd)
  if ($zoomed) {
    Fail-Shortcut "release helper left maximized"
  }
  Rec-Shortcut "release-reset" @{ unmaximized = $true }
  # Snap Layouts best-effort probe (bounded, no oracle): hover the exact
  # helper maximize button (read-only point, occlusion-guarded, no click),
  # one UNMARKED Win+Z targeted at the helper (ordinary synthetic input, no
  # secure desktop), one unmarked Esc to dismiss. No programmatic oracle
  # exists for the shell flyout, so this records pending-physical unless a
  # later run positively enumerates it; nothing is fabricated from
  # EnumWindows alone and physical-key acceptance is never claimed.
  $laySnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $laySnap $h1 "layouts-prefocus"
  $layActivated = Invoke-OwnedFocusEnsure $laySnap $h1 $helperCopy "layouts-target"
  $activateAccepted += [int]$layActivated.prime_inserted
  Rec-Shortcut "activate-layouts-target" $layActivated
  $maxX = [int]$laySnap.right - 20
  $maxY = [int]$laySnap.top + 12
  $maxAnc = [ShortcutProofNative]::WindowAncestorAt($maxX, $maxY)
  if ([uint64]$maxAnc -eq [uint64]$h1.hwnd) {
    $savedCur = [ShortcutProofNative]::CursorXY()
    $vx2 = [ShortcutProofNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
    $vy2 = [ShortcutProofNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
    $vw2 = [ShortcutProofNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
    $vh2 = [ShortcutProofNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
    $hx = ConvertTo-AbsoluteNative $maxX $vx2 $vw2
    $hy = ConvertTo-AbsoluteNative $maxY $vy2 $vh2
    $moveFlags = ($MOUSEEVENTF_MOVE -bor $MOUSEEVENTF_ABSOLUTE)
    if ([ShortcutProofNative]::SendMouse($moveFlags, $hx, $hy, [uint64]0) -ne 1) {
      Fail-Shortcut "layouts hover short insertion"
    }
    Start-Sleep -Milliseconds 1500
    $fgNow = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
    $zw = Send-MarkedChord $VK_Z $false $false ([uint64]$h1.hwnd) 0 $true
    Rec-Shortcut "send-layouts-winz" $zw
    Start-Sleep -Milliseconds 1500
    $escDown = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $false, [uint64]0)
    $escUp = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $true, [uint64]0)
    if ($escDown -ne 1 -or $escUp -ne 1) {
      Fail-Shortcut "layouts esc short insertion"
    }
    if ($null -ne $savedCur) {
      $qx = ConvertTo-AbsoluteNative ([int]$savedCur[0]) $vx2 $vw2
      $qy = ConvertTo-AbsoluteNative ([int]$savedCur[1]) $vy2 $vh2
      if ([ShortcutProofNative]::SendMouse($moveFlags, $qx, $qy, [uint64]0) -ne 1) {
        Fail-Shortcut "layouts cursor restore short insertion"
      }
    }
    $fgAfter = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
    Rec-Shortcut "layouts-probe" @{ hover_ancestor_match = $true; foreground_before = $fgNow; foreground_after = $fgAfter; oracle = "pending-physical" }
  } else {
    Rec-Shortcut "layouts-probe" @{ hover_ancestor_match = $false; oracle = "pending-physical"; note = "maximize corner occluded/foreign, no hover, no input" }
  }
}

function Invoke-SpiGracefulLive($Ctx) {
  $ownerCopy = $Ctx.ownerCopy
  $helperCopy = $Ctx.helperCopy
  $proofDir = $Ctx.proofDir
  $ownerSeconds = $Ctx.ownerSeconds
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $preLive = Read-SpiArranging
  Rec-Shortcut "spi-preflight" @{ arranging = $preLive; ledger = "$($ident.ledger_directory)" }
  $snap = Start-PassiveShortcutHelper $helperCopy $proofDir "spi-helper"
  $null = $Ctx.created.Add(@{ snap = $snap; bin = $helperCopy })
  Show-ExactHelper $snap $snap $helperCopy "spi-admit"
  $allowPath = Join-Path $proofDir "spi-allowlist.json"
  @{ windows = @(@{
    hwnd = [uint64]$snap.hwnd
    pid = [uint32]$snap.process.pid
    process_creation = "$($snap.process.process_creation)"
    exe_path = "$($snap.process.exe_path)"
    user_sid = "$($snap.process.user_sid)"
    session_id = [uint32]$snap.process.session_id
    tag = "$($snap.tag)"
  }) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  $ownerArgString = "--allowlist `"$allowPath`" --seconds $ownerSeconds --trace"
  if ($Ctx.noMouse) {
    $ownerArgString += " --no-mouse-snap-prevention"
  }
  Start-ExplorerGui $ownerCopy "shortcut-proof $ownerArgString" $binDir
  $ready = Assert-OwnerReady $ownerCopy "spi-grace"
  $Ctx.ownerFrozen = $ready.owner
  $Ctx.ownerRunning = $true
  $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  $ledgerDir = "$($ident.ledger_directory)"
  $mark = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($snap.hwnd) $logPath $mark 20 "spi-adopt"
  Rec-Shortcut "spi-adopted" @{ tick = $conv.tick }
  $ledgerText = Get-Content -LiteralPath (Join-Path $ledgerDir "ledger.json") -Raw | ConvertFrom-Json
  if ($preLive -and (-not $Ctx.noMouse)) {
    Assert-SpiPreimageOwned $ledgerText "spi-grace-preimage"
  }
  Rec-Shortcut "spi-ledger" @{ v = $ledgerText.v; mouse_snap = $ledgerText.mouse_snap }
  $midLive = Read-SpiArranging
  if ((-not $Ctx.noMouse) -and $preLive -and ($midLive -ne $false)) {
    Fail-Shortcut "SPI effect not observed"
  }
  Rec-Shortcut "spi-mid-live" @{ arranging = $midLive }
  $stopped = Stop-ExactOwner $ownerCopy $false "spi-grace" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  $postLive = Read-SpiArranging
  Rec-Shortcut "spi-graceful" @{ pre = $preLive; post = $postLive; stop = $stopped.stop.owner_exited }
  if ($postLive -ne $preLive) {
    Fail-Shortcut "SPI graceful restore mismatch"
  }
  $tailAll = Get-LogEventsAfter $logPath 0
  $mouseEvents = @($tailAll.events | Where-Object { $_.event -eq "mouse-snap" })
  Rec-Shortcut "spi-log" @{ events = @($mouseEvents | ForEach-Object { "$($_.phase)=$($_.outcome)" }) }
}

function Invoke-SpiCrashLive($Ctx) {
  $ownerCopy = $Ctx.ownerCopy
  $helperCopy = $Ctx.helperCopy
  $proofDir = $Ctx.proofDir
  $ownerSeconds = $Ctx.ownerSeconds
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $preLive = Read-SpiArranging
  Rec-Shortcut "spi-crash-preflight" @{ arranging = $preLive }
  $snap = Start-PassiveShortcutHelper $helperCopy $proofDir "spicrash-helper"
  $null = $Ctx.created.Add(@{ snap = $snap; bin = $helperCopy })
  Show-ExactHelper $snap $snap $helperCopy "spicrash-admit"
  $allowPath = Join-Path $proofDir "spicrash-allowlist.json"
  @{ windows = @(@{
    hwnd = [uint64]$snap.hwnd
    pid = [uint32]$snap.process.pid
    process_creation = "$($snap.process.process_creation)"
    exe_path = "$($snap.process.exe_path)"
    user_sid = "$($snap.process.user_sid)"
    session_id = [uint32]$snap.process.session_id
    tag = "$($snap.tag)"
  }) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "spi-crash"
  $Ctx.ownerFrozen = $ready.owner
  $Ctx.ownerRunning = $true
  $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  $ledgerDir = "$($ident.ledger_directory)"
  $mark = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($snap.hwnd) $logPath $mark 20 "spicrash-adopt"
  Rec-Shortcut "spicrash-adopted" @{ tick = $conv.tick }
  # Pre-crash proof: live still ours (FALSE) plus ledger v4 owned preimage.
  $midLive = Read-SpiArranging
  if ($preLive -and ($midLive -ne $false)) {
    Fail-Shortcut "SPI effect not active before crash"
  }
  $ledgerText = Get-Content -LiteralPath (Join-Path $ledgerDir "ledger.json") -Raw | ConvertFrom-Json
  if ($preLive) {
    Assert-SpiPreimageOwned $ledgerText "spi-crash-preimage"
  }
  Rec-Shortcut "spi-crash-pre" @{ live = $midLive; ledger_v = $ledgerText.v; mouse_snap = $ledgerText.mouse_snap }
  $stopped = Stop-ExactOwner $ownerCopy $true "spi-crash" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  $postLive = Read-SpiArranging
  Rec-Shortcut "spi-crash" @{ pre = $preLive; post = $postLive; stop = $stopped.stop.owner_exited; restored = $stopped.restore.restored }
  if ($postLive -ne $preLive) {
    Fail-Shortcut "SPI crash restore mismatch"
  }
  $back = Invoke-Native $helperCopy @("inspect", "$($snap.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $back $snap "spicrash-intact"
}

function Invoke-BoundedOwnedDrag($Snap, $Frozen, [string]$HelperBin, [int]$ToX, [int]$ToY, [string]$Tag) {
  # Bounded owned titlebar drag with safe release. Guards: full identity,
  # non-maximized, caption point inside rect, WindowFromPoint root == exact
  # frozen HWND (no drag when occluded/foreign). Motion is absolute SendInput
  # only; LEFTUP is guaranteed on short insertion before failing. Returns
  # accepted counts plus settled IsZoomed/geometry; no tiling oracle.
  Assert-FullIdentityMatches $Snap $Frozen $Tag
  $fresh = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $fresh $Frozen "$Tag-prefocus"
  if ([ShortcutProofNative]::IsZoomed([IntPtr][long]$Frozen.hwnd)) {
    Fail-Shortcut "$Tag helper maximized, title bar not exposed"
  }
  $cx = [int](([int]$fresh.left + [int]$fresh.right) / 2)
  $cy = [int]$fresh.top + 10
  if ($cx -lt [int]$fresh.left -or $cx -gt [int]$fresh.right -or $cy -lt [int]$fresh.top -or $cy -ge [int]$fresh.bottom) {
    Fail-Shortcut "$Tag caption point outside rect"
  }
  $anc = [ShortcutProofNative]::WindowAncestorAt($cx, $cy)
  Assert-OcclusionClear ([uint64]$anc) ([uint64]$Frozen.hwnd) $Tag
  $saved = [ShortcutProofNative]::CursorXY()
  if ($null -eq $saved) {
    Fail-Shortcut "$Tag cursor read failed"
  }
  $vx = [ShortcutProofNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
  $vy = [ShortcutProofNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
  $vw = [ShortcutProofNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
  $vh = [ShortcutProofNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
  $moveFlags = ($MOUSEEVENTF_MOVE -bor $MOUSEEVENTF_ABSOLUTE)
  $nx = ConvertTo-AbsoluteNative $cx $vx $vw
  $ny = ConvertTo-AbsoluteNative $cy $vy $vh
  if ([ShortcutProofNative]::SendMouse($moveFlags, $nx, $ny, [uint64]0) -ne 1) {
    Fail-Shortcut "$Tag drag move short insertion"
  }
  Start-Sleep -Milliseconds 120
  if ([ShortcutProofNative]::SendMouse($MOUSEEVENTF_LEFTDOWN, 0, 0, [uint64]0) -ne 1) {
    $null = [ShortcutProofNative]::SendMouse($moveFlags, (ConvertTo-AbsoluteNative ([int]$saved[0]) $vx $vw), (ConvertTo-AbsoluteNative ([int]$saved[1]) $vy $vh), [uint64]0)
    Fail-Shortcut "$Tag drag down short insertion"
  }
  $accepted = 2
  try {
    $steps = 12
    for ($i = 1; $i -le $steps; $i++) {
      $px = [int]($cx + (($ToX - $cx) * $i / $steps))
      $py = [int]($cy + (($ToY - $cy) * $i / $steps))
      $ax = ConvertTo-AbsoluteNative $px $vx $vw
      $ay = ConvertTo-AbsoluteNative $py $vy $vh
      if ([ShortcutProofNative]::SendMouse($moveFlags, $ax, $ay, [uint64]0) -ne 1) {
        Fail-Shortcut "$Tag drag step $i short insertion"
      }
      $accepted += 1
      Start-Sleep -Milliseconds 40
    }
    Start-Sleep -Milliseconds 900
  } finally {
    $up = [ShortcutProofNative]::SendMouse($MOUSEEVENTF_LEFTUP, 0, 0, [uint64]0)
    $accepted += [int]$up
    $null = [ShortcutProofNative]::SendMouse($moveFlags, (ConvertTo-AbsoluteNative ([int]$saved[0]) $vx $vw), (ConvertTo-AbsoluteNative ([int]$saved[1]) $vy $vh), [uint64]0)
    if ($up -ne 1) {
      Fail-Shortcut "$Tag drag release short insertion"
    }
  }
  Start-Sleep -Milliseconds 900
  $post = Invoke-Native $HelperBin @("inspect", "$($Frozen.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $post $Frozen "$Tag-postdrag"
  $zoomed = [bool][ShortcutProofNative]::IsZoomed([IntPtr][long]$Frozen.hwnd)
  return @{ accepted = $accepted; unmarked = $true; zoomed = $zoomed; rect = "$($post.left),$($post.top),$($post.right),$($post.bottom)" }
}

function Invoke-SnapSurfacesLive($Ctx) {
  # Independent mouse-Snap surface coverage. No keyboard journey, no Engine
  # focus setter, no retries on focus/move. One managed helper (allowlisted)
  # for maximize-hover + Win+Z, one unmanaged helper for the drag oracle
  # (unmanaged avoids tiler-reflow confound; session SPI false still covers
  # it). All surface inputs unmarked (extra 0) so the product hook must pass
  # them through untracked. Shell flyout has no programmatic oracle: record
  # read-only inventory/class diffs plus pending-physical, never fabricate.
  $ownerCopy = $Ctx.ownerCopy
  $helperCopy = $Ctx.helperCopy
  $proofDir = $Ctx.proofDir
  $ownerSeconds = $Ctx.ownerSeconds
  $h1 = Start-PassiveShortcutHelper $helperCopy $proofDir "snap-managed"
  $hFree = Start-PassiveShortcutHelper $helperCopy $proofDir "snap-free"
  $null = $Ctx.created.Add(@{ snap = $h1; bin = $helperCopy })
  $null = $Ctx.created.Add(@{ snap = $hFree; bin = $helperCopy })
  Rec-Shortcut "snap-helpers-created" @(@($h1, $hFree) | ForEach-Object { @{ hwnd = $_.hwnd; pid = $_.process.pid; tag = $_.tag } })
  $allowPath = Join-Path $proofDir "snap-surfaces-allowlist.json"
  @{ windows = @(@{
    hwnd = [uint64]$h1.hwnd
    pid = [uint32]$h1.process.pid
    process_creation = "$($h1.process.process_creation)"
    exe_path = "$($h1.process.exe_path)"
    user_sid = "$($h1.process.user_sid)"
    session_id = [uint32]$h1.process.session_id
    tag = "$($h1.tag)"
  }) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $allowPath
  $binDir = Split-Path -Parent $ownerCopy
  Start-ExplorerGui $ownerCopy "shortcut-proof --allowlist `"$allowPath`" --seconds $ownerSeconds --trace" $binDir
  $ready = Assert-OwnerReady $ownerCopy "snap-surfaces"
  $Ctx.ownerFrozen = $ready.owner
  $Ctx.ownerRunning = $true
  $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Shortcut "snap-owner-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $ledgerDir = "$($ident.ledger_directory)"
  $Ctx.auditPath = Join-Path $ledgerDir "proof-audit-$($ready.owner.process_creation).jsonl"
  $start = $null
  foreach ($e in (Get-LogEventsAfter $logPath 0).events) {
    if ($e.event -eq "tile-start") { $start = $e }
  }
  if ($null -eq $start) { Fail-Shortcut "snap tile-start missing" }
  Assert-TileStartMode $start "shortcut-proof" $true $false "snap-surfaces"
  if ([bool]$start.mouse_snap_prevention -ne $true) { Fail-Shortcut "snap prevention not default-on" }
  Rec-Shortcut "snap-tile-start" @{ mode = "$($start.mode)"; prevention = $start.mouse_snap_prevention }
  Show-ExactHelper $h1 $h1 $helperCopy "snap-admit-managed"
  Show-ExactHelper $hFree $hFree $helperCopy "snap-admit-free"
  $mark = (Get-CompleteLinesLocal $logPath).Count
  $conv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd) $logPath $mark 20 "snap-adopt"
  Rec-Shortcut "snap-adopted" @{ tick = $conv.tick }
  $ledgerText = Get-Content -LiteralPath (Join-Path $ledgerDir "ledger.json") -Raw | ConvertFrom-Json
  Assert-SpiPreimageOwned $ledgerText "snap-preimage"
  Rec-Shortcut "snap-ledger" @{ v = $ledgerText.v; mouse_snap = $ledgerText.mouse_snap }
  $midLive = Read-SpiArranging
  if ($midLive -ne $false) { Fail-Shortcut "snap SPI effect not observed" }
  Rec-Shortcut "snap-mid-live" @{ arranging = $midLive }
  $clickAccepted = 0
  $invBefore = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
  Rec-Shortcut "snap-inventory-before" @{ windows = $invBefore.windows.Count }
  $invBefore | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $proofDir "snap-inventory-before.json")
  $laySnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $laySnap $h1 "snap-prefocus"
  $layClicked = Invoke-GuardedHelperClick $laySnap $h1 $helperCopy "snap-target"
  $clickAccepted += [int]$layClicked.accepted
  Rec-Shortcut "click-snap-target" $layClicked
  $cursorBase = [ShortcutProofNative]::CursorXY()
  Rec-Shortcut "snap-cursor-baseline" @{ cursor = ($cursorBase -join ",") }
  $maxX = [int]$laySnap.right - 20
  $maxY = [int]$laySnap.top + 12
  $maxAnc = [ShortcutProofNative]::WindowAncestorAt($maxX, $maxY)
  if ([uint64]$maxAnc -eq [uint64]$h1.hwnd) {
    $savedCur = [ShortcutProofNative]::CursorXY()
    $vx2 = [ShortcutProofNative]::GetSystemMetrics($SM_XVIRTUALSCREEN)
    $vy2 = [ShortcutProofNative]::GetSystemMetrics($SM_YVIRTUALSCREEN)
    $vw2 = [ShortcutProofNative]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
    $vh2 = [ShortcutProofNative]::GetSystemMetrics($SM_CYVIRTUALSCREEN)
    $hx = ConvertTo-AbsoluteNative $maxX $vx2 $vw2
    $hy = ConvertTo-AbsoluteNative $maxY $vy2 $vh2
    $moveFlags = ($MOUSEEVENTF_MOVE -bor $MOUSEEVENTF_ABSOLUTE)
    if ([ShortcutProofNative]::SendMouse($moveFlags, $hx, $hy, [uint64]0) -ne 1) {
      Fail-Shortcut "snap hover short insertion"
    }
    Start-Sleep -Milliseconds 1500
    $fgHover = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
    $invHover = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
    $invHover | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $proofDir "snap-inventory-hover.json")
    if ($null -ne $savedCur) {
      $qx = ConvertTo-AbsoluteNative ([int]$savedCur[0]) $vx2 $vw2
      $qy = ConvertTo-AbsoluteNative ([int]$savedCur[1]) $vy2 $vh2
      if ([ShortcutProofNative]::SendMouse($moveFlags, $qx, $qy, [uint64]0) -ne 1) {
        Fail-Shortcut "snap cursor restore short insertion"
      }
    }
    Rec-Shortcut "snap-hover" @{ hover_ancestor_match = $true; input_accepted = 1; unmarked = $true; foreground = "$fgHover"; inventory_windows = $invHover.windows.Count; oracle = "pending-physical"; note = "accepted counts input only; no programmatic flyout oracle" }
  } else {
    Rec-Shortcut "snap-hover" @{ hover_ancestor_match = $false; oracle = "pending-physical"; note = "maximize corner occluded/foreign, no hover, no input" }
  }
  $wzSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $wzSnap $h1 "snap-winz-prefocus"
  $fgCheck = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ($fgCheck -ne [uint64]$h1.hwnd) {
    $reSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
    $reClicked = Invoke-GuardedHelperClick $reSnap $h1 $helperCopy "snap-winz-repark"
    $clickAccepted += [int]$reClicked.accepted
    Rec-Shortcut "click-snap-winz-repark" $reClicked
  }
  $wzMark = (Get-CompleteLinesLocal $logPath).Count
  $zw = Send-MarkedChord $VK_Z $false $false ([uint64]$h1.hwnd) 0 $true
  Rec-Shortcut "send-snap-winz" $zw
  Start-Sleep -Milliseconds 1500
  $fgWinz = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
  $invWinz = Invoke-Native $ownerCopy @("inventory") | ConvertFrom-Json
  $invWinz | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $proofDir "snap-inventory-winz.json")
  $fgInfo = @($invWinz.windows | Where-Object { [uint64]$_.hwnd -eq $fgWinz } | Select-Object -First 1)
  $fgClass = ""
  $fgExe = ""
  if ($fgInfo.Count -gt 0) { $fgClass = "$($fgInfo[0].class)"; $fgExe = "$($fgInfo[0].exe)" }
  Wait-NoConsumedSnap $logPath $wzMark 8 "snap-winz-passthrough"
  Rec-Shortcut "snap-winz" @{ input_accepted = $zw.accepted; unmarked = $true; foreground = "$fgWinz"; fg_class = $fgClass; fg_exe = $fgExe; consumed = 0; oracle = "pending-physical" }
  if ($fgWinz -ne [uint64]$h1.hwnd) {
    $shellHit = ($fgExe -ieq "explorer.exe") -or ($fgExe -ieq "ShellExperienceHost.exe") -or ($fgExe -ieq "StartMenuExperienceHost.exe") -or ($fgExe -ieq "SearchHost.exe") -or ($fgClass -like "*Xaml*") -or ($fgClass -like "*Shell*") -or ($fgClass -like "*Flyout*") -or ($fgClass -ieq "Windows.UI.Core.CoreWindow")
    if ($shellHit) {
      $escDown = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $false, [uint64]0)
      $escUp = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $true, [uint64]0)
      if ($escDown -ne 1 -or $escUp -ne 1) { Fail-Shortcut "snap esc short insertion" }
      Rec-Shortcut "snap-winz-dismiss" @{ verified_shell = $true; fg_class = $fgClass }
      Start-Sleep -Milliseconds 800
    } else {
      Rec-Shortcut "snap-winz-dismiss" @{ verified_shell = $false; fg_class = $fgClass; note = "foreign foreground, no Esc sent" }
    }
    $fgBack = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
    if ($fgBack -ne [uint64]$h1.hwnd) {
      $parkSnap = Invoke-Native $helperCopy @("inspect", "$($h1.hwnd)") | ConvertFrom-Json
      $parked = Invoke-GuardedHelperClick $parkSnap $h1 $helperCopy "snap-winz-park"
      $clickAccepted += [int]$parked.accepted
      Rec-Shortcut "click-snap-winz-park" $parked
    }
  } else {
    $escDown = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $false, [uint64]0)
    $escUp = [ShortcutProofNative]::SendKey([uint16]$VK_ESCAPE, $true, [uint64]0)
    if ($escDown -ne 1 -or $escUp -ne 1) { Fail-Shortcut "snap esc short insertion" }
    Rec-Shortcut "snap-winz-dismiss" @{ verified_shell = $false; note = "foreground stayed helper, harmless Esc" }
  }
  $fgBeforeDrag = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
  if ($fgBeforeDrag -eq [uint64]$h1.hwnd) {
    Rec-Shortcut "snap-drag-skipped" @{ reason = "managed h1 foreground covers unmanaged hFree at same rect; helper minimize refuses foreground; no owned park surface without touching originals"; live_zoomed = "unknown"; baseline_zoomed = "unknown" }
    $dragLive = @{ accepted = 0; zoomed = "unknown"; rect = "skipped" }
    $dragBase = @{ accepted = 0; zoomed = "unknown"; rect = "skipped" }
    Rec-Shortcut "snap-drag-comparison" @{ live_zoomed = "unknown"; baseline_zoomed = "unknown"; note = "drag not feasible; hover+WinZ coverage unaffected" }
  } else {
  $minH1 = Invoke-Native $helperCopy @("minimize", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$minH1.foreground -eq [uint64]$h1.hwnd) { Fail-Shortcut "snap drag minimize focused h1" }
  Rec-Shortcut "snap-drag-h1-minimized" @{ minimized = $true }
  $freePre = Invoke-Native $helperCopy @("inspect", "$($hFree.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $freePre $hFree "snap-drag-pre"
  $freeClicked = Invoke-GuardedHelperClick $freePre $hFree $helperCopy "snap-drag-target"
  $clickAccepted += [int]$freeClicked.accepted
  Rec-Shortcut "click-snap-drag-target" $freeClicked
  $freePre2 = Invoke-Native $helperCopy @("inspect", "$($hFree.hwnd)") | ConvertFrom-Json
  $dragLive = Invoke-BoundedOwnedDrag $freePre2 $hFree $helperCopy ([int]$freePre2.left + 200) 0 "snap-drag-live"
  Rec-Shortcut "snap-drag-live" @{ accepted = $dragLive.accepted; zoomed = $dragLive.zoomed; rect = $dragLive.rect; note = "unmanaged helper; tiler reflow not proof, zoomed/geometry only" }
  $rstH1 = Invoke-Native $helperCopy @("restore", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$rstH1.foreground -eq [uint64]$h1.hwnd) { Fail-Shortcut "snap drag restore focused h1" }
  $reMark = (Get-CompleteLinesLocal $logPath).Count
  $reConv = Wait-ConvergedFrames $ownerCopy $allowPath @($h1.hwnd) $logPath $reMark 20 "snap-drag-restore"
  Rec-Shortcut "snap-drag-restored" @{ tick = $reConv.tick }
  }
  $tailAll = Get-LogEventsAfter $logPath 0
  $masks = @($tailAll.events | Where-Object { $_.event -eq "snap-mask" })
  Rec-Shortcut "snap-mask-evidence" @{ pairs = $masks.Count }
  $prodLines = @($tailAll.events | Where-Object { ($_.event -eq "snap") -or ($_.event -eq "snap-mask") -or ($_.event -eq "tick") } | ForEach-Object { ($_ | ConvertTo-Json -Compress) })
  Assert-ProductionLogTokenOnly $prodLines
  Rec-Shortcut "snap-production-logs" @{ lines = $prodLines.Count; token_only = $true }
  Rec-Shortcut "click-accepted-total" @{ accepted = $clickAccepted; unmarked = $true; note = "guarded title-bar mouse clicks only; no click on occluded/foreign target" }
  $stopped = Stop-ExactOwner $ownerCopy $false "snap-surfaces" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  Rec-Shortcut "snap-owner-stop" $stopped
  $readyAfter = Invoke-Native $ownerCopy @("ready") | ConvertFrom-Json
  if ($readyAfter.ready -ne $false) { Fail-Shortcut "snap owner still ready after stop" }
  if ($dragLive.rect -eq "skipped") {
    Rec-Shortcut "snap-drag-baseline" @{ note = "skipped with live drag; see snap-drag-skipped" }
  } else {
  $minH1b = Invoke-Native $helperCopy @("minimize", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$minH1b.foreground -eq [uint64]$h1.hwnd) { Fail-Shortcut "snap baseline minimize focused h1" }
  $freeBase = Invoke-Native $helperCopy @("inspect", "$($hFree.hwnd)") | ConvertFrom-Json
  Assert-FullIdentityMatches $freeBase $hFree "snap-baseline-pre"
  if ([ShortcutProofNative]::IsZoomed([IntPtr][long]$hFree.hwnd)) {
    $minB = Invoke-Native $helperCopy @("minimize", "$($hFree.hwnd)", "--tag", "$($hFree.tag)") | ConvertFrom-Json
    if ([uint64]$minB.foreground -eq [uint64]$hFree.hwnd) { Fail-Shortcut "snap baseline minimize focused" }
    $rstB = Invoke-Native $helperCopy @("restore", "$($hFree.hwnd)", "--tag", "$($hFree.tag)") | ConvertFrom-Json
    if ([uint64]$rstB.foreground -eq [uint64]$hFree.hwnd) { Fail-Shortcut "snap baseline restore focused" }
    $freeBase = Invoke-Native $helperCopy @("inspect", "$($hFree.hwnd)") | ConvertFrom-Json
  }
  $freeBaseClicked = Invoke-GuardedHelperClick $freeBase $hFree $helperCopy "snap-baseline-target"
  Rec-Shortcut "click-snap-baseline-target" $freeBaseClicked
  $freeBase2 = Invoke-Native $helperCopy @("inspect", "$($hFree.hwnd)") | ConvertFrom-Json
  $dragBase = Invoke-BoundedOwnedDrag $freeBase2 $hFree $helperCopy ([int]$freeBase2.left + 200) 0 "snap-drag-baseline"
  Rec-Shortcut "snap-drag-baseline" @{ accepted = $dragBase.accepted; zoomed = $dragBase.zoomed; rect = $dragBase.rect; note = "same action after stop/preimage restored; OS native baseline" }
  Rec-Shortcut "snap-drag-comparison" @{ live_zoomed = $dragLive.zoomed; baseline_zoomed = $dragBase.zoomed; live_rect = $dragLive.rect; baseline_rect = $dragBase.rect }
  $rstH1b = Invoke-Native $helperCopy @("restore", "$($h1.hwnd)", "--tag", "$($h1.tag)") | ConvertFrom-Json
  if ([uint64]$rstH1b.foreground -eq [uint64]$h1.hwnd) { Fail-Shortcut "snap baseline restore focused h1" }
  }
  foreach ($pair in @(@{ snap = $h1; name = "h1" }, @{ snap = $hFree; name = "hFree" })) {
    $cur = Invoke-Native $helperCopy @("inspect", "$($pair.snap.hwnd)") | ConvertFrom-Json
    Assert-FullIdentityMatches $cur $pair.snap "snap-final-$($pair.name)"
    if ([ShortcutProofNative]::IsZoomed([IntPtr][long]$pair.snap.hwnd)) {
      $mn = Invoke-Native $helperCopy @("minimize", "$($pair.snap.hwnd)", "--tag", "$($pair.snap.tag)") | ConvertFrom-Json
      if ([uint64]$mn.foreground -eq [uint64]$pair.snap.hwnd) { Fail-Shortcut "snap final minimize focused $($pair.name)" }
      $rs = Invoke-Native $helperCopy @("restore", "$($pair.snap.hwnd)", "--tag", "$($pair.snap.tag)") | ConvertFrom-Json
      if ([uint64]$rs.foreground -eq [uint64]$pair.snap.hwnd) { Fail-Shortcut "snap final restore focused $($pair.name)" }
      $chk = [ShortcutProofNative]::IsZoomed([IntPtr][long]$pair.snap.hwnd)
      if ($chk) { Fail-Shortcut "snap helper left maximized $($pair.name)" }
    }
  }
  Rec-Shortcut "snap-reset" @{ unmaximized = $true }
}

function Get-ExistingNotepadSnapshot([string]$Tag) {
  # Existing approved Notepad only (the user's original Store app, oldest
  # main-window instance). Never launched, activated, or closed by this
  # harness: full native process identity plus HWND/rect/zoom for intactness.
  $cands = @(Get-Process -Name "notepad" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  if ($cands.Count -eq 0) {
    Fail-Shortcut "$Tag no existing Notepad with main window"
  }
  $np = $cands | Sort-Object StartTime | Select-Object -First 1
  $hex = ""
  try {
    $hex = "{0:x16}" -f $np.StartTime.ToUniversalTime().ToFileTimeUtc()
  } catch {
    Fail-Shortcut "$Tag notepad start unreadable"
  }
  $session = -1
  $sid = "unreadable"
  try {
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($np.Id)" -ErrorAction Stop
    $session = [int]$cim.SessionId
    $owner = Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
    $sid = "$($owner.Sid)"
  } catch {
    $sid = "unreadable"
  }
  $rect = [ShortcutProofNative]::RectOf([long]$np.MainWindowHandle.ToInt64())
  if ($null -eq $rect) {
    Fail-Shortcut "$Tag notepad rect unreadable"
  }
  return @{
    pid = [int]$np.Id
    start = $hex
    exe = "$($np.Path)"
    hwnd = [uint64]$np.MainWindowHandle.ToInt64()
    session = $session
    sid = $sid
    rect = "$($rect -join ',')"
    zoomed = [bool][ShortcutProofNative]::IsZoomed($np.MainWindowHandle)
  }
}

function Assert-NotepadIntact($Snap, [string]$Tag) {
  $live = Get-Process -Id ([int]$Snap.pid) -ErrorAction SilentlyContinue
  if ($null -eq $live) {
    Fail-Shortcut "$Tag notepad pid=$($Snap.pid) gone"
  }
  $hex = "{0:x16}" -f $live.StartTime.ToUniversalTime().ToFileTimeUtc()
  if ($hex -cne "$($Snap.start)") {
    Fail-Shortcut "$Tag notepad restarted"
  }
  if ("$($live.Path)" -cne "$($Snap.exe)") {
    Fail-Shortcut "$Tag notepad exe changed"
  }
  if ([uint64]$live.MainWindowHandle.ToInt64() -ne [uint64]$Snap.hwnd) {
    Fail-Shortcut "$Tag notepad hwnd changed"
  }
  if ([ShortcutProofNative]::IsZoomed($live.MainWindowHandle)) {
    Fail-Shortcut "$Tag notepad maximized"
  }
}

function Wait-PlanTick([string]$LogPath, [int]$TimeoutSec, [string]$Tag) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $tail = Get-LogEventsAfter $LogPath 0
    $plans = @($tail.events | Where-Object { $_.event -eq "plan" })
    if ($plans.Count -gt 0) {
      return $plans.Count
    }
    Start-Sleep -Milliseconds 500
  }
  Fail-Shortcut "$Tag no plan tick in log"
  return 0
}

function Invoke-NormalSmokeLive($Ctx) {
  # Normal-mode smoke on the EXISTING approved Notepad (Store app from the
  # preflight inventory): never launched, activated, or closed here, only
  # identity-snapshotted before/after. Run 1 default-on verifies
  # hook/tile-start/options plus the session-only SPI effect with a safe
  # Win+Ctrl+H (product filters ALL injected, zero consumption). Run 2 with
  # both off flags verifies no hook, no SPI write (live stays preimage), and
  # ledger.mouse_snap none.
  $ownerCopy = $Ctx.ownerCopy
  $binDir = Split-Path -Parent $ownerCopy
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $ledgerDir = "$($ident.ledger_directory)"
  $preSpi = Read-SpiArranging
  $prePen = Read-PenVisualization
  Rec-Shortcut "normal-preflight" @{ arranging = $preSpi; pen = $prePen }
  $np = Get-ExistingNotepadSnapshot "normal-pre"
  Rec-Shortcut "normal-notepad-pre" $np
  # Explicit test scope on every normal tile launch (product default manages
  # everything including Terminal): Notepad + Calculator host + Paint, with
  # the Calculator host-child fence. Never unscoped.
  $normalScopeArgs = " --scope-exe notepad.exe --scope-exe ApplicationFrameHost.exe --scope-exe mspaint.exe --scope-host-child ApplicationFrameHost.exe=CalculatorApp.exe"
  Start-ExplorerGui $ownerCopy "tile --user-start --seconds 20 --trace$normalScopeArgs" $binDir
  $ready = Assert-OwnerReady $ownerCopy "normal-smoke"
  $Ctx.ownerFrozen = $ready.owner
  $Ctx.ownerRunning = $true
  $Ctx.ownerPayload = $ownerCopy
  $logPath = "$($ready.log_path)"
  Rec-Shortcut "normal-ready" @{ pid = $ready.owner.pid; log = $logPath }
  $ticks = Wait-PlanTick $logPath 20 "normal-smoke"
  $start = $null
  foreach ($e in (Get-LogEventsAfter $logPath 0).events) {
    if ($e.event -eq "tile-start") {
      $start = $e
    }
  }
  if ($null -eq $start) {
    Fail-Shortcut "normal tile-start missing"
  }
  Assert-TileStartMode $start "normal" $true $false "normal-smoke"
  if ([int]$start.scope_count -ne 3) {
    Fail-Shortcut "normal-smoke scope_count $($start.scope_count) != 3 (explicit test scope required)"
  }
  if ([bool]$start.mouse_snap_prevention -ne $true) {
    Fail-Shortcut "normal-smoke prevention not default-on"
  }
  Rec-Shortcut "normal-tile-start" @{ mode = "$($start.mode)"; takeover = $start.keyboard.takeover; prevention = $start.mouse_snap_prevention; ticks = $ticks; scope_count = $start.scope_count }
  $ledgerText = Get-Content -LiteralPath (Join-Path $ledgerDir "ledger.json") -Raw | ConvertFrom-Json
  Assert-SpiPreimageOwned $ledgerText "normal-preimage"
  $midLive = Read-SpiArranging
  if ($midLive -ne $false) {
    Fail-Shortcut "normal SPI effect not observed"
  }
  Rec-Shortcut "normal-mid" @{ arranging = $midLive; ledger_v = $ledgerText.v }
  $fgNow = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
  $sendMark = (Get-CompleteLinesLocal $logPath).Count
  $sent = Send-MarkedChord $VK_H $false $true $fgNow 0 $true
  Rec-Shortcut "send-normal-filter" $sent
  Wait-NoConsumedSnap $logPath $sendMark 8 "normal-filter"
  Rec-Shortcut "normal-filter" @{ consumed = 0; foreground = "$fgNow" }
  $stopped = Stop-ExactOwner $ownerCopy $false "normal-smoke" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  $postLive = Read-SpiArranging
  if ($postLive -ne $preSpi) {
    Fail-Shortcut "normal graceful restore mismatch"
  }
  Rec-Shortcut "normal-default-on" @{ pre = $preSpi; post = $postLive; stop = $stopped.stop.owner_exited }
  Assert-NotepadIntact $np "normal-mid"
  Start-ExplorerGui $ownerCopy "tile --user-start --seconds 20 --trace --no-keyboard-snap-takeover --no-mouse-snap-prevention$normalScopeArgs" $binDir
  $ready2 = Assert-OwnerReady $ownerCopy "normal-off"
  $Ctx.ownerFrozen = $ready2.owner
  $Ctx.ownerRunning = $true
  $logPath2 = "$($ready2.log_path)"
  Rec-Shortcut "normal-off-ready" @{ pid = $ready2.owner.pid; log = $logPath2 }
  $ticks2 = Wait-PlanTick $logPath2 20 "normal-off"
  $start2 = $null
  foreach ($e in (Get-LogEventsAfter $logPath2 0).events) {
    if ($e.event -eq "tile-start") {
      $start2 = $e
    }
  }
  if ($null -eq $start2) {
    Fail-Shortcut "normal-off tile-start missing"
  }
  Assert-TileStartMode $start2 "normal" $false $false "normal-off"
  if ([int]$start2.scope_count -ne 3) {
    Fail-Shortcut "normal-off scope_count $($start2.scope_count) != 3 (explicit test scope required)"
  }
  if ([bool]$start2.mouse_snap_prevention -ne $false) {
    Fail-Shortcut "normal-off prevention not off"
  }
  $ledger2 = Get-Content -LiteralPath (Join-Path $ledgerDir "ledger.json") -Raw | ConvertFrom-Json
  if ([int]$ledger2.v -ne 4) {
    Fail-Shortcut "normal-off ledger v$($ledger2.v) != v4"
  }
  if ($null -ne $ledger2.mouse_snap) {
    Fail-Shortcut "normal-off ledger mouse_snap present"
  }
  $stillLive = Read-SpiArranging
  if ($stillLive -ne $preSpi) {
    Fail-Shortcut "normal-off SPI wrote live"
  }
  Rec-Shortcut "normal-off-state" @{ takeover = $false; prevention = $false; arranging = $stillLive; ticks = $ticks2 }
  $fg2 = [uint64][ShortcutProofNative]::GetForegroundWindow().ToInt64()
  $mark2 = (Get-CompleteLinesLocal $logPath2).Count
  $sent2 = Send-MarkedChord $VK_H $false $true $fg2 0 $true
  Rec-Shortcut "send-normal-off-filter" $sent2
  Wait-NoConsumedSnap $logPath2 $mark2 8 "normal-off-filter"
  $stopped2 = Stop-ExactOwner $ownerCopy $false "normal-off" $Ctx.ownerFrozen
  $Ctx.ownerRunning = $false
  if ([bool]$stopped2.restore.mouse_snap_restored -ne $false) {
    Fail-Shortcut "normal-off unexpected snap write"
  }
  $endLive = Read-SpiArranging
  if ($endLive -ne $preSpi) {
    Fail-Shortcut "normal-off end SPI mismatch"
  }
  Rec-Shortcut "normal-off" @{ arranging = $endLive; restored = $stopped2.restore.restored }
  Assert-NotepadIntact $np "normal-end"
  $endPen = Read-PenVisualization
  if ($endPen -ne $prePen) {
    Fail-Shortcut "normal pen changed $endPen != $prePen"
  }
  Rec-Shortcut "normal-smoke" @{ mode = "normal"; synthetic_consumed = 0; notepad_intact = $true; pen = $endPen }
}

function Get-OriginalAppsSnapshot {
  $out = @()
  foreach ($name in @("notepad", "Calculator", "ApplicationFrameHost", "mspaint")) {
    $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
      $hex = ""
      try {
        $hex = "{0:x16}" -f $p.StartTime.ToUniversalTime().ToFileTimeUtc()
      } catch {
        $hex = "unknown"
      }
      $out += @{ name = $name; pid = $p.Id; start = $hex }
    }
  }
  return ,$out
}

function Assert-OriginalAppsIntact($Before, [string]$Tag) {
  foreach ($b in @($Before)) {
    $live = Get-Process -Id $b.pid -ErrorAction SilentlyContinue
    if ($null -eq $live) {
      Fail-Shortcut "$Tag original $($b.name) pid=$($b.pid) gone"
    }
    $hex = ""
    try {
      $hex = "{0:x16}" -f $live.StartTime.ToUniversalTime().ToFileTimeUtc()
    } catch {
      Fail-Shortcut "$Tag original $($b.name) unreadable"
    }
    if ($hex -cne "$($b.start)") {
      Fail-Shortcut "$Tag original $($b.name) restarted"
    }
    $zoomed = $false
    try {
      $handle = $live.MainWindowHandle
      if ($handle -ne 0) {
        $zoomed = [ShortcutProofNative]::IsZoomed($handle)
      }
    } catch {
      Fail-Shortcut "$Tag original $($b.name) zoom check failed"
    }
    if ($zoomed) {
      Fail-Shortcut "$Tag original $($b.name) maximized"
    }
  }
}

function Close-CreatedHelpers($Ctx, [string]$Tag) {
  foreach ($h in @($Ctx.created)) {
    $snap = $h.snap
    $helperBin = $h.bin
    $held = Test-ProcessAliveSameCreation ([int]$snap.process.pid) "$($snap.process.process_creation)"
    if (-not $held) {
      Rec-Shortcut "$Tag-helper-already-closed" @{ hwnd = $snap.hwnd }
      continue
    }
    try {
      $closed = Invoke-Native $helperBin @("close", "$($snap.hwnd)", "--tag", "$($snap.tag)") | ConvertFrom-Json
      Rec-Shortcut "$Tag-helper-close" $closed
    } catch {
      Rec-Shortcut "$Tag-helper-close-failed" @{ hwnd = $snap.hwnd; error = "$($_.Exception.Message)" }
    }
  }
  $exitDeadline = (Get-Date).AddSeconds(10)
  foreach ($h in @($Ctx.created)) {
    $snap = $h.snap
    while (Test-ProcessAliveSameCreation ([int]$snap.process.pid) "$($snap.process.process_creation)") {
      if ((Get-Date) -gt $exitDeadline) {
        Fail-Shortcut "$Tag helper exit timeout pid=$($snap.process.pid)"
      }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Recover-ExactOwner($Ctx, [string]$Tag) {
  if (-not $Ctx.ownerRunning) {
    return "no-owner"
  }
  $notes = @()
  $payload = $Ctx.ownerPayload
  $frozen = $Ctx.ownerFrozen
  try {
    $ready = Invoke-Native $payload @("ready") | ConvertFrom-Json
    $same = ($ready.ready -eq $true) -and ([int]$ready.owner.pid -eq [int]$frozen.pid) -and ("$($ready.owner.process_creation)" -ceq "$($frozen.process_creation)")
    if ($same) {
      $s = Invoke-Native $payload @("stop") | ConvertFrom-Json
      $notes += "stop exited=$($s.owner_exited)"
      if (Test-ProcessAliveSameCreation ([int]$frozen.pid) "$($frozen.process_creation)") {
        $e = Invoke-Native $payload @("emergency-stop") | ConvertFrom-Json
        $notes += "emergency exited=$($e.owner_exited)"
      }
    } else {
      $notes += "owner identity changed; stop refused"
    }
  } catch {
    $notes += "stop failed: $($_.Exception.Message)"
  }
  try {
    $r = Invoke-Native $payload @("restore") | ConvertFrom-Json
    $notes += "restore=$($r.restored)"
  } catch {
    $notes += "restore failed: $($_.Exception.Message)"
  }
  $Ctx.ownerRunning = $false
  return "$Tag-recovery: $($notes -join '; ')"
}

function Test-NoProjectActors([string]$OwnerCopy, [string]$HelperCopy, [string]$Tag) {
  $hits = @(Get-Process -Name "tiler-windows", "tiler-test-window" -ErrorAction SilentlyContinue | Where-Object {
    $p = ""
    try {
      $p = $_.Path
    } catch {
      $p = ""
    }
    ($p -ieq $OwnerCopy) -or ($p -ieq $HelperCopy)
  })
  if ($hits.Count -ne 0) {
    Fail-Shortcut "$Tag project actors remain"
  }
}

function Invoke-StopFromRunDir([string]$TargetDir) {
  $machinePath = Join-Path $TargetDir "machine.json"
  if (-not (Test-Path -LiteralPath $machinePath)) {
    Fail-Shortcut "no machine binding $machinePath"
  }
  $machine = Get-Content -LiteralPath $machinePath -Raw | ConvertFrom-Json
  $payload = "$($machine.ownerCopy)"
  $frozen = $machine.ownerFrozen
  $ready = Invoke-Native $payload @("ready") | ConvertFrom-Json
  $same = ($ready.ready -eq $true) -and ([int]$ready.owner.pid -eq [int]$frozen.pid) -and ("$($ready.owner.process_creation)" -ceq "$($frozen.process_creation)")
  if ($same) {
    $st = Invoke-Native $payload @("stop") | ConvertFrom-Json
    Write-Output "stop: $($st | ConvertTo-Json -Compress)"
    if (-not $st.owner_exited) {
      Fail-Shortcut "graceful stop no exit"
    }
  } else {
    Write-Output "owner already gone or identity changed; no stop attempted"
  }
  $r = Invoke-Native $payload @("restore") | ConvertFrom-Json
  Write-Output "restore: $($r | ConvertTo-Json -Compress)"
  if (-not $r.restored) {
    Fail-Shortcut "restore not restored"
  }
  Assert-LedgerClean $payload
  Write-Output "stopped clean runDir=$TargetDir"
}

if ((-not $Mock) -and (-not $Live) -and (-not $Stop)) {
  Write-Output "dry-run parse ok; pass -Mock (harness, no native calls) or -Stage <name> -Live (bounded live) or -Stop -RunDir <dir>"
  exit 0
}
if ($OwnerSeconds -lt 1 -or $OwnerSeconds -gt $MAX_OWNER_SECONDS) {
  Fail-Shortcut "refuse: OwnerSeconds must be 1..600"
}
Assert-NoWinLJourney (Get-ShortcutJourney)
if ($Mock) {
  $mockReport = Invoke-ShortcutMock
  $mockReport | ConvertTo-Json -Depth 8 | Write-Output
  exit 0
}
if ($Stop) {
  if ([string]::IsNullOrWhiteSpace($RunDir)) {
    Fail-Shortcut "stop needs exact -RunDir"
  }
  if (-not (Test-Path -LiteralPath $RunDir)) {
    Fail-Shortcut "no such run dir $RunDir"
  }
  Invoke-StopFromRunDir $RunDir
  exit 0
}
if ($Live) {
  if (-not [string]::IsNullOrWhiteSpace($RunDir)) {
    Fail-Shortcut "refuse: -Live always creates a new run dir; -RunDir is for -Stop only"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Repo "Cargo.toml") -PathType Leaf)) {
    Fail-Shortcut "driver must run from the repo checkout"
  }
  Install-ShortcutNative
  $size = [ShortcutProofNative]::SizeOfInput()
  Assert-InputStructSize $size
  & cargo build --locked --manifest-path (Join-Path $Repo "Cargo.toml") -p tiler-windows
  if ($LASTEXITCODE -ne 0) {
    Fail-Shortcut "cargo build failed"
  }
  $proofDir = New-ShortcutRunDir $Repo
  $binDir = Join-Path $proofDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $ownerCopy = Join-Path $binDir "tiler-windows.exe"
  $helperCopy = Join-Path $binDir "tiler-test-window.exe"
  Copy-Item (Join-Path $Repo "target\debug\tiler-windows.exe") $ownerCopy -Force
  Copy-Item (Join-Path $Repo "target\debug\tiler-test-window.exe") $helperCopy -Force
  $commit = (& git -C $Repo rev-parse HEAD | Out-String).Trim()
  $status = (& git -C $Repo status --short | Out-String).Trim()
  $ident = Invoke-Native $ownerCopy @("identity") | ConvertFrom-Json
  $preSpi = Read-SpiArranging
  $originals = Get-OriginalAppsSnapshot
  Rec-Shortcut "env" @{
    commit = $commit
    status = $status
    actor_pid = $PID
    owner_sha256 = (Get-FileHash -LiteralPath $ownerCopy -Algorithm SHA256).Hash
    helper_sha256 = (Get-FileHash -LiteralPath $helperCopy -Algorithm SHA256).Hash
    script_sha256 = (Get-FileHash -LiteralPath (Join-Path $Repo "scripts\windows-shortcuts.ps1") -Algorithm SHA256).Hash
    marker = ("0x{0:X}" -f $SHORTCUT_MARKER)
    input_size = $size
    sid = "$($ident.process.user_sid)"
    session = "$($ident.process.session_id)"
    pre_spi_arranging = $preSpi
    original_apps = $originals
  }
  Assert-LedgerClean $ownerCopy
  Test-NoProjectActors $ownerCopy $helperCopy "preflight"
  $ctx = @{
    ownerCopy = $ownerCopy
    helperCopy = $helperCopy
    proofDir = $proofDir
    ownerSeconds = $OwnerSeconds
    noMouse = [bool]$NoMouseSnapPrevention
    created = [System.Collections.ArrayList]@()
    createdApp = [System.Collections.ArrayList]@()
    ownerRunning = $false
    ownerPayload = ""
    ownerFrozen = $null
    auditPath = ""
  }
  $wantStages = @()
  if ($Stage -eq "All") {
    $wantStages = @("OwnedFocusMove", "SpiGraceful", "SpiCrash")
  } else {
    $wantStages = @($Stage)
  }
  try {
    foreach ($one in $wantStages) {
      if ($one -eq "OwnedFocusMove") {
        Invoke-OwnedFocusMoveLive $ctx
      } elseif ($one -eq "OwnedMove") {
        Invoke-OwnedFocusMoveLive $ctx -SkipFocus
      } elseif ($one -eq "SpiGraceful") {
        Invoke-SpiGracefulLive $ctx
      } elseif ($one -eq "SpiCrash") {
        Invoke-SpiCrashLive $ctx
      } elseif ($one -eq "NormalSmoke") {
        Invoke-NormalSmokeLive $ctx
      } elseif ($one -eq "SnapSurfaces") {
        Invoke-SnapSurfacesLive $ctx
      }
    }
    $machine = @{
      ownerCopy = $ownerCopy
      helperCopy = $helperCopy
      ownerFrozen = $ctx.ownerFrozen
      ledger_directory = "$($ident.ledger_directory)"
    }
    $machine | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $proofDir "machine.json")
    Close-CreatedHelpers $ctx "cleanup"
    $postSpi = Read-SpiArranging
    if ($postSpi -ne $preSpi) {
      Fail-Shortcut "end SPI $postSpi != preflight $preSpi"
    }
    Assert-LedgerClean $ownerCopy
    Test-NoProjectActors $ownerCopy $helperCopy "end"
    Assert-OriginalAppsIntact $originals "end"
    $reportPath = Join-Path $proofDir "shortcuts-report.json"
    $report = @{ status = "pass"; stage = $Stage; steps = $ShortcutSteps }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportPath
    Write-Output "shortcuts-report=$reportPath"
    Write-Output "status=pass"
    exit 0
  } catch {
    $recovery = Recover-ExactOwner $ctx "fail"
    try {
      Close-CreatedHelpers $ctx "fail"
    } catch {
      $recovery += "; helper cleanup: $($_.Exception.Message)"
    }
    $failPath = Join-Path $proofDir "shortcuts-fail.json"
    $failReport = @{ status = "fail"; stage = $Stage; error = "$($_.Exception.Message)"; recovery = $recovery; steps = $ShortcutSteps }
    $failReport | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $failPath
    Write-Output "shortcuts-fail=$failPath"
    throw "shortcut stage failed: $($_.Exception.Message)"
  }
}
