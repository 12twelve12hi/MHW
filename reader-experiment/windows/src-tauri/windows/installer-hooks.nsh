; Send to Daylight: extra installer steps (tauri.conf.json > bundle > windows > nsis > installerHooks).
; The installer is per user (no admin), so $APPDATA is this user's roaming AppData folder.

!macro NSIS_HOOK_POSTINSTALL
  ; File Explorer: right-click files > Send to > Daylight starts the app with them as arguments.
  CreateDirectory "$APPDATA\Microsoft\Windows\SendTo"
  CreateShortcut "$APPDATA\Microsoft\Windows\SendTo\Daylight.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWNORMAL "" "Send to your Daylight"

  ; Start at login survives an update. Installing over an older build offers "Uninstall before installing" (the
  ; default), which runs the old uninstaller, and that deletes this user's Run entry. The app keeps the user's choice
  ; in its data folder (main.rs: AUTOSTART_MARKER), which the uninstaller leaves unless asked to delete the data, so
  ; put the entry back, as the app writes it. A "Disabled" set in Task Manager is kept apart and still holds.
  ${If} ${FileExists} "$APPDATA\${BUNDLEID}\start-at-login"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Not on updates (the installer of the new version runs the old uninstaller with /UPDATE).
  ${If} $UpdateMode <> 1
    Delete "$APPDATA\Microsoft\Windows\SendTo\Daylight.lnk"
  ${EndIf}
!macroend
