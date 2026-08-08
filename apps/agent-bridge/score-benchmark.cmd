@echo off
if "%~4"=="" (echo Usage: score-benchmark.cmd Bundle.zip answer-key.json response.json OUTPUT_DIRECTORY & exit /b 2)
node "%~dp0dist\agent\index.js" benchmark-score --bundle "%~1" --benchmark "%~2" --response "%~3" --output "%~4"
