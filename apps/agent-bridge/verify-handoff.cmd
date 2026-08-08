@echo off
if "%~5"=="" (echo Usage: verify-handoff.cmd Receiver-Handoff.zip Private-Verification-Kit.zip Receiver-Receipt.json Response.json OUTPUT_DIRECTORY & exit /b 2)
node "%~dp0dist\agent\index.js" handoff-verify --handoff "%~1" --verification-kit "%~2" --receiver-receipt "%~3" --response "%~4" --output "%~5"
