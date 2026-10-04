# Starts the REAL desktop Hodeum from this checkout, optionally with the WebView2 DevTools endpoint for
# cdp.mjs, then waits until it is ready.
#   .\start-hodeum.ps1                         # npm run tauri:dev (live reload; Vite on [::1]:1420)
#   .\start-hodeum.ps1 -Standalone             # src-tauri\target\debug\hodeum.exe from `npm run app` (no Vite)
#   .\start-hodeum.ps1 -CdpPort 9229           # + CDP on 127.0.0.1:9229 (debug builds only; release ignores it)
#   .\start-hodeum.ps1 -Restart                # stop-hodeum.ps1 first
# The app log is %LOCALAPPDATA%\com.hodeum.app\logs\hodeum.log; the launcher's own output goes next to it.
param([int]$CdpPort = 0, [switch]$Restart, [switch]$Standalone, [int]$TimeoutSec = 900,
      [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$ErrorActionPreference = 'Stop'
if ($Restart) { & "$PSScriptRoot\stop-hodeum.ps1" -Repo $Repo -CdpPort $CdpPort }
# Single instance: a second launch would only hand over to (and show) the copy already running,
# which may be an older installed build.
$running = Get-Process hodeum -ErrorAction SilentlyContinue
if ($running) { throw "Hodeum is already running ($(($running | ForEach-Object Path) -join ', ')): run stop-hodeum.ps1 or pass -Restart" }
$ports = @(8737) + @($CdpPort | Where-Object { $_ }) + @(if (-not $Standalone) { 1420 })
foreach ($port in $ports) {
    $owner = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($owner) { throw "port $port is taken by pid $($owner.OwningProcess) ($((Get-Process -Id $owner.OwningProcess).Path))" }
}
$logs = Join-Path $env:LOCALAPPDATA 'com.hodeum.app\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $logs "launch-$stamp.out.log"; $err = Join-Path $logs "launch-$stamp.err.log"
# Inherited by npm -> tauri CLI -> cargo -> hodeum.exe -> WebView2. Appended to tauri.conf.json's additionalBrowserArgs.
if ($CdpPort) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$CdpPort" }
# Debug builds only: the harness's SendInput clicks and keys count as the learner's (release builds ignore it).
$env:HODEUM_E2E_INPUT = '1'
$env:RUST_BACKTRACE = '1'
try {
    if ($Standalone) {
        $exe = Join-Path $Repo 'src-tauri\target\debug\hodeum.exe'
        if (-not (Test-Path $exe)) { throw "no ${exe}: run npm run app first" }
        $proc = Start-Process -FilePath $exe -WorkingDirectory $Repo -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
        "started hodeum.exe pid $($proc.Id); launcher logs: $out | $err"
    } else {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', 'npm run tauri:dev' -WorkingDirectory $Repo `
            -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
        "started npm pid $($proc.Id); launcher logs: $out | $err"
    }
} finally {
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
}
& "$PSScriptRoot\wait-ready.ps1" -TimeoutSec $TimeoutSec -CdpPort $CdpPort -Repo $Repo -Standalone:$Standalone
if ($LASTEXITCODE -ne 0) {
    "not ready; last launcher stderr lines:"; Get-Content $err -Tail 30
    $appLog = Join-Path $logs 'hodeum.log'
    if (Test-Path $appLog) { "last app log lines:"; Get-Content $appLog -Tail 30 }
    exit 1
}
