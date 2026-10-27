; FreeFlow - custom NSIS hooks for electron-builder (UTF-8 with BOM: NSIS reads the accents).
; Look: installer/sidebar.bmp on the welcome and finish pages, installer/header.bmp on
; the others (package.json > build.nsis.installerSidebar / installerHeader).

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

; Welcome page (electron-builder has none by default), and the texts of the finish
; page, defined here because this macro comes before the pages are inserted.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenue dans FreeFlow"
  !define MUI_WELCOMEPAGE_TEXT "FreeFlow écrit ce que tu dis, dans n’importe quelle application : un raccourci, tu parles, le texte apparaît là où se trouve ton curseur.$\r$\n$\r$\nTout se passe sur ton ordinateur : ta voix n’est jamais envoyée sur Internet. Gratuit, sans compte, sans abonnement.$\r$\n$\r$\nClique sur Suivant pour choisir où l’installer."
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_FINISHPAGE_TITLE "FreeFlow est prêt"
  !define MUI_FINISHPAGE_TEXT "Appuie sur Ctrl + Alt + Espace, parle, appuie à nouveau : le texte s’écrit tout seul.$\r$\n$\r$\nUne petite barre t’attend en bas de l’écran, et un court tutoriel s’ouvre au premier lancement (tu peux le passer).$\r$\n$\r$\nAu premier démarrage, FreeFlow télécharge son modèle de reconnaissance vocale, une seule fois."
  !define MUI_FINISHPAGE_RUN_TEXT "Lancer FreeFlow"
!macroend

!macro customHeader
  BrandingText "FreeFlow · dictée vocale 100 % locale"
!macroend

; Close only the FreeFlow processes started from this install folder (never
; another copy of the app running elsewhere), engine included, before files
; are replaced or removed.
!macro customCheckAppRunning
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name FreeFlow,freeflow-stt -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
  Sleep 800
!macroend

!macro customUnInstall
  ; "Lancer au démarrage de l’ordinateur" entry written by Electron (value = AppUserModelId).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.alan.freeflow"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.alan.freeflow"
  ; The downloaded speech model is a cache (0,5 to 3 GB): removed on a real uninstall,
  ; kept on an update. Settings, history, notes, meetings and dictionary (%APPDATA%\FreeFlow) are kept.
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\FreeFlow\models"
    RMDir "$LOCALAPPDATA\FreeFlow"
  ${endIf}
!macroend
