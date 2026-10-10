# Hive agent runner: a minimal image for the CLIs that Hive can preflight.
#
# This is deliberately separate from docker/atelier/Dockerfile. The Atelier is
# a Chromium/VNC desktop and its entrypoint is not an agent command runner.
# Versions — and their whole dependency tree — are pinned by package-lock.json
# so a rebuild cannot silently change the runtime contract.

FROM node:24-bookworm-slim

# ─── L'ARBRE ENTIER EST ÉPINGLÉ, PAS SEULEMENT LES TROIS CLI ─────────────────
#
# Les versions vivaient en ARG et s'installaient par `npm install --global` :
# les CLI étaient épinglés, leurs dépendances transitives NON — un global ne lit
# aucun lockfile. Le 25 septembre, la construction a cassé sans qu'une ligne du
# dépôt change : `cline@3.0.65` a tiré `@ai-sdk/openai@4.0.77`, publiée à
# l'instant et pas encore servie par le registre (« No matching version
# found »), sur main comme sur toutes les PR ouvertes.
#
# L'arbre complet est donc dans docker/agents/package-lock.json (versions et
# empreintes d'intégrité) et `npm ci` installe exactement celui-là, ou échoue.
# Mettre à jour un CLI : changer sa version dans docker/agents/package.json,
# `npm install --package-lock-only` dans ce dossier, reconstruire, refaire les
# sondes.
#
# Cline se distribue en binaire compilé par plateforme (Bun embarqué), résolu
# par npm via les optionalDependencies du paquet `cline`. NOTE : ce binaire
# exige un CPU x86-64 récent ; sur un cœur trop ancien il s'arrête en « Illegal
# instruction ». Les runners CI et les machines modernes l'exécutent sans souci ;
# c'est le même compromis que tout binaire précompilé.

# ─── NI NODE_ENV, NI HOME DANS L'ENVIRONNEMENT DE L'IMAGE ────────────────────
#
# Tout ce qui tourne dans le conteneur hérite de cet ENV : l'agent et ses
# commandes, et les validations du nœud (`npm ci` puis les scripts du projet ;
# le bac ne relaie que `CI`).
#
#   · `NODE_ENV=production` y faisait omettre les devDependencies (npm :
#     `omit=dev`) : le `test` d'un projet ne trouvait plus vitest ni jest —
#     127, `outil_introuvable`, aucune production jugée. Les CLI n'en ont pas
#     besoin : leur installation dit `--omit=dev` elle-même, et aucun des trois
#     ne lit la variable pour décider (bundles compilés en production).
#   · `HOME` appartient au bac, qui pose le sien à chaque lancement
#     (`HOME_CONTENEUR`, dans le /tmp en mémoire). Posé ici, il faisait écrire
#     la construction — `npm ci`, en root — dans ce HOME : Docker masque /tmp
#     par un tmpfs vide, mais Podman y RECOPIE le /tmp de l'image (tmpcopyup),
#     et l'agent héritait d'un `~/.npm` à root — `npm ci` en EACCES.
ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/hive-agents/node_modules/.bin:$PATH

COPY docker/agents/package.json docker/agents/package-lock.json /opt/hive-agents/

RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates git \
  && cd /opt/hive-agents \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

# ─── LES OUTILS DE LA PORTE DE SÉCURITÉ, ÉPINGLÉS COMME LE RESTE ─────────────
#
# La porte de sécurité du nœud (`src/node-client/porte-securite.ts`) lance ses
# outils DANS ce bac : Betterleaks (MIT) pour les secrets, osv-scanner
# (Apache-2.0) pour les dépendances. Des binaires officiels, invoqués et jamais
# liés, épinglés par version ET par SHA-256 — ceux que publient les fichiers
# `checksums.txt` et `osv-scanner_SHA256SUMS` des releases. Un octet de
# différence, et la construction échoue : on ne pose pas un outil de sécurité
# qu'on ne peut pas reconnaître.
#
# Les versions doivent rester celles de `VERSION_EPINGLEE`
# (`src/shared/porte-securite.ts`) : un banc relit les deux. Mettre à jour :
# changer version et empreintes ensemble, depuis les fichiers de checksums de
# la release, puis refaire `npm run bac:image`.
#
# Téléchargés par le `fetch` de Node, déjà dans l'image : ni curl, ni wget de
# plus dans un bac où tourne le code des agents.
#
# Les empreintes viennent des fichiers de checksums PUBLIÉS par chaque release
# (relus le 4 octobre, égaux aux empreintes que GitHub donne de chaque
# fichier) — jamais recalculées sur un binaire téléchargé à la main. Une
# empreinte vide fait échouer la construction en le disant : une valeur
# inventée serait pire qu'aucune.
ARG BETTERLEAKS_VERSION=1.9.0
ARG BETTERLEAKS_SHA256_AMD64=f8b185a39ffcece2a1ca82bf3a4e7435cd81963ffd16b7a9128daf75f35f6de7
ARG BETTERLEAKS_SHA256_ARM64=1d39116e0a58dc94574715e2aa12a2dbd5062f193eee3fec011fef6ba06bd13b
ARG OSV_SCANNER_VERSION=2.6.0
ARG OSV_SCANNER_SHA256_AMD64=ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108
ARG OSV_SCANNER_SHA256_ARM64=2c71403eb443d05891c4f268c3ad771cf4f16e5443463fd7851ef8f454d3c7e4

RUN set -eu; \
  case "$(dpkg --print-architecture)" in \
    amd64) bl_arch=x64; bl_sha="$BETTERLEAKS_SHA256_AMD64"; osv_arch=amd64; osv_sha="$OSV_SCANNER_SHA256_AMD64" ;; \
    arm64) bl_arch=arm64; bl_sha="$BETTERLEAKS_SHA256_ARM64"; osv_arch=arm64; osv_sha="$OSV_SCANNER_SHA256_ARM64" ;; \
    *) echo "porte de sécurité : architecture $(dpkg --print-architecture) sans binaire épinglé" >&2; exit 1 ;; \
  esac; \
  if [ -z "$bl_sha" ] || [ -z "$osv_sha" ]; then \
    echo "porte de sécurité : empreinte SHA-256 manquante — reprenez-la du fichier de checksums de la release" >&2; exit 1; \
  fi; \
  telecharger() { node -e 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${process.argv[1]}`); require("node:fs").writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); })' "$1" "$2"; }; \
  cd /tmp; \
  telecharger "https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}/betterleaks_${BETTERLEAKS_VERSION}_linux_${bl_arch}.tar.gz" betterleaks.tar.gz; \
  echo "${bl_sha}  betterleaks.tar.gz" | sha256sum -c -; \
  tar -xzf betterleaks.tar.gz betterleaks; \
  install -m 0755 betterleaks /usr/local/bin/betterleaks; \
  telecharger "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${osv_arch}" osv-scanner; \
  echo "${osv_sha}  osv-scanner" | sha256sum -c -; \
  install -m 0755 osv-scanner /usr/local/bin/osv-scanner; \
  rm -f betterleaks.tar.gz betterleaks osv-scanner; \
  betterleaks --version; \
  osv-scanner --version

# Ce que `hive doctor` lit sans rien lancer dans l'image (`ETIQUETTE_PORTE`,
# `src/shared/porte-securite.ts`). Une construction qui arrive ici a installé
# ET vérifié les deux outils : une image sans cette étiquette date d'avant eux.
LABEL hive.porte-securite="betterleaks=${BETTERLEAKS_VERSION} osv-scanner=${OSV_SCANNER_VERSION}"

# The runtime invokes the container as uid/gid 1000. Keep the image contract
# aligned with the official Node image and never run an agent as root.
USER 1000:1000
WORKDIR /hive/tache

# Hive supplies the command after the image name. This default is only useful
# for manually inspecting the image and is not a simulated agent run.
CMD ["sh"]
