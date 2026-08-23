#!/usr/bin/env sh
#
# POSER LA RUCHE SUR UN SERVEUR — Ubuntu / Debian, à lancer DANS la machine.
#
#   curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/scripts/poser-la-ruche.sh | sudo sh
#
# Il installe Node, récupère Hive, engendre les secrets SUR PLACE, pose un
# service qui redémarre avec la machine, et dit ce qu'il a fait.
#
# ─── LES SECRETS NAISSENT ICI, ET NULLE PART AILLEURS ────────────────────────
#
# `HIVE_TOKEN` et `HIVE_JWT_SECRET` sont tirés d'`openssl rand` sur CETTE
# machine, écrits dans un `.env` en 0600, et jamais transmis à quiconque. Ils
# ne passent en argument d'aucune commande — un argument se lit dans `ps`, par
# n'importe quel utilisateur de la machine. Ils passent par le fichier.
#
# ─── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
#
# · Il n'expose RIEN sur l'Internet. Le port n'est ouvert qu'au réseau local.
#   Pour recruter au-delà, la ruche a ses propres portes — billet révocable
#   (`npm run cli -- invite`) ou tunnel — qui ne demandent pas d'ouvrir un port
#   sur votre box.
# · Il ne touche pas au pare-feu si `ufw` est inactif : activer un pare-feu sur
#   une machine qu'on administre à distance est le geste qui coupe la branche.

set -eu

DEPOT="${HIVE_DEPOT:-https://github.com/Micka420-collab/hive.git}"
RACINE="${HIVE_RACINE:-/opt/hive}"
UTIL="${HIVE_UTILISATEUR:-hive}"
PORT="${HIVE_PORT:-7777}"
RESEAU_LOCAL="${HIVE_RESEAU:-192.168.0.0/16}"

dire() { printf '%s\n' "$*"; }
mourir() { printf '✘ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || mourir "à lancer en root (sudo) — il pose un service système."
command -v apt-get >/dev/null 2>&1 || mourir "ce script vise Debian/Ubuntu (apt-get introuvable)."

dire "→ 1/6  Paquets de base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates openssl build-essential python3 >/dev/null

dire "→ 2/6  Node 24"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
dire "     $(node --version)"

dire "→ 3/6  Compte de service « $UTIL » (sans mot de passe, sans shell de connexion)"
# Un compte dédié, sans mot de passe et sans shell : la ruche lance des agents,
# et un agent qui déraille ne doit pas hériter des droits d'un humain.
id -u "$UTIL" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$UTIL" --shell /usr/sbin/nologin "$UTIL"

dire "→ 4/6  Hive dans $RACINE"
if [ -d "$RACINE/.git" ]; then
  git -C "$RACINE" fetch --quiet origin main && git -C "$RACINE" reset --quiet --hard origin/main
else
  rm -rf "$RACINE"
  git clone --quiet --depth 1 "$DEPOT" "$RACINE"
fi
chown -R "$UTIL:$UTIL" "$RACINE"
# Toutes les dépendances, y compris celles de développement : TypeScript est
# une devDependency, et `npm run build` en a besoin. Poser `--omit=dev` ici
# rendrait la compilation impossible — mesuré sur cet arbre.
su -s /bin/sh -c "cd '$RACINE' && npm ci --no-fund --no-audit --silent || npm install --silent" "$UTIL"
su -s /bin/sh -c "cd '$RACINE' && npm run build --silent" "$UTIL"

# ─── LA SONDE QUI EMPÊCHE UNE RUCHE MORT-NÉE ────────────────────────────────
#
# `better-sqlite3` est une dépendance OPTIONNELLE : quand sa compilation native
# échoue, npm l'écarte EN SILENCE et rend 0. La ruche démarre alors, répond, et
# ne sait rien ranger. Le Dockerfile du dépôt porte déjà cette leçon — trois
# essais, puis une sonde qui ouvre vraiment une base. On la refait ici, parce
# qu'une leçon apprise dans une image ne protège pas une installation nue.
essai=1
while [ "$essai" -le 3 ]; do
  if su -s /bin/sh -c "cd '$RACINE' && node -e \"const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE TABLE s(x INTEGER)');d.prepare('INSERT INTO s VALUES (?)').run(1);if(d.prepare('SELECT count(*) AS n FROM s').get().n!==1)throw new Error('SQLite repond faux');d.close();require('fastify');\"" "$UTIL" 2>/dev/null; then
    dire "     base SQLite : ouverte et vérifiée"
    break
  fi
  [ "$essai" -eq 3 ] && mourir "better-sqlite3 reste inutilisable après 3 essais — la ruche naîtrait morte. Vérifiez build-essential et python3."
  dire "     npm a écarté une dépendance optionnelle (essai $essai sur 3) — on recommence"
  su -s /bin/sh -c "cd '$RACINE' && npm install --silent" "$UTIL" || true
  essai=$((essai + 1))
done

install -d -o "$UTIL" -g "$UTIL" "$RACINE/data"

dire "→ 5/6  Secrets et configuration"
ENVF="$RACINE/.env"
if [ -f "$ENVF" ]; then
  dire "     .env déjà présent — CONSERVÉ (réécrire un secret invaliderait les billets en cours)"
else
  # `umask 077` AVANT la première écriture : créer le fichier lisible puis le
  # restreindre laisse une fenêtre, courte mais réelle, où il est lisible.
  ( umask 077
    {
      printf 'HIVE_TOKEN=%s\n' "$(openssl rand -hex 32)"
      printf 'HIVE_JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
      printf 'HIVE_PORT=%s\n' "$PORT"
      printf 'HIVE_HOST=0.0.0.0\n'
      # Au SINGULIER — vérifié dans `.env.example`. Le pluriel est ignoré en
      # silence, et la ruche refuse alors toutes les origines.
      printf 'HIVE_CORS_ORIGIN=http://%s:%s\n' "$(hostname -I 2>/dev/null | awk '{print $1}')" "$PORT"
      printf 'HIVE_DB=%s/data/hive.db\n' "$RACINE"
      printf 'HIVE_SIMULATION=0\n' 
    } > "$ENVF"
  )
  chown "$UTIL:$UTIL" "$ENVF"
  dire "     .env engendré (0600, propriétaire $UTIL)"
fi

dire "→ 6/6  Service"
cat > /etc/systemd/system/hive.service <<UNIT
[Unit]
Description=Hive — orchestrateur d'agents
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$UTIL
WorkingDirectory=$RACINE
EnvironmentFile=$RACINE/.env
ExecStart=/usr/bin/node $RACINE/dist/orchestrator/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$RACINE

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --quiet hive
systemctl restart hive

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow from "$RESEAU_LOCAL" to any port "$PORT" proto tcp >/dev/null
  dire "     pare-feu : port $PORT ouvert au réseau local seulement"
fi

sleep 3
dire ""
if systemctl is-active --quiet hive; then
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  dire "✔ La ruche répond sur http://${IP:-<ip>}:$PORT"
  dire ""
  dire "  Le jeton de la ruche — à coller dans le champ « Jeton » du tableau de bord :"
  dire ""
  dire "      sudo grep HIVE_TOKEN $ENVF"
  dire ""
  dire "  Il n'est pas affiché ici : cette sortie part souvent dans un journal,"
  dire "  un historique de terminal ou une capture d'écran. Lisez-le quand vous"
  dire "  en avez besoin, à l'endroit où il vit."
  dire ""
  dire "  Pour recruter quelqu'un — un billet révocable, à durée limitée :"
  dire ""
  dire "      cd $RACINE && sudo -u $UTIL npm run cli -- invite --uses 1 --hours 24"
  dire ""
  dire "  Journal :  journalctl -u hive -f"
else
  dire "✘ Le service n'a pas démarré. Ce qu'il en dit :"
  journalctl -u hive -n 30 --no-pager || true
  exit 1
fi
