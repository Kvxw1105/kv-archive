@echo off
if "%~3"=="" (echo Usage: create-benchmark.cmd Bundle.zip PROJECT OUTPUT_DIRECTORY & exit /b 2)
node "%~dp0dist\agent\index.js" benchmark-create --bundle "%~1" --project "%~2" --output "%~3"
