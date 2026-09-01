@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js / npm，請先安裝 Node.js 22 以上版本。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 第一次啟動，正在安裝必要套件...
  set "NODE_OPTIONS=--use-system-ca"
  call npm install
  if errorlevel 1 (
    echo [錯誤] 套件安裝失敗。
    pause
    exit /b 1
  )
)

set "NODE_OPTIONS=--use-system-ca"
echo 網站啟動中，瀏覽器將開啟 http://localhost:3000/
echo 第一次整理官方資料約需 5 到 20 秒；關閉此視窗即可停止網站。

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:3000/'"
call npm run dev

echo.
echo 網站已停止。
pause
