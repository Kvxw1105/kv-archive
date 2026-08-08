@echo off
if "%~2"=="" (echo Usage: propose-state.cmd Bundle.zip proposal-draft.json [proposal-directory] & exit /b 2)
set "PROPOSAL_DIR=%~3"
if "%PROPOSAL_DIR%"=="" set "PROPOSAL_DIR=%CD%\kv-archive-proposals"
node "%~dp0dist\agent\index.js" propose --bundle "%~1" --input "%~2" --proposal-dir "%PROPOSAL_DIR%"
