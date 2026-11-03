@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 校样下载插件本地测试服务
 echo 演示地址：http://127.0.0.1:8765/?demo=1
 echo 飞书测试地址：http://127.0.0.1:8765/
 echo 保持此窗口运行，按 Ctrl+C 停止。
python -m http.server 8765 --bind 127.0.0.1 --directory dist
pause
