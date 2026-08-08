@echo off
if "%~4"=="" (echo Usage: create-gate-benchmark.cmd Bundle.zip PROJECT QUERY OUTPUT_DIRECTORY [POLICY] & exit /b 2)
set "POLICY=%~5"
if "%POLICY%"=="" set "POLICY=balanced"
node "%~dp0dist\agent\index.js" benchmark-gate-create --bundle "%~1" --project "%~2" --query "%~3" --output "%~4" --policy "%POLICY%"
