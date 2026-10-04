# Draws rectangles (physical screen px) onto a screenshot so a human or a vision model can eyeball alignment.
#   .\mark.ps1 -In full.png -OriginX -1600 -OriginY 0 -Out marked.png -Rects '[{"x":32,"y":366,"width":560,"height":72,"color":"Lime"}]'
param([Parameter(Mandatory)] [string]$In, [Parameter(Mandatory)] [string]$Out, [int]$OriginX = 0, [int]$OriginY = 0,
      [Parameter(Mandatory)] [string]$Rects)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$PEN_WIDTH = 4
$source = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($In))
$bitmap = New-Object System.Drawing.Bitmap $source
$source.Dispose()
$g = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    foreach ($r in ($Rects | ConvertFrom-Json)) {
        $color = if ($r.color) { [System.Drawing.Color]::FromName($r.color) } else { [System.Drawing.Color]::Red }
        $pen = New-Object System.Drawing.Pen $color, $PEN_WIDTH
        $g.DrawRectangle($pen, [int]($r.x - $OriginX), [int]($r.y - $OriginY), [int]$r.width, [int]$r.height)
        $pen.Dispose()
    }
    $bitmap.Save([System.IO.Path]::GetFullPath($Out), [System.Drawing.Imaging.ImageFormat]::Png)
    "marked $Out"
} finally { $g.Dispose(); $bitmap.Dispose() }
