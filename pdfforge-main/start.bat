@echo off
echo ============================================
echo   PDFForge v5 - Complete PDF Toolbox
echo ============================================
echo.
cd /d %~dp0

echo [1/4] Setting up backend...
cd backend
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo [2/4] Installing packages...
pip install fastapi uvicorn python-multipart pymupdf aiofiles Pillow python-docx -q

echo [3/4] Starting backend...
start "PDFForge Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && uvicorn main:app --reload --port 8000"

echo [4/4] Starting frontend...
cd /d %~dp0frontend
call npm install --silent
start "PDFForge Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo ============================================
echo   PDFForge running at http://localhost:5173
echo   Keep both black windows open!
echo ============================================
pause
