# Waits until the REAL desktop Hodeum is up and prints one JSON status object. Exit 0 = ready.
#   .\wait-ready.ps1                       # dev build (tauri dev): also needs Vite on [::1]:1420
#   .\wait-ready.ps1 -Standalone           # target\debug\hodeum.exe from `npm run app`: no Vite
#   .\wait-ready.ps1 -Release              # installed / release build: any exe path, no Vite
#   .\wait-ready.ps1 -CdpPort 9229         # also require the WebView2 DevTools endpoint
param([int]$TimeoutSec = 240, [switch]$Release, [switch]$Standalone, [int]$CdpPort = 0, [switch]$NoVlm,
      [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"

function Http-Ok([string]$url) {
    try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $url).StatusCode -eq 200 } catch { $false }
}
$expectedExe = if ($Release) { $null } else { Join-Path $Repo 'src-tauri\target\debug\hodeum.exe' }
$started = Get-Date; $attempt = 0
do {
    $proc = Get-Process hodeum -ErrorAction SilentlyContinue
    $status = [ordered]@{
        elapsedSec = [int]((Get-Date) - $started).TotalSeconds; attempt = ++$attempt
        processes = @($proc | ForEach-Object { "$($_.Id) $($_.Path)" })
        rightExe = $false; notchWindow = $false; notchRendered = $false; vite = $null; vlm = $null; cdp = $null
    }
    if ($proc.Count -eq 1) { $status.rightExe = (-not $expectedExe) -or ($proc.Path -eq $expectedExe) }
    if ($proc.Count -eq 1) {
        $notch = [HodeumNative]::Windows([uint32]$proc.Id) | Where-Object { $_.Title -eq 'Hodey' -and $_.Visible } | Select-Object -First 1
        $status.notchWindow = [bool]$notch
        if ($notch) {
            # The notch's React root exists once WebView2 has loaded notch.html (Chromium a11y wakes on first query).
            # The first query after a while only switches Chromium's accessibility on, so ask twice.
            foreach ($try in 1..2) {
                $dump = & "$PSScriptRoot\uia-tree.ps1" -Hwnd ('0x{0:X}' -f $notch.Hwnd) -Depth 30 2>$null
                $status.notchRendered = [bool]($dump | Select-String "\[Document\] 'Hodey' id=RootWebArea")
                if ($status.notchRendered) { break }
                Start-Sleep -Milliseconds 500
            }
        }
    }
    if (-not ($Release -or $Standalone)) { $status.vite = Http-Ok 'http://[::1]:1420/notch.html' }   # Vite binds ::1 only
    if (-not $NoVlm) { $status.vlm = Http-Ok 'http://127.0.0.1:8737/health' }         # /health needs no API key
    if ($CdpPort) {
        try { $status.cdp = @((Invoke-RestMethod -TimeoutSec 3 "http://127.0.0.1:$CdpPort/json/list") | Where-Object type -eq 'page' | ForEach-Object { ($_.url -split '/')[-1] }) }
        catch { $status.cdp = @() }
    }
    $ready = $status.rightExe -and $status.notchRendered -and ($Release -or $Standalone -or $status.vite) -and ($NoVlm -or $status.vlm) -and
             ((-not $CdpPort) -or ($status.cdp -contains 'notch.html'))
    if ($ready) { $status.ready = $true; [pscustomobject]$status | ConvertTo-Json -Compress; exit 0 }
    Start-Sleep -Seconds 2
} while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSec)
$status.ready = $false
[pscustomobject]$status | ConvertTo-Json -Compress
exit 1
