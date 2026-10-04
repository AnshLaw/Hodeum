# Read-only UI Automation dump of a window (physical px). Never invokes anything.
#   .\uia-tree.ps1 -Title Hodey                  # Hodeum notch
#   .\uia-tree.ps1 -Hwnd 0x1234 -Depth 12 -Json  # any window, JSON for assertions
#   .\uia-tree.ps1 -Title Settings -Name Colors  # only elements whose Name matches
param([string]$Title, [string]$Hwnd, [int]$Depth = 25, [string]$Name, [switch]$Json, [int]$Max = 400)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]

if ($Hwnd) {
    $root = $A::FromHandle([IntPtr][Convert]::ToInt64(($Hwnd -replace '^0x', ''), 16))
} else {
    $cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $Title)
    $root = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}
if (-not $root) { Write-Error "window not found (Title='$Title' Hwnd='$Hwnd')"; exit 1 }

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$out = New-Object System.Collections.Generic.List[object]
function Visit($el, $level) {
    if ($level -gt $Depth -or $out.Count -ge $Max) { return }
    $c = $el.Current
    $r = $c.BoundingRectangle
    if ($r.IsEmpty -or [double]::IsInfinity($r.X)) { $r = New-Object System.Windows.Rect 0, 0, 0, 0 }
    $patterns = ($el.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern', '' }) -join ','
    $row = [pscustomobject]@{
        depth = $level; type = $c.ControlType.ProgrammaticName -replace 'ControlType.', ''; name = $c.Name
        id = $c.AutomationId; cls = $c.ClassName; offscreen = $c.IsOffscreen; enabled = $c.IsEnabled
        x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; patterns = $patterns
    }
    if (-not $Name -or $c.Name -match $Name) { $out.Add($row) }
    $child = $walker.GetFirstChild($el)
    while ($child) { Visit $child ($level + 1); $child = $walker.GetNextSibling($child) }
}
Visit $root 0
if ($Json) { $out | ConvertTo-Json -Depth 3 } else {
    $out | ForEach-Object { ('  ' * $_.depth) + "[$($_.type)] '$($_.name)' id=$($_.id) @$($_.x),$($_.y) $($_.w)x$($_.h) off=$($_.offscreen) {$($_.patterns)}" }
}
