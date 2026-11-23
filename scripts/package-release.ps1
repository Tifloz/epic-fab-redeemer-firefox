param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $projectRoot "manifest.json"
$readmePath = Join-Path $projectRoot "README.md"
$sourcePath = Join-Path $projectRoot "src"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "manifest.json was not found at the project root."
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "The src directory was not found."
}
if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) {
  throw "README.md was not found at the project root."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.version -or -not $manifest.browser_specific_settings.gecko.id) {
  throw "The manifest needs a version and stable Firefox Gecko add-on ID."
}

if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  $resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$archiveName = "epic-fab-redeemer-firefox-v$($manifest.version).zip"
$archivePath = Join-Path $resolvedOutput $archiveName
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

$stagePath = Join-Path ([System.IO.Path]::GetTempPath()) ("efar-release-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stagePath | Out-Null
try {
  Copy-Item -LiteralPath $manifestPath -Destination $stagePath
  Copy-Item -LiteralPath $readmePath -Destination $stagePath
  Copy-Item -LiteralPath (Join-Path $projectRoot "CHANGELOG.md") -Destination $stagePath
  Copy-Item -LiteralPath $sourcePath -Destination $stagePath -Recurse
  Compress-Archive -Path (Join-Path $stagePath "*") -DestinationPath $archivePath -CompressionLevel Optimal
} finally {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $resolvedStage = [System.IO.Path]::GetFullPath($stagePath)
  if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

Write-Output "Created $archivePath"
