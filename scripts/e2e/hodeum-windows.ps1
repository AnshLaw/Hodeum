# Lists Hodeum's top-level windows (physical px, ex-styles) and the monitors.
param([string]$ProcessName = 'hodeum')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
"dpi mode: $script:HodeumDpiMode"
"virtual screen (x,y,w,h): " + ([HodeumNative]::VirtualScreen() -join ',')
[HodeumNative]::Monitors()
$proc = Get-Process $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Error "$ProcessName is not running"; exit 1 }
"pid $($proc.Id)"
[HodeumNative]::Windows([uint32]$proc.Id) | Where-Object { $_.Title -or $_.Visible } | ForEach-Object {
    $ex = [Convert]::ToInt64($_.ExStyle.Substring(2), 16)
    [pscustomobject]@{ Hwnd = '0x{0:X}' -f $_.Hwnd; Title = $_.Title; Class = $_.Class; Visible = $_.Visible
        Rect = "$($_.X),$($_.Y) $($_.W)x$($_.H)"; Dpi = $_.Dpi; Ex = [HodeumNative]::DecodeEx($ex) }
} | Format-Table -AutoSize | Out-String -Width 250
