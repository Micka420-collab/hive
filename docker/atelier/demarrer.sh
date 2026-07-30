#!/bin/sh
#
# Allumer l'écran, le gestionnaire de fenêtres, le navigateur, et la vue.
#
# ─── L'ORDRE COMPTE, ET C'EST TOUT CE QU'IL Y A À SAVOIR ─────────────────────
#
# Xvfb doit répondre AVANT que fluxbox n'essaie de s'y connecter, et fluxbox
# avant Chromium — sinon les fenêtres n'ont pas de décoration et le navigateur
# s'ouvre en dehors de l'écran. On ATTEND que l'écran existe au lieu de dormir
# une durée choisie au hasard : un `sleep 2` marche sur la machine de celui qui
# l'écrit et échoue sur une machine chargée.

set -eu

ECRAN="${SCREEN:-1440x900x24}"
AFFICHAGE="${DISPLAY:-:99}"

Xvfb "$AFFICHAGE" -screen 0 "$ECRAN" -nolisten tcp &
XVFB=$!

# Attendre l'écran, avec une borne. `xdpyinfo` n'est pas installé — on regarde
# la socket, qui est ce que X crée en dernier quand il est prêt.
SOCKET="/tmp/.X11-unix/X$(printf '%s' "$AFFICHAGE" | tr -d ':')"
i=0
while [ ! -e "$SOCKET" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then
    echo "✘ l'écran ne s'est pas ouvert en 10 s — l'atelier s'arrête." >&2
    exit 1
  fi
  sleep 0.1
done

fluxbox >/dev/null 2>&1 &

# `--no-sandbox` : Chromium veut ses propres namespaces, que `--cap-drop=ALL`
# lui refuse. C'est le conteneur QUI EST le bac à sable ici — empiler les deux
# donnerait un navigateur qui ne démarre pas, et le désactiver n'ouvre rien de
# plus que ce que le conteneur borne déjà.
chromium \
  --no-sandbox --disable-dev-shm-usage \
  --no-first-run --no-default-browser-check \
  --disable-features=Translate \
  --window-position=0,0 \
  about:blank >/dev/null 2>&1 &

# `-shared` : plusieurs spectateurs à la fois. `-forever` : le bureau survit à
# la fermeture d'un onglet. Aucun mot de passe — la borne est le réseau, pas un
# secret partagé par tous ceux qui construisent l'image.
x11vnc -display "$AFFICHAGE" -forever -shared -nopw -quiet -localhost &

websockify --web=/usr/share/novnc 6080 localhost:5900 &
VUE=$!

# Relayer l'arrêt : `docker stop` envoie SIGTERM à PID 1, et sans ce piège les
# enfants seraient tués dix secondes plus tard, laissant un verrou de profil
# Chromium qui casse le démarrage suivant.
arreter() {
  kill -TERM "$VUE" "$XVFB" 2>/dev/null || true
  exit 0
}
trap arreter TERM INT

echo "🖥  Atelier prêt — écran $ECRAN sur $AFFICHAGE, vue sur :6080"
wait "$VUE"
