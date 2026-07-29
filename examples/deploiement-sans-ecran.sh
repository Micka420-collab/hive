#!/usr/bin/env sh
#
# Déployer une ruche SANS ÉCRAN — l'exemple de bout en bout.
#
#   HIVE_TOKEN=… HIVE_JWT_SECRET=… sh examples/deploiement-sans-ecran.sh
#
# ─── CE QUE CE FICHIER DÉMONTRE, ET POURQUOI IL EXISTE ───────────────────────
#
# Le critère 9 du definition of done demande un déploiement sans écran :
# `--non-interactive`, les secrets par l'environnement, et des CODES DE SORTIE
# exploitables. Les trois existaient depuis longtemps ; ce qui manquait, c'est
# la démonstration qu'ils s'utilisent ENSEMBLE.
#
# Un fichier `examples/` n'est pas de la décoration : c'est la seule preuve
# qu'une interface est utilisable par quelqu'un d'autre que son auteur. Sans
# lui, « scriptable » est une affirmation.
#
# ─── CE QU'IL FAIT DE PARTICULIER ────────────────────────────────────────────
#
# Il TRAITE CHAQUE CODE SÉPARÉMENT. C'est tout l'intérêt, et c'est ce qu'on
# oublie : un script qui fait `|| exit 1` transforme sept situations distinctes
# en une seule, et la seule réponse qui reste est « relancer et espérer ».
#
#   · 4 (port occupé) se règle en changeant HIVE_PORT — ça n'a rien à voir
#     avec 2 (prérequis), qui demande d'installer Node.
#   · 3 (réponse manquante) veut dire qu'il manque une variable d'environnement,
#     pas que l'installation a échoué.
#   · 5 (refus de sécurité) ne se réessaie JAMAIS : réessayer un refus de
#     sécurité, c'est le contourner par la répétition.
#   · 130 est un ^C. Un script de supervision qui le confondrait avec un échec
#     réinstallerait ce que quelqu'un venait d'annuler à la main.
#
# ─── LES SECRETS PASSENT PAR L'ENVIRONNEMENT, JAMAIS EN ARGUMENT ─────────────
#
# `/proc/*/cmdline` est lisible par les autres processus de la machine, et
# l'historique du shell garde ce qu'on a tapé. Un jeton en argument est un
# jeton publié.

set -eu

# Le dossier de la ruche. Par défaut celui d'où l'on lance ce script.
RUCHE="${HIVE_DIR:-$(pwd)}"

dire() { printf '%s\n' "$*"; }

# ─── 1. Ce que le déploiement exige, vérifié AVANT d'écrire quoi que ce soit ──
#
# On échoue tôt, avec le code qui dit pourquoi. Découvrir l'absence d'un secret
# après avoir écrit la moitié d'une configuration ne rend service à personne.
manque=''
[ -n "${HIVE_TOKEN:-}" ] || manque="$manque HIVE_TOKEN"
[ -n "${HIVE_JWT_SECRET:-}" ] || manque="$manque HIVE_JWT_SECRET"
if [ -n "$manque" ]; then
  dire "✘ variable(s) d'environnement absente(s) :$manque"
  dire ""
  dire "  Un déploiement sans écran ne peut RIEN demander. Ces deux secrets"
  dire "  doivent venir de l'environnement — jamais de la ligne de commande,"
  dire "  que /proc et l'historique du shell rendent lisible."
  dire ""
  dire "    export HIVE_TOKEN=\"\$(openssl rand -hex 16)\""
  dire "    export HIVE_JWT_SECRET=\"\$(openssl rand -hex 32)\""
  # 3 : « réponse requise absente en mode non interactif ». C'est exactement
  # ce dont il s'agit — une réponse que personne ne pouvait donner.
  exit 3
fi

cd "$RUCHE"

# ─── 2. L'installation, muette et machine ────────────────────────────────────
#
# `--non-interactive` : aucune question, jamais. `--json` : une sortie qu'un
# `jq` lit sans filtre préalable.
#
# `set -e` est SUSPENDU le temps de cet appel (`|| code=$?`) : sans ça, le
# script mourrait sur le premier code non nul, et tout l'aiguillage ci-dessous
# — sa raison d'être — ne serait jamais atteint.
code=0
sortie=$(npm run install:hive -- --non-interactive --json 2>&1) || code=$?

# ─── 3. L'AIGUILLAGE — ce que le critère 9 demande vraiment ──────────────────
case "$code" in
  0)
    dire "✔ ruche configurée"
    # La sortie JSON dit ce qui a été fait : créé, complété, ou inchangé. On
    # la garde telle quelle pour l'appelant, qui la lira avec jq.
    printf '%s\n' "$sortie" | sed -n '/^{/,$p'
    ;;
  2)
    dire "✘ prérequis manquant (code 2)"
    dire "  Node est absent ou trop ancien. Installez-le, puis relancez."
    dire "  Ce code ne se résout PAS en réessayant."
    exit 2
    ;;
  3)
    dire "✘ réponse requise absente (code 3)"
    dire "  L'installeur avait besoin d'une valeur que l'environnement ne"
    dire "  fournit pas. Complétez-le — ne passez pas en interactif : un"
    dire "  déploiement qui demande quelque chose n'est plus un déploiement"
    dire "  sans écran."
    exit 3
    ;;
  4)
    dire "✘ port occupé (code 4)"
    dire "  Quelqu'un écoute déjà sur ce port. Choisissez-en un autre :"
    dire ""
    dire "    HIVE_PORT=7788 sh examples/deploiement-sans-ecran.sh"
    dire ""
    dire "  C'est le SEUL code qui se règle en changeant un réglage, et c'est"
    dire "  pour ça qu'il a le sien : un « erreur 1 » aurait laissé l'appelant"
    dire "  chercher une panne là où il n'y a qu'une collision."
    exit 4
    ;;
  5)
    dire "✘ refus de sécurité (code 5)"
    dire "  La configuration demandée a été REFUSÉE, pas ratée. Un jeton trop"
    dire "  faible, ou une écoute publique sans jeton solide."
    dire ""
    dire "  NE RÉESSAYEZ PAS : réessayer un refus de sécurité, c'est le"
    dire "  contourner par la répétition. Corrigez la cause."
    exit 5
    ;;
  130)
    # Un ^C n'est pas un échec, c'est une réponse. Un superviseur qui le
    # confondrait avec une panne réinstallerait ce qu'on vient d'annuler.
    dire "⏹ interrompu (code 130) — rien n'a été écrit."
    exit 130
    ;;
  *)
    dire "✘ échec non classé (code $code)"
    printf '%s\n' "$sortie"
    exit "$code"
    ;;
esac

# ─── 4. Ce qu'on VÉRIFIE avant de dire que c'est bon ─────────────────────────
#
# Un code 0 dit que l'installeur n'a pas échoué. Il ne dit pas que la ruche
# peut démarrer — c'est la leçon de l'image qui naissait morte : une dépendance
# optionnelle écartée en silence, un `npm ci` vert, et un service qui ne
# démarre jamais.
if ! node -e "require('better-sqlite3'); require('fastify')" 2>/dev/null; then
  dire ""
  dire "✘ la ruche est configurée mais ne peut pas démarrer (code 2)"
  dire "  « better-sqlite3 » ou « fastify » ne se charge pas. C'est le signe"
  dire "  d'une dépendance optionnelle écartée en silence à l'installation."
  dire ""
  dire "    npm install --no-fund --no-audit"
  exit 2
fi

[ -f .env ] || {
  dire "✘ .env absent après une installation réussie (code 1)"
  exit 1
}

dire ""
dire "✔ déploiement terminé — la ruche peut démarrer."
dire ""
dire "  Démarrer          :  npm run dev"
dire "  Construire l'écran :  npm run build:dashboard"
dire "  Diagnostiquer     :  npm run cli -- doctor"
