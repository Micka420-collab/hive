#!/usr/bin/env sh
#
# LE SEUIL, FRANCHI — l'installation en une commande, menée jusqu'à une ruche
# qui répond.
#
# ─── POURQUOI CE SCRIPT EXISTE ───────────────────────────────────────────────
#
# La CI exerçait `install.sh --dry-run`, et rien d'autre. Or le mode sec
# s'arrête AVANT `npm install` — donc avant tout ce qui peut réellement échouer
# chez un inconnu : la résolution des dépendances, le module natif SQLite, la
# construction du tableau de bord, la ruche qui démarre.
#
# Ce que le README promet en une ligne était donc exercé JUSQU'AU SEUIL, jamais
# franchi. Le critère 1 du definition of done (« une commande, ≤ 3 décisions,
# < 60 s ») avait été mesuré sur un dépôt DÉJÀ cloné — pas depuis la commande
# que lit un arrivant.
#
# Mesuré le 13 août depuis l'URL du README, sur Node 24 : code 0 en 27 s, `.env`
# en 0600, `/api/pulse` répond HTTP 200 en 7 ms, `hive doctor` dit « tout est en
# ordre ». Une mesure faite UNE FOIS n'est pas une garde : ce script la rejoue.
#
# ─── CE QU'IL AFFIRME, ET POURQUOI CHAQUE PAS COMPTE ─────────────────────────
#
#   1. l'installation sort en 0                — sinon rien d'autre n'a de sens
#   2. `.env` existe en 0600                   — un secret lisible par tous est
#                                                une fuite, pas un réglage
#   3. la ruche RÉPOND sur /api/pulse          — « installé » ne veut rien dire
#                                                si rien ne démarre
#   4. le TABLEAU est servi et charge          — « la ruche répond » n'est pas
#                                                « je peux m'en servir »
#   5. je CRÉE MON PREMIER PROJET, et le       — le premier geste réel d'un
#      tableau le voit                           arrivant, jamais mesuré avant
#   6. J'INVITE QUELQU'UN, et il ENTRE         — la commande d'entrée était
#                                                composée, gardée et affichée par
#                                                trois bancs ; aucun ne la collait
#
# ⚠ La numérotation est bancale et c'est ASSUMÉ : les pas de shell disent « /3 »
# parce qu'ils étaient trois avant que le parcours n'existe. Les renuméroter
# toucherait les deux jumeaux et leurs gardes pour ne rien mesurer de plus. Ce
# qui compte est qu'aucun pas ne manque, et c'est `installeurs-jumeaux` qui le
# tient — pas la beauté des étiquettes.
#
# Le troisième est le seul qui ne peut pas être simulé : il faut que le code
# tourne. C'est lui qui distingue « les fichiers sont là » de « ça marche ».
#
# ─── LES DEUX DERNIERS SONT NÉS D'UN AVEU ────────────────────────────────────
#
# Le point de sortie du 15 août classait en 3c, sans arrondir : « je n'ai PAS de
# mesure bout-en-bout j'installe → j'ouvre le tableau → je crée mon premier
# projet. Des morceaux sont éprouvés, le PARCOURS ne l'est pas. »
#
# Ils sont en Node (`scripts/essai-parcours.mjs`) et PARTAGÉS avec l'essai
# Windows : les réécrire dans les deux langages aurait refabriqué la divergence
# que `tests/installeurs-jumeaux.test.ts` avait trouvée entre les installeurs.
#
# ─── USAGE ───────────────────────────────────────────────────────────────────
#
#   sh scripts/essai-installation.sh [--depot CHEMIN_OU_URL] [--ref BRANCHE]
#
# Sans `--depot`, il tire du GitHub public — c'est le chemin exact de l'arrivant.
# Avec, il éprouve L'ARBRE QU'ON VIENT D'ÉCRIRE : sans cela la CI ne vérifierait
# que du code déjà fusionné, et dirait « l'installation marche » d'une version
# qui n'est pas celle qu'on livre.

set -eu

# ─── OÙ EST L'INSTRUMENT DU PARCOURS ─────────────────────────────────────────
#
# À CÔTÉ DE CE SCRIPT, et c'est un défaut mesuré qui l'a décidé. Première
# version : `$(dirname $0)/..`, en supposant que l'essai tourne depuis le dépôt.
# `tests/essai-installation.test.ts` COPIE le script dans un dossier temporaire
# pour l'éprouver — la remontée d'un cran y désigne `/tmp`, l'instrument est
# introuvable, et l'essai sortait en 1 sur un chantier parfaitement sain.
#
# Chercher à côté de soi vaut dans les deux mondes, et c'est déjà ce que fait le
# jumeau PowerShell (`Join-Path $PSScriptRoot`). `CDPATH=` désarme un `cd` qui
# partirait ailleurs parce que l'utilisateur a un CDPATH.
MES_SCRIPTS=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

DEPOT_ESSAI=""
REF_ESSAI="main"

# ─── LE PORT, ET CE QU'ON A APPRIS EN VOULANT L'IMPOSER ──────────────────────
#
# Première version : on tirait un port libre et on le passait par `HIVE_PORT`.
# Ça ne marche pas, et la raison est un CHOIX du produit, pas un défaut :
# l'installeur ne lit que le `.env` EXISTANT (`garde()`), jamais
# l'environnement — c'est ce qui rend un réinstall idempotent.
#
# On subit donc le port par défaut. Un autre service qui le tient rendrait
# PORT_OCCUPE (4), et l'essai rougirait pour une raison étrangère à ce qu'il
# mesure. Ce cas a donc son PROPRE code de sortie : « je n'ai pas pu conclure »
# n'est pas « le produit est cassé », et les confondre apprend à ne plus lire
# les rouges.
CODE_INCONCLUANT=78
while [ $# -gt 0 ]; do
  case "$1" in
    --depot) DEPOT_ESSAI="$2"; shift 2 ;;
    --ref) REF_ESSAI="$2"; shift 2 ;;
    *) echo "argument inconnu : $1" >&2; exit 64 ;;
  esac
done

# Un dossier à nous, effacé quoi qu'il arrive — y compris si un pas échoue.
CIBLE="${TMPDIR:-/tmp}/hive-essai-installation-$$"
RUCHE_PID=""

# ─── LE MÉNAGE VISE LE DOSSIER, PAS LE PÈRE NI LE GROUPE ─────────────────────
#
# Deux versions ont été écrites, essayées, et MESURÉES FAUSSES. Elles sont
# gardées ici parce qu'elles sont l'une et l'autre plausibles à la lecture :
#
#   1. `kill "$RUCHE_PID"` — un signal au père ne descend pas (§ 9 quadragies).
#      `npm run ruche` lance `node scripts/ruche.mjs`, qui lance tsx, qui lance
#      esbuild ; tuer le premier laisse les autres tenir le port. Une ruche a
#      ainsi survécu et fait rougir `installeur-porte.test.ts` — un banc qui a
#      besoin de POUVOIR occuper 7777 pour simuler l'occupation.
#
#   2. `setsid …` puis `kill -- -$!` — élégant sur le papier : le lanceur
#      devient chef de session, son PID EST l'identifiant du groupe. Sans effet
#      en pratique ; mesuré, le port était encore tenu vingt secondes après.
#
# On vise donc ce qu'on connaît AVEC CERTITUDE : tout ce qui travaille dans
# notre dossier d'essai nous appartient. Le `cwd` d'un processus ne ment pas,
# et il survit aux ré-exec successifs de npm → node → tsx.
#
# Enfin on ATTEND que le port soit rendu. Sans cette attente, une fuite reste
# muette et empoisonne la course suivante : c'est exactement le piège dans
# lequel les deux versions précédentes sont tombées.
#
# ─── ET CE QU'IL NE PEUT PAS FAIRE AILLEURS QUE SOUS LINUX ───────────────────
#
# La reconnaissance par `cwd` passe par `/proc`, qui n'existe pas sous macOS.
# La garde `[ -d /proc ]` était donc un SAUT SILENCIEUX : sur un système sans
# `/proc`, la fonction s'appelait « ménage » et ne rangeait rien, sans le dire.
#
# Tant que ce script ne tournait que sur `ubuntu-latest`, la branche morte ne
# coûtait rien. Elle cesse de l'être le jour où le travail `seuil` s'étend à
# macOS — et une garde qui devient fausse en changeant de plateforme doit se
# DIRE, pas se taire : c'est la seule façon qu'un rouge de macOS soit lisible.
menage() {
  [ -n "$RUCHE_PID" ] && kill "$RUCHE_PID" 2>/dev/null
  if [ -d /proc ]; then
    for entree in /proc/[0-9]*; do
      p=${entree#/proc/}
      # loupe : équivalent — || → &&
      # Mesuré dans CE contexte — un `[ … ]`, pas une affectation : sous
      # `set -eu`, `cmd || true` et `cmd && true` rendent la même chaîne vide
      # et le script survit aux deux. (L'affectation d'une commande SIMPLE,
      # elle, TUE le script en `&&` — mais cette forme-là n'existe pas ici.
      # C'est la mesure qui l'a dit ; ma lecture disait le contraire.)
      [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$CIBLE" ] &&
        kill -9 "$p" 2>/dev/null
    done
  elif [ -n "${PORT:-}" ] && command -v lsof >/dev/null 2>&1; then
    # ─── LE MÊME CRITÈRE, PAR UN AUTRE CHEMIN ────────────────────────────────
    #
    # On ne relâche PAS la règle : on ne tue que ce qui travaille dans NOTRE
    # dossier. `lsof -ti` dit qui tient le port ; `lsof -d cwd` dit d'où. Sans
    # cette seconde question, on tuerait la ruche personnelle d'un développeur
    # qui aurait par hasard le même port — un script d'essai qui abat le
    # serveur de son hôte est pire que le désordre qu'il vient ranger.
    #
    # Le chemin physique compte autant que le logique : sous macOS, `$TMPDIR`
    # vit sous `/var/folders/…`, et `/var` est un lien vers `/private/var`.
    # `lsof` rend le chemin RÉSOLU ; comparer à la seule forme logique ne
    # reconnaîtrait jamais rien, et le ménage échouerait en silence — c'est-à-
    # dire exactement le défaut qu'on est en train de corriger.
    CIBLE_REEL=$(cd "$CIBLE" 2>/dev/null && pwd -P || echo "$CIBLE")
    for p in $(lsof -ti "tcp:$PORT" 2>/dev/null || true); do
      ou=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
      case "$ou" in
        "$CIBLE" | "$CIBLE"/* | "$CIBLE_REEL" | "$CIBLE_REEL"/*)
          kill -9 "$p" 2>/dev/null
          ;;
      esac
    done
  else
    # Ni l'un ni l'autre : on le DIT. Un ménage qui ne peut pas ranger et se
    # tait laisse croire que la place est rendue.
    echo "  ⚠ ni /proc ni lsof : le ménage ne peut viser aucun processus" >&2
  fi
  if [ -n "${PORT:-}" ]; then
    attente=0
    while [ "$attente" -lt 15 ]; do
      # Sans `-f` : on demande « quelqu'un décroche-t-il ? », pas « répond-il
      # bien ? ». Un 401 sans jeton prouve que le port est TENU ; le prendre
      # pour un échec ferait sortir de la boucle en croyant la place libre.
      # PAS équivalent, et PAS défendu.
      # `|| break` sort quand curl ÉCHOUE, c'est-à-dire quand le port est enfin
      # LIBRE : la boucle attend tant que la ruche répond encore. Muté en `&&`,
      # elle sort dès qu'elle répond et attend quinze secondes quand le port est
      # déjà libre — l'inverse exact, et silencieux.
      # L'entrée qui tranche : un port encore tenu APRÈS le ménage. La produire
      # demande de garder un processus vivant au bon moment ; le banc ne sait pas
      # encore le faire, et je préfère le dire que le couvrir d'un test qui simule.
      curl -sS -o /dev/null -m 1 "http://127.0.0.1:$PORT/api/pulse" 2>/dev/null || break
      attente=$((attente + 1))
      sleep 1
    done
    [ "$attente" -ge 15 ] &&
      echo "⚠ le port $PORT est encore tenu après le ménage" >&2
  fi
  rm -rf "$CIBLE" 2>/dev/null
  return 0
}
trap menage EXIT INT TERM


echo "→ installation réelle dans $CIBLE"
# PAS équivalent, et PAS défendu — il faut le dire dans cet ordre.
# Muté en `||`, la ligne DISPARAÎT quand un dépôt est donné et s'affiche vide
# quand il ne l'est pas : exactement à l'envers. La CI passe toujours
# `--depot`, donc le journal perdrait la seule trace de CE QUI a été installé.
# L'entrée qui tranche est simple — lancer avec puis sans `--depot`. Ce qui ne
# l'est pas, c'est le prix : chaque cas est une installation complète.
# Mesuré au passage, parce que la lecture faisait peur : sous `set -eu`, une
# liste `&&` dont le test échoue ne tue PAS le script. Le chemin sans dépôt
# est sain.
[ -n "$DEPOT_ESSAI" ] && echo "  depuis : $DEPOT_ESSAI ($REF_ESSAI)"

DEBUT=$(date +%s)
CODE_INSTALL=0
set +e
if [ -n "$DEPOT_ESSAI" ]; then
  HIVE_DEPOT="$DEPOT_ESSAI" sh install.sh --dir="$CIBLE" --ref="$REF_ESSAI" --non-interactive
else
  sh install.sh --dir="$CIBLE" --ref="$REF_ESSAI" --non-interactive
fi
CODE_INSTALL=$?
set -e
DUREE=$(( $(date +%s) - DEBUT ))

# 4 = PORT_OCCUPE. La machine d'essai a un service sur le port par défaut :
# l'installation n'a rien à se reprocher, et l'essai n'a rien pu conclure.
if [ "$CODE_INSTALL" = 4 ]; then
  echo "⊘ le port par défaut est tenu par un autre service — essai NON CONCLUANT" >&2
  exit "$CODE_INCONCLUANT"
fi
[ "$CODE_INSTALL" = 0 ] || { echo "✘ installation sortie en $CODE_INSTALL" >&2; exit 1; }
echo "✔ 1/3 — installation sortie en 0, $DUREE s"

# ─── 2. Le secret n'est lisible que par son propriétaire ────────────────────
[ -f "$CIBLE/.env" ] || { echo "✘ .env absent" >&2; exit 1; }
PERMS=$(ls -l "$CIBLE/.env" | cut -c1-10)
case "$PERMS" in
  -rw-------) echo "✔ 2/3 — .env en $PERMS" ;;
  *) echo "✘ .env en $PERMS — un secret doit être en 0600" >&2; exit 1 ;;
esac

# ─── 3. La ruche répond ─────────────────────────────────────────────────────
#
# Le port est tiré du `.env` écrit par l'installeur, jamais supposé : c'est LUI
# qui décide, et le supposer ferait passer un test sur une ruche qu'on n'a pas
# installée.
# loupe : équivalent — || → &&
# Le statut d'un pipeline est celui de son DERNIER maillon, et `cut` réussit
# même sans entrée (`pipefail` n'est pas armé). Mesuré `.env` absent : les deux
# formes rendent PORT vide et survivent. Le `|| true` est une ceinture, pas une
# garde — on la garde, elle ne coûte rien.
PORT=$(grep -m1 '^HIVE_PORT=' "$CIBLE/.env" | cut -d= -f2 || true)
[ -n "$PORT" ] || { echo "✘ .env sans HIVE_PORT" >&2; exit 1; }
JETON=$(grep -m1 '^HIVE_TOKEN=' "$CIBLE/.env" | cut -d= -f2)

# `RUCHE_PID` ne désigne qu'un sous-shell : ses petits-enfants — node, tsx,
# esbuild — lui survivent. On le garde pour la politesse d'un TERM propre, mais
# ce n'est pas lui qui garantit la place rendue : c'est `menage` (voir plus
# haut), qui vise le dossier et attend le port.
# ─── L'AGENT SIMULÉ EST FORCÉ, ET C'EST UNE DÉCISION ────────────────────────
#
# `HIVE_AGENT=shell` impose l'adaptateur simulé au lieu de laisser l'ouvrière
# détecter ce qui traîne sur la machine. Trois raisons, dans cet ordre :
#
#   1. UN RUNNER N'EST PAS UN POSTE. Sans cette ligne, l'ouvrière prend le
#      premier agent trouvé — Claude Code sur un runner qui l'a — et le fait
#      tourner dans un bac à sable. Les runners macOS et Windows n'ont PAS de
#      démon Docker : la tâche échouerait, non par défaut du produit mais par
#      absence d'un service que la jambe ne prétend pas mesurer.
#   2. LE PAS 7/7 MESURE LA CHAÎNE, pas la qualité d'un modèle — il le dit
#      lui-même. Création, assignation, exécution, rangement, relecture :
#      l'adaptateur simulé les traverse toutes, sans lancer un processus.
#   3. C'EST CE QU'UN ARRIVANT OBTIENT SANS CLÉ D'API. Mesurer ce chemin-là
#      n'est pas un repli, c'est le cas le plus fréquent.
#
# La disponibilité du bac à sable, elle, est le sujet de `hive doctor` — et
# elle y est mesurée depuis qu'un ✔ posé sur un CLIENT plutôt qu'un SERVICE a
# été trouvé (§ 9 novemtrigicenties).
sh -c "cd '$CIBLE' && HIVE_AGENT=shell npm run ruche >'$CIBLE/ruche.log' 2>&1" &
RUCHE_PID=$!

# On attend qu'elle réponde, on ne dort pas un temps fixe : une attente en dur
# est un pari sur la vitesse de la machine (§ 9 octoquadragies du carnet).
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS -m 2 -H "x-hive-token: $JETON" \
       "http://127.0.0.1:$PORT/api/pulse" >/dev/null 2>&1; then
    echo "✔ 3/3 — la ruche répond sur :$PORT après ${i}s"
    # ─── ET MAINTENANT LE PARCOURS ────────────────────────────────────────
    #
    # « La ruche répond » n'est pas « je peux m'en servir ». Les deux pas
    # suivants — j'ouvre le tableau, je crée mon premier projet — sont en Node
    # et PARTAGÉS avec l'essai Windows : les réécrire dans les deux langages
    # aurait refabriqué la divergence que `installeurs-jumeaux` a trouvée.
    #
    # La racine est passée en argument ; le JETON, jamais. Il est relu là-bas
    # dans le `.env` que l'installeur vient d'écrire.
    node "$MES_SCRIPTS/essai-parcours.mjs" --racine "$CIBLE" || exit 1
    # ─── ET LE GESTE D'APRÈS : J'INVITE QUELQU'UN ────────────────────────
    #
    # Le sixième pas fabrique un poste d'invité à côté, y colle la commande
    # d'entrée que la ruche vient de composer, et attend que l'invité
    # apparaisse. C'était le dernier morceau du parcours à n'être mesuré
    # nulle part — la forme exacte du trou qu'était le pas 4/5.
    #
    # Le dossier d'invité vit à CÔTÉ de la cible, pas dedans : le ménage de
    # ce script vise `$CIBLE`, et un poste d'invité sous elle serait effacé
    # au milieu de l'essai. C'est l'instrument qui range le sien.
    node "$MES_SCRIPTS/essai-entree.mjs" --racine "$CIBLE" --invite "$CIBLE-invite" || exit 1
    # ─── ET LE SEUL GESTE QUI PROUVE LE PRODUIT ──────────────────────────
    #
    # Les six pas précédents mènent l'arrivant jusqu'à « j'ai installé,
    # j'ouvre le tableau, je crée un projet, j'invite quelqu'un ». Aucun ne
    # menait un travail jusqu'à un RÉSULTAT — c'est-à-dire juste avant la
    # seule chose que Hive promet. Un arrivant y est à sa troisième minute.
    node "$MES_SCRIPTS/essai-travail.mjs" --racine "$CIBLE" || exit 1
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "✘ la ruche n'a pas répondu sur :$PORT en 60 s" >&2
echo "--- son journal ---" >&2
# loupe : équivalent — || → &&
# Instruction seule : mesuré fichier absent, `set -e` ne se déclenche PAS sur
# une liste `&&` dont le côté gauche échoue. Les deux formes survivent.
tail -30 "$CIBLE/ruche.log" >&2 2>/dev/null || true
exit 1
