@echo off
if "%~5"=="" (echo Usage: score-gate-benchmark.cmd Bundle.zip answer-key.json response-off.json response-on.json OUTPUT_DIRECTORY & exit /b 2)
node "%~dp0dist\agent\index.js" benchmark-gate-score --bundle "%~1" --benchmark "%~2" --response-off "%~3" --response-on "%~4" --output "%~5"
