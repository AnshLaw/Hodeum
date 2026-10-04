# Hovers the notch pill (cursor move only, no click), dumps the expanded notch UIA tree, restores the cursor.
param([int]$SettleMs = 1200)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
$notch = [HodeumNative]::Windows(0) | Where-Object { $_.Title -eq 'Hodey' -and $_.Class -eq 'Tauri Window' } | Select-Object -First 1
if (-not $notch) { throw 'notch window not found' }
$p = New-Object HodeumNative+POINT; [void][HodeumNative]::GetCursorPos([ref]$p)
$cx = $notch.X + [int]($notch.W / 2); $cy = 3    # top-centre of the monitor = the pill, or the orb it tucks into
[HodeumNative]::MoveTo($cx, $cy); Start-Sleep -Milliseconds 400; [HodeumNative]::MoveTo($cx, $cy + 30); Start-Sleep -Milliseconds $SettleMs
try {
    & "$PSScriptRoot\uia-tree.ps1" -Hwnd ('0x{0:X}' -f $notch.Hwnd) -Depth 40 | Where-Object { $_ -notmatch "\[Pane\] ''" }
} finally { [HodeumNative]::MoveTo($p.X, $p.Y) }
