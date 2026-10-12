$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = Join-Path $projectRoot "release"
$distRoot = Join-Path $projectRoot "dist"
$packageJson = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version

& (Join-Path $PSScriptRoot "generate-release-assets.ps1")

Push-Location $projectRoot
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Extension build failed."
  }
}
finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$chromeArchive = Join-Path $releaseRoot "consistent-unit-price-chrome-$version.zip"
$firefoxArchive = Join-Path $releaseRoot "consistent-unit-price-firefox-$version.zip"
$sourceArchive = Join-Path $releaseRoot "consistent-unit-price-source-$version.zip"

foreach ($archive in @($chromeArchive, $firefoxArchive, $sourceArchive)) {
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
}

Compress-Archive -Path (Join-Path $distRoot "chrome\*") -DestinationPath $chromeArchive -CompressionLevel Optimal
Compress-Archive -Path (Join-Path $distRoot "firefox\*") -DestinationPath $firefoxArchive -CompressionLevel Optimal

$sourcePaths = @(
  (Join-Path $projectRoot "assets"),
  (Join-Path $projectRoot "docs"),
  (Join-Path $projectRoot "manifests"),
  (Join-Path $projectRoot "scripts"),
  (Join-Path $projectRoot "src"),
  (Join-Path $projectRoot ".gitignore"),
  (Join-Path $projectRoot "package.json"),
  (Join-Path $projectRoot "PRIVACY.md"),
  (Join-Path $projectRoot "README.md"),
  (Join-Path $projectRoot "tsconfig.json")
)

$lockFile = Join-Path $projectRoot "package-lock.json"
if (Test-Path -LiteralPath $lockFile) {
  $sourcePaths += $lockFile
}

Compress-Archive -Path $sourcePaths -DestinationPath $sourceArchive -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-ArchiveEntry {
  param(
    [string]$Archive,
    [string]$Entry
  )

  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    if (-not ($zip.Entries | Where-Object { $_.FullName -eq $Entry })) {
      throw "Archive '$Archive' is missing required root entry '$Entry'."
    }
  }
  finally {
    $zip.Dispose()
  }
}

Assert-ArchiveEntry $chromeArchive "manifest.json"
Assert-ArchiveEntry $firefoxArchive "manifest.json"
Assert-ArchiveEntry $sourceArchive "package.json"

Write-Output "Release archives created:"
Write-Output $chromeArchive
Write-Output $firefoxArchive
Write-Output $sourceArchive
