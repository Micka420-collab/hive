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
# Le dépôt d'où l'on tire Hive. Surchargeable par l'environnement pour UNE
# raison : éprouver l'installation SUR L'ARBRE QU'ON VIENT D'ÉCRIRE. Sans cela,
# la CI ne pourrait vérifier que `main`, c'est-à-dire du code déjà fusionné —
# elle dirait « l'installation marche » d'une version qui n'est pas celle qu'on
# s'apprête à livrer. Un chemin local est un dépôt valide pour git.
DEPOT="${HIVE_DEPOT:-https://github.com/Micka420-collab/hive.git}"
DOSSIER="${HIVE_DIR:-$HOME/hive}"
REF="${HIVE_REF:-main}"

CODE_ERREUR=1
CODE_PREREQUIS=2

# ═══ LA CHARTE, TENUE ICI AUSSI ══════════════════════════════════════════════
#
# La marque de Hive est ÉCRITE, dans `src/tui/rendu.ts`, et `tui-rendu.test.ts`
# l'exerce. Les deux installeurs en étaient les seules pièces qui ne la
# respectaient pas : ils peignaient en vert, jaune et rouge.
#
# Trois accents, c'est-à-dire aucun. La charte (§6.1) le dit sans détour :
# « deux accents, c'est zéro accent — plus rien ne ressort ». Un seul ton
# ressort donc, l'AMBRE ; le reste est neutre, le secondaire est atténué, et
# c'est le SYMBOLE qui porte le sens — pas la couleur.
#
# Ce que ça change pour de vrai : cette sortie reste lisible SANS couleur du
# tout. Dans un `less`, dans un journal de CI, ou pour quelqu'un qui ne
# distingue pas le rouge du vert — c'est-à-dire environ un homme sur douze.
#
# `NO_COLOR` (https://no-color.org) et l'absence de TTY coupent tout.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  # 256 couleurs quand le terminal l'annonce, 16 sinon. L'ambre 214 est la
  # MÊME que celle du module pur — c'est une marque, pas une préférence.
  case "${TERM:-}" in
    *256color* | *truecolor* | alacritty | kitty* | wezterm*) AMBRE=$(printf '\033[38;5;214m') ;;
    *) AMBRE=$(printf '\033[33m') ;;
  esac
  ATTENUE=$(printf '\033[2m'); ZERO=$(printf '\033[0m')
  # ─── LA COULEUR VRAIE NE SE DEVINE PAS ────────────────────────────────────
  #
  # `COLORTERM` est la SEULE annonce fiable des 24 bits — `TERM` ne la porte
  # pas, y compris sur des terminaux qui la gèrent depuis des années. Le module
  # pur lit exactement la même variable (`niveauCouleur`), et les deux doivent
  # conclure pareil : sinon le même terminal verrait deux marques différentes
  # selon le fichier qui l'affiche.
  case "${COLORTERM:-}" in
    truecolor | 24bit) VRAIE_COULEUR=1 ;;
    *) VRAIE_COULEUR=0 ;;
  esac
else
  AMBRE=''; ATTENUE=''; ZERO=''; VRAIE_COULEUR=0
fi

# ─── L'alphabet, et son repli ────────────────────────────────────────────────
#
# Chaque repli ASCII fait EXACTEMENT une colonne, sans quoi les lignes
# cesseraient d'être alignées entre elles au premier repli.
#
# On considère l'UTF-8 sûr dès que la locale l'annonce. `LC_ALL` d'abord, comme
# le veut POSIX, puis `LC_CTYPE`, puis `LANG` : c'est l'ordre de précédence
# réel, et le prendre à l'envers ferait dessiner des cadres dans un terminal
# qui ne sait pas les rendre.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8* | *utf8* | *UTF8* | *utf-8*) UNICODE=1 ;;
  *) UNICODE=0 ;;
esac

if [ "$UNICODE" = 1 ]; then
  S_FAIT='✔'; S_CURSEUR='▸'; S_AVENIR='◦'; S_ALERTE='⚠'; S_ECHEC='✘'
  B_HG='╭'; B_HD='╮'; B_BG='╰'; B_BD='╯'; B_H='─'; B_V='│'
  HEXAGONE='⬡'; TIRET='—'
else
  S_FAIT='+'; S_CURSEUR='>'; S_AVENIR='.'; S_ALERTE='!'; S_ECHEC='x'
  B_HG='+'; B_HD='+'; B_BG='+'; B_BD='+'; B_H='-'; B_V='|'
  HEXAGONE='<>'; TIRET='-'
fi

# Mêmes seuils que le module pur : 76 colonnes de contenu au plus, et pas de
# cadre en dessous de 60 — ils y coûteraient plus de place qu'ils n'en donnent.
LARGEUR=76
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  COLONNES=$(tput cols 2>/dev/null || echo 80)
  [ "$COLONNES" -lt 78 ] 2>/dev/null && LARGEUR=$((COLONNES - 2))
fi
[ "$LARGEUR" -lt 20 ] 2>/dev/null && LARGEUR=20
if [ "$LARGEUR" -ge 60 ]; then CADRES=1; else CADRES=0; fi

dire()    { printf '%s\n' "$*"; }
accent()  { printf '%s%s%s\n' "$AMBRE" "$*" "$ZERO"; }
discret() { printf '%s%s%s\n' "$ATTENUE" "$*" "$ZERO"; }

# ─── LE RAIL ─────────────────────────────────────────────────────────────────
#
# Le même que celui de `src/tui/rendu.ts`, et pour la même raison : une suite de
# lignes cochées dit « ça a marché » et ne dit jamais « où en suis-je ». Une
# colonne continue le dit sans un mot.
#
#     ⬡  Vérification des prérequis
#     │  ✔ Node v24.18.0
#     │  ✔ git 2.51
#     │
#     ⬡  Installation des dépendances
#
# ─── POURQUOI LA PERLE PLEINE N'EXISTE PAS ICI ───────────────────────────────
#
# Dans le module pur, `⬢` marque un pas TERMINÉ : l'installeur en TypeScript
# tient un écran et peut le repeindre. Un script shell, lui, écrit une ligne et
# ne revient jamais dessus — et il ne DOIT pas, sinon sa sortie devient
# illisible dans un `tee`, un journal de CI ou un `less`.
#
# Une perle pleine serait donc INATTEIGNABLE ici. On ne la déclare pas : le
# dépôt a déjà payé une frise d'hexagones que plus aucune largeur ne pouvait
# afficher, et une variante qui ne peut pas aboutir donne l'illusion d'une
# couverture (§ 6.2 du journal).
if [ "$UNICODE" = 1 ]; then PERLE='⬡'; else PERLE='o'; fi

# Le premier pas n'est précédé d'aucun segment : un rail qui commence par un
# trait pendrait dans le vide.
PREMIER_PAS=1

etape() {
  if [ "$PREMIER_PAS" = 1 ]; then
    PREMIER_PAS=0
    printf '\n'
  else
    printf '  %s%s%s\n' "$ATTENUE" "$B_V" "$ZERO"
  fi
  printf '  %s%s  %s%s\n' "$AMBRE" "$PERLE" "$*" "$ZERO"
}

# Les verdicts PENDENT au rail. C'est ce trait, un caractère par ligne, qui
# rattache une vérification à son étape — sans lui, l'écran redevient une liste.
rameau()  { printf '  %s%s%s  ' "$ATTENUE" "$B_V" "$ZERO"; }
ok()      { rameau; printf '%s %s\n' "$S_FAIT" "$*"; }
attente() { rameau; printf '%s%s %s%s\n' "$ATTENUE" "$S_AVENIR" "$*" "$ZERO"; }
alerte()  { rameau; printf '%s%s %s%s\n' "$ATTENUE" "$S_ALERTE" "$*" "$ZERO"; }
# L'échec part sur stderr, donc SANS rail : les deux flux sont mêlés à
# l'affichage mais séparés dans un `2>fichier`, où un demi-rail orphelin ne
# voudrait plus rien dire.
echec()   { printf '  %s %s\n' "$S_ECHEC" "$*" >&2; }

# ─── Le cadre, et la marque ──────────────────────────────────────────────────
#
# `barre` répète un caractère sans boucle visible : `printf` avec une largeur
# puis substitution. Rien d'astucieux — juste ce qui marche en `sh` nu, sans
# `seq`, sans `{1..n}`, sans bashisme.
barre() {
  n=$1
  ligne=$(printf "%${n}s" '')
  printf '%s' "$(printf '%s' "$ligne" | sed "s/ /$B_H/g")"
}

# ─── COMBIEN DE COLONNES, PAS COMBIEN D'OCTETS ───────────────────────────────
#
# `printf '%-*s'` complète en OCTETS. `⬡` en pèse trois pour une seule colonne :
# la bordure droite du cadre se retrouvait deux colonnes trop à gauche, et
# seulement sur la ligne du titre — donc un cadre de travers, visible d'un coup
# d'œil et invisible à la relecture du code.
#
# (Le repli ASCII n'avait pas le défaut — `<>` fait deux octets pour deux
#  colonnes. C'est exactement pourquoi il ne se voyait que sur une ligne.)
#
# On compte les octets qui NE SONT PAS des continuations UTF-8 (0x80–0xBF) :
# c'est exactement le nombre de caractères, et ça ne dépend pas de la locale.
#
# `wc -m` aurait été le geste évident. Il est LOCALE-DÉPENDANT : sur une
# machine où `fr_FR.UTF-8` n'est pas générée — un conteneur minimal, une image
# Docker nue, exactement les machines que ce script vise — il recompte des
# octets et le cadre repart de travers. Mesuré ici avant d'être corrigé.
nb_colonnes() {
  printf '%s' "$1" | LC_ALL=C tr -d '\200-\277' | LC_ALL=C wc -c | tr -d ' '
}

# Une ligne de cadre, complétée à la bonne largeur.
#
# Une ligne TROP LONGUE sort du cadre plutôt que de le crever : mieux vaut une
# ligne qui déborde proprement qu'une bordure de travers, qui donne
# l'impression d'un logiciel mal fini. Rien de ce qui va dans un cadre n'est
# censé être long — les chemins, eux, s'affichent hors cadre.
cadre_ligne() {
  interieur=$((LARGEUR - 4))
  manque=$((interieur - $(nb_colonnes "$1")))
  if [ "$manque" -lt 0 ]; then
    dire "  $1"
    return
  fi
  printf '%s %s%s %s\n' "$B_V" "$1" "$(printf "%${manque}s" '')" "$B_V"
}

# Un cadre autour de lignes déjà composées. Rien n'en dépasse.
cadre() {
  if [ "$CADRES" = 0 ]; then
    for l in "$@"; do dire "$l"; done
    return
  fi
  interieur=$((LARGEUR - 4))
  discret "$B_HG$(barre $((interieur + 2)))$B_HD"
  for l in "$@"; do cadre_ligne "$l"; done
  discret "$B_BG$(barre $((interieur + 2)))$B_BD"
}

# ─── « HIVE » EN DEMI-BLOCS, LES MÊMES QUE `src/tui/rendu.ts` ────────────────
#
# Les demi-blocs donnent deux rangées de pixels par ligne de texte : une
# capitale lisible tient donc en TROIS lignes là où un dessin en `#` en
# demanderait cinq — et la charte plafonne la bannière à quatre.
#
# Le dégradé est POSÉ PAR LIGNE, pas par caractère : trois octets
# d'échappement au lieu de soixante-six. En `sh` nu, une boucle par caractère
# coûterait un `printf` par colonne et se verrait à l'affichage ; et sur trois
# lignes seulement, l'œil lit une transition tout aussi bien.
#
# `tests/installeurs.test.ts` confronte ces trois lignes à `BLOCS_HIVE` : si
# l'une des deux marques dérive, l'autre le dit.
BLOC_1='█   █  ▀█▀  █   █  █▀▀▀'
BLOC_2='█████   █   ▀▄ ▄▀  ███ '
BLOC_3='█   █  ▄█▄   ▀▄▀   █▄▄▄'

marque_blocs() {
  interieur=$1
  comble=$((interieur - 23))
  [ "$comble" -lt 0 ] && comble=0
  # Centrée, comme dans `marqueBlocs` : collée à gauche dans un cadre de 76
  # colonnes, la marque laisse cinquante colonnes de vide à sa droite et cesse
  # de se lire comme un logo.
  gauche=$((comble / 2))
  droite=$((comble - gauche))
  avant=$(printf "%${gauche}s" '')
  vide=$(printf "%${droite}s" '')
  # Du brun-miel au jaune pâle — la rampe de `RAMPE_MIEL`, échantillonnée aux
  # trois hauteurs de la lettre.
  for paire in "166;92;8 $BLOC_1" "230;154;20 $BLOC_2" "250;205;96 $BLOC_3"; do
    teinte=${paire%% *}
    dessin=${paire#* }
    printf '%s %s%s%s%s%s %s\n' \
      "$B_V" "$avant" "$(printf '\033[38;2;%sm' "$teinte")" "$dessin" "$ZERO" "$vide" "$B_V"
  done
}

# La marque : l'hexagone, le nom espacé, le sous-titre, le marqueur à droite.
# Quatre lignes au plus, affichées UNE SEULE FOIS, en haut.
banniere() {
  titre="$HEXAGONE  H I V E"
  sous="Orchestration communautaire d'agents IA"
  marqueur='installation'

  dire ''
  if [ "$CADRES" = 0 ]; then
    accent "$titre  $TIRET  $sous"
    dire ''
    return
  fi
  interieur=$((LARGEUR - 4))
  # Le marqueur dit « installation » plutôt qu'un numéro de version : à cet
  # instant le dépôt n'est pas encore là pour en donner un, et inventer une
  # version serait mentir sur la seule ligne que tout le monde lit.
  espace=$((interieur - $(nb_colonnes "$sous") - $(nb_colonnes "$marqueur")))
  [ "$espace" -lt 2 ] && espace=2
  remplissage=$(printf "%${espace}s" '')
  comble=$((interieur - $(nb_colonnes "$titre")))
  [ "$comble" -lt 0 ] && comble=0

  discret "$B_HG$(barre $((interieur + 2)))$B_HD"
  # ─── LA MARQUE EN BLOCS, AUX MÊMES CONDITIONS QUE LE MODULE PUR ────────────
  #
  # `src/tui/rendu.ts` dessine « HIVE » en demi-blocs quand le terminal a
  # l'Unicode, les cadres ET la couleur vraie. Ce script montrait, lui, un titre
  # d'une ligne — sur le même terminal, la même machine, la même installation.
  #
  # Deux marques pour un même produit, c'est zéro marque. Et c'est en plus la
  # forme exacte du § 9 bis du journal : deux chemins pour un même geste, dont
  # le moins fréquenté finit par mentir. Ici c'était le PLUS fréquenté qui
  # était en retard — `install.sh` est ce qu'on voit en premier.
  #
  # Les trois conditions sont donc les mêmes des deux côtés, à la lettre.
  if [ "$UNICODE" = 1 ] && [ "$VRAIE_COULEUR" = 1 ] && [ "$interieur" -ge 23 ]; then
    marque_blocs "$interieur"
  else
    printf '%s %s%s%s%s %s\n' \
      "$B_V" "$AMBRE" "$titre" "$ZERO" "$(printf "%${comble}s" '')" "$B_V"
  fi
  cadre_ligne "$sous$remplissage$marqueur"
  discret "$B_BG$(barre $((interieur + 2)))$B_BD"
  dire ''
}

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
      dire ""
      dire "  HIVE_DEPOT     dépôt d'où tirer Hive (défaut : GitHub)"
      dire "  --dry-run      montre, n'écrit rien"
      dire ""
      dire "Tout autre drapeau est transmis à l'installeur de Hive"
      dire "(--non-interactive, --json…)."
      exit 0
      ;;
    *) POUR_INSTALLEUR="$POUR_INSTALLEUR $arg" ;;
  esac
done

banniere

# ─── 1. Les prérequis, et la commande exacte s'ils manquent ─────────────────

etape "Vérification des prérequis"

manque() {
  echec "$1 est introuvable."
  dire ""
  dire "      Pour l'installer :"
  case "$(uname -s)" in
    Darwin) accent "        brew install $2" ;;
    *)
      if [ -f /etc/debian_version ]; then accent "        sudo apt install -y $2"
      elif [ -f /etc/alpine-release ]; then accent "        sudo apk add $2"
      elif [ -f /etc/fedora-release ]; then accent "        sudo dnf install -y $2"
      else dire "      (via le gestionnaire de paquets de votre système : $2)"
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
  dire "      Hive exige Node ${NODE_MIN} ou plus. Le plus simple :"
  dire ""
  accent "        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  accent "        nvm install $NODE_MIN"
  dire ""
  dire "      (ou brew install node sur macOS, ou nodejs via votre gestionnaire de paquets)"
  dire ""
  exit $CODE_PREREQUIS
fi

# La version se lit sans `sed -E` ni bashisme : `v24.3.1` → `24`.
MAJEUR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$MAJEUR" -lt "$NODE_MIN" ] 2>/dev/null; then
  echec "Node $MAJEUR détecté — Hive exige $NODE_MIN ou plus."
  dire ""
  dire "      Sous cette version, le module natif SQLite doit être COMPILÉ, ce qui"
  dire "      échoue sur toute machine sans outillage C++ — en silence, parce que la"
  dire "      dépendance est optionnelle. À partir de Node $NODE_MIN, un binaire"
  dire "      prébuilt existe : rien à compiler, aucun compilateur à installer."
  dire ""
  accent "        nvm install $NODE_MIN && nvm use $NODE_MIN"
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
      dire "      Réglez-les, ou installez ailleurs : --dir=/autre/chemin"
      exit $CODE_ERREUR
    }
  fi
elif [ -e "$DOSSIER" ]; then
  echec "$DOSSIER existe et n'est pas une installation Hive."
  dire "      Choisissez un autre emplacement : --dir=/autre/chemin"
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

  # ─── « INSTALLÉES » NE VEUT PAS DIRE « CHARGEABLES » ─────────────────────
  #
  # Leçon de l'image qui naissait morte (§ 1.5), et elle a mordu pour de vrai
  # sur la machine d'un utilisateur — alors que le remède était DÉJÀ écrit dans
  # `examples/deploiement-sans-ecran.sh`. Il vivait à un endroit que personne
  # ne traverse en installant.
  #
  # `better-sqlite3` et `fastify` sont OPTIONNELLES : npm a le droit de les
  # écarter, ou de refuser leur script d'installation (npm ≥ 11.17 le fait par
  # défaut, cf. « allow-scripts »), et de sortir avec 0 quand même. Croire le
  # code de sortie, c'est écrire une configuration pour une ruche morte.
  if ! node -e "require('better-sqlite3'); require('fastify')" 2>/dev/null; then
    echo ""
    echo "✘ Les dépendances sont installées mais la ruche ne peut pas démarrer."
    echo ""
    echo "  « better-sqlite3 » ou « fastify » ne se charge pas. Les deux sont"
    echo "  OPTIONNELLES : npm a pu les écarter — ou refuser leur script"
    echo "  d'installation — sans échouer pour autant."
    echo ""
    echo "  Une seule commande, et c'est la bonne dans tous les cas :"
    echo ""
    echo "    npm rebuild better-sqlite3"
    echo ""
    # UNE commande, parce qu'elle a suffi. Ce message en listait deux, dont
    # `npm approve-scripts --allow-scripts-pending` — qui ne fait que LISTER,
    # sans rien autoriser. La trace d'un utilisateur montre `npm rebuild
    # better-sqlite3` réussissant SEUL, verrou toujours en place : `rebuild`
    # compile au lieu d'attendre le script d'installation.
    #
    # Deux commandes, dont une qui ne fait rien, c'est deux occasions de croire
    # qu'on a essayé.
    echo "  Elle règle les deux causes qui donnent ce message : le verrou"
    echo "  « allow-scripts » de npm, qui a empêché la récupération du binaire, et"
    echo "  un Node qui a CHANGÉ depuis l'installation — le binaire reste alors"
    echo "  celui de l'ancienne ABI."
    echo ""
    echo "  « npm install » n'y suffirait PAS : il voit un paquet déjà présent à"
    echo "  la bonne version, ne touche à rien, et rend 0. Seul « rebuild » refait"
    echo "  le binaire."
    echo ""
    echo "  On s'arrête ICI plutôt que d'écrire une configuration pour une ruche"
    echo "  qui ne démarrera pas."
    echo ""
    exit 2
  fi

  ok "dépendances installées, et chargeables"
else
  alerte "--dry-run : npm install non lancé"
fi

# ─── 4. La main à l'installeur de Hive ──────────────────────────────────────
#
# C'est LUI qui pose les questions (≤ 3), engendre le jeton, écrit le `.env` en
# 600 et détecte l'agent. Le dupliquer ici ferait deux installeurs à maintenir,
# dont un non testé.

etape "Configuration"
# Pas de `dire ""` ici : une ligne vide entre la perle et son premier rameau
# ROMPRAIT le rail, qui n'a de sens que continu. C'était la seule rupture de
# la colonne, et elle se voyait à l'écran sans se voir dans le code.
if [ "$SEC" = 1 ]; then
  alerte "--dry-run : l'installeur n'est pas lancé."
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
    SUITE="cd $DOSSIER && npm run install:hive --$POUR_INSTALLEUR"
  else
    SUITE="cd $DOSSIER && npm run install:hive"
  fi

  # ─── LA CARTE DE FIN ────────────────────────────────────────────────────────
  #
  # Un `--dry-run` se termine sur ce que la personne doit RETENIR, pas sur la
  # dernière ligne de journal qui traîne. Le cadre est là pour ça : il sépare
  # le compte-rendu de la suite à donner.
  dire ""
  cadre "Rien n'a été écrit — pas même le dossier de destination."
  dire ""
  # LA COMMANDE VIT HORS DU CADRE, et c'est un choix : on la copie-colle. Une
  # bordure collée à gauche partirait avec elle.
  dire "  Sans --dry-run, la suite serait :"
  dire ""
  accent "    $SUITE"
  # ─── ET L'ÉCRAN, QUE CETTE CARTE TAISAIT ──────────────────────────────────
  #
  # L'installeur construit le tableau de bord depuis peu. Cette carte, elle, ne
  # nommait que la configuration : elle annonçait donc MOINS que ce que le vrai
  # passage allait faire.
  #
  # C'est mot pour mot la faute que le commentaire du dessus documente déjà à
  # propos du `--` manquant : une ligne qui dit « voilà ce qui va se passer »
  # doit dire vrai, sinon elle est pire que son absence.
  #
  # Elle a aussi une conséquence de couverture. La CI ne lance `install.sh`
  # qu'en `--dry-run`, et ce mode SORT ICI — l'étape 5 n'y est donc jamais
  # exécutée. Ce que la CI peut encore vérifier, c'est que la carte l'ANNONCE ;
  # c'est peu, et c'est mieux que rien du tout.
  accent "    npm run build:dashboard"
  dire ""
  exit 0
fi

# shellcheck disable=SC2086
npm run install:hive -- $POUR_INSTALLEUR

# ─── 5. L'écran ─────────────────────────────────────────────────────────────
#
# ─── CE QUE VOYAIT UN NOUVEL ARRIVANT AVANT CETTE ÉTAPE ─────────────────────
#
# L'installation réussissait, `hive doctor` ne reprochait plus qu'UNE chose —
# « tableau de bord non construit » —, et celui qui suivait la consigne
# (`npm run dev`, puis son navigateur) recevait ceci :
#
#     {"hive":"orchestrateur en ligne","hint":"Dashboard non construit : …"}
#
# Le premier contact avec le produit était donc un texte de débogage, sur une
# ruche dont toute la promesse est un tableau de bord de treize vues.
#
# ─── POURQUOI ON LE CONSTRUIT PLUTÔT QUE DE LE DIRE ─────────────────────────
#
# Parce que c'est GRATUIT : mesuré à 1 866 ms sur ce dépôt, contre ≈ 20 s pour
# le `npm install` qui vient de passer. Faire porter à l'utilisateur une
# commande de plus pour économiser deux secondes, c'est lui demander de payer
# notre confort en attention — et l'attention d'un nouvel arrivant est ce qu'on
# a de plus rare.
#
# ─── ET POURQUOI UN ÉCHEC ICI N'ARRÊTE RIEN ─────────────────────────────────
#
# La ruche TOURNE sans écran : orchestrateur, API, nœuds, tout fonctionne. Un
# `vite build` qui échoue (mémoire, plateforme exotique) ne doit donc pas
# transformer une installation réussie en installation ratée. On suspend
# `set -e` le temps de l'appel, on le dit, et on rend la main avec le geste.
etape "Construction de l'écran"
CODE_ECRAN=0
npm run build:dashboard >/dev/null 2>&1 || CODE_ECRAN=$?
if [ "$CODE_ECRAN" = 0 ]; then
  ok "tableau de bord prêt"
else
  alerte "l'écran n'a pas pu être construit — la ruche tourne quand même"
  dire ""
  dire "  Pour réessayer plus tard, sans rien réinstaller :"
  dire ""
  accent "    cd $DOSSIER && npm run build:dashboard"
  dire ""
fi
