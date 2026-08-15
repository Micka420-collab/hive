#Requires -Version 5.1
<#
.SYNOPSIS
  Rejoindre une ruche Hive — en UNE commande, sur un poste qui n'a rien.

.DESCRIPTION
  ─── LE DÉFAUT QUE CE SCRIPT RETIRE ─────────────────────────────────────────

  La ruche remettait `npm run join -- hive2_…`, et le panneau d'invitation le
  disait franchement : « il colle cette commande DANS LE DOSSIER ». Le dossier.
  Celui qu'un invité n'a pas, puisqu'il n'a rien installé.

  Le parcours réel était en deux temps — installer, puis rejoindre — avec un
  `cd` implicite dont personne ne parlait. Celui qui invite devait l'expliquer
  de vive voix, et c'est ce qui fait qu'on n'invite personne.

  ─── CE QU'IL FAIT ──────────────────────────────────────────────────────────

    1. si Hive est déjà là, on ne réinstalle RIEN — on rejoint ;
    2. sinon on installe, par le MÊME install.ps1 que le README annonce ;
    3. puis on rejoint avec le billet.

  Le pas 1 compte : quelqu'un qui a déjà une ruche et rejoint celle d'un ami ne
  doit pas voir son installation refaite sous lui.

  ─── PAR FICHIER, JAMAIS PAR `iex` ──────────────────────────────────────────

  Comme install.ps1, et pour la raison déjà payée : `iex` évalue une
  EXPRESSION, or `param()` n'est valide qu'au début d'un SCRIPT. Un script à
  paramètres tuyauté dans `iex` échoue sur toutes les machines, dès la ligne du
  `param`.

  ─── LE BILLET EST UN SECRET, ET IL PASSE EN ARGUMENT ───────────────────────

  Assumé, et c'est le compromis de toutes les commandes d'adhésion. Ce qu'on
  peut en dire honnêtement : il n'est exposé que sur le poste de l'invité, il
  est COMPTÉ et RÉVOCABLE, et il est échangé contre une clé propre au noeud dès
  la première connexion. Un billet à usage unique referme la fenêtre dès
  l'entrée.

.PARAMETER Billet
  Le billet remis par la personne qui invite. Forme : hive2_…

.EXAMPLE
  irm https://raw.githubusercontent.com/Micka420-collab/hive/main/rejoindre.ps1 -OutFile "$env:TEMP\hive-rejoindre.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-rejoindre.ps1" -Billet hive2_...
#>
param(
  [Parameter(Mandatory = $true)][string]$Billet,
  # Ou installer. Defaut : %USERPROFILE%\hive — le meme qu'install.ps1.
  [string]$Dir = $(if ($env:HIVE_DIR) { $env:HIVE_DIR } else { Join-Path $HOME 'hive' }),
  [string]$DepotBrut = $(if ($env:HIVE_DEPOT_BRUT) { $env:HIVE_DEPOT_BRUT } else { 'https://raw.githubusercontent.com/Micka420-collab/hive/main' })
)

$ErrorActionPreference = 'Stop'

# ─── LE BILLET EST VALIDÉ AVANT DE TOUCHER À QUOI QUE CE SOIT ────────────────
#
# Un billet est `hive2_` suivi de base64url — un alphabet sans aucun caractère
# actif. On refuse tout le reste PLUTOT que d'echapper : ce script passe le
# billet a `npm run join --`, et une chaine tordue y deviendrait autre chose
# qu'un argument.
#
# La meme regle vit dans `src/shared/commande-entree.ts` et dans
# `rejoindre.sh`. Trois endroits, une seule regle, un banc qui l'eprouve sur des
# billets empoisonnes.
if ($Billet -notmatch '^hive2_[A-Za-z0-9_-]+$') {
  Write-Error 'Ce billet n a pas la forme attendue (hive2_...). Redemandez-en un.'
  exit 64
}

# ─── 1. HIVE EST-IL DÉJÀ LÀ ? ───────────────────────────────────────────────
#
# On reconnait une installation a son package.json ET a son node_modules : un
# clone sans dependances ne sait pas rejoindre, et le reinstaller est justement
# ce qu'il faut faire.
$pkg = Join-Path $Dir 'package.json'
$mods = Join-Path $Dir 'node_modules'
if ((Test-Path -LiteralPath $pkg) -and (Test-Path -LiteralPath $mods)) {
  Write-Host "-> Hive est deja installe dans $Dir - on rejoint directement."
} else {
  Write-Host "-> Installation de Hive dans $Dir..."
  # Le MEME installeur que le README annonce. En reprendre une copie ici
  # fabriquerait un second installeur a maintenir, dont un jamais eprouve.
  $installeur = Join-Path $env:TEMP 'hive-install.ps1'
  Invoke-RestMethod "$DepotBrut/install.ps1" -OutFile $installeur
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installeur -Dir $Dir '--non-interactive'
  if ($LASTEXITCODE -ne 0) {
    Write-Error "L installation a echoue (code $LASTEXITCODE) - rien n a ete rejoint."
    exit $LASTEXITCODE
  }
}

# ─── 2. REJOINDRE ───────────────────────────────────────────────────────────
#
# `npm run join` lit l'adresse DANS le billet : rien d'autre a demander, rien a
# configurer. L'agent de codage de l'invite est detecte tout seul.
Write-Host ''
Write-Host '-> Entree dans la ruche...'
Push-Location $Dir
npm run join -- $Billet
$code = $LASTEXITCODE
Pop-Location
exit $code
