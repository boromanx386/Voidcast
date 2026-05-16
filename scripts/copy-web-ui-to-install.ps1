# Copy freshly built web-ui into an installed Voidcast app (no full reinstall).
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repoRoot "tts-server\web-ui"
$index = Join-Path $src "index.web.html"

if (!(Test-Path $index)) {
  Write-Host "Building web-ui..."
  Push-Location (Join-Path $repoRoot "electron-app")
  npm run build:web
  Pop-Location
}

$candidates = @(
  "$env:LOCALAPPDATA\Programs\Voidcast\resources\tts-server\web-ui",
  "$env:LOCALAPPDATA\Programs\voidcast\resources\tts-server\web-ui",
  "${env:ProgramFiles}\Voidcast\resources\tts-server\web-ui",
  "${env:ProgramFiles(x86)}\Voidcast\resources\tts-server\web-ui"
)

$destParent = $null
foreach ($c in $candidates) {
  $parent = Split-Path $c -Parent
  if (Test-Path $parent) {
    $destParent = $parent
    break
  }
}

if (-not $destParent) {
  Write-Host "Could not find Voidcast install under:"
  $candidates | ForEach-Object { Write-Host "  $_" }
  exit 1
}

$dest = Join-Path $destParent "web-ui"
Write-Host "Copying web-ui to $dest"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse -Force $src $dest
Write-Host "Done. Restart Voidcast, then open http://<your-LAN-IP>:8765/ on your phone."
Write-Host "Health should show web_ui: true"
