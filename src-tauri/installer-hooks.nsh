; Hodeum NSIS hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).
; Tauri's template already adds the Start menu shortcut, the Desktop shortcut (a ticked box on the
; last page, always in /S and /P installs) and removes both on uninstall.

; "Start Hodeum when I sign in" (tray menu) writes this per-user Run value: AUTOSTART_NAME in src/lib.rs.
!define HODEUM_RUN_VALUE "Hodeum"
!define HODEUM_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define HODEUM_RUN_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update reinstalls to the same path, so keep the setting; a real uninstall must not leave
  ; Windows launching a deleted exe at sign-in.
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${HODEUM_RUN_KEY}" "${HODEUM_RUN_VALUE}"
    DeleteRegValue HKCU "${HODEUM_RUN_APPROVED_KEY}" "${HODEUM_RUN_VALUE}"
  ${EndIf}
!macroend
