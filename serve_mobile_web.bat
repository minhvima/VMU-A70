@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "WEB_DIR=%SCRIPT_DIR%mobile_web"
set "PY310=%LocalAppData%\Programs\Python\Python310\python.exe"

if not exist "%WEB_DIR%\index.html" (
  echo Khong tim thay thu muc mobile_web.
  pause
  exit /b 1
)

echo Mo tren dien thoai cung Wi-Fi bang mot trong cac dia chi sau:
powershell -NoProfile -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*' } | Select-Object -ExpandProperty IPAddress -Unique; if (-not $ips) { Write-Host 'http://127.0.0.1:8000' } else { $ips | ForEach-Object { Write-Host ('http://' + $_ + ':8000') } }"
echo.
echo Nhan Ctrl+C de dung server.
echo.

cd /d "%WEB_DIR%"

if exist "%PY310%" (
  "%PY310%" -m http.server 8000 --bind 0.0.0.0
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 8000 --bind 0.0.0.0
  goto :eof
)

echo Khong tim thay Python 3 de chay local server.
pause
