#!/usr/bin/env sh
#
# FUSIONNER — porter une branche sur `main` SANS fabriquer de commit de fusion.
#
#   sh scripts/fusionner.sh [--essai]
#
# ─── LE DÉFAUT QUE CE SCRIPT RETIRE ──────────────────────────────────────────
#
# Fusionner par l'API GitHub fait fabriquer le commit de fusion PAR GITHUB. Son
# committer est alors `noreply@github.com`, quelle que soit l'identité de celui
# qui a écrit le code. Résultat : un historique dont chaque fusion est signalée
# « Unverified », et un rappel de contrôle qui se déclenche à chaque livraison
# sur un commit que personne n'a écrit.
#
# Les huit dernières fusions du dépôt (#80 à #87) sont toutes dans ce cas.
#
# ─── CE QU'ON FAIT À LA PLACE ────────────────────────────────────────────────
#
# Une AVANCE RAPIDE. Quand la branche descend directement de `main`, porter
# `main` sur elle ne demande aucun commit : la référence se déplace, et les
# commits qui arrivent sont exactement ceux qu'on a écrits et relus.
#
#     Pas de commit de fusion  ⇒  aucun committer à corriger.
#
# Ce n'est pas un contournement du rappel de contrôle : c'est un historique
# LINÉAIRE, où chaque commit sur `main` a un auteur réel et un contenu revu.
#
# ─── CE QUE CE SCRIPT REFUSE DE FAIRE ────────────────────────────────────────
#
# Il ne force RIEN. S'il ne peut pas avancer proprement, il s'arrête et dit
# quoi faire :
#
#   · `main` a bougé depuis la branche → il faut REBASER, et c'est un geste qui
#     réécrit : on ne le fait pas dans le dos de celui qui lance le script ;
#   · un commit porte un committer inattendu → on le NOMME plutôt que de le
#     laisser filer, puisque c'est précisément ce qu'on cherche à éviter ;
#   · l'arbre de travail est sale → on ne pousse pas un état qu'on n'a pas vu.
#
# `--essai` montre ce qui serait fait, et ne pousse pas.

set -eu

ESSAI=0
[ "${1:-}" = "--essai" ] && ESSAI=1

BRANCHE=$(git rev-parse --abbrev-ref HEAD)
BASE="${FUSION_BASE:-main}"
ATTENDU="${FUSION_COMMITTER:-noreply@anthropic.com}"

dire() { printf '%s\n' "$*"; }

if [ "$BRANCHE" = "$BASE" ]; then
  dire "✘ On est déjà sur « $BASE » — il n'y a rien à y porter."
  exit 1
fi

# ─── 1. Un arbre sale ne se pousse pas ───────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  dire "✘ Arbre de travail sale. Commitez ou remisez d'abord :"
  git status --short
  exit 1
fi

git fetch origin "$BASE" >/dev/null 2>&1 || {
  dire "✘ Impossible de récupérer « origin/$BASE »."
  exit 1
}

# ─── 2. L'avance rapide est-elle possible ? ──────────────────────────────────
#
# `merge-base --is-ancestor` répond exactement à la question : est-ce que
# `origin/main` est un ancêtre de la branche ? Si oui, avancer `main` ne perd
# rien et n'invente rien.
if ! git merge-base --is-ancestor "origin/$BASE" HEAD; then
  dire "✘ « origin/$BASE » n'est pas un ancêtre de « $BRANCHE » : l'avance rapide"
  dire "  perdrait des commits, ou en fabriquerait un de fusion."
  dire ""
  dire "  « $BASE » a bougé. Rebasez d'abord — c'est un geste qui RÉÉCRIT, donc"
  dire "  il vous revient :"
  dire ""
  dire "    git rebase origin/$BASE"
  dire ""
  dire "  puis relancez ce script."
  exit 2
fi

NOUVEAUX=$(git rev-list --count "origin/$BASE..HEAD")
if [ "$NOUVEAUX" -eq 0 ]; then
  dire "✔ « $BASE » est déjà à jour — rien à porter."
  exit 0
fi

# ─── 3. Chaque commit qu'on porte doit être attribuable ───────────────────────
#
# C'est le point de tout l'exercice. Un commit dont le committer n'est pas celui
# qu'on attend arrive « Unverified », et le signaler APRÈS l'avoir poussé ne sert
# plus à rien — l'historique publié ne se corrige qu'en le réécrivant.
INTRUS=$(git log --format='%h %ce' "origin/$BASE..HEAD" | grep -v " $ATTENDU\$" || true)
if [ -n "$INTRUS" ]; then
  dire "✘ Commit(s) dont le committer n'est pas « $ATTENDU » :"
  printf '%s\n' "$INTRUS"
  dire ""
  dire "  Corrigez AVANT de porter — un historique publié ne se corrige qu'en"
  dire "  le réécrivant, ce qui est bien plus cher :"
  dire ""
  dire "    git config user.email $ATTENDU && git config user.name Claude"
  dire "    git rebase --exec 'git commit --amend --no-edit --reset-author' origin/$BASE"
  exit 3
fi

dire "→ $NOUVEAUX commit(s) à porter sur « $BASE », en avance rapide :"
git log --format='   %h %s' "origin/$BASE..HEAD"
dire ""

if [ "$ESSAI" -eq 1 ]; then
  dire "⏸ --essai : rien n'a été poussé."
  dire "   La commande qui le ferait : git push origin HEAD:$BASE"
  exit 0
fi

# ─── 4. Porter ────────────────────────────────────────────────────────────────
#
# `HEAD:main` pousse le contenu de la branche SUR main sans passer par une
# fusion locale. Pas de `--force` : si quelqu'un a poussé entre-temps, git
# refuse, et c'est le comportement qu'on veut.
git push origin "HEAD:$BASE"

dire ""
dire "✔ « $BASE » porté sur $BRANCHE — sans commit de fusion."
dire ""
dire "  La PR se ferme d'elle-même : GitHub la marque « Merged » dès que sa"
dire "  tête est atteignable depuis « $BASE »."
