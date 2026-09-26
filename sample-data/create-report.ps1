$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$reportPath = Join-Path $PSScriptRoot 'sample-soil-report.png'
$bitmap = New-Object System.Drawing.Bitmap(1500, 1850)
$bitmap.SetResolution(150, 150)
$canvas = [System.Drawing.Graphics]::FromImage($bitmap)
$canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$canvas.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$canvas.Clear([System.Drawing.Color]::White)
$resources = New-Object System.Collections.Generic.List[System.IDisposable]

function Brush([string]$hex) {
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex))
    $resources.Add($brush)
    return $brush
}
function Text([string]$value, [float]$x, [float]$y, [float]$size = 27, [string]$color = '#263A2C', [bool]$bold = $false, [float]$width = 1300, [float]$height = 90) {
    $weight = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = New-Object System.Drawing.Font('Arial', $size, $weight, [System.Drawing.GraphicsUnit]::Pixel)
    $resources.Add($font)
    $box = New-Object System.Drawing.RectangleF($x, $y, $width, $height)
    $canvas.DrawString($value, $font, (Brush $color), $box)
}

try {
    $canvas.FillRectangle((Brush '#254F38'), 0, 0, 1500, 18)
    Text 'AGRILENS / TEST FIXTURE' 90 65 25 '#617455' $true
    Text 'Soil analysis report' 90 120 57 '#254F38' $true
    Text 'SYNTHETIC DATA - NOT A REAL LABORATORY REPORT' 90 201 25 '#8B5D19' $true
    $canvas.FillRectangle((Brush '#FFF5DD'), 90, 260, 1320, 94)
    Text 'For app testing only. All values and ratings below are fictional.' 113 280 27 '#76551D'
    Text 'These ratings are test labels, not validated agronomic thresholds.' 113 318 22 '#76551D'

    Text 'REPORT ID' 90 394 20 '#72806A' $true
    Text 'DEMO-SOIL-001' 90 425 29 '#263A2C' $true
    Text 'CROP CONTEXT' 570 394 20 '#72806A' $true
    Text 'Wheat (test scenario)' 570 425 29
    Text 'DATE' 1110 394 20 '#72806A' $true
    Text '2026-09-24' 1110 425 29
    Text 'Sample depth: 0-15 cm (fictional). Laboratory and analytical methods: not supplied.' 90 483 24 '#617455'

    $rows = @(
        @{ parameter = 'pH'; value = '7.6'; unit = 'pH'; interpretation = 'Not rated'; reference = 'Not provided' },
        @{ parameter = 'Nitrate-N'; value = '8'; unit = 'mg/kg'; interpretation = 'Low'; reference = 'Not provided' },
        @{ parameter = 'Available phosphorus'; value = '12'; unit = 'mg/kg'; interpretation = 'Medium'; reference = 'Not provided' },
        @{ parameter = 'Exchangeable potassium'; value = '180'; unit = 'mg/kg'; interpretation = 'Adequate'; reference = 'Not provided' },
        @{ parameter = 'Organic matter'; value = '1.2'; unit = '%'; interpretation = 'Low'; reference = 'Not provided' },
        @{ parameter = 'Electrical conductivity'; value = '0.7'; unit = 'dS/m'; interpretation = 'Not rated'; reference = 'Not provided' }
    )
    $canvas.FillRectangle((Brush '#254F38'), 90, 560, 1320, 70)
    Text 'PARAMETER' 108 581 21 '#FFFFFF' $true 330
    Text 'VALUE' 477 581 21 '#FFFFFF' $true 110
    Text 'UNIT' 617 581 21 '#FFFFFF' $true 125
    Text 'PRINTED RATING' 797 581 21 '#FFFFFF' $true 220
    Text 'REFERENCE RANGE' 1107 581 21 '#FFFFFF' $true 295
    $y = 630
    foreach ($row in $rows) {
        $fill = if ((($y - 630) / 100) % 2 -eq 0) { '#F0F4EA' } else { '#FAFBF7' }
        $canvas.FillRectangle((Brush $fill), 90, $y, 1320, 100)
        Text $row.parameter 108 ($y + 25) 26 '#263A2C' $false 330 74
        Text $row.value 477 ($y + 25) 29 '#254F38' $true 110
        Text $row.unit 617 ($y + 25) 27 '#263A2C' $false 150
        Text $row.interpretation 797 ($y + 25) 27 '#263A2C' $false 240
        Text $row.reference 1107 ($y + 25) 25 '#617455' $false 290
        $y += 100
    }
    Text 'REPORT NOTES' 90 1280 22 '#617455' $true
    Text '1. Preserve the values, units and printed ratings exactly as shown.' 90 1330 27
    Text '2. Reference ranges and analytical methods were not provided.' 90 1380 27
    Text '3. No rainfall, soil moisture or irrigation measurements were provided.' 90 1430 27
    Text '4. This report does not establish the cause of any visible leaf symptoms.' 90 1480 27
    Text '5. No fertilizer, pesticide, lime or irrigation application rate is supplied.' 90 1530 27
    $canvas.FillRectangle((Brush '#E4EBDD'), 90, 1650, 1320, 2)
    Text 'FICTIONAL TEST DATA / NOT FOR FIELD DECISIONS' 90 1682 23 '#617455' $true
    Text 'This fixture is unrelated to the reference photos supplied in the test pack.' 90 1727 24 '#72806A'
    Text 'Page 1 of 1' 1210 1780 20 '#72806A' $false 200
    $bitmap.Save($reportPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'expected-soil-readings.json') -Encoding UTF8
    Write-Output 'Created sample-soil-report.png (1500 x 1850) and expected-soil-readings.json.'
} finally {
    foreach ($resource in $resources) { $resource.Dispose() }
    $canvas.Dispose()
    $bitmap.Dispose()
}
