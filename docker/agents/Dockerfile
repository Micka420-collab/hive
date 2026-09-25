# Hive agent runner: a minimal image for the CLIs that Hive can preflight.
#
# This is deliberately separate from docker/atelier/Dockerfile. The Atelier is
# a Chromium/VNC desktop and its entrypoint is not an agent command runner.
# Versions are pinned so a rebuild cannot silently change the runtime contract.

FROM node:24-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.278
ARG CODEX_VERSION=0.155.1
# Cline se distribue en binaire compilé par plateforme (Bun embarqué), résolu
# par npm via les optionalDependencies du paquet `cline`. Épinglé comme les
# autres. NOTE : ce binaire exige un CPU x86-64 récent ; sur un cœur trop ancien
# il s'arrête en « Illegal instruction ». Les runners CI et les machines
# modernes l'exécutent sans souci ; c'est le même compromis que tout binaire
# précompilé.
ARG CLINE_VERSION=3.0.65

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp/hive-home \
    NODE_ENV=production

RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates git \
  && npm install --global \
       @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
       @openai/codex@${CODEX_VERSION} \
       cline@${CLINE_VERSION} \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

# The runtime invokes the container as uid/gid 1000. Keep the image contract
# aligned with the official Node image and never run an agent as root.
USER 1000:1000
WORKDIR /hive/tache

# Hive supplies the command after the image name. This default is only useful
# for manually inspecting the image and is not a simulated agent run.
CMD ["sh"]
