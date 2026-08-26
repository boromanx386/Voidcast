@echo off
rem ============================================================
rem  Voidcast — cloud model preset checker (interactive apply)
rem  Launches a fresh PowerShell window that runs
rem  scripts/check-models.mjs --apply, so the output renders
rem  cleanly (plain cmd smears lines together).
rem ============================================================
setlocal

rem Move to the project root (parent of the scripts folder).
cd /d "%~dp0.."

echo.
echo  Opening PowerShell window to run: node scripts/check-models.mjs --apply
echo  (follow the prompts: numbers, 'a' = all, Enter = skip)
echo.

rem Launch a NEW PowerShell window (blue title bar, not cmd).
start "Voidcast model apply" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%~dp0..'; node scripts/check-models.mjs --apply; Write-Host ''; Write-Host 'Done. Review changes with:'; Write-Host '  git diff electron-app/src/lib/cloudLlmPresets.ts electron-app/src/lib/contextLimit.ts'"

endlocal