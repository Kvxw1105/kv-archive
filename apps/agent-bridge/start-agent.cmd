@echo off
if "%~1"=="" (echo Usage: start-agent.cmd C:\path\KV-Archive-Agent-Bundle.zip [proposal-directory] & exit /b 2)
set "PROPOSAL_DIR=%~2"
if "%PROPOSAL_DIR%"=="" set "PROPOSAL_DIR=%CD%\kv-archive-proposals"
node "%~dp0dist\agent\index.js" serve --bundle "%~1" --proposal-dir "%PROPOSAL_DIR%"
