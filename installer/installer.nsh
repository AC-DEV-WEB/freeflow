; FreeFlow - custom NSIS hooks for electron-builder.

!ifndef BUILD_UNINSTALLER
; Windows limits paths to 260 characters and the deepest file of the app sits about
; 110 characters below the install folder: a longer folder would silently lose files.
; The "Suivant" button stays disabled until a shorter folder is chosen.
Function .onVerifyInstDir
  StrLen $0 $INSTDIR
  IntCmp $0 140 instdir_ok instdir_ok
  Abort
  instdir_ok:
FunctionEnd
!endif

; Close only the FreeFlow processes started from this install folder (never
; another copy of the app running elsewhere), engine included, before files
; are replaced or removed.
!macro customCheckAppRunning
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name FreeFlow,freeflow-stt -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
  Sleep 800
!macroend

!macro customUnInstall
  ; "Lancer au démarrage de Windows" entry written by Electron (value = AppUserModelId).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.alan.freeflow"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.alan.freeflow"
  ; The downloaded speech model is a cache (0,5 to 3 GB): removed on a real uninstall,
  ; kept on an update. Settings, history and dictionary (%APPDATA%\FreeFlow) are kept.
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\FreeFlow\models"
    RMDir "$LOCALAPPDATA\FreeFlow"
  ${endIf}
!macroend
