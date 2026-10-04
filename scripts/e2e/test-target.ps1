# A throwaway DPI-aware WinForms window used to prove click/type accuracy. It logs every click
# (screen px) and the textbox's text to $Log, and closes itself after $Seconds.
param([string]$Log = "$PSScriptRoot\target.log", [int]$Seconds = 25, [int]$X = 200, [int]$Y = 300)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\HodeumNative.ps1"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Set-Content -Encoding UTF8 -Path $Log -Value "ready $script:HodeumDpiMode"
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Hodeum harness target'; $form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point $X, $Y; $form.Size = New-Object System.Drawing.Size 700, 400
$form.TopMost = $true
$box = New-Object System.Windows.Forms.TextBox
$box.Name = 'HarnessInput'; $box.AccessibleName = 'Harness input'
$box.Location = New-Object System.Drawing.Point 20, 20; $box.Size = New-Object System.Drawing.Size 640, 40
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Harness button'; $button.AccessibleName = 'Harness button'
$button.Location = New-Object System.Drawing.Point 20, 120; $button.Size = New-Object System.Drawing.Size 300, 120
$button.Add_MouseClick({ param($s, $e)
    $screen = $button.PointToScreen($e.Location)
    Add-Content -Encoding UTF8 -Path $Log -Value ("click client={0},{1} screen={2},{3} text='{4}'" -f $e.X, $e.Y, $screen.X, $screen.Y, $box.Text) })
$form.Controls.AddRange(@($box, $button))
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = $Seconds * 1000
$timer.Add_Tick({ Add-Content -Encoding UTF8 -Path $Log -Value 'timeout-close'; $form.Close() }); $timer.Start()
$form.Add_FormClosed({ Add-Content -Encoding UTF8 -Path $Log -Value "closed text='$($box.Text)'" })
[void]$form.ShowDialog()
