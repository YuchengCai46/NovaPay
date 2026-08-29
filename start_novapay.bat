@echo off
chcp 65001 >nul
cd /d "C:\Users\Administrator\WorkBuddy\NovaPay"

REM 关闭占用 5000 端口的旧进程（避免端口冲突）
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 >nul

REM 在独立窗口启动 Flask 服务器
start "NovaPay Server" "C:\Users\Administrator\.workbuddy\binaries\python\envs\novapay\Scripts\python.exe" run.py

REM 等服务器起来后打开浏览器
timeout /t 3 >nul
start "" "http://127.0.0.1:5000"

echo.
echo ============================================
echo  NovaPay V6.0 已启动
echo  请在浏览器访问: http://127.0.0.1:5000
echo  （不要直接双击 frontend/index.html，那样是白底黑字、点不动）
echo  关闭此窗口不会停止服务器；停止请关闭 "NovaPay Server" 窗口
echo ============================================
echo.
pause
