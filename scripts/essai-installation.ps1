#Requires -Version 5.1
<#
.SYNOPSIS
  Le seuil, franchi sous Windows — l'installation menée jusqu'à une ruche qui
  répond.

.DESCRIPTION
  ─── POURQUOI CE SCRIPT EXISTE ─────────────────────────────────────────────

  La CI exerçait `install.ps1 -DryRun`, et rien d'autre. Le mode sec s'arrête
  AVANT le clone, avant `npm install`, avant l'installeur — c'est-à-dire avant
  tout ce qui peut réellement échouer chez un inconnu.

  Linux et macOS ont, depuis le 14 août, une jambe « l'installation va jusqu'à
  une ruche qui répond », à chaque PR. Windows n'en avait pas : le seul essai
  complet était un rapport de terrain UNIQUE, une machine, un jour. Un arrivant
  sous Windows exécutait donc un chemin que personne ne voyait réussir en
  continu — et c'est le premier point de la liste du point de sortie.

  ─── CE QU'IL AFFIRME ──────────────────────────────────────────────────────

    1. l'installation sort en 0        — sinon rien d'autre n'a de sens
    2. le `.env` est écrit, et c'est LE vrai (port + jeton)
    3. la ruche RÉPOND sur /api/pulse  — « installé » ne veut rien dire si rien
                                         ne démarre
    4. le TABLEAU est servi et charge  — « la ruche répond » n'est pas « je peux
                                         m'en servir »
    5. je CRÉE MON PREMIER PROJET, et le tableau le voit — le premier geste réel
                                         d'un arrivant, jamais mesuré avant
    6. J'INVITE QUELQU'UN, et il ENTRE — la commande d'entrée était composée,
                                         gardée et affichée par trois bancs ;
                                         aucun ne la collait

  Le troisième est le seul qui ne puisse pas être simulé : il faut que le code
  tourne.

  Les trois derniers sont en Node (`scripts/essai-parcours.mjs`,
  `scripts/essai-entree.mjs`) et PARTAGÉS avec l'essai POSIX. Les réécrire ici, avec du JSON à analyser en PowerShell, aurait
  refabriqué exactement la divergence que `tests/installeurs-jumeaux.test.ts`
  avait trouvée entre les deux installeurs.

  ─── CE QU'IL N'AFFIRME PAS, ET POURQUOI ───────────────────────────────────

  La version POSIX vérifie que le `.env` est en **0600**. Ici, non — et ce n'est
  pas un oubli.

  Le fichier est écrit par Node avec `mode: 0o600` (`src/ecriture-atomique.ts`).
  Sous Windows, ce `mode` ne pose AUCUNE ACL : Node n'en retient que le bit
  « lecture seule ». Le secret n'y est donc pas protégé par la même mécanique,
  et `tests/installeur-porte.test.ts` saute déjà cette assertion là-bas pour
  cette raison exacte.

  Écrire ici un contrôle d'ACL donnerait une garde VERTE qui ne mesure pas ce
  que la POSIX mesure — le pire des deux mondes : une couverture apparente sur
  une protection absente. On le DIT plutôt que de le simuler ; fermer ce trou
  est un lot à part, qui touche l'installeur, pas son essai.

  ─── LE JETON NE PASSE JAMAIS EN ARGUMENT ──────────────────────────────────

  Il est lu dans le `.env` que l'installeur vient d'écrire, et voyage dans un
  EN-TÊTE. Un secret en argument de commande se retrouve dans la table des
  processus, et dans les journaux de la CI.

.PARAMETER Depot
  Dépôt à installer. La CI y met l'arbre qu'on vient d'écrire : sans cela, on
  éprouverait du code déjà fusionné en croyant mesurer le sien.

.PARAMETER Ref
  Branche ou tag à installer.

.EXAMPLE
  pwsh -File scripts/essai-installation.ps1 -Depot "$PWD" -Ref essai-du-seuil
#>
param(
  [string]$Depot = '',
  [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'

# 78 = « je n'ai pas pu conclure » : un service tenait le port par défaut. Le
# confondre avec un rouge apprendrait à relancer plutôt qu'à lire.
$CODE_INCONCLUANT = 78

$Cible = Join-Path ([System.IO.Path]::GetTempPath()) ("essai-hive-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$Ruche = $null
$Port = $null

function Menage {
  # ─── LE MÉNAGE NE PEUT PAS FAIRE ROUGIR L'ESSAI ────────────────────────────
  #
  # DÉFAUT MESURÉ (run 31879223630) : les CINQ affirmations avaient mordu, et
  # la jambe est quand même sortie en 1, sur ceci —
  #
  #     taskkill.exe : ERROR: The process with PID 7356 (child process of PID
  #     7152) could not be terminated.
  #     + FullyQualifiedErrorId : NativeCommandError
  #
  # `taskkill /T /F` écrit sur stderr quand un enfant est DÉJÀ parti. C'est une
  # course normale entre l'arbre qu'on tue et l'arbre qui se termine, pas une
  # panne. Mais sous `$ErrorActionPreference = 'Stop'`, la moindre ligne de
  # stderr d'une commande NATIVE devient une erreur TERMINANTE — et le ménage
  # tuait l'essai qu'il devait seulement ranger.
  #
  # Intermittent, donc pire qu'un rouge franc : le tour précédent était vert
  # avec exactement le même code.
  #
  # C'est le piège déjà écrit dans `install.ps1` au sujet de `*> $null`. Je
  # l'avais évité pour le code NEUF sans regarder s'il vivait déjà dans le code
  # d'à côté (§ 9 terdecicenties).
  #
  # Un ménage a UN devoir — rendre la place — et jamais celui de porter un
  # verdict. On neutralise donc la préférence le temps du rangement, et on
  # avale ce qui resterait : le journal le dit, l'essai n'en meurt pas.
  $ancienneErreur = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Menage_ | Out-Null
  } catch {
    Write-Host "  (le menage n a pas tout pu ranger : $($_.Exception.Message))"
  } finally {
    $ErrorActionPreference = $ancienneErreur
  }
}

function Menage_ {
  # ─── RENDRE LA PLACE ───────────────────────────────────────────────────────
  #
  # `Stop-Process` seul ne suffit pas : `npm` lance `node`, qui lance ses
  # propres enfants. Tuer le parent laisse la ruche vivante et le port tenu —
  # et l'essai SUIVANT échouerait pour une raison qui n'est pas la sienne.
  # `taskkill /T` descend l'arbre.
  if ($null -ne $Ruche -and -not $Ruche.HasExited) {
    & taskkill.exe '/T' '/F' '/PID' $Ruche.Id 2>&1 | Out-Null
  }
  if ($null -ne $Port) {
    # On attend que la porte soit VRAIMENT rendue. Une réponse — même un 401 —
    # prouve que quelqu'un décroche encore.
    for ($i = 0; $i -lt 15; $i++) {
      try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 `
          -Uri "http://127.0.0.1:$Port/api/pulse" | Out-Null
      } catch [System.Net.WebException] {
        # Refus de connexion : la place est rendue, on sort.
        if ($_.Exception.Response -eq $null) { break }
      } catch {
        break
      }
      Start-Sleep -Seconds 1
    }
  }
  if (Test-Path -LiteralPath $Cible) {
    Remove-Item -LiteralPath $Cible -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  Write-Host "→ installation réelle dans $Cible"
  if ($Depot -ne '') { Write-Host "  depuis : $Depot ($Ref)" }

  $debut = Get-Date
  $arguments = @('-Dir', $Cible, '-Ref', $Ref, '--non-interactive')
  if ($Depot -ne '') { $arguments = @('-Depot', $Depot) + $arguments }

  # `install.ps1` est lancé PAR FICHIER, avec les drapeaux de la commande
  # annoncée — c'est l'invocation du README, pas une invocation voisine
  # (§ la garde `tests/commande-annoncee.test.ts`).
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '..\install.ps1') @arguments
  $code = $LASTEXITCODE
  $duree = [int]((Get-Date) - $debut).TotalSeconds

  # 4 = PORT_OCCUPE. La machine d'essai a un service sur le port par défaut :
  # l'installation n'a rien à se reprocher, et l'essai n'a rien pu conclure.
  if ($code -eq 4) {
    Write-Error '⊘ le port par défaut est tenu par un autre service — essai NON CONCLUANT'
    exit $CODE_INCONCLUANT
  }
  if ($code -ne 0) {
    Write-Error "✘ installation sortie en $code"
    exit 1
  }
  Write-Host "✔ 1/3 — installation sortie en 0, $duree s"

  # ─── 2. LE .env EST ÉCRIT, ET C'EST LE VRAI ────────────────────────────────
  #
  # Le port et le jeton viennent du fichier que l'installeur vient d'écrire,
  # JAMAIS d'une supposition : les supposer ferait passer l'essai sur une ruche
  # qu'on n'a pas installée.
  $env_ = Join-Path $Cible '.env'
  if (-not (Test-Path -LiteralPath $env_)) {
    Write-Error '✘ .env absent'
    exit 1
  }
  $lignes = Get-Content -LiteralPath $env_
  $Port = ($lignes | Where-Object { $_ -match '^HIVE_PORT=' } | Select-Object -First 1) -replace '^HIVE_PORT=', ''
  $jeton = ($lignes | Where-Object { $_ -match '^HIVE_TOKEN=' } | Select-Object -First 1) -replace '^HIVE_TOKEN=', ''
  if ([string]::IsNullOrWhiteSpace($Port)) {
    Write-Error '✘ .env sans HIVE_PORT'
    exit 1
  }
  if ([string]::IsNullOrWhiteSpace($jeton)) {
    Write-Error '✘ .env sans HIVE_TOKEN'
    exit 1
  }
  Write-Host "✔ 2/3 — .env écrit, port $Port et jeton présents"
  # ─── PAS D'APOSTROPHE TYPOGRAPHIQUE DANS UNE CHAINE POWERSHELL ─────────────
  #
  # Cette ligne portait « n'a PAS d'equivalent » avec des apostrophes courbes.
  # PowerShell 5.1 les traite comme des DELIMITEURS de chaine, au meme titre que
  # l'apostrophe droite : la chaine s'est refermee au milieu du mot, et le
  # fichier entier a cesse d'etre analysable.
  #
  #     The Try statement is missing its Catch or Finally block.
  #     Unexpected token ')' in expression or statement.
  #
  # Le BOM avait reparu l'encodage ; ceci est un defaut DISTINCT, invisible tant
  # qu'on ne lance pas le script pour de vrai. Les chaines de ce fichier restent
  # donc en ASCII — les commentaires, eux, peuvent tout se permettre.
  Write-Host '  (la permission 0600 n a pas d equivalent Windows - voir l en-tete)'

  # ─── 3. LA RUCHE RÉPOND ────────────────────────────────────────────────────
  # ─── L'AGENT SIMULE EST FORCE, ET C'EST UNE DECISION ─────────────────────
  #
  # `HIVE_AGENT=shell` impose l'adaptateur simule au lieu de laisser l'ouvriere
  # detecter ce qui traine sur la machine. Meme raison que le jumeau POSIX, et
  # elle mord surtout ICI : un runner Windows n'a PAS de demon Docker. Sans
  # cette ligne, une ouvriere qui trouverait un agent reel le ferait tourner
  # dans un bac a sable absent, et la tache echouerait — non par defaut du
  # produit, mais par absence d'un service que cette jambe ne pretend pas
  # mesurer.
  #
  # `Start-Process` n'a pas de parametre d'environnement : on pose la variable
  # sur le processus courant, dont l'enfant herite.
  $env:HIVE_AGENT = 'shell'
  $Ruche = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'ruche') `
    -WorkingDirectory $Cible -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Cible 'ruche.log') `
    -RedirectStandardError (Join-Path $Cible 'ruche.err')

  # On attend qu'elle réponde, on ne dort pas un temps fixe : une attente en dur
  # est un pari sur la vitesse de la machine (§ 9 octoquadragies du carnet).
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 `
        -Headers @{ 'x-hive-token' = $jeton } `
        -Uri "http://127.0.0.1:$Port/api/pulse"
      if ($r.StatusCode -eq 200) {
        Write-Host "✔ 3/3 — la ruche répond sur :$Port après $i s"
        # ─── ET MAINTENANT LE PARCOURS ────────────────────────────────────
        #
        # « La ruche répond » n'est pas « je peux m'en servir ». Les deux pas
        # suivants — j'ouvre le tableau, je crée mon premier projet — sont en
        # Node et PARTAGÉS avec l'essai POSIX. Les réécrire ici, avec du JSON à
        # analyser en PowerShell, aurait refabriqué exactement la divergence
        # que `tests/installeurs-jumeaux.test.ts` a trouvée entre les deux
        # installeurs.
        #
        # La racine passe en argument ; le JETON, jamais — il est relu là-bas
        # dans le .env que l'installeur vient d'écrire.
        $parcours = Join-Path $PSScriptRoot 'essai-parcours.mjs'
        & node.exe $parcours '--racine' $Cible
        if ($LASTEXITCODE -ne 0) { exit 1 }

        # ─── ET LE GESTE D'APRES : J'INVITE QUELQU'UN ────────────────────
        #
        # Le sixieme pas fabrique un poste d'invite a cote, y colle la
        # commande d'entree que la ruche vient de composer, et attend que
        # l'invite apparaisse. Partage lui aussi : c'est LE MEME fichier
        # Node que la jambe POSIX lance, et il choisit seul le jumeau
        # (`rejoindre.ps1` ici) selon la plateforme.
        #
        # Le dossier d'invite vit A COTE de la cible, jamais dedans : le
        # menage de ce script vise $Cible, et un poste d'invite sous elle
        # serait efface au milieu de l'essai.
        $entree = Join-Path $PSScriptRoot 'essai-entree.mjs'
        & node.exe $entree '--racine' $Cible '--invite' "$Cible-invite"
        if ($LASTEXITCODE -ne 0) { exit 1 }

        # ─── ET LE SEUL GESTE QUI PROUVE LE PRODUIT ──────────────────────
        #
        # Les six pas precedents menent l'arrivant jusqu'a « j'ai installe,
        # j'ouvre le tableau, je cree un projet, j'invite quelqu'un ». Aucun
        # ne menait un travail jusqu'a un RESULTAT — juste avant la seule
        # chose que Hive promet. Partage lui aussi : c'est LE MEME fichier
        # Node que la jambe POSIX lance.
        $travail = Join-Path $PSScriptRoot 'essai-travail.mjs'
        & node.exe $travail '--racine' $Cible
        if ($LASTEXITCODE -ne 0) { exit 1 }
        exit 0
      }
    } catch {
      # Pas encore là : on retente. Le seul verdict qui compte est le 200.
    }
    Start-Sleep -Seconds 1
  }

  Write-Error "✘ la ruche n'a pas répondu sur :$Port en 90 s"
  Write-Host '--- son journal ---'
  foreach ($f in @('ruche.log', 'ruche.err')) {
    $j = Join-Path $Cible $f
    if (Test-Path -LiteralPath $j) { Get-Content -LiteralPath $j -Tail 30 }
  }
  exit 1
} finally {
  Menage
}
