#!/usr/bin/env sh
#
# Hive — installation en une commande (Linux et macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh
#
# ─── CE QUE CE SCRIPT FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────
#
# IL FAIT : vérifier Node, récupérer Hive, installer ses dépendances, lancer
# l'installeur interactif (celui qui écrit le `.env` et engendre le jeton).
#
# IL NE FAIT PAS :
#   · aucun `sudo`, jamais. Rien hors du dossier d'installation.
#   · il n'installe PAS Node à votre place. Un script d'installation qui touche
#     au gestionnaire de paquets d'une machine qu'il ne connaît pas est un
#     script qu'on ne devrait pas exécuter en aveugle. S'il manque, on dit la
#     commande exacte pour VOTRE système et on s'arrête.
#   · il n'ouvre aucun port et ne démarre aucun service.
#
# ─── POURQUOI DU `sh` ET PAS DU `bash` ───────────────────────────────────────
#
# Alpine, les images Docker minimales et certains conteneurs n'ont pas bash.
# Un script d'entrée qui échoue sur « bash: not found » rate exactement les
# machines qu'il est censé servir. Rien ici n'utilise de bashisme.
#
# Codes de sortie — les MÊMES que `src/codes-sortie.ts`, pour qu'un script
# appelant n'ait qu'une table à connaître :
#   0 succès · 1 erreur · 2 prérequis manquant · 3 réponse manquante
#   4 port occupé · 5 refus de sécurité · 130 interrompu

set -eu

NODE_MIN=24
DEPOT="https://github.com/Micka420-collab/hive.git"
DOSSIER="${HIVE_DIR:-$HOME/hive}"
REF="${HIVE_REF:-main}"

CODE_ERREUR=1
CODE_PREREQUIS=2

# ─── Affichage : lisible partout, y compris sans couleur ni TTY ──────────────
#
# `NO_COLOR` est respecté (norme informelle, https://no-color.org), et l'absence
# de TTY suffit à couper les couleurs : un journal de CI plein de séquences ANSI
# est plus dur à lire qu'un journal nu.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GRAS=$(printf '\033[1m'); ZERO=$(printf '\033[0m')
  VERT=$(printf '\033[32m'); ROUGE=$(printf '\033[31m'); JAUNE=$(printf '\033[33m')
else
  GRAS=''; ZERO=''; VERT=''; ROUGE=''; JAUNE=''
fi

dire()    { printf '%s\n' "$*"; }
etape()   { printf '%s▸%s %s\n' "$GRAS" "$ZERO" "$*"; }
ok()      { printf '  %s✔%s %s\n' "$VERT" "$ZERO" "$*"; }
alerte()  { printf '  %s▲%s %s\n' "$JAUNE" "$ZERO" "$*"; }
echec()   { printf '  %s✘%s %s\n' "$ROUGE" "$ZERO" "$*" >&2; }

# ─── Options ────────────────────────────────────────────────────────────────
#
# Tout ce qui n'est pas reconnu ici est TRANSMIS à l'installeur : c'est lui qui
# porte `--non-interactive`, `--json` et le reste. Les dupliquer ferait deux
# vérités à tenir à jour.
#
# Les quatre drapeaux reconnus ci-dessous sont ceux qui pilotent CE script-ci —
# où cloner, quoi cloner, montrer sans écrire, l'aide. Eux sont consommés.
POUR_INSTALLEUR=''
SEC=0
for arg in "$@"; do
  case "$arg" in
    --dir=*)  DOSSIER="${arg#--dir=}" ;;
    --ref=*)  REF="${arg#--ref=}" ;;
    # `--dry-run` est CONSOMMÉ ICI, il n'est pas transmis. Il l'était, et ça
    # produisait une contradiction : le script s'arrête AVANT l'installeur en
    # mode sec, donc le drapeau n'était jamais transmis à personne — mais il
    # apparaissait dans la commande affichée, qui annonçait « sans --dry-run,
    # la suite serait : npm run install:hive -- --dry-run ». Une suggestion qui
    # contient exactement le drapeau dont elle dit se passer.
    #
    # (`install.ps1` avait raison depuis le début : `-DryRun` y est un `switch`
    #  déclaré, donc séparé de `$Reste` par PowerShell lui-même.)
    --dry-run) SEC=1 ;;
    -h|--help)
      dire "Hive — installation en une commande"
      dire ""
      dire "  --dir=CHEMIN   où installer          (défaut : \$HOME/hive)"
      dire "  --ref=REF      branche ou tag        (défaut : main)"
      dire "  --dry-run      montre, n'écrit rien"
      dire ""
      dire "Tout autre drapeau est transmis à l'installeur de Hive"
      dire "(--non-interactive, --json…)."
      exit 0
      ;;
    *) POUR_INSTALLEUR="$POUR_INSTALLEUR $arg" ;;
  esac
done

dire ""
dire "${GRAS}🐝 Hive${ZERO} — installation"
dire ""

# ─── 1. Les prérequis, et la commande exacte s'ils manquent ─────────────────

etape "Vérification des prérequis"

manque() {
  echec "$1 est introuvable."
  dire ""
  dire "  Pour l'installer :"
  case "$(uname -s)" in
    Darwin) dire "    brew install $2" ;;
    *)
      if [ -f /etc/debian_version ]; then dire "    sudo apt install -y $2"
      elif [ -f /etc/alpine-release ]; then dire "    sudo apk add $2"
      elif [ -f /etc/fedora-release ]; then dire "    sudo dnf install -y $2"
      else dire "    (via le gestionnaire de paquets de votre système : $2)"
      fi
      ;;
  esac
  dire ""
  exit $CODE_PREREQUIS
}

command -v git >/dev/null 2>&1 || manque "git" "git"

if ! command -v node >/dev/null 2>&1; then
  echec "Node.js est introuvable."
  dire ""
  dire "  Hive exige ${GRAS}Node ${NODE_MIN} ou plus${ZERO}. Le plus simple :"
  dire ""
  dire "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  dire "    nvm install $NODE_MIN"
  dire ""
  dire "  (ou ${GRAS}brew install node${ZERO} sur macOS, ou nodejs via votre gestionnaire de paquets)"
  dire ""
  exit $CODE_PREREQUIS
fi

# La version se lit sans `sed -E` ni bashisme : `v24.3.1` → `24`.
MAJEUR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$MAJEUR" -lt "$NODE_MIN" ] 2>/dev/null; then
  echec "Node $MAJEUR détecté — Hive exige $NODE_MIN ou plus."
  dire ""
  dire "  Sous cette version, le module natif SQLite doit être COMPILÉ, ce qui"
  dire "  échoue sur toute machine sans outillage C++ — en silence, parce que la"
  dire "  dépendance est optionnelle. À partir de Node $NODE_MIN, un binaire prébuilt"
  dire "  existe : rien à compiler, aucun compilateur à installer."
  dire ""
  dire "    nvm install $NODE_MIN && nvm use $NODE_MIN"
  dire ""
  exit $CODE_PREREQUIS
fi
ok "Node $MAJEUR (≥ $NODE_MIN exigé)"
ok "git $(git --version | cut -d' ' -f3)"

# ─── 2. Récupérer Hive — sans jamais écraser un travail en cours ────────────

etape "Récupération de Hive dans $DOSSIER"

if [ "$SEC" = 1 ]; then
  alerte "--dry-run : rien ne sera écrit."
fi

if [ -d "$DOSSIER/.git" ]; then
  ok "déjà présent — mise à jour"
  if [ "$SEC" = 0 ]; then
    # `git checkout` REFUSE si des fichiers suivis ont été modifiés localement :
    # quelqu'un qui a bidouillé son installation le découvre ici, pas après
    # coup. On ne force rien, et l'échec est expliqué juste en dessous.
    #
    # (Le commentaire disait « --ff-only » alors que le code n'en utilise pas.
    #  Une règle écrite qui ne décrit pas le câblage : corrigée à la source.)
    (cd "$DOSSIER" && git fetch --depth 1 origin "$REF" -q && git checkout -q FETCH_HEAD) || {
      echec "mise à jour impossible — le dossier contient peut-être des modifications locales."
      dire "  Réglez-les, ou installez ailleurs : --dir=/autre/chemin"
      exit $CODE_ERREUR
    }
  fi
elif [ -e "$DOSSIER" ]; then
  echec "$DOSSIER existe et n'est pas une installation Hive."
  dire "  Choisissez un autre emplacement : --dir=/autre/chemin"
  exit $CODE_ERREUR
else
  if [ "$SEC" = 0 ]; then
    git clone --depth 1 --branch "$REF" -q "$DEPOT" "$DOSSIER"
    ok "cloné"
  else
    ok "serait cloné depuis $DEPOT ($REF)"
  fi
fi

# ─── 3. Dépendances ─────────────────────────────────────────────────────────

etape "Installation des dépendances"
if [ "$SEC" = 0 ]; then
  cd "$DOSSIER"
  # `--no-fund --no-audit` : deux pages de bruit sur une première installation.
  # `npm audit` reste lançable à la main, et la CI le fait.
  npm install --no-fund --no-audit
  ok "dépendances installées"
else
  alerte "--dry-run : npm install non lancé"
fi

# ─── 4. La main à l'installeur de Hive ──────────────────────────────────────
#
# C'est LUI qui pose les questions (≤ 3), engendre le jeton, écrit le `.env` en
# 600 et détecte l'agent. Le dupliquer ici ferait deux installeurs à maintenir,
# dont un non testé.

etape "Configuration"
dire ""
if [ "$SEC" = 1 ]; then
  alerte "--dry-run : l'installeur n'est pas lancé."
  dire ""
  dire "Sans --dry-run, la suite serait :"
  # LE `--` N'EST PAS DÉCORATIF, et cette ligne l'a longtemps oublié. Elle
  # affichait `npm run install:hive --dry-run` alors que le vrai appel, en bas,
  # est `npm run install:hive -- --dry-run`. Sans le séparateur, npm garde le
  # drapeau POUR LUI — et `--dry-run` en est un vrai, côté npm : la commande
  # copiée-collée depuis cet écran ne lançait donc PAS l'installeur.
  #
  # Une ligne qui dit « voilà ce qui va se passer » doit dire vrai, sinon elle
  # est pire que son absence. Le test `installeurs.test.ts` la compare
  # désormais à l'appel réel.
  if [ -n "$POUR_INSTALLEUR" ]; then
    dire "    cd $DOSSIER && npm run install:hive --$POUR_INSTALLEUR"
  else
    dire "    cd $DOSSIER && npm run install:hive"
  fi
  dire ""
  exit 0
fi

# shellcheck disable=SC2086
npm run install:hive -- $POUR_INSTALLEUR
