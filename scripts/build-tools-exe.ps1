$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$ttsDir = Join-Path $repoRoot "tts-server"
$distDir = Join-Path $ttsDir "dist"
$entryFile = Join-Path $ttsDir "tools_exe_entry.py"
$toolsReq = Join-Path $ttsDir "requirements-tools.txt"

if (!(Test-Path $venvPython)) {
  throw "Missing venv Python at $venvPython. Create .venv first."
}
if (!(Test-Path $entryFile)) {
  throw "Missing tools exe entrypoint at $entryFile."
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
