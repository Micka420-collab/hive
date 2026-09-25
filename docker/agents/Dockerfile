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

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp/hive-home \
    NODE_ENV=production \
    PATH=/opt/hive-agents/node_modules/.bin:$PATH

COPY docker/agents/package.json docker/agents/package-lock.json /opt/hive-agents/

RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates git \
  && cd /opt/hive-agents \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

# The runtime invokes the container as uid/gid 1000. Keep the image contract
# aligned with the official Node image and never run an agent as root.
USER 1000:1000
WORKDIR /hive/tache

# Hive supplies the command after the image name. This default is only useful
# for manually inspecting the image and is not a simulated agent run.
CMD ["sh"]
