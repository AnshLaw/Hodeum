# Finds UIA elements by name (regex) inside the top-level window whose title matches -Window, and prints
# their physical-px rects as JSON: the ground truth to compare Hodeum's overlay against.
#   .\uia-find.ps1 -Window 'Settings' -Name '^Colors$'
#   .\uia-find.ps1 -Window 'Excel' -Name 'PivotTable' -Type Button
param([Parameter(Mandatory)] [string]$Window, [Parameter(Mandatory)] [string]$Name, [string]$Type, [int]$WaitSec = 10)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$deadline = (Get-Date).AddSeconds($WaitSec)
do {
    $hw = [HodeumNative]::Windows(0) | Where-Object { $_.Visible -and $_.Title -match $Window -and $_.W -gt 0 } | Select-Object -First 1
    $hits = @()
    if ($hw) {
        $root = $A::FromHandle([IntPtr]$hw.Hwnd)
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($el in $all) {
            $c = $el.Current
            if ($c.Name -notmatch $Name) { continue }
            $type = $c.ControlType.ProgrammaticName -replace 'ControlType.', ''
            if ($Type -and $type -ne $Type) { continue }
            $r = $c.BoundingRectangle
            if ($r.IsEmpty -or [double]::IsInfinity($r.X)) { continue }
            $hits += [pscustomobject]@{ name = $c.Name; type = $type; id = $c.AutomationId; offscreen = $c.IsOffscreen
                bounds = [pscustomobject]@{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height } }
        }
    }
    if ($hits.Count) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if (-not $hw) { Write-Error "no visible window titled /$Window/"; exit 1 }
if (-not $hits.Count) { Write-Error "no element /$Name/ in '$($hw.Title)'"; exit 1 }
[pscustomobject]@{ window = [pscustomobject]@{ title = $hw.Title; hwnd = $hw.Hwnd; x = $hw.X; y = $hw.Y; width = $hw.W; height = $hw.H; dpi = $hw.Dpi }; elements = $hits } |
    ConvertTo-Json -Depth 5
