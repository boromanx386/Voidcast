$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$ttsDir = Join-Path $repoRoot "tts-server"
$distDir = Join-Path $ttsDir "dist"
$entryFile = Join-Path $ttsDir "tools_exe_entry.py"
$toolsReq = Join-Path $ttsDir "requirements-tools.txt"
$fontsDir = Join-Path $ttsDir "fonts"

if (!(Test-Path $venvPython)) {
  throw "Missing venv Python at $venvPython. Create .venv first."
}
if (!(Test-Path $entryFile)) {
  throw "Missing tools exe entrypoint at $entryFile."
}
if (!(Test-Path $fontsDir)) {
  throw "Missing PDF fonts at $fontsDir (need NotoSans-Regular.ttf and NotoSans-Bold.ttf)."
}

$webUiDir = Join-Path $ttsDir "web-ui"
$webIndex = Join-Path $webUiDir "index.web.html"
if (!(Test-Path $webIndex)) {
  Write-Host "[tools-exe] web-ui missing; running npm run build:web..."
  Push-Location (Join-Path $repoRoot "electron-app")
  npm run build:web | Out-Host
  Pop-Location
}
if (!(Test-Path $webIndex)) {
  throw "Missing $webIndex. Run from repo: cd electron-app; npm run build:web"
}

Write-Host "[tools-exe] Ensuring PyInstaller is available..."
& $venvPython -m pip install -r $toolsReq | Out-Host
& $venvPython -m pip install pyinstaller | Out-Host

if (Test-Path $distDir) {
  Remove-Item -Recurse -Force $distDir
}

Write-Host "[tools-exe] Building one-file tools backend..."
& $venvPython -m PyInstaller `
  --noconfirm `
  --onefile `
  --name voidcast-tools-server `
  --distpath $distDir `
  --workpath (Join-Path $ttsDir "build") `
  --specpath $ttsDir `
  --paths $ttsDir `
  --add-data "$fontsDir;fonts" `
  --add-data "$webUiDir;web-ui" `
  --exclude-module torch `
  --exclude-module torchaudio `
  --exclude-module omnivoice `
  --exclude-module transformers `
  --exclude-module tensorflow `
  --exclude-module tensorboard `
  $entryFile | Out-Host

$exe = Join-Path $distDir "voidcast-tools-server.exe"
if (!(Test-Path $exe)) {
  throw "Build did not produce $exe"
}

Write-Host "[tools-exe] OK: $exe"
