# L'ATELIER — le bureau que l'ouvrière allume.
#
#   docker build -t hive-atelier:local docker/atelier
#
# ─── CE QU'IL Y A DEDANS, ET RIEN DE PLUS ────────────────────────────────────
#
# Un écran sans carte graphique (Xvfb), un gestionnaire de fenêtres minuscule
# (fluxbox), un navigateur (Chromium), et de quoi regarder l'écran depuis un
# navigateur (x11vnc + noVNC).
#
# Pas d'éditeur, pas de bureautique, pas de suite graphique. Chaque paquet en
# plus est une surface en plus, et l'agent n'a besoin que de voir son travail.
#
# ─── CE QU'IL N'Y A PAS, DÉLIBÉRÉMENT ────────────────────────────────────────
#
# · AUCUN mot de passe VNC. Ce n'est pas un oubli : le port ne quitte jamais
#   127.0.0.1 (voir `planAtelier`), et un mot de passe VNC dans une image
#   publique serait un secret partagé par tous ceux qui la construisent — donc
#   pas un secret. La borne est le réseau.
# · AUCUN identifiant. `envAtelier` est une liste d'AUTORISATION qui ne laisse
#   passer que TZ et LANG. Un navigateur est l'endroit le plus facile du monde
#   pour exfiltrer une clé.
# · Pas de `sudo`. L'utilisateur n'est pas root, et n'a pas de chemin pour le
#   devenir (`--cap-drop=ALL`, `no-new-privileges`).

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN=1440x900x24

# `--no-install-recommends` : sans lui, `chromium` tire une demi-session de
# bureau — gestionnaire de sons, thèmes, polices asiatiques. Trois cents Mo pour
# rien, et autant de code qui tourne sans raison.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11vnc fluxbox novnc websockify \
      chromium \
      ca-certificates fonts-dejavu-core \
      procps \
 && rm -rf /var/lib/apt/lists/*

# ─── UN UTILISATEUR SANS POUVOIR ─────────────────────────────────────────────
#
# Le démon Docker tourne en root sur la plupart des machines ; c'est écrit dans
# l'annonce du bac à sable et ça reste vrai. Ce qu'on peut faire, c'est que le
# PROCESSUS, lui, ne soit pas root — pour que ce qui s'échappe du navigateur ne
# tombe pas sur un compte tout-puissant.
RUN useradd --create-home --shell /usr/sbin/nologin ouvriere \
 && mkdir -p /travail && chown ouvriere:ouvriere /travail

COPY demarrer.sh /usr/local/bin/demarrer.sh
RUN chmod +x /usr/local/bin/demarrer.sh

USER ouvriere
WORKDIR /travail

# 6080 : noVNC. Publié sur 127.0.0.1 UNIQUEMENT par `planAtelier`. L'exposer ici
# ne l'ouvre pas — c'est le `--publish` qui décide.
EXPOSE 6080

# ─── UN SIGNAL D'ARRÊT QUI ARRIVE ────────────────────────────────────────────
#
# `demarrer.sh` est lancé par `exec` en PID 1 et relaie SIGTERM. Sans ça, un
# `docker stop` attendrait dix secondes puis tuerait — et un navigateur tué
# laisse un verrou de profil qui casse le démarrage suivant.
ENTRYPOINT ["/usr/local/bin/demarrer.sh"]
