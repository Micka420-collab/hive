# Hive — l'image de la ruche.
#
# ─── POURQUOI `slim` ET SURTOUT PAS `alpine` ─────────────────────────────────
#
# `better-sqlite3` est un module NATIF. Il publie des binaires prébuilts pour
# la glibc, pas pour la musl d'Alpine : sur `node:24-alpine`, npm doit le
# COMPILER — donc embarquer python3, make et g++ dans l'image, allonger la
# construction de plusieurs minutes, et échouer sur toute machine où l'un des
# trois manque.
#
# Pire : la dépendance est OPTIONNELLE. La compilation qui échoue ne fait pas
# échouer `npm ci` — elle produit une image « réussie » dont le `hive start`
# meurt sur `ERR_MODULE_NOT_FOUND`. C'est exactement la panne que le passage à
# Node 24 a supprimée côté poste de travail (voir `docs/ERREURS.md`) ; la
# réintroduire dans l'image serait la refaire.
#
# `node:24-bookworm-slim` est en glibc : le prébuilt existe, rien ne se
# compile, et l'image n'a pas besoin d'un compilateur.
#
# ─── DEUX ÉTAGES, ET CE QUI RESTE DANS LE SECOND ─────────────────────────────
#
# L'étage de construction a besoin des dépendances de développement —
# TypeScript, Vite — et de leurs 200 Mo. L'étage final n'en garde rien : les
# artefacts compilés, les dépendances de production, et c'est tout.

# ═══ Étage 1 — construire ════════════════════════════════════════════════════
FROM node:24-bookworm-slim AS construction
WORKDIR /app

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation. Copier tout le dépôt d'emblée invaliderait ce cache à
# chaque modification d'une seule ligne de source.
COPY package.json package-lock.json ./
# `npm ci` et pas `npm install` : il installe EXACTEMENT le lock, et échoue si
# le lock ne correspond pas au manifeste. Dans une image, une résolution qui
# dérive au fil des constructions est une image qu'on ne peut pas reproduire.
#
# ─── `--ignore-scripts`, ET POURQUOI IL EST OBLIGATOIRE ICI ──────────────────
#
# `package.json` porte un script `prepare` (« npm run build:node »), et npm
# lance `prepare` À CHAQUE `npm ci`. À cette ligne, seuls les DEUX MANIFESTES
# ont été copiés : ni les sources, ni `tsconfig.build.json` n'existent encore.
# `tsc` s'exécuterait donc dans un répertoire quasi vide.
#
# Mesuré, dans un dossier ne contenant que les deux manifestes :
#
#     error TS5058: The specified path does not exist: 'tsconfig.build.json'
#
# Rien de natif n'est requis pour compiler du TypeScript — les `.d.ts` sont
# posés par la copie des paquets, pas par leurs scripts d'installation. Cet
# étage peut donc s'en passer entièrement. Le binaire natif de
# `better-sqlite3`, lui, est l'affaire de l'étage 2, qui NE met pas
# `--ignore-scripts` (voir plus bas).
RUN npm ci --no-fund --no-audit --ignore-scripts

COPY . .
RUN npm run build

# ═══ Étage 2 — servir ════════════════════════════════════════════════════════
FROM node:24-bookworm-slim AS ruche
WORKDIR /app

ENV NODE_ENV=production
# La ruche écoute sur toutes les interfaces DANS le conteneur — c'est le seul
# moyen que la redirection de port fonctionne. Ce n'est pas une écoute publique
# pour autant : c'est `docker-compose.yml` qui décide sur quelle interface de
# l'hôte le port est publié, et il le publie sur la boucle locale.
ENV HIVE_HOST=0.0.0.0
ENV HIVE_PORT=7777
ENV HIVE_DB=/app/data/hive.db

COPY package.json package-lock.json ./
# `--omit=dev` retire TypeScript et Vite. Les dépendances OPTIONNELLES, elles,
# sont gardées : `better-sqlite3` et Fastify en sont, et sans eux la ruche ne
# démarre pas. C'est `--omit=optional` qu'il ne faut pas écrire ici.
#
# ─── POURQUOI ON RETIRE `prepare` AU LIEU DE METTRE `--ignore-scripts` ──────
#
# npm lance `prepare` sur `npm ci` MÊME AVEC `--omit=dev`. Le script `prepare`
# de ce dépôt appelle `tsc` — qui est justement une dépendance de
# développement, donc absente ici. L'étage se coupait la branche sur laquelle
# il était assis :
#
#     > hive@0.2.0 prepare
#     > npm run build:node
#     sh: 1: tsc: not found
#     npm error code 127
#
# `--ignore-scripts` corrigerait ce symptôme et en créerait un pire : il
# neutraliserait AUSSI le script d'installation de `better-sqlite3`, qui est
# celui qui télécharge le binaire prébuilt. On obtiendrait une image dont la
# construction réussit et dont le démarrage meurt sur un module natif absent —
# exactement la panne que le choix de `slim` plutôt qu'`alpine` évite plus
# haut. Une image qui échoue à se construire est un problème ; une image qui se
# construit et ne démarre pas est un piège.
#
# On retire donc UNIQUEMENT le script fautif. C'est cohérent avec ce qu'est cet
# étage : il ne compile rien, il reçoit `dist/` de l'étage 1.
RUN npm pkg delete scripts.prepare \
  && npm ci --omit=dev --no-fund --no-audit \
  && npm cache clean --force

COPY --from=construction /app/dist ./dist
COPY --from=construction /app/dashboard/dist ./dashboard/dist

# ─── L'utilisateur `node` existe déjà dans l'image officielle ────────────────
#
# On ne tourne PAS en root. Une ruche n'a aucune raison d'avoir les droits
# d'administration du conteneur — et un agent qui s'échapperait de son bac à
# sable les trouverait.
#
# `data/` appartient à `node` : c'est le seul chemin inscriptible dont la ruche
# a besoin.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 7777

# ─── La sonde de santé interroge la ruche, pas le port ──────────────────────
#
# Un port ouvert ne dit pas qu'une ruche répond : un processus bloqué garde son
# écoute. On demande donc `/api/health`, ce qui exige que le serveur ait fini
# de démarrer ET que la base réponde.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HIVE_PORT||7777)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/orchestrator/main.js"]
