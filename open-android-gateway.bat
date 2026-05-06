@echo off
setlocal
cd /d "%~dp0"

set "PROJECT_DIR=%~dp0android-gateway"
if not exist "%PROJECT_DIR%\settings.gradle.kts" (
  echo Android gateway project not found at:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

set "STUDIO_EXE="
if exist "C:\Program Files\Android\Android Studio\bin\studio64.exe" set "STUDIO_EXE=C:\Program Files\Android\Android Studio\bin\studio64.exe"
if exist "C:\Program Files\Android\Android Studio\bin\studio.exe" set "STUDIO_EXE=C:\Program Files\Android\Android Studio\bin\studio.exe"

if "%STUDIO_EXE%"=="" (
  echo Could not find Android Studio executable automatically.
  echo Try opening Android Studio manually and open folder:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

echo Opening Android Studio on:
echo %PROJECT_DIR%
start "" "%STUDIO_EXE%" "%PROJECT_DIR%"
exit /b 0
