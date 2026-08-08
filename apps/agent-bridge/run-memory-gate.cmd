@echo off
if "%~3"=="" (echo Usage: run-memory-gate.cmd Bundle.zip PROJECT OUTPUT_DIRECTORY [POLICY] [TOKEN_BUDGET] & exit /b 2)
set "POLICY=%~4"
if "%POLICY%"=="" set "POLICY=balanced"
set "TOKEN_BUDGET=%~5"
if "%TOKEN_BUDGET%"=="" set "TOKEN_BUDGET=2048"
node "%~dp0dist\agent\index.js" memory-gate --bundle "%~1" --project "%~2" --output "%~3" --policy "%POLICY%" --token-budget "%TOKEN_BUDGET%"
