#!/usr/bin/env sh
#
# REJOINDRE UNE RUCHE — en UNE commande, sur un poste qui n'a rien.
#
#   curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/rejoindre.sh | sh -s -- hive2_…
#
# ─── LE DÉFAUT QUE CE SCRIPT RETIRE ──────────────────────────────────────────
#
# La ruche remettait `npm run join -- hive2_…`, et le panneau d'invitation le
# disait franchement : « il colle cette commande DANS LE DOSSIER ». Le dossier.
# Celui qu'un invité n'a pas, puisqu'il n'a rien installé.
#
# Le parcours réel était donc :
#
#     1.  curl -fsSL …/install.sh | sh          ← ne sait rien du billet
#     2.  cd ~/hive && npm run join -- hive2_…  ← suppose le pas 1 réussi
#
# Deux commandes, deux endroits, et un `cd` implicite dont personne ne parle.
# Celui qui invite devait expliquer tout ça de vive voix — et c'est exactement
# ce qui fait qu'on n'invite personne.
#
# ─── CE QU'IL FAIT, ET DANS CET ORDRE ────────────────────────────────────────
#
#   1. si Hive est déjà là, on ne réinstalle RIEN — on rejoint, c'est tout ;
#   2. sinon on installe, par le MÊME `install.sh` que le README annonce ;
#   3. puis on rejoint avec le billet.
#
# Le pas 1 compte : quelqu'un qui a déjà une ruche et rejoint celle d'un ami ne
# doit pas voir son installation refaite sous lui.
#
# ─── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
#
#   · aucune élévation de privilèges, rien hors du dossier d'installation ;
#   · il n'installe pas Node à votre place — `install.sh` s'en charge de le
#     DIRE, et s'arrête si la version ne convient pas ;
#   · il n'écrit jamais le billet sur le disque.
#
# ─── LE BILLET EST UN SECRET, ET IL PASSE EN ARGUMENT ────────────────────────
#
# C'est assumé, et c'est le compromis de toutes les commandes d'adhésion de ce
# genre. Ce qu'on peut en dire honnêtement :
#
#   · il n'est exposé QUE sur le poste de l'invité — sa table des processus,
#     son historique de shell. Pas sur le réseau, pas chez l'hôte ;
#   · un billet est COMPTÉ et RÉVOCABLE : il ouvre N entrées, pas un accès
#     permanent, et l'hôte peut le tuer d'un geste ;
#   · il est échangé contre une clé propre au nœud dès la première connexion,
#     après quoi le billet ne sert plus à rien.
#
# Ce qui reste vrai malgré tout : quelqu'un qui lit l'historique du shell de
# l'invité, AVANT que le billet ne soit consommé, peut entrer à sa place. Un
# billet à un seul usage referme cette fenêtre dès la première connexion.

set -eu

BILLET="${1:-}"
if [ -z "$BILLET" ]; then
  echo "Usage : curl -fsSL .../rejoindre.sh | sh -s -- <billet>" >&2
  echo "" >&2
  echo "Le billet vous est remis par la personne qui vous invite." >&2
  exit 64
fi

# ─── LE BILLET EST VALIDÉ AVANT DE TOUCHER À QUOI QUE CE SOIT ────────────────
#
# Un billet est `hive2_` suivi de base64url — un alphabet sans aucun caractère
# actif en shell. On refuse tout le reste PLUTÔT que d'échapper : ce script
# passe le billet à `npm run join --`, et une chaîne bien tordue y deviendrait
# autre chose qu'un argument.
#
# La même règle vit dans `src/shared/commande-entree.ts`, qui compose la
# commande côté ruche. Deux endroits, une seule règle — et un banc qui l'éprouve
# sur des billets empoisonnés.
if ! printf '%s' "$BILLET" | grep -Eq '^hive2_[A-Za-z0-9_-]+$'; then
  echo "✘ Ce billet n'a pas la forme attendue (hive2_…)." >&2
  echo "  Redemandez-en un à la personne qui vous invite." >&2
  exit 64
fi

DOSSIER="${HIVE_DIR:-$HOME/hive}"
DEPOT_BRUT="${HIVE_DEPOT_BRUT:-https://raw.githubusercontent.com/Micka420-collab/hive/main}"

# ─── 1. HIVE EST-IL DÉJÀ LÀ ? ────────────────────────────────────────────────
#
# On reconnaît une installation à son `package.json` ET à son dossier
# `node_modules` : un clone sans dépendances ne sait pas rejoindre, et le
# réinstaller est justement ce qu'il faut faire.
if [ -f "$DOSSIER/package.json" ] && [ -d "$DOSSIER/node_modules" ]; then
  echo "→ Hive est déjà installé dans $DOSSIER — on rejoint directement."
else
  echo "→ Installation de Hive dans $DOSSIER…"
  # Le MÊME installeur que le README annonce. En reprendre une copie ici
  # fabriquerait un second installeur à maintenir, dont un jamais éprouvé —
  # c'est la leçon des installeurs jumeaux, déjà payée trois fois.
  HIVE_DIR="$DOSSIER" sh -c "$(curl -fsSL "$DEPOT_BRUT/install.sh")" -- --non-interactive
fi

# ─── 2. REJOINDRE ────────────────────────────────────────────────────────────
#
# `npm run join` lit l'adresse DANS le billet : rien d'autre à demander, rien à
# configurer. L'agent de codage de l'invité est détecté tout seul.
echo ""
echo "→ Entrée dans la ruche…"
cd "$DOSSIER"
exec npm run join -- "$BILLET"
