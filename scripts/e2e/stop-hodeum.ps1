# Stops the Hodeum started from this checkout (hodeum.exe + llama-server, plus the tauri dev tree and Vite).
#   .\stop-hodeum.ps1 -DryRun          # only list what would be stopped
#   .\stop-hodeum.ps1 -CdpPort 9229    # quit gracefully over CDP first (debug builds), then force what's left
# Graceful first: __hodeumDebug.quit() (or the debug_quit command) runs the tray's quit path, so the
# side-dock's reserved screen space is released and RunEvent::Exit stops the model. A forced kill skips
# that (llama-server still dies through its kill-on-close job, vlm.rs/child_job.rs). Then the tauri CLI /
# npm / Vite processes of THIS repo only. Never touches other node or WebView2 apps.
param([switch]$DryRun, [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path, [int]$WaitSec = 15,
      [int]$CdpPort = $(if ($env:CDP_PORT) { [int]$env:CDP_PORT } else { 9229 }), [int]$GraceSec = 8)
$ErrorActionPreference = 'Stop'
$repoPattern = [regex]::Escape($Repo)
$all = Get-CimInstance Win32_Process
$byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
$app = @($all | Where-Object { $_.Name -eq 'hodeum.exe' })
$appIds = $app | ForEach-Object { [int]$_.ProcessId }
# Only Hodeum's own server (child of hodeum.exe); other llama-servers (experiments on other ports) are left alone.
$llama = $all | Where-Object { $_.Name -eq 'llama-server.exe' -and $appIds -contains [int]$_.ParentProcessId }
# The launcher chain above each hodeum.exe: cargo <- rustup <- node tauri.js dev <- cmd <- npm run tauri:dev.
$launcherNames = 'cargo.exe', 'rustup.exe', 'node.exe', 'cmd.exe'
$devTree = foreach ($a in $app) {
    $cur = $byId[[int]$a.ParentProcessId]
    while ($cur -and $launcherNames -contains $cur.Name -and $cur.CommandLine -notmatch 'claude|bash\.exe') {
        $cur
        if ($cur.CommandLine -match 'npm-cli\.js"?\s+run\s+tauri:dev') { break }
        $cur = $byId[[int]$cur.ParentProcessId]
    }
}
# tauri's beforeDevCommand: `cmd /c vite` -> node vite.js with no extra args, in this repo (not other vite configs).
$devTree = @($devTree) + @($all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match ($repoPattern + '.*vite[\\/]bin[\\/]vite\.js"?\s*$') })
$plan = @($app) + @($devTree) | ForEach-Object { [pscustomobject]@{ Pid = $_.ProcessId; Name = $_.Name; Cmd = ($_.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(140, ($_.CommandLine -replace '\s+', ' ').Length)) } }
"llama-server (dies with hodeum.exe via its job): " + (($llama | ForEach-Object ProcessId) -join ', ')
$plan | Format-Table -AutoSize | Out-String -Width 220
$foreign = @($app | Where-Object { $_.ExecutablePath -notmatch $repoPattern })
if ($foreign) {
    Write-Warning "an INSTALLED Hodeum is running ($($foreign.ExecutablePath -join ', ')); it shares com.hodeum.app data and WebView2 profile with the dev build"
}
if ($DryRun) { 'dry run: nothing stopped'; exit 0 }

function Alive-App { @($appIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count }
# 1. Graceful: only works for a debug build started with -CdpPort (release builds ignore the CDP variable).
if ($app -and $CdpPort) {
    $env:CDP_PORT = "$CdpPort"; $env:CDP_TIMEOUT_MS = '3000'
    & node "$PSScriptRoot\cdp.mjs" quit 2>&1 | ForEach-Object { "graceful quit: $_" }
    if ($LASTEXITCODE -eq 0) {
        $deadline = (Get-Date).AddSeconds($GraceSec)
        while ((Alive-App) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    }
    if (Alive-App) { "graceful quit didn't finish; forcing" } else { 'quit gracefully' }
}
# 2. Forced fallback for whatever is still running.
foreach ($p in $app) { Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue }
$deadline = (Get-Date).AddSeconds($WaitSec)
$llamaIds = @($llama | ForEach-Object { [int]$_.ProcessId })
function Alive-Llama { @($llamaIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count }
while ((Alive-Llama) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
foreach ($p in $devTree) { Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
$left = [ordered]@{
    hodeum = @(Get-Process hodeum -ErrorAction SilentlyContinue).Count
    llama = Alive-Llama
    port1420 = @(Get-NetTCPConnection -State Listen -LocalPort 1420 -ErrorAction SilentlyContinue).Count
    port8737 = @(Get-NetTCPConnection -State Listen -LocalPort 8737 -ErrorAction SilentlyContinue).Count
}
[pscustomobject]$left | ConvertTo-Json -Compress
if ($left.Values | Where-Object { $_ -gt 0 }) { exit 1 }
