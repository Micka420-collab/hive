# L'ATELIER — le bureau de recette de l'ouvrière.
#
#   docker build -f docker/atelier/Dockerfile -t hive-atelier:local .
#
# ─── POURQUOI CHROMIUM, PAS google-chrome-stable ─────────────────────────────
#
# Le dépôt apt de Google exige une clé GPG tierce et une source supplémentaire.
# Sur une image slim, ça casse souvent la construction, et ça agrandit la
# surface pour un binaire qui parle le MÊME protocole (CDP, port 9222).
# Chromium du dépôt Debian suffit.
#
# Node.js vient de l'image officielle `node:24-bookworm-slim` (Debian), pour
# que le démon d'outils tourne avec le même palier que la ruche. Python,
# LibreOffice et Tesseract viennent d'apt.

FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    SCREEN=1440x900x24 \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb openbox x11vnc novnc websockify \
      chromium \
      python3 \
      libreoffice-writer libreoffice-calc \
      tesseract-ocr \
      ca-certificates fonts-dejavu-core \
      procps \
    && rm -rf /var/lib/apt/lists/*

# ─── UN UTILISATEUR SANS POUVOIR ─────────────────────────────────────────────
#
# Le démon Docker de l'hôte tourne souvent en root. Le PROCESSUS, lui, non.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin hive \
 && mkdir -p /workspace/.wake-hooks /usr/local/lib/hive \
 && chown -R hive:hive /workspace /home/hive /usr/local/lib/hive

COPY docker/atelier/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/atelier/demarrer.sh /usr/local/bin/demarrer.sh
COPY src/atelier/outil.ts /usr/local/lib/hive/outil.ts
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/demarrer.sh \
 && chown hive:hive /usr/local/lib/hive/outil.ts

USER hive
WORKDIR /workspace

# 6080 noVNC · 8765 démon d'outils · 9222 CDP (publiés en 127.0.0.1 par compose)
EXPOSE 6080 8765 9222

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
