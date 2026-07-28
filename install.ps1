# Hive — installation en une commande (Windows).
#
#   irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 | iex
#
# ─── CE QUE CE SCRIPT FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────
#
# IL FAIT : vérifier Node, récupérer Hive, installer ses dépendances, lancer
# l'installeur (celui qui écrit le `.env` et engendre le jeton).
#
# IL NE FAIT PAS :
#   · aucune élévation de privilèges. Rien hors du dossier d'installation.
#   · il n'installe PAS Node à votre place — on donne la commande winget exacte
#     et on s'arrête. Un script qui installe des choses en aveugle sur une
#     machine qu'il ne connaît pas ne mérite pas qu'on le tuyaute dans `iex`.
#   · il n'ouvre aucun port, ne crée aucun service.
#
# ─── CE QUE WINDOWS A APPRIS À CE PROJET, ET QUI SE VOIT ICI ─────────────────
#
# La CI Windows a rendu cinq défauts réels en s'ouvrant (voir `docs/ERREURS.md`).
# Deux d'entre eux dictent des choix de ce script :
#
#   · Node 24 EST UN PRÉREQUIS DUR, pas une préférence. Sous Node 20,
#     `better-sqlite3` n'a pas de binaire prébuilt : il faut le COMPILER, ce
#     qui exige Visual Studio Build Tools — et échoue en silence sans, parce
#     que la dépendance est optionnelle. On vérifie donc la version AVANT de
#     lancer quoi que ce soit, plutôt que de laisser `npm install` « réussir »
#     et `hive start` mourir sur ERR_MODULE_NOT_FOUND.
#
#   · on n'appelle jamais `npm` par un simple `npm` dans du code : sous Windows
#     c'est `npm.cmd`, et tout ne sait pas le lancer. PowerShell, lui, le
#     résout correctement — c'est pour ça que ce script peut l'écrire ainsi
#     alors que le code Node du projet, non.
#
# ─── CE FICHIER COMMENCE PAR UN BOM UTF-8, ET CE N'EST PAS UN ACCIDENT ───────
#
# Windows PowerShell 5.1 — celui que TOUT LE MONDE a, `powershell.exe`, celui
# que `#Requires -Version 5.1` juste en dessous prétend servir — lit un fichier
# SANS BOM avec la page de codes ANSI, pas en UTF-8. « détecté » y devient
# « dÃ©tectÃ© », « — » devient « â€” », et l'abeille disparaît. PowerShell 7,
# lui, suppose UTF-8 : c'est pour ça que la CI passait au vert sans que rien
# ne se voie.
#
# Le BOM est ce qui met les deux d'accord. Un pas de CI le vérifie sous
# `powershell` (5.1) ET sous `pwsh` (7), et `tests/installeurs.test.ts` exige
# ses trois octets — un BOM est invisible, et le premier éditeur venu l'ôte
# sans le dire.
#
# Codes de sortie — les MÊMES que `src/codes-sortie.ts` :
#   0 succès · 1 erreur · 2 prérequis manquant · 3 réponse manquante
#   4 port occupé · 5 refus de sécurité · 130 interrompu

#Requires -Version 5.1
[CmdletBinding()]
param(
  # Où installer. Défaut : %USERPROFILE%\hive
  [string]$Dir = $(if ($env:HIVE_DIR) { $env:HIVE_DIR } else { Join-Path $HOME 'hive' }),
  # Branche ou tag à récupérer.
  [string]$Ref = $(if ($env:HIVE_REF) { $env:HIVE_REF } else { 'main' }),
  # Montre ce qui serait fait, n'écrit rien.
  [switch]$DryRun,
  # Tout le reste part à l'installeur de Hive (--non-interactive, --json…).
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Reste
)

$ErrorActionPreference = 'Stop'

$NODE_MIN = 24
$DEPOT = 'https://github.com/Micka420-collab/hive.git'
$CODE_ERREUR = 1
$CODE_PREREQUIS = 2

# ─── Affichage : lisible même sans couleur ──────────────────────────────────
#
# `NO_COLOR` respecté (https://no-color.org). `Write-Host` plutôt que
# `Write-Output` : ces lignes sont de l'INFORMATION pour un humain, pas la
# valeur de retour du script — les mélanger casserait tout usage en pipeline.
$Couleur = -not $env:NO_COLOR
function Dire($m) { Write-Host $m }
function Etape($m) { if ($Couleur) { Write-Host "▸ $m" -ForegroundColor White } else { Write-Host "> $m" } }
function Ok($m) { if ($Couleur) { Write-Host "  ✔ $m" -ForegroundColor Green } else { Write-Host "  [ok] $m" } }
function Alerte($m) { if ($Couleur) { Write-Host "  ▲ $m" -ForegroundColor Yellow } else { Write-Host "  [!] $m" } }
function Echec($m) { if ($Couleur) { Write-Host "  ✘ $m" -ForegroundColor Red } else { Write-Host "  [X] $m" } }

Dire ''
Dire '🐝 Hive — installation'
Dire ''

# ─── 1. Les prérequis, et la commande exacte s'ils manquent ─────────────────

Etape 'Vérification des prérequis'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Echec 'git est introuvable.'
  Dire ''
  Dire '  Pour l''installer :'
  Dire '    winget install --id Git.Git -e'
  Dire ''
  exit $CODE_PREREQUIS
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Echec 'Node.js est introuvable.'
  Dire ''
  Dire "  Hive exige Node $NODE_MIN ou plus :"
  Dire "    winget install --id OpenJS.NodeJS -e"
  Dire ''
  exit $CODE_PREREQUIS
}

# On lit la version PAR NODE LUI-MÊME plutôt qu'en découpant `node --version` :
# une chaîne comme « v24.3.1-nightly » casse un découpage naïf, pas ceci.
$majeur = [int](node -p 'process.versions.node.split(".")[0]')
if ($majeur -lt $NODE_MIN) {
  Echec "Node $majeur détecté — Hive exige $NODE_MIN ou plus."
  Dire ''
  Dire '  Ce n''est pas une préférence pour le neuf. Sous cette version,'
  Dire '  better-sqlite3 n''a pas de binaire prébuilt : il faut le COMPILER,'
  Dire '  donc installer Visual Studio Build Tools — et la compilation échoue'
  Dire '  EN SILENCE sans eux, parce que la dépendance est optionnelle.'
  Dire ''
  Dire "  À partir de Node $NODE_MIN, le binaire prébuilt existe : rien à compiler."
  Dire ''
  Dire '    winget install --id OpenJS.NodeJS -e'
  Dire ''
  exit $CODE_PREREQUIS
}
Ok "Node $majeur (≥ $NODE_MIN exigé)"

# ─── 2. Récupérer Hive — sans jamais écraser un travail en cours ────────────

Etape "Récupération de Hive dans $Dir"
if ($DryRun) { Alerte '--dry-run : rien ne sera écrit.' }

if (Test-Path (Join-Path $Dir '.git')) {
  Ok 'déjà présent — mise à jour'
  if (-not $DryRun) {
    Push-Location $Dir
    try {
      git fetch --depth 1 origin $Ref -q
      # `git checkout` REFUSE si des fichiers suivis ont été modifiés
      # localement. Quelqu'un qui a bidouillé son installation le découvre
      # ici, pas après coup. On ne force rien.
      git checkout -q FETCH_HEAD
      if ($LASTEXITCODE -ne 0) { throw 'checkout refusé' }
    } catch {
      Echec 'mise à jour impossible — modifications locales dans le dossier ?'
      Dire '  Réglez-les, ou installez ailleurs : -Dir C:\autre\chemin'
      Pop-Location
      exit $CODE_ERREUR
    }
    Pop-Location
  }
} elseif (Test-Path $Dir) {
  Echec "$Dir existe et n'est pas une installation Hive."
  Dire '  Choisissez un autre emplacement : -Dir C:\autre\chemin'
  exit $CODE_ERREUR
} else {
  if ($DryRun) {
    Ok "serait cloné depuis $DEPOT ($Ref)"
  } else {
    git clone --depth 1 --branch $Ref -q $DEPOT $Dir
    if ($LASTEXITCODE -ne 0) { Echec 'clone impossible.'; exit $CODE_ERREUR }
    Ok 'cloné'
  }
}

# ─── 3. Dépendances ─────────────────────────────────────────────────────────

Etape 'Installation des dépendances'
if ($DryRun) {
  Alerte '--dry-run : npm install non lancé'
} else {
  Push-Location $Dir
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Echec 'npm install a échoué.'; Pop-Location; exit $CODE_ERREUR }
  Pop-Location
  Ok 'dépendances installées'
}

# ─── 4. La main à l'installeur de Hive ──────────────────────────────────────
#
# C'est LUI qui pose les questions (≤ 3), engendre le jeton, écrit le `.env` et
# détecte l'agent. Le dupliquer ici ferait deux installeurs à maintenir, dont
# un jamais testé.

Etape 'Configuration'
Dire ''
if ($DryRun) {
  Alerte "--dry-run : l'installeur n'est pas lancé."
  Dire ''
  Dire '  Sans -DryRun, la suite serait :'
  # Le `--` ne s'affiche QUE s'il sépare quelque chose : sans arguments, cette
  # ligne rendait « npm run install:hive -- » avec un séparateur pendu dans le
  # vide. C'est le défaut symétrique de celui d'`install.sh`, qui lui OUBLIAIT
  # le `--`. Les deux sont sortis du même endroit : une ligne écrite pour
  # ressembler à la commande réelle au lieu d'être dérivée d'elle.
  if ($Reste) {
    Dire "    cd $Dir; npm run install:hive -- $($Reste -join ' ')"
  } else {
    Dire "    cd $Dir; npm run install:hive"
  }
  Dire ''
  exit 0
}

Push-Location $Dir
if ($Reste) { npm run install:hive -- @Reste } else { npm run install:hive }
$code = $LASTEXITCODE
Pop-Location
exit $code
