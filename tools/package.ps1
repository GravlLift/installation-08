#requires -Version 7
<#
.SYNOPSIS
    Builds the packaged infinite-theater-3d: one self-contained Windows exe with the
    web viewer embedded, plus a release zip.

.DESCRIPTION
    The script builds the web app (web\npm run build), stages web\dist\index.html and
    web\dist\assets into internal\webdist\files (the dev fixtures in web\dist\dev never
    leave web\dist), builds the Go binary with the embedweb tag, the version and a
    static MinGW link (no libwinpthread-1.dll on the user's machine), and writes under
    dist\:

        dist\infinite-theater-3d-<version>-windows-amd64\
            infinite-theater-3d.exe
            LICENSE
            NOTICE.md
            README.md
            <third-party license texts from third_party\>
        dist\infinite-theater-3d-<version>-windows-amd64.zip

    Any failing step stops the script with a non-zero exit and a clear message.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $PSCommandPath
$repo = Split-Path -Parent $scriptDir
if (-not $repo -or -not (Test-Path $repo)) { throw "cannot resolve repo root: PSCommandPath=$PSCommandPath scriptDir=$scriptDir repo=$repo" }

# --- 1. Toolchain check: whatever Go, gcc and Node are on PATH; say which one is missing.
$missing = @()
if (-not (Get-Command go -ErrorAction SilentlyContinue)) { $missing += 'go' }
if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) { $missing += 'gcc (a C toolchain for cgo)' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missing += 'npm' }
if ($missing) {
    throw "missing from PATH: $($missing -join ', ')"
}
if (-not $env:CGO_ENABLED) { $env:CGO_ENABLED = '1' }

# --- 2. Web build (unless -SkipWeb).
if (-not $SkipWeb) {
    Push-Location (Join-Path $repo 'web')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}
$dist = Join-Path (Join-Path $repo 'web') 'dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
    throw "web build missing: $dist\index.html (run without -SkipWeb, or build web first)"
}

# --- 3. Stage the viewer: index.html and assets only. web\dist\dev is local development
# fixtures and never ends up in the exe or the zip.
$stage = Join-Path (Join-Path (Join-Path $repo 'internal') 'webdist') 'files'
$srcAssets = Join-Path $dist 'assets'
$dstAssets = Join-Path $stage 'assets'
New-Item -ItemType Directory -Force -Path $dstAssets | Out-Null
# Drop the files of an earlier staging (asset names carry a content hash, so an old build
# leaves other names behind). The tracked placeholder stays.
Get-ChildItem -LiteralPath $stage -File | Where-Object Name -ne 'placeholder' | Remove-Item
Get-ChildItem -LiteralPath $dstAssets -File | Remove-Item
Copy-Item -LiteralPath (Join-Path $dist 'index.html') -Destination $stage
if (Test-Path $srcAssets) {
    Get-ChildItem -LiteralPath $srcAssets -File | Copy-Item -Destination $dstAssets
}

# --- 4. The packaged binary: embed tag, version, no debug info, static MinGW link.
$outDir = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir 'infinite-theater-3d.exe'
Push-Location $repo
try {
    & go build -tags embedweb -trimpath -ldflags "-s -w -X main.Version=$Version -extldflags=-static" -o $exe ./cmd/infinite-theater-3d
    if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
}
finally { Pop-Location }

# --- 5. The release folder and the zip.
$name = "infinite-theater-3d-$Version-windows-amd64"
$pkgDir = Join-Path $outDir $name
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
Get-ChildItem -LiteralPath $pkgDir -File | Remove-Item
Copy-Item -LiteralPath $exe -Destination (Join-Path $pkgDir 'infinite-theater-3d.exe')
foreach ($f in 'LICENSE', 'NOTICE.md', 'README.md') {
    Copy-Item -LiteralPath (Join-Path $repo $f) -Destination $pkgDir
}
# Third-party license texts the repo already carries.
$tp = Join-Path $repo 'third_party'
Get-ChildItem -LiteralPath $tp -Recurse -File |
    Where-Object { $_.Name -match '^(LICENSE|COPYING|NOTICE)' } |
    ForEach-Object {
        $rel = $_.FullName.Substring($tp.Length).TrimStart('\')
        $dest = Join-Path (Join-Path $pkgDir 'third_party') $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $dest
    }
$zip = Join-Path $outDir "$name.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip }
Compress-Archive -Path $pkgDir -DestinationPath $zip

Write-Host ''
Write-Host "Packaged build ${name}:"
Write-Host "  exe:  $exe ($((Get-Item $exe).Length) bytes)"
Write-Host "  zip:  $zip ($((Get-Item $zip).Length) bytes)"
Write-Host "  folder: $pkgDir"
