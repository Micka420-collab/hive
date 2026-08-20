#!/bin/sh
#
# Allumer l'écran, le gestionnaire de fenêtres, VNC, le navigateur (CDP),
# le démon d'outils, puis les crochets de réveil.
#
# L'ordre compte : Xvfb avant openbox, openbox avant Chromium. On ATTEND la
# socket X plutôt que de dormir une durée inventée.

set -eu

ECRAN="${SCREEN:-1440x900x24}"
AFFICHAGE="${DISPLAY:-:99}"

Xvfb "$AFFICHAGE" -screen 0 "$ECRAN" -nolisten tcp &
XVFB=$!

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

openbox >/dev/null 2>&1 &

# CDP : 0.0.0.0 DANS le conteneur (compose / le réseau Docker). Sur l'hôte,
# compose publie 127.0.0.1:9222 — jamais 0.0.0.0 public.
# `--no-sandbox` : Chromium veut ses namespaces, `--cap-drop=ALL` les refuse.
# Le conteneur EST le bac ; empiler les deux empêcherait le navigateur de naître.
chromium \
  --no-sandbox --disable-dev-shm-usage \
  --no-first-run --no-default-browser-check \
  --disable-features=Translate \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --window-position=0,0 \
  about:blank >/dev/null 2>&1 &

x11vnc -display "$AFFICHAGE" -forever -shared -nopw -quiet -localhost &

websockify --web=/usr/share/novnc 6080 localhost:5900 &
VUE=$!

node --experimental-strip-types /usr/local/lib/hive/outil.ts --serveur &
OUTIL=$!

# Crochets de réveil : uniquement /workspace/.wake-hooks, exécutables, uid hive.
UID_HIVE="$(id -u)"
for f in /workspace/.wake-hooks/*; do
  [ -e "$f" ] || continue
  [ -f "$f" ] || continue
  [ -x "$f" ] || continue
  [ "$(stat -c '%u' "$f" 2>/dev/null || stat -f '%u' "$f")" = "$UID_HIVE" ] || continue
  "$f" || true
done

arreter() {
  kill -TERM "$OUTIL" "$VUE" "$XVFB" 2>/dev/null || true
  exit 0
}
trap arreter TERM INT

echo "Atelier prêt — écran $ECRAN sur $AFFICHAGE, vue :6080, CDP :9222, outils :8765"
wait "$VUE"
