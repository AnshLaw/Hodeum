# End-to-end Gate 6 run of the windows-zip task pack against the REAL app:
# spoken goal (here: hode:start over CDP) -> target highlight -> learner action (real SendInput) -> verification.
#   .\e2e-zip.ps1 -CdpPort 9229          # Hodeum started with start-hodeum.ps1 -CdpPort 9229
#   .\e2e-zip.ps1 -NoHodeum              # only exercise the Explorer driving (no app needed)
# Artifacts (screenshots, overlay/uia JSON) go to .\runs\<stamp>\.
param([int]$CdpPort = 9229, [switch]$NoHodeum, [int]$StepTimeoutSec = 30)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$env:CDP_PORT = "$CdpPort"
$run = Join-Path $PSScriptRoot ("runs\" + (Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Force $run | Out-Null
$folderName = 'hodeum-e2e-zip'
$folder = Join-Path $env:TEMP $folderName
Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $folder | Out-Null
1..3 | ForEach-Object { Set-Content (Join-Path $folder "note$_.txt") "test file $_" }

function Cdp([string[]]$cdpArgs) {
    $out = & node "$PSScriptRoot\cdp.mjs" @cdpArgs
    if ($LASTEXITCODE -ne 0) { throw "cdp $($cdpArgs -join ' ') failed" }
    ($out -join "`n") | ConvertFrom-Json
}
function Wait-Summary([scriptblock]$until, [string]$what) {
    $deadline = (Get-Date).AddSeconds($StepTimeoutSec)
    do { $s = Cdp @('summary'); if (& $until $s) { return $s }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline)
    throw "timed out waiting for $what; last summary: $($s | ConvertTo-Json -Compress)"
}
function Find-In($root, [string]$name, [string]$type) {
    $deadline = (Get-Date).AddSeconds(10)
    do {
        foreach ($el in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            $c = $el.Current
            if ($c.Name -eq $name -and (-not $type -or $c.ControlType.ProgrammaticName -eq "ControlType.$type")) { return $el }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw "UIA element '$name' ($type) not found"
}
# Windows 11 context menus live in top-level 'PopupHost' windows (WinUI); searching the whole desktop is too slow.
function Find-MenuItem([string]$name, [int]$WithinSec = 10) {
    $deadline = (Get-Date).AddSeconds($WithinSec)
    do {
        foreach ($pw in ([HodeumNative]::Windows(0) | Where-Object { $_.Visible -and $_.Title -eq 'PopupHost' })) {
            $cond = New-Object System.Windows.Automation.AndCondition(
                (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name)),
                (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::MenuItem)))
            $hit = $A::FromHandle([IntPtr]$pw.Hwnd).FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($hit) { return $hit }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    & (Join-Path $PSScriptRoot 'screenshot.ps1') -Out (Join-Path $run 'menu-missing.png') | Out-Null
    $hosts = ([HodeumNative]::Windows(0) | Where-Object { $_.Visible -and $_.Title -eq 'PopupHost' } | ForEach-Object { "$($_.X),$($_.Y) $($_.W)x$($_.H)" }) -join '; '
    throw "menu item '$name' not found; visible PopupHosts: [$hosts]; screenshot in $run"
}
function Rect($el) {
    $r = $el.Current.BoundingRectangle
    # An element still animating in (or scrolled away) reports an empty/infinite rect.
    if ($r.IsEmpty -or [double]::IsInfinity($r.X)) { return [pscustomobject]@{ x = 0; y = 0; width = 0; height = 0 } }
    [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height } }
# Win11 menus animate in: the same item reads y=837 h=39 mid-animation and y=809 h=32 settled. Wait for 2 equal reads.
function Wait-StableRect($el) {
    $last = $null
    foreach ($i in 1..20) {
        $now = (Rect $el) | ConvertTo-Json -Compress
        if ($now -eq $last -and (Rect $el).width -gt 0) { return }
        $last = $now; Start-Sleep -Milliseconds 150
    }
}
function Center($el) { $r = Rect $el; @([int]($r.x + $r.width / 2), [int]($r.y + $r.height / 2)) }
function Check-Overlay([string]$step, $element) {
    if ($NoHodeum) { return }
    Start-Sleep -Milliseconds 800   # let the overlay settle after the phase change
    Cdp @('overlay') | ConvertTo-Json -Depth 8 | Set-Content "$run\$step.overlay.json"
    [pscustomobject]@{ elements = @([pscustomobject]@{ name = $element.Current.Name; bounds = (Rect $element) }) } | ConvertTo-Json -Depth 5 | Set-Content "$run\$step.uia.json"
    & "$PSScriptRoot\screenshot.ps1" -Out "$run\$step.png" | Out-Null
    & node "$PSScriptRoot\compare.mjs" "$run\$step.overlay.json" "$run\$step.uia.json"
    if ($LASTEXITCODE -ne 0) { throw "step ${step}: highlight is not on '$($element.Current.Name)' (see $run)" }
}

# 1. Open our own Explorer window on the scratch folder and select the files (prerequisite of the pack).
Start-Process explorer.exe $folder
$deadline = (Get-Date).AddSeconds(15)
do { Start-Sleep -Milliseconds 400; $hw = [HodeumNative]::Windows(0) | Where-Object { $_.Visible -and $_.Title -like "$folderName*" } | Select-Object -First 1 } while (-not $hw -and (Get-Date) -lt $deadline)
if (-not $hw) { throw 'Explorer window did not open' }
$explorer = $A::FromHandle([IntPtr]$hw.Hwnd)
try {
    $items = Find-In $explorer 'Items View' 'List'
    $first = Find-In $items 'note1.txt' 'ListItem'
    $fx, $fy = Center $first
    [HodeumNative]::Click($fx, $fy, $false); Start-Sleep -Milliseconds 300
    [HodeumNative]::Chord(0x11, 0x41); Start-Sleep -Milliseconds 300            # Ctrl+A selects all files
    "selected files; Items View at $((Rect $items) | ConvertTo-Json -Compress)"

    if (-not $NoHodeum) {
        Cdp @('arm') | Out-Null
        Cdp @('start', 'zip files') | Out-Null
        Wait-Summary { param($s) $s.phase -eq 'guiding' -and $s.step.current -eq 1 } 'step 1 guidance' | ConvertTo-Json -Compress
        Check-Overlay 'step1' $items
    }
    # 2. Learner right-clicks the selection (real input).
    # Explorer sometimes drops the first right-click after the window opens: retry, as a learner would.
    $menu = $null; $tries = 0
    while (-not $menu -and $tries -lt 3) {
        $tries++
        [HodeumNative]::Click($fx, $fy, $true)
        try { $menu = Find-MenuItem 'Compress to...' -WithinSec 3 } catch { if ($tries -eq 3) { throw } ; "right-click $tries showed no menu, retrying" }
    }
    Start-Sleep -Milliseconds 400; $menu = Find-MenuItem 'Compress to...'; Wait-StableRect $menu   # re-find after the open animation
    "context menu item 'Compress to...' at $((Rect $menu) | ConvertTo-Json -Compress)"
    if (-not $NoHodeum) {
        Wait-Summary { param($s) $s.step.current -eq 2 } 'step 2' | ConvertTo-Json -Compress
        Check-Overlay 'step2' $menu
    }
    $fg = [HodeumNative]::GetForegroundWindow().ToInt64()
    $fgw = [HodeumNative]::Windows(0) | Where-Object { $_.Hwnd -eq $fg } | Select-Object -First 1
    "foreground while the menu is open: '$($fgw.Title)' class=$($fgw.Class) pid=$($fgw.Pid) $($fgw.X),$($fgw.Y) $($fgw.W)x$($fgw.H)"
    if ($NoHodeum) { [HodeumNative]::Chord(0x1B); 'NoHodeum: closed the menu, stopping before any change'; return }
    $mx, $my = Center $menu; [HodeumNative]::Click($mx, $my, $false)
    $zip = Find-MenuItem 'ZIP File'
    Start-Sleep -Milliseconds 400; $zip = Find-MenuItem 'ZIP File'; Wait-StableRect $zip
    Wait-Summary { param($s) $s.step.current -eq 3 } 'step 3' | ConvertTo-Json -Compress
    Check-Overlay 'step3' $zip
    $zx, $zy = Center $zip; [HodeumNative]::Click($zx, $zy, $false)
    Wait-Summary { param($s) $s.phase -eq 'success' } 'Hode complete' | ConvertTo-Json -Compress
    [HodeumNative]::Chord(0x0D)                                                  # accept the proposed archive name
    Start-Sleep -Seconds 2
    if (-not (Get-ChildItem $folder -Filter *.zip)) { throw 'no .zip was created' }
    "PASS: zip created, artifacts in $run"
} finally {
    if (-not $NoHodeum) { try { Cdp @('end') | Out-Null } catch { Write-Warning $_ } }
    $explorer.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()   # only the window we opened
}
