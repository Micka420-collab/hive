; L'INSTALLEUR WINDOWS DE HIVE — ce qu'electron-builder ne fait pas seul.
;
; electron-builder compile ce fichier DEUX fois : pour l'installeur, puis pour
; le désinstalleur (`BUILD_UNINSTALLER`). Une variable, une fonction ou un
; texte déclaré dans la mauvaise moitié y serait « non référencé » — un
; avertissement que `warningsAsErrors` change en échec. Chaque moitié ne
; déclare donc que ce qu'elle emploie.
;
; Les textes sont en français (1036) et en anglais (1033), par identifiant
; numérique : les `LangString` de ce fichier sont lues AVANT que les langues ne
; soient chargées (`addLangs` vient après les pages).
;
; Ce qu'il ajoute (ADR 0013 § 11, § 15) :
;   · une page d'ACCUEIL (la barre latérale à la marque s'y montre) ;
;   · une page d'OPTIONS après le dossier : lancer Hive à l'ouverture de
;     session (DÉCOCHÉE, comme le service — ADR 0004) et le raccourci du
;     bureau (cochée) ;
;   · une page du désinstalleur, AVANT la désinstallation, avec la case
;     DÉCOCHÉE « Supprimer aussi mes données ». Ignorée pendant une mise à
;     jour (`${isUpdated}` : l'ancien désinstalleur tourne à chaque mise à
;     jour) et en désinstallation silencieuse (`/S` garde tout).
;
; L'entrée de session est la MÊME que celle de l'app (`setLoginItemSettings`,
; `autostart.ts`) : `HKCU\…\Run`, valeur « Hive », `"<Hive.exe>" --session`.
; La case de la barre système la relit donc telle quelle.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!define HIVE_CLE_SESSION "Software\Microsoft\Windows\CurrentVersion\Run"

!ifndef BUILD_UNINSTALLER

  LangString hiveBienvenueTitre 1036 "Bienvenue dans Hive"
  LangString hiveBienvenueTitre 1033 "Welcome to Hive"
  LangString hiveBienvenueTexte 1036 "Hive fait travailler vos agents de code — Claude Code, Codex, Cursor — sur votre machine, et vous montre tout dans une seule fenêtre.$\r$\n$\r$\nL'installation est pour vous seul : aucun droit administrateur, aucun service installé.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
  LangString hiveBienvenueTexte 1033 "Hive puts your coding agents — Claude Code, Codex, Cursor — to work on your machine, and shows everything in one window.$\r$\n$\r$\nIt installs for you only: no administrator rights, no system service.$\r$\n$\r$\nClick Next to continue."
  LangString hiveOptionsTitre 1036 "Options"
  LangString hiveOptionsTitre 1033 "Options"
  LangString hiveOptionsSous 1036 "Comment Hive s'intègre à votre session."
  LangString hiveOptionsSous 1033 "How Hive fits into your session."
  LangString hiveOptSession 1036 "Lancer Hive à l'ouverture de session"
  LangString hiveOptSession 1033 "Start Hive when I sign in"
  LangString hiveOptRaccourci 1036 "Créer un raccourci sur le bureau"
  LangString hiveOptRaccourci 1033 "Create a desktop shortcut"
  LangString hiveOptNote 1036 "Les deux se changent ensuite depuis l'icône de Hive dans la barre des tâches. Vos données (base, clés, journaux) vivent dans %APPDATA%\Hive et restent en place si vous désinstallez."
  LangString hiveOptNote 1033 "Both can be changed later from Hive's taskbar icon. Your data (database, keys, logs) lives in %APPDATA%\Hive and stays in place if you uninstall."

  Var hiveSession
  Var hiveRaccourci
  Var hiveCaseSession
  Var hiveCaseRaccourci

  !macro customInit
    ; Les défauts valent aussi pour une installation silencieuse (`/S`).
    StrCpy $hiveSession "0"
    StrCpy $hiveRaccourci "1"
  !macroend

  !macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "$(hiveBienvenueTitre)"
    !define MUI_WELCOMEPAGE_TEXT "$(hiveBienvenueTexte)"
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  ; Les fonctions des pages vivent DANS la macro qui pose la page : insérées
  ; là, elles sont compilées après le chargement des greffons NSIS, dont
  ; `${isUpdated}` a besoin (StdUtils). Définies au niveau de ce fichier, elles
  ; le précéderaient — mesuré : « Plugin not found, cannot call
  ; StdUtils::TestParameter ».
  !macro customPageAfterChangeDir
    Page custom hivePageOptions hivePageOptionsQuitter

  Function hivePageOptions
    ; Une mise à jour garde les choix d'avant : la page ne se montre pas.
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "$(hiveOptionsTitre)" "$(hiveOptionsSous)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 12u "$(hiveOptSession)"
    Pop $hiveCaseSession
    ${if} $hiveSession == "1"
      ${NSD_Check} $hiveCaseSession
    ${endif}
    ${NSD_CreateCheckbox} 0 18u 100% 12u "$(hiveOptRaccourci)"
    Pop $hiveCaseRaccourci
    ${if} $hiveRaccourci == "1"
      ${NSD_Check} $hiveCaseRaccourci
    ${endif}
    ${NSD_CreateLabel} 0 44u 100% 48u "$(hiveOptNote)"
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function hivePageOptionsQuitter
    ${NSD_GetState} $hiveCaseSession $hiveSession
    ${NSD_GetState} $hiveCaseRaccourci $hiveRaccourci
  FunctionEnd
  !macroend

  !macro customInstall
    ${ifNot} ${isUpdated}
      ${if} $hiveRaccourci == "1"
        CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0
        WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
      ${endif}
      ${if} $hiveSession == "1"
        WriteRegStr HKCU "${HIVE_CLE_SESSION}" "Hive" '"$appExe" --session'
      ${endif}
    ${endif}
  !macroend

!else

  LangString hiveDonneesTitre 1036 "Vos données Hive"
  LangString hiveDonneesTitre 1033 "Your Hive data"
  LangString hiveDonneesSous 1036 "Elles restent sur ce poste, sauf si vous le demandez."
  LangString hiveDonneesSous 1033 "They stay on this computer unless you ask otherwise."
  LangString hiveDonneesNote 1036 "Votre ruche — la base, les clés, la mémoire et les journaux — vit dans %APPDATA%\Hive. Par défaut elle RESTE : réinstaller Hive la retrouve telle quelle."
  LangString hiveDonneesNote 1033 "Your hive — database, keys, memory and logs — lives in %APPDATA%\Hive. By default it STAYS: reinstalling Hive finds it as it was."
  LangString hiveDonneesCase 1036 "Supprimer aussi mes données Hive (base, clés, journaux)"
  LangString hiveDonneesCase 1033 "Also delete my Hive data (database, keys, logs)"

  Var hiveSupprimerDonnees
  Var hiveCaseDonnees

  !macro customUnInit
    StrCpy $hiveSupprimerDonnees "0"
  !macroend

  ; La page de la case vient AVANT la désinstallation : `customUninstallPage`
  ; est insérée APRÈS elle par electron-builder, quand il est trop tard pour
  ; demander. On garde l'accueil d'origine et on la pose juste derrière.
  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.hivePageDonnees un.hivePageDonneesQuitter

  Function un.hivePageDonnees
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "$(hiveDonneesTitre)" "$(hiveDonneesSous)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "$(hiveDonneesNote)"
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "$(hiveDonneesCase)"
    Pop $hiveCaseDonnees
    nsDialogs::Show
  FunctionEnd

  Function un.hivePageDonneesQuitter
    ${NSD_GetState} $hiveCaseDonnees $hiveSupprimerDonnees
  FunctionEnd
  !macroend

  !macro customUnInstall
    ${ifNot} ${isUpdated}
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
      DeleteRegValue HKCU "${HIVE_CLE_SESSION}" "Hive"
      ${if} $hiveSupprimerDonnees == "1"
        SetShellVarContext current
        RMDir /r "$APPDATA\${APP_FILENAME}"
      ${endif}
    ${endif}
  !macroend

!endif
