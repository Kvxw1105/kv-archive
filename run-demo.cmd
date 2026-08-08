@echo off
setlocal
cd /d "%~dp0"
node dist\apps\cli\src\index.js normalize fixtures\synthetic\multi-branch-conversation.json --output .tmp\output
if errorlevel 1 exit /b %errorlevel%
echo.
echo Output written to %CD%\.tmp\output
pause
