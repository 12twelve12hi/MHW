; Send to Daylight: extra installer steps (tauri.conf.json > bundle > windows > nsis > installerHooks).
; The installer is per user (no admin), so $APPDATA is this user's roaming AppData folder.

!macro NSIS_HOOK_POSTINSTALL
  ; File Explorer: right-click files > Send to > Daylight starts the app with them as arguments.
  CreateDirectory "$APPDATA\Microsoft\Windows\SendTo"
  CreateShortcut "$APPDATA\Microsoft\Windows\SendTo\Daylight.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWNORMAL "" "Send to your Daylight"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Not on updates (the installer of the new version runs the old uninstaller with /UPDATE).
  ${If} $UpdateMode <> 1
    Delete "$APPDATA\Microsoft\Windows\SendTo\Daylight.lnk"
  ${EndIf}
!macroend
