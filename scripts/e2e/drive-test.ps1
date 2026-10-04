# Proves the input path end to end: opens test-target.ps1, finds its controls by UIA (physical px),
# clicks the textbox and types with SendInput, clicks the button at its UIA centre, then checks the log.
param([int]$X = 200, [int]$Y = 300)   # target position; try -X -1400 -Y 600 for the secondary monitor
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$log = "$PSScriptRoot\target.log"; Remove-Item $log -ErrorAction SilentlyContinue
$target = Start-Process powershell -PassThru -NoNewWindow -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$PSScriptRoot\test-target.ps1", '-Log', $log, '-X', $X, '-Y', $Y)
$cursor = New-Object HodeumNative+POINT; [void][HodeumNative]::GetCursorPos([ref]$cursor)
function Find-Named($root, $name) {
    # Name first, then AutomationId (WinForms/XAML set it from the control's Name).
    foreach ($prop in @($A::NameProperty, $A::AutomationIdProperty)) {
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition($prop, $name)))
        if ($el) { return $el }
    }
    throw "no element named '$name'"
}
function Center($el) { $r = $el.Current.BoundingRectangle; @([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) }
try {
    $deadline = (Get-Date).AddSeconds(20); $win = $null
    while (-not $win -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 300
        # Locate by HWND (EnumWindows) then wrap: robust even when UIA parents the window elsewhere.
        $hw = [HodeumNative]::Windows([uint32]$target.Id) | Where-Object { $_.Visible -and $_.Title -eq 'Hodeum harness target' } | Select-Object -First 1
        if ($hw) { $win = $A::FromHandle([IntPtr]$hw.Hwnd) }
    }
    if (-not $win) { throw 'test target window never appeared' }
    Start-Sleep -Milliseconds 800   # let the form finish laying out
    $button = Find-Named $win 'Harness button'
    # PowerShell-hosted WinForms exposes the TextBox only as an unnamed MSAA Pane: take the unnamed child.
    $box = $win.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) |
        Where-Object { -not $_.Current.Name } | Select-Object -First 1
    "uia box rect:    $($box.Current.BoundingRectangle)"
    "uia button rect: $($button.Current.BoundingRectangle)"
    $bx, $by = Center $box
    [HodeumNative]::Click($bx, $by, $false); Start-Sleep -Milliseconds 300
    [HodeumNative]::TypeText('make a pivot table ✓ हिंदी'); Start-Sleep -Milliseconds 200
    [HodeumNative]::Chord(0x11, 0x41)   # Ctrl+A (select all) to prove chords reach the focused control
    $cx, $cy = Center $button
    "clicking button centre at $cx,$cy"
    [HodeumNative]::Click($cx, $cy, $false); Start-Sleep -Milliseconds 400
    Get-Content -Encoding UTF8 $log
} finally {
    if (-not $target.HasExited) { Stop-Process -Id $target.Id }   # only the window this script opened
    [HodeumNative]::MoveTo($cursor.X, $cursor.Y)
}
