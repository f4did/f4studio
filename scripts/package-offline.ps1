$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'desktop\dist\win-unpacked'
$web = Join-Path $root 'dist'
$staging = Join-Path $root '.offline-package'
$zip = Join-Path $root 'F4-Studio-Offline-Windows.zip'

if (-not (Test-Path -LiteralPath (Join-Path $runtime 'F4 Studio.exe'))) {
  throw "The Windows runtime was not built: $runtime"
}

if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
Copy-Item -LiteralPath $runtime -Destination (Join-Path $staging 'windows-portable') -Recurse -Force
Copy-Item -LiteralPath $web -Destination (Join-Path $staging 'web-dist') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $staging -Force
Copy-Item -LiteralPath (Join-Path $root 'OFFLINE-START.txt') -Destination $staging -Force
Copy-Item -LiteralPath (Join-Path $root 'offline-launcher') -Destination (Join-Path $staging 'offline-launcher') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'docs\screenshots') -Destination (Join-Path $staging 'docs\screenshots') -Recurse -Force

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item -LiteralPath $staging -Recurse -Force
Write-Output "Created $zip"
