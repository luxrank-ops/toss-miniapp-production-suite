@echo off
chcp 65001 >nul
echo ====================================================================
echo 🚀 [안티그래비티 토스 미니앱 유료화 팩토리] 로컬 서버 및 브라우저 실행기
echo ====================================================================
echo.
echo 1. QA 보안/무결성 검수 및 토스 파트너 콘솔 번들 패키징 실행 중...
node "%~dp0scripts\toss-deploy-agent.js"
echo.
echo 2. 토스 인앱 브라우저 웹뷰 서버를 시작하고 브라우저를 엽니다 (http://localhost:3000)...
start http://localhost:3000
node "%~dp0backend\server.js"
pause
