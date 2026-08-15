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

  Le troisième est le seul qui ne puisse pas être simulé : il faut que le code
  tourne.

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
  # ─── RENDRE LA PLACE, QUOI QU'IL ARRIVE ────────────────────────────────────
  #
  # `Stop-Process` seul ne suffit pas : `npm` lance `node`, qui lance ses
  # propres enfants. Tuer le parent laisse la ruche vivante et le port tenu —
  # et l'essai SUIVANT échouerait pour une raison qui n'est pas la sienne.
  # `taskkill /T` descend l'arbre.
  if ($null -ne $Ruche -and -not $Ruche.HasExited) {
    & taskkill.exe '/T' '/F' '/PID' $Ruche.Id 2>$null | Out-Null
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
