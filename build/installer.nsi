; Supported electron-builder custom NSIS installer. Write the uninstaller on
; the user's Windows machine so Linux builds do not need to execute PE files.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Name "${PRODUCT_NAME}"
Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallLocation"
Icon "${BUILD_RESOURCES_DIR}\icon.ico"
UninstallIcon "${BUILD_RESOURCES_DIR}\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_FILENAME}.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "This application requires 64-bit Windows 10 or 11."
  Abort
 ${EndIf}
 FindWindow $0 "" "Multi Browser Manager"
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "Close Multi Browser Manager before installing or upgrading."
  Abort
 ${EndIf}
FunctionEnd
Section "Install"
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r "${PROJECT_DIR}\release\win-unpacked\*"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
 CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
 CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
 WriteRegStr HKCU "Software\${APP_ID}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "${PRODUCT_NAME}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayIcon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoRepair" 1
SectionEnd
Function un.onInit
 FindWindow $0 "" "Multi Browser Manager"
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "Close Multi Browser Manager before uninstalling."
  Abort
 ${EndIf}
FunctionEnd
Section "Uninstall"
 SetShellVarContext current
 ; Delete only files shipped by this build; preserve unknown files and all
 ; profile data in the user's AppData directory.
 !include "${BUILD_RESOURCES_DIR}\uninstall-files.nsh"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
 Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
 RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
 DeleteRegKey HKCU "Software\${APP_ID}"
SectionEnd
