# ADR 0006 — Le TUI s'écrit à la main

- **Statut** : accepté (lot 0 de la mission « L'ACCUEIL », validé le 2026-07-27)
- **Date** : 2026-07-27
- **Concerne** : §6.5, §15 et §16 de `MISSION-ACCUEIL.md`

## Contexte

L'accueil demande un menu navigable aux flèches, des cadres, un spinner, des
couleurs, et cinq dégradations obligatoires (non-TTY, `NO_COLOR`, `TERM=dumb`,
< 60 colonnes, `--non-interactive`). L'écosystème propose exactement ça :
`@clack/prompts`, `inquirer`, `ink`, `blessed`.

La mission l'interdit. Cet ADR existe pour que ce soit une **décision motivée**
plutôt qu'une contrainte subie — parce qu'une contrainte subie se contourne à
la première difficulté, et qu'il y en aura une au lot 2.

## Options pesées

**A. `@clack/prompts`.** Beau par défaut, exactement l'esthétique visée, API
minuscule. Trois dépendances transitives.

**B. `ink` (React pour le terminal).** Le plus puissant. Tire React, Yoga,
et une trentaine de paquets transitifs — pour un menu de trois lignes.

**C. À la main.** Environ 300 lignes pour tout ce dont on a besoin : quelques
séquences ANSI, un lecteur de touches en mode brut, un calcul de largeur. Rien
d'algorithmiquement difficile ; le travail est dans les cas limites, et les cas
limites sont précisément ce que le §6.4 exige de traiter **explicitement**.

## Décision

**C.**

L'argument n'est pas la taille du `node_modules`. C'est que **ce code est le
premier que quelqu'un exécute**, avant d'avoir décidé de faire confiance au
projet, par un `npx` lancé à l'aveugle. Chaque dépendance transitive du chemin
d'installation est un mainteneur de plus à qui l'on demande à ses utilisateurs
de faire confiance sans le leur dire. Un projet qui promet « vos clés d'API ne
quittent jamais votre machine » et qui, pour dessiner un cadre, tire trente
paquets sur le chemin d'installation, se contredit dans le même geste.

Le deuxième argument est testable : un module de rendu **pur**
(`src/tui/rendu.ts`, des fonctions `(état) => string[]`) se teste intégralement
par snapshots, sans terminal. Avec une bibliothèque, on teste la bibliothèque
ou on ne teste rien. Ici, chaque dégradation du §6.4 devient une assertion —
et notamment la seule qui compte vraiment : **aucun octet `\x1b` ne sort quand
`NO_COLOR` est posé**, ce qui est la garantie qu'on peut rediriger la sortie
dans un fichier de log sans le remplir de bruit.

## Conséquences

- Deux fichiers, sur la ligne de partage déjà suivie par tout le dépôt :
  - `src/tui/rendu.ts` — **pur**, aucune I/O, 100 % testable ;
  - `src/tui/terminal.ts` — impur : mode brut, lecture des touches, curseur,
    signaux, **restauration en `finally`**.
- `dependencies` n'augmente pas. C'est le critère n° 3 du §4, vérifiable au
  diff.
- Ce qu'on n'aura pas, et qu'il faut assumer : pas de gestion fine des
  largeurs de glyphes (les emoji et les idéogrammes comptent double dans un
  terminal, `String.length` ne le sait pas). La charte du §6.1 interdit déjà
  l'emoji dans le flux d'exécution, ce qui rend le problème théorique — mais un
  label venu d'un billet, lui, peut contenir n'importe quoi. `acces.ts:121-127`
  borne déjà ces labels à 120 caractères sans caractère de contrôle ; le rendu
  les tronquera en plus, et le test le vérifiera.
- Le raw mode ne se teste pas sans terminal. `terminal.ts` prendra donc son
  flux d'entrée en **paramètre injecté**, ce qui permet de tester la séquence
  « flèche bas, flèche bas, entrée » et l'interruption `^C` → code 130 sur un
  faux flux.
- Si un jour cette décision doit s'inverser, le point de bascule est nommé :
  le jour où le rendu correct des largeurs de glyphes devient nécessaire, une
  bibliothèque de mesure (et elle seule) sera plus sûre que notre code.
