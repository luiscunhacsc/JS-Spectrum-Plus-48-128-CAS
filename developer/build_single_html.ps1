param(
    [string]$InputHtml = "js_spectrum.html",
    [string]$OutputHtml = "..\index.html",
    [string]$CpuScript = "Z80.js",
    [string]$RomFile = "48.rom",
    [string]$KeyboardImage = "keyboard.jpg"
)

$ErrorActionPreference = "Stop"

function Update-RequiredText {
    param(
        [string]$Content,
        [string]$Search,
        [string]$Replace,
        [string]$Label
    )

    if (-not $Content.Contains($Search)) {
        throw "Could not find expected block: $Label"
    }

    return $Content.Replace($Search, $Replace)
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($root)) {
    $root = (Get-Location).Path
}

$inputPath = Join-Path $root $InputHtml
$cpuPath = Join-Path $root $CpuScript
$romPath = Join-Path $root $RomFile
$keyboardPath = Join-Path $root $KeyboardImage
$outputPath = Join-Path $root $OutputHtml

$html = [System.IO.File]::ReadAllText($inputPath)
$z80 = [System.IO.File]::ReadAllText($cpuPath)
$cas = [System.IO.File]::ReadAllText((Join-Path $root 'cas.js'))
$calculatorUi = [System.IO.File]::ReadAllText((Join-Path $root 'calculator-ui.js'))
$calculatorCss = [System.IO.File]::ReadAllText((Join-Path $root 'calculator.css'))
$romB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($romPath))
$keyboardB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($keyboardPath))
$embeddedRomMap = @{ '48K' = $romB64 }
$rom128Dir = Join-Path $root "ZX Spectrum 128"
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($romName in @('128-0.rom.zip', '128-1.rom.zip')) {
    $romArchivePath = Join-Path $rom128Dir $romName
    if (-not (Test-Path $romArchivePath)) {
        throw "Required 128K ROM archive is missing: $romArchivePath"
    }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($romArchivePath)
    try {
        $romEntry = @($archive.Entries | Where-Object { $_.Name -match '\.rom$' })
        if ($romEntry.Count -ne 1) {
            throw "$romArchivePath must contain exactly one ROM file."
        }
        $stream = $romEntry[0].Open()
        $memoryStream = [System.IO.MemoryStream]::new()
        try {
            $stream.CopyTo($memoryStream)
            $romBytes = $memoryStream.ToArray()
        } finally {
            $memoryStream.Dispose()
            $stream.Dispose()
        }
        if ($romBytes.Length -ne 16384) {
            throw "$($romEntry[0].Name) must be exactly 16 KB."
        }
        $embeddedRomMap[$romEntry[0].Name] = [Convert]::ToBase64String($romBytes)
    } finally {
        $archive.Dispose()
    }
}
$embeddedRomJson = $embeddedRomMap | ConvertTo-Json -Compress
$tapDir = Join-Path $root "TAPs"
$embeddedTapMap = @{}
if (Test-Path $tapDir) {
    Get-ChildItem -Path $tapDir -File -Filter *.tap | Sort-Object Name | ForEach-Object {
        $relativeTapPath = "TAPs/" + $_.Name
        $embeddedTapMap[$relativeTapPath] = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($_.FullName))
    }
}
$embeddedTapJson = if ($embeddedTapMap.Count -gt 0) { $embeddedTapMap | ConvertTo-Json -Compress } else { "{}" }

$inlineZ80 = "<script>`r`n$z80`r`n</script>"
$html = Update-RequiredText -Content $html -Search '<script src="Z80.js"></script>' -Replace $inlineZ80 -Label 'external Z80 script tag'
$html = Update-RequiredText -Content $html -Search '<script src="cas.js"></script>' -Replace "<script>`r`n$cas`r`n</script>" -Label 'CAS script tag'
$html = Update-RequiredText -Content $html -Search '<script src="calculator-ui.js"></script>' -Replace "<script>`r`n$calculatorUi`r`n</script>" -Label 'calculator UI script tag'
$html = Update-RequiredText -Content $html -Search '<link rel="stylesheet" href="calculator.css">' -Replace "<style>`r`n$calculatorCss`r`n</style>" -Label 'calculator stylesheet'
$html = Update-RequiredText -Content $html -Search 'src="keyboard.jpg"' -Replace "src=`"data:image/jpeg;base64,$keyboardB64`"" -Label 'keyboard image source'
foreach ($modelImage in @('spectrum-48k.png', 'spectrum-128k.png')) {
    $modelImagePath = Join-Path $root "assets/$modelImage"
    $modelImageB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($modelImagePath))
    $html = Update-RequiredText -Content $html -Search "src=`"assets/$modelImage`"" -Replace "src=`"data:image/png;base64,$modelImageB64`"" -Label "$modelImage source"
}
$html = Update-RequiredText -Content $html -Search 'const EMBEDDED_TAP_BASE64 = {};' -Replace "const EMBEDDED_TAP_BASE64 = $embeddedTapJson;" -Label 'embedded TAP map placeholder'
$html = Update-RequiredText -Content $html -Search 'const EMBEDDED_ROM_BASE64 = {};' -Replace "const EMBEDDED_ROM_BASE64 = $embeddedRomJson;" -Label 'embedded ROM map placeholder'

[System.IO.File]::WriteAllText($outputPath, $html, [System.Text.UTF8Encoding]::new($false))

Write-Host "Standalone file generated: $OutputHtml"
