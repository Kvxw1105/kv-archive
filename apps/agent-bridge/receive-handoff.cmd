@echo off
if "%~2"=="" (echo Usage: receive-handoff.cmd Receiver-Handoff.zip OUTPUT_DIRECTORY [RECEIVER_NAME] & exit /b 2)
set "RECEIVER=%~3"
if "%RECEIVER%"=="" set "RECEIVER=receiving-agent"
node "%~dp0dist\agent\index.js" handoff-receive --handoff "%~1" --output "%~2" --receiver "%RECEIVER%"
