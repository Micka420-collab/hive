# Hive — installation en une commande (Windows).
#
#   irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 -OutFile "$env:TEMP\hive-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-install.ps1"
#
# ─── POURQUOI PAS `irm … | iex`, QUI ÉTAIT ÉCRIT ICI ─────────────────────────
#
# Parce que ça ne pouvait pas marcher. Sur AUCUNE machine. Signalé par un
# utilisateur, avec la trace exacte :
#
#     iex : Au caractère Ligne:53 : 1
#     + [CmdletBinding()]
#     Attribut inattendu « CmdletBinding ».
#     + param(
#     Jeton inattendu « param » dans l'expression ou l'instruction.
#
# `iex` évalue une EXPRESSION. `param()` et `[CmdletBinding()]` ne sont valides
# qu'au début d'un SCRIPT — ou d'un scriptblock. Un script à paramètres tuyauté
# dans `iex` échoue toujours, dès la ligne du `param`.
#
# Et il y a un second défaut, indépendant, que corriger le premier n'aurait pas
# réglé : ce script appelle `exit` sept fois. Dans un `iex`, `exit` s'évalue au
# niveau de la SESSION — il ferme la fenêtre de l'utilisateur. Les sept codes de
# sortie, qui sont toute l'interface de ce script (critère 9 : un déploiement
# sans écran doit pouvoir les aiguiller), deviendraient inobservables.
#
# Lancé comme un FICHIER, `exit` termine le script et pose `$LASTEXITCODE`. La
# session survit, et le code reste lisible. C'est aussi, exactement, ce que la
# CI exerce depuis toujours — elle testait `-File` pendant que la doc annonçait
# `iex`. Le script était juste ; la phrase qui disait comment l'appeler, non.
#
# `-ExecutionPolicy Bypass` est nécessaire : un `.ps1` sur le disque est soumis à
# la politique d'exécution, qu'un `iex` contournait par construction. `-NoProfile`
# évite qu'un profil utilisateur ne change le décor sous les pieds de
# l'installeur.
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
  # ─── D'OÙ TIRER HIVE ────────────────────────────────────────────────────────
  #
  # `install.sh` honore `HIVE_DEPOT` depuis toujours (l. 75) ; ce script-ci ne
  # le connaissait pas. Un utilisateur qui a forké Hive pouvait donc installer
  # depuis son fork sous Linux et macOS, et pas sous Windows — sans qu'aucun
  # message ne le lui dise : le réglage était simplement ignoré.
  #
  # C'est aussi ce qui bloquait, en amont, l'essai d'installation Windows en
  # CI : sans ce réglage, il n'aurait pas su viser l'arbre qu'on vient
  # d'écrire, et aurait éprouvé du code déjà fusionné en croyant mesurer le
  # nôtre.
  [string]$Depot = $(if ($env:HIVE_DEPOT) { $env:HIVE_DEPOT } else { 'https://github.com/Micka420-collab/hive.git' }),
  # Montre ce qui serait fait, n'écrit rien.
  [switch]$DryRun,
  # Tout le reste part à l'installeur de Hive (--non-interactive, --json…).
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Reste
)

$ErrorActionPreference = 'Stop'

$NODE_MIN = 24
# Le dépôt vient du paramètre (lui-même issu de `HIVE_DEPOT`, ou du défaut
# public). Garder ici une CONSTANTE en plus du paramètre serait la meilleure
# façon de les faire diverger : le clone lirait l'une, l'aide l'autre.
$DEPOT = $Depot
$CODE_ERREUR = 1
$CODE_PREREQUIS = 2

# ═══ LA CHARTE, TENUE ICI AUSSI ══════════════════════════════════════════════
#
# La marque de Hive n'est pas une improvisation : elle est ÉCRITE, dans
# `src/tui/rendu.ts`, et `tests/tui-rendu.test.ts` l'exerce. Ce script en était
# la seule pièce qui ne la respectait pas — il ouvrait sur un « 🐝 Hive » et
# peignait en vert, jaune, rouge et blanc.
#
# Quatre accents, c'est-à-dire aucun. La charte (§6.1) le dit sans détour :
# « deux accents, c'est zéro accent — plus rien ne ressort ». Un seul ton
# ressort donc, l'AMBRE ; le reste est neutre, le secondaire est atténué, et
# c'est le SYMBOLE qui porte le sens — pas la couleur.
#
# `tests/installeurs.test.ts` compare maintenant ces constantes à celles du
# module TypeScript. Deux vérités écrites à deux endroits divergent le jour où
# l'une bouge ; celle-ci ne le pourra pas en silence.
#
# ─── ET LE PRÉALABLE PROPRE À WINDOWS ───────────────────────────────────────
#
# Une console PowerShell 5.1 démarre en page de codes 850 ou 437. Le plus beau
# des cadres y sort en « ????? » — on aurait un dessin invisible et une
# impression de logiciel cassé, ce qui est pire que pas de dessin du tout.
#
# On pose donc l'encodage de SORTIE en UTF-8 avant d'écrire quoi que ce soit,
# et si le système refuse, on retombe sur l'alphabet ASCII de la charte. C'est
# le pendant du BOM en tête de ce fichier : l'un fait que PowerShell LIT bien
# ce qui est écrit, l'autre fait que la console AFFICHE bien ce qu'il écrit.

$Unicode = $true
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # Console redirigée, hôte sans console, système exotique : on ne force rien
  # et on se replie sur un alphabet qui passe partout.
  $Unicode = $false
}

# ─── Ce que cette sortie sait faire ─────────────────────────────────────────
#
# Mêmes seuils que le module pur : 76 colonnes de contenu au plus (au-delà une
# ligne devient pénible à lire), et pas de cadre en dessous de 60 (ils y
# coûteraient plus de place qu'ils n'en donnent).
$LARGEUR_MAX = 76
$LARGEUR_MIN_CADRES = 60

$Largeur = $LARGEUR_MAX
try {
  if (-not [Console]::IsOutputRedirected -and [Console]::WindowWidth -gt 0) {
    $Largeur = [Math]::Min($LARGEUR_MAX, [Console]::WindowWidth - 2)
  }
} catch {
  # Pas de console attachée : on garde la largeur nominale.
}
$Cadres = $Largeur -ge $LARGEUR_MIN_CADRES

# ─── La couleur : trois niveaux, et un seul accent ──────────────────────────
#
# 256 exige que le terminal interprète les séquences ANSI. Sous PowerShell 7
# c'est acquis ; sous 5.1 ça ne l'est que dans Windows Terminal. Ailleurs, on
# passe par `-ForegroundColor`, que TOUS les hôtes Windows honorent — et qui
# ne laisse jamais un `←[38;5;214m` traîner à l'écran quand c'est faux.
#
# `NO_COLOR` (https://no-color.org) et une sortie redirigée coupent tout : un
# journal de CI plein de séquences est plus dur à lire qu'un journal nu.
$Redirigee = $false
try { $Redirigee = [Console]::IsOutputRedirected } catch { $Redirigee = $true }

if ($env:NO_COLOR -or $Redirigee) {
  $NiveauCouleur = 0
} elseif ($PSVersionTable.PSVersion.Major -ge 7 -or $env:WT_SESSION) {
  $NiveauCouleur = 256
} else {
  $NiveauCouleur = 16
}

# ─── LA COULEUR VRAIE NE SE DEVINE PAS ───────────────────────────────────────
#
# `COLORTERM` est la SEULE annonce fiable des 24 bits. Le module pur lit
# exactement la même variable, et les deux doivent conclure pareil : sinon le
# même terminal verrait deux marques différentes selon le fichier qui l'affiche.
$VraieCouleur = ($NiveauCouleur -ne 0) -and ($env:COLORTERM -in @('truecolor', '24bit'))

$AMBRE_256 = "$([char]27)[38;5;214m"
$ATTENUE = "$([char]27)[2m"
$REPRISE = "$([char]27)[0m"

# L'alphabet. Chaque repli ASCII fait EXACTEMENT une colonne, sans quoi les
# lignes cesseraient d'être alignées entre elles au premier repli.
if ($Unicode) {
  $SYM = @{ fait = '✔'; curseur = '▸'; avenir = '◦'; alerte = '⚠'; echec = '✘' }
  $BORD = @{ hg = '╭'; hd = '╮'; bg = '╰'; bd = '╯'; h = '─'; v = '│' }
  $HEXAGONE = '⬡'
  $TIRET = '—'
} else {
  $SYM = @{ fait = '+'; curseur = '>'; avenir = '.'; alerte = '!'; echec = 'x' }
  $BORD = @{ hg = '+'; hd = '+'; bg = '+'; bd = '+'; h = '-'; v = '|' }
  $HEXAGONE = '<>'
  $TIRET = '-'
}

<#
.SYNOPSIS
  Écrit une ligne dans l'un des trois tons de la charte.
.DESCRIPTION
  `accent` est l'ambre, et il n'y en a qu'un. `discret` est atténué.
  `neutre` n'est pas teinté du tout — c'est le cas le plus fréquent, et c'est
  voulu : ce qui ressort ne ressort que parce que le reste ne ressort pas.
#>
function Ecrire {
  param([string]$Texte = '', [ValidateSet('accent', 'discret', 'neutre')][string]$Ton = 'neutre')
  if ($NiveauCouleur -eq 0 -or $Ton -eq 'neutre' -or $Texte -eq '') {
    Write-Host $Texte
  } elseif ($NiveauCouleur -eq 256) {
    $debut = if ($Ton -eq 'accent') { $AMBRE_256 } else { $ATTENUE }
    Write-Host "$debut$Texte$REPRISE"
  } else {
    # 16 couleurs : `DarkYellow` est l'ambre de la palette console, `DarkGray`
    # tient lieu d'atténué. Aucune séquence ANSI n'est émise ici.
    $couleur = if ($Ton -eq 'accent') { 'DarkYellow' } else { 'DarkGray' }
    Write-Host $Texte -ForegroundColor $couleur
  }
}

function Dire($m) { Ecrire $m }

<# Un cadre autour de lignes déjà composées. Rien n'en dépasse. #>
function Cadre {
  param([string[]]$Lignes, [ValidateSet('accent', 'discret', 'neutre')][string]$Ton = 'neutre')
  if (-not $Cadres) {
    foreach ($l in $Lignes) { Ecrire $l $Ton }
    return
  }
  $interieur = $Largeur - 4
  $barre = $BORD.h * ($interieur + 2)
  Ecrire "$($BORD.hg)$barre$($BORD.hd)" 'discret'
  foreach ($l in $Lignes) {
    # On tronque AVANT de compléter : un chemin d'installation très long ne
    # doit pas pouvoir crever le cadre.
    $t = if ($l.Length -gt $interieur) { $l.Substring(0, $interieur - 1) + $TIRET } else { $l }
    Ecrire "$($BORD.v) $($t.PadRight($interieur)) $($BORD.v)" $Ton
  }
  Ecrire "$($BORD.bg)$barre$($BORD.bd)" 'discret'
}

# ─── L'alphabet de la charte, en fonctions ──────────────────────────────────
#
# Le SYMBOLE porte le sens, la couleur ne fait que hiérarchiser. C'est ce qui
# rend cette sortie lisible sans couleur du tout — en CI, dans un `less`, ou
# pour quelqu'un qui ne distingue pas le rouge du vert.
# ─── LE RAIL ─────────────────────────────────────────────────────────────────
#
# Le même que celui de `src/tui/rendu.ts` et de `install.sh`, et pour la même
# raison : une suite de lignes cochées dit « ça a marché » et ne dit jamais
# « où en suis-je ». Une colonne continue le dit sans un mot.
#
#     ⬡  Vérification des prérequis
#     │  ✔ Node v24.18.0
#     │  ✔ git 2.51
#     │
#     ⬡  Installation des dépendances
#
# La perle PLEINE (`⬢`) n'existe pas ici, comme elle n'existe pas dans
# `install.sh` : un script qui écrit une ligne ne revient jamais dessus — et il
# ne doit pas, sinon sa sortie devient illisible dans un fichier de journal. La
# déclarer serait déclarer une variante inatteignable (§ 6.2 du journal).
$PERLE = if ($Unicode) { '⬡' } else { 'o' }

# Le premier pas n'est précédé d'aucun segment : un rail qui commence par un
# trait pendrait dans le vide.
$script:PremierPas = $true

function Etape($m) {
  if ($script:PremierPas) { $script:PremierPas = $false; Dire '' }
  else { Ecrire "  $($BORD.v)" 'discret' }
  Ecrire "  $PERLE  $m" 'accent'
}

# Les verdicts PENDENT au rail. C'est ce trait, un caractère par ligne, qui
# rattache une vérification à son étape — sans lui, l'écran redevient une liste.
#
# Le trait est écrit dans le MÊME appel que le verdict : `Ecrire` teinte la
# ligne entière, et deux appels donneraient deux lignes. On accepte donc que le
# trait porte le ton du verdict plutôt que le sien — c'est la seule concession,
# et elle ne coûte que sur un caractère.
function Ok($m) { Ecrire "  $($BORD.v)  $($SYM.fait) $m" }
function Attente($m) { Ecrire "  $($BORD.v)  $($SYM.avenir) $m" 'discret' }
function Alerte($m) { Ecrire "  $($BORD.v)  $($SYM.alerte) $m" 'discret' }
# L'échec ne porte pas le rail : il part souvent seul, après un arrêt, et un
# demi-rail orphelin ne voudrait plus rien dire.
function Echec($m) { Ecrire "  $($SYM.echec) $m" }

<#
.SYNOPSIS
  La marque. Quatre lignes au plus, affichées UNE SEULE FOIS, en haut.
.DESCRIPTION
  Même composition que `banniere()` dans `src/tui/rendu.ts` : l'hexagone, le
  nom espacé, le sous-titre, et un marqueur aligné à droite. Ici le marqueur
  dit « installation » plutôt qu'un numéro de version : à cet instant, le dépôt
  n'est pas encore là pour en donner un, et inventer une version serait mentir
  sur la seule ligne que tout le monde lit.
#>
function Banniere {
  $titre = "$HEXAGONE  H I V E"
  $sous = "Orchestration communautaire d'agents IA"
  $marque = 'installation'

  Dire ''
  if (-not $Cadres) {
    Ecrire "$titre  $TIRET  $sous" 'accent'
    Dire ''
    return
  }
  # Le sous-titre et le marqueur partagent une ligne : on ne peut pas les
  # teinter séparément sans casser le cadre en 16 couleurs. Le sous-titre reste
  # donc neutre et le marqueur avec lui — la charte ne réclame l'accent que sur
  # le titre.
  $interieur = $Largeur - 4
  $espace = [Math]::Max(2, $interieur - $sous.Length - $marque.Length)
  $barre = $BORD.h * ($interieur + 2)
  Ecrire "$($BORD.hg)$barre$($BORD.hd)" 'discret'
  # ─── LA MARQUE EN BLOCS, AUX MÊMES CONDITIONS QUE LE MODULE PUR ────────────
  #
  # `src/tui/rendu.ts` dessine « HIVE » en demi-blocs quand le terminal a
  # l'Unicode, les cadres ET la couleur vraie. Les deux installeurs montraient,
  # eux, un titre d'une ligne — sur le même terminal, la même machine, la même
  # installation. Deux marques pour un produit, c'est zéro marque.
  #
  # `tests/installeurs.test.ts` confronte ces trois lignes à `BLOCS_HIVE`.
  if ($Unicode -and $VraieCouleur -and $interieur -ge 23) {
    # Le dégradé est posé PAR LIGNE : trois octets d'échappement au lieu de
    # soixante-six, et sur trois lignes l'œil lit une transition tout aussi bien.
    $blocs = @(
      @('166;92;8',   '█   █  ▀█▀  █   █  █▀▀▀'),
      @('230;154;20', '█████   █   ▀▄ ▄▀  ███ '),
      @('250;205;96', '█   █  ▄█▄   ▀▄▀   █▄▄▄')
    )
    # Centrée, comme `marqueBlocs` : à gauche d'un cadre de 76 colonnes, la
    # marque laisse cinquante colonnes de vide et ne se lit plus comme un logo.
    $gauche = [Math]::Floor(($interieur - 23) / 2)
    foreach ($b in $blocs) {
      $teinte = "$([char]27)[38;2;$($b[0])m"
      $droite = $interieur - 23 - $gauche
      Write-Host "$($BORD.v) $(' ' * $gauche)$teinte$($b[1])$REPRISE$(' ' * $droite) $($BORD.v)"
    }
  } else {
    Ecrire "$($BORD.v) $($titre.PadRight($interieur)) $($BORD.v)" 'accent'
  }
  Ecrire "$($BORD.v) $("$sous$(' ' * $espace)$marque".PadRight($interieur)) $($BORD.v)"
  Ecrire "$($BORD.bg)$barre$($BORD.bd)" 'discret'
  Dire ''
}

Banniere

# ─── 1. Les prérequis, et la commande exacte s'ils manquent ─────────────────

Etape 'Vérification des prérequis'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Echec 'git est introuvable.'
  Dire ''
  Dire '      Pour l''installer :'
  Ecrire '        winget install --id Git.Git -e' 'accent'
  Dire ''
  exit $CODE_PREREQUIS
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Echec 'Node.js est introuvable.'
  Dire ''
  Dire "      Hive exige Node $NODE_MIN ou plus :"
  Ecrire "        winget install --id OpenJS.NodeJS -e" 'accent'
  Dire ''
  exit $CODE_PREREQUIS
}

# On demande sa version À NODE LUI-MÊME plutôt que de découper `node --version` :
# le préfixe « v » et un suffixe comme « -nightly » cassent un découpage naïf.
#
# ─── ET AUCUN GUILLEMET DOUBLE NE PASSE PAR LÀ ───────────────────────────────
#
# La version précédente était `node -p 'process.versions.node.split(".")[0]'`.
# Elle marchait sous PowerShell 7 et MOURAIT sous Windows PowerShell 5.1 : 5.1
# réécrit les arguments d'une commande native avec ses propres règles, et MANGE
# les guillemets doubles qu'ils contiennent. Node recevait donc
# `process.versions.node.split(.)[0]` et rendait « [eval]:1 SyntaxError ».
#
# Comme `$ErrorActionPreference` vaut `Stop`, la sortie d'erreur native devient
# une exception : l'installeur mourait à sa TOUTE PREMIÈRE vérification, sous
# l'interpréteur que la plupart des gens ont. PowerShell 7.3 a corrigé ce
# passage d'arguments ; 5.1 ne le sera jamais.
#
# Le découpage se fait donc côté PowerShell, et l'expression envoyée à Node ne
# contient plus un seul caractère spécial. `tests/installeurs.test.ts` l'exige.
$version = node -p 'process.versions.node'
$majeur = [int](($version -split '\.')[0])
if ($majeur -lt $NODE_MIN) {
  Echec "Node $majeur détecté — Hive exige $NODE_MIN ou plus."
  Dire ''
  Dire '      Ce n''est pas une préférence pour le neuf. Sous cette version,'
  Dire '      better-sqlite3 n''a pas de binaire prébuilt : il faut le COMPILER,'
  Dire '      donc installer Visual Studio Build Tools — et la compilation échoue'
  Dire '      EN SILENCE sans eux, parce que la dépendance est optionnelle.'
  Dire ''
  Dire "      À partir de Node $NODE_MIN, le binaire prébuilt existe : rien à compiler."
  Dire ''
  Ecrire '        winget install --id OpenJS.NodeJS -e' 'accent'
  Dire ''
  exit $CODE_PREREQUIS
}
Ok "Node $majeur (≥ $NODE_MIN exigé)"

# ─── LA POLITIQUE D'EXÉCUTION, QUI MORD APRÈS L'INSTALLATION ─────────────────
#
# Ce script tourne avec `-ExecutionPolicy Bypass` : elle ne le gêne pas. Mais le
# SHELL de l'utilisateur, lui, garde la sienne — et sous Windows `npm` est
# `npm.ps1`. Sur une machine en `Restricted` (le défaut de Windows client),
# la toute première commande qu'on lui dit de taper échoue :
#
#     npm : Impossible de charger le fichier C:\Program Files\nodejs\npm.ps1,
#           car l'exécution de scripts est désactivée sur ce système.
#
# Mesuré chez un utilisateur, juste après une installation PARFAITEMENT réussie.
# C'est le pire moment pour buter : tout a marché, l'écran final donne cinq
# commandes, et aucune ne fonctionne. On avertit donc AVANT, tant qu'on a encore
# son attention — et on n'y touche pas à sa place, changer la politique
# d'exécution d'une machine n'est pas à nous.
$politique = Get-ExecutionPolicy
if ($politique -in @('Restricted', 'AllSigned')) {
  Alerte "Politique d'exécution « $politique » — npm sera inutilisable dans PowerShell"
  Dire ''
  Dire '      Sous Windows, « npm » est un script PowerShell (npm.ps1). Cette'
  Dire '      politique le bloque : les commandes affichées à la fin de cette'
  Dire '      installation échoueront, alors que l''installation, elle, aura'
  Dire '      réussi.'
  Dire ''
  Dire '      Le réglage habituel d''un poste de développement, à votre seul'
  Dire '      compte — il ne touche pas la machine :'
  Dire ''
  Ecrire '        Set-ExecutionPolicy -Scope CurrentUser RemoteSigned' 'accent'
  Dire ''
  Dire '      Ou, sans rien changer durablement : « npm.cmd » à la place de'
  Dire '      « npm ». Un .cmd n''est pas soumis à cette politique.'
  Dire ''
}

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
      Dire '      Réglez-les, ou installez ailleurs : -Dir C:\autre\chemin'
      Pop-Location
      exit $CODE_ERREUR
    }
    Pop-Location
  }
} elseif (Test-Path $Dir) {
  Echec "$Dir existe et n'est pas une installation Hive."
  Dire '      Choisissez un autre emplacement : -Dir C:\autre\chemin'
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

  # ─── « INSTALLÉES » NE VEUT PAS DIRE « CHARGEABLES » ───────────────────────
  #
  # C'est la leçon de l'image qui naissait morte (§ 1.5 du journal), et elle a
  # mordu ici alors qu'elle était déjà appliquée dans
  # `examples/deploiement-sans-ecran.sh` : le remède existait, à un endroit que
  # personne ne traverse en installant.
  #
  # Mesuré sur la machine d'un utilisateur, avec npm 11.17 :
  #
  #     npm warn allow-scripts 2 packages have install scripts not yet covered:
  #     npm warn allow-scripts   better-sqlite3@12.11.1 (install: prebuild-install…)
  #
  # npm a BLOQUÉ le script d'installation. `npm install` sort donc avec 0, on
  # affiche « dépendances installées », et le binaire natif n'est pas là. La
  # ruche mourra au démarrage, très loin d'ici, sur un message que rien ne relie
  # à ce moment-ci.
  #
  # `better-sqlite3` et `fastify` sont des dépendances OPTIONNELLES : npm a le
  # droit de les écarter sans échouer. C'est précisément pour ça qu'il faut les
  # charger pour de bon au lieu de croire un code de sortie.
  $null = node -e "require('better-sqlite3'); require('fastify')" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Echec 'Les dépendances sont installées mais la ruche ne peut pas démarrer.'
    Dire ''
    Dire '      « better-sqlite3 » ou « fastify » ne se charge pas. Les deux sont'
    Dire '      OPTIONNELLES : npm a pu les écarter — ou refuser leur script'
    Dire '      d''installation — sans échouer pour autant.'
    Dire ''
    Dire '      Une seule commande, et c''est la bonne dans tous les cas :'
    Dire ''
    Ecrire '        npm rebuild better-sqlite3' 'accent'
    Dire ''
    # ─── UNE COMMANDE, PARCE QU'ELLE A SUFFI ─────────────────────────────────
    #
    # Ce message en a listé deux, dont une inutile. Mesuré chez un utilisateur :
    #
    #     PS> npm approve-scripts --allow-scripts-pending
    #     2 packages have install scripts not yet covered by allowScripts: …
    #     Run `npm approve-scripts <pkg>` to allow…
    #
    # `--allow-scripts-pending` ne fait que LISTER — il n'autorise rien. Il
    # faudrait `npm approve-scripts better-sqlite3`. Et surtout : la ligne
    # suivante de la même trace montre que `npm rebuild better-sqlite3` a réussi
    # SEUL, verrou toujours en place, parce que `rebuild` compile au lieu
    # d'attendre le script d'installation.
    #
    # On ne donne donc qu'une commande. Deux, dont une qui ne fait rien, c'est
    # deux occasions de croire qu'on a essayé.
    Dire '      Elle règle les deux causes qui donnent ce message : le verrou'
    Dire '      « allow-scripts » de npm, qui a empêché la récupération du binaire,'
    Dire '      et un Node qui a CHANGÉ depuis l''installation — le binaire reste'
    Dire '      alors celui de l''ancienne ABI.'
    Dire ''
    # ─── `rebuild`, ET SURTOUT PAS `install` ─────────────────────────────────
    #
    # Première version de ce message : « npm install ». Mesuré chez un
    # utilisateur, c'était le mauvais conseil — et pour une raison qui compte :
    #
    #     Error: le module better_sqlite3.node a été compilé pour
    #     NODE_MODULE_VERSION 137. Cette version de Node exige 147.
    #
    # Le paquet ÉTAIT là. Son binaire natif ne correspondait pas à l'ABI du Node
    # utilisé. `npm install` voit un paquet déjà installé à la bonne version et
    # ne touche à rien : il rend 0, et la panne reste entière. Seul `rebuild`
    # refait le binaire.
    #
    # Deux causes mènent au même message, et la même commande les règle :
    #   · le verrou `allow-scripts` a empêché `prebuild-install` de chercher le
    #     binaire correspondant à ce Node ;
    #   · le Node de la machine a changé depuis l'installation.
    Dire '      « npm install » n''y suffirait PAS : il voit un paquet déjà présent'
    Dire '      à la bonne version, ne touche à rien, et rend 0. Seul « rebuild »'
    Dire '      refait le binaire.'
    Dire ''
    Dire '      On s''arrête ICI plutôt que d''écrire une configuration pour une'
    Dire '      ruche qui ne démarrera pas.'
    Dire ''
    exit $CODE_PREREQUIS
  }

  Pop-Location
  Ok 'dépendances installées, et chargeables'
}

# ─── 4. La main à l'installeur de Hive ──────────────────────────────────────
#
# C'est LUI qui pose les questions (≤ 3), engendre le jeton, écrit le `.env` et
# détecte l'agent. Le dupliquer ici ferait deux installeurs à maintenir, dont
# un jamais testé.

Etape 'Configuration'
if ($DryRun) {
  Alerte "--dry-run : l'installeur n'est pas lancé."

  # Le `--` ne s'affiche QUE s'il sépare quelque chose : sans arguments, cette
  # ligne rendait « npm run install:hive -- » avec un séparateur pendu dans le
  # vide. C'est le défaut symétrique de celui d'`install.sh`, qui lui OUBLIAIT
  # le `--`. Les deux sont sortis du même endroit : une ligne écrite pour
  # ressembler à la commande réelle au lieu d'être dérivée d'elle.
  if ($Reste) {
    $suite = "cd $Dir; npm run install:hive -- $($Reste -join ' ')"
  } else {
    $suite = "cd $Dir; npm run install:hive"
  }

  # ─── LA CARTE DE FIN ───────────────────────────────────────────────────────
  #
  # Un `--dry-run` se termine sur ce que la personne doit RETENIR, pas sur la
  # dernière ligne de journal qui traîne. Le cadre existe pour ça : il sépare
  # le compte-rendu de la suite à donner.
  Dire ''
  Cadre @(
    'Rien n''a été écrit — pas même le dossier de destination.',
    '',
    'Sans -DryRun, la suite serait :',
    "  $suite"
  )
  Dire ''
  exit 0
}

Push-Location $Dir
if ($Reste) { npm run install:hive -- @Reste } else { npm run install:hive }
$code = $LASTEXITCODE
Pop-Location
exit $code
