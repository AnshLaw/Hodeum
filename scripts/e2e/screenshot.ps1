# DPI-aware screenshot of the whole virtual desktop (all monitors) or one region, in PHYSICAL pixels.
#   .\screenshot.ps1 -Out shot.png                         # every monitor
#   .\screenshot.ps1 -Out r.png -X 100 -Y 50 -W 800 -H 600 # region (virtual-desktop physical coords)
#   .\screenshot.ps1 -Out w.png -Hwnd 0x1234               # one window's DWM frame
# Prints "<path> <width>x<height> origin=<x>,<y>" so callers can map image px back to screen px.
param(
    [Parameter(Mandatory)] [string]$Out,
    [int]$X, [int]$Y, [int]$W, [int]$H,
    [string]$Hwnd
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName System.Drawing

if ($Hwnd) {
    $handle = [IntPtr][Convert]::ToInt64(($Hwnd -replace '^0x', ''), 16)
    $win = [HodeumNative]::Windows(0) | Where-Object { $_.Hwnd -eq $handle.ToInt64() } | Select-Object -First 1
    if (-not $win) { throw "window $Hwnd not found" }
    $X, $Y, $W, $H = $win.X, $win.Y, $win.W, $win.H
} elseif (-not $W -or -not $H) {
    $v = [HodeumNative]::VirtualScreen()
    $X, $Y, $W, $H = $v[0], $v[1], $v[2], $v[3]
}
if ($W -le 0 -or $H -le 0) { throw "empty capture rect ${W}x${H}" }

$bitmap = [HodeumNative]::Capture($X, $Y, $W, $H)
try {
    $full = [System.IO.Path]::GetFullPath($Out)
    $bitmap.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
    "$full ${W}x${H} origin=$X,$Y dpi=$script:HodeumDpiMode"
} finally {
    $bitmap.Dispose()
}
