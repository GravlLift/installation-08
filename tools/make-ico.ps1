#requires -Version 7
<#
.SYNOPSIS
    Packs a folder of PNGs into a multi-size Windows .ico, with PNG-compressed entries.

.DESCRIPTION
    Windows Vista and later accept a PNG image directly inside an ICO directory entry for
    any size, not just 256; this script writes every entry that way; no re-encoding, no
    external tool. It takes the sizes it finds named "icon-<N>.png" (or a given list) and
    writes them in descending size order, which is how Explorer and shell icon caches
    expect an ICO's entries to be ordered.

.PARAMETER PngDir
    Folder holding icon-<N>.png files (for example icon-16.png, icon-32.png, ...).

.PARAMETER OutFile
    The .ico file to write.

.PARAMETER Sizes
    The pixel sizes to include, largest first by default order given. Defaults to the set
    this project rasterizes: 256,128,96,64,48,40,32,24,20,16.
#>
param(
    [Parameter(Mandatory = $true)][string]$PngDir,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int[]]$Sizes = @(256, 128, 96, 64, 48, 40, 32, 24, 20, 16)
)

$ErrorActionPreference = 'Stop'

$entries = foreach ($size in $Sizes) {
    $path = Join-Path $PngDir "icon-$size.png"
    if (-not (Test-Path $path)) { throw "missing PNG for size $size`: $path" }
    [pscustomobject]@{
        Size = $size
        Bytes = [System.IO.File]::ReadAllBytes($path)
    }
}

# ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image, then the PNG bytes back to back.
$headerSize = 6
$dirEntrySize = 16
$dataOffset = $headerSize + ($dirEntrySize * $entries.Count)

$stream = [System.IO.MemoryStream]::new()
$w = [System.IO.BinaryWriter]::new($stream)

# ICONDIR: reserved=0, type=1 (icon), count
$w.Write([uint16]0)
$w.Write([uint16]1)
$w.Write([uint16]$entries.Count)

$offset = $dataOffset
foreach ($e in $entries) {
    $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }   # 0 means 256 in the ICO format
    $w.Write([byte]$dim)        # width
    $w.Write([byte]$dim)        # height
    $w.Write([byte]0)           # color count (0 = no palette, true color)
    $w.Write([byte]0)           # reserved
    $w.Write([uint16]1)         # color planes
    $w.Write([uint16]32)        # bits per pixel
    $w.Write([uint32]$e.Bytes.Length)
    $w.Write([uint32]$offset)
    $offset += $e.Bytes.Length
}
foreach ($e in $entries) {
    $w.Write($e.Bytes)
}

$w.Flush()
[System.IO.File]::WriteAllBytes($OutFile, $stream.ToArray())
Write-Host "Wrote $OutFile ($($entries.Count) sizes: $($Sizes -join ', '))"
