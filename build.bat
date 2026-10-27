@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

echo === FreeFlow - universal build (NVIDIA + AMD) ===

if not exist "node_modules" (
  call "C:\Program Files\nodejs\npm.cmd" install
  if errorlevel 1 goto :fail
)

REM === NVIDIA engine (Python 3.13) =========================================
echo.
echo [1/2] Building NVIDIA engine...
py -3.13 -m pip install faster-whisper pyinstaller nvidia-cublas-cu12 "nvidia-cudnn-cu12<10" >nul 2>&1
call "C:\Program Files\nodejs\npm.cmd" run build:native
if errorlevel 1 goto :fail
if exist "stt\dist\freeflow-stt" rmdir /s /q "stt\dist\freeflow-stt"
py -3.13 stt\build_stt.py --cuda
if errorlevel 1 goto :fail
if exist "stt\dist\freeflow-stt-cuda" rmdir /s /q "stt\dist\freeflow-stt-cuda"
move "stt\dist\freeflow-stt" "stt\dist\freeflow-stt-cuda" >nul
if errorlevel 1 goto :fail

REM === AMD engine (Python 3.12, has ROCm SDK) ==============================
echo.
echo [2/2] Building AMD engine...
if exist "stt\dist\freeflow-stt" rmdir /s /q "stt\dist\freeflow-stt"
py -3.12 stt\build_stt.py --rocm
if errorlevel 1 goto :fail
if exist "stt\dist\freeflow-stt-rocm" rmdir /s /q "stt\dist\freeflow-stt-rocm"
move "stt\dist\freeflow-stt" "stt\dist\freeflow-stt-rocm" >nul
if errorlevel 1 goto :fail

REM === Package with both engines ===========================================
echo.
echo Packaging with both engines...
if exist "release" rmdir /s /q "release"
call "C:\Program Files\nodejs\node.exe" scripts\package-universal.js
if errorlevel 1 goto :fail

REM === Installer ============================================================
echo.
echo Creating installer...
call "C:\Program Files\nodejs\npm.cmd" run installer
if errorlevel 1 (
  echo.
  echo Installer failed. Creating portable ZIP instead...
  powershell -NoProfile -Command "Compress-Archive -Path 'release\FreeFlow-win32-x64' -DestinationPath 'release\FreeFlow-Portable.zip' -Force"
)

echo.
echo === UNIVERSAL BUILD DONE ===
echo App: release\FreeFlow-win32-x64
goto :end

:fail
echo.
echo === BUILD FAILED ===
exit /b 1

:end
endlocal