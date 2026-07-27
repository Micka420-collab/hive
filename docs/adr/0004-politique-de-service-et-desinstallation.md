# ADR 0004 — Le service est opt-in, et la désinstallation ne touche pas à l'état

- **Statut** : proposé (lot 0 de la mission « L'ACCUEIL »)
- **Date** : 2026-07-27
- **Concerne** : §7.2.3, §7.3.2-7.3.3 et §19.5 de `MISSION-ACCUEIL.md`

## Contexte

Une ruche qui tient des semaines doit survivre à une déconnexion et à un
redémarrage. Il faut donc un service — mais l'installeur promet par ailleurs
de ne rien poser sur la machine sans qu'on le lui demande (§7.5, et l'invariant
n° 1 déjà tenu par `src/installer.ts`).

Symétriquement : `hive service uninstall` doit-il retirer aussi le `.env` et la
base ?

## Options pesées — l'installation

**A. Service installé par défaut.** La ruche « marche toute seule », au prix
de la promesse. Un outil qu'on essaie et qui laisse une unité systemd derrière
lui est un outil qu'on n'essaie qu'une fois.

**B. Opt-in explicite, niveau utilisateur par défaut.** `systemd --user` et la
tâche planifiée Windows ne demandent **aucun droit administrateur**. Ils ne
survivent pas à la fermeture de session sans `loginctl enable-linger`, ce qui
est une limite réelle — et qui se dit.

**C. Opt-in, niveau système.** Survit à tout, réclame `sudo` / l'admin.

## Décision — l'installation

**B par défaut, C documenté et jamais choisi à la place de quelqu'un.**

- Linux : unité `systemd --user`, `Restart=on-failure`, `RestartSec=5`,
  `EnvironmentFile` en `0600`, et le durcissement du §7.3.2
  (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`,
  `ProtectHome=read-only` avec un `ReadWritePaths` minimal).
- Windows : **tâche planifiée à l'ouverture de session** — aucun droit admin.
  Le service via `sc.exe`/NSSM est documenté avec sa conséquence en clair : il
  tourne hors session, survit à la déconnexion, et réclame l'administrateur.
- macOS : `launchd` en `LaunchAgents` (utilisateur), même politique.

## Options pesées — la désinstallation

**A. `hive uninstall` retire tout** (service, `.env`, base). Symétrique et
satisfaisant à écrire. Et catastrophique : la base SQLite est la **mémoire**
de la ruche — les projets, les tâches, le Hive Mind, le grand livre. Le `.env`
porte `HIVE_TOKEN`, dont la perte déconnecte **tous** les nœuds, et
`HIVE_JWT_SECRET`, dont la perte invalide toutes les sessions.

**B. Rien retirer.** Laisse des unités systemd orphelines qui redémarrent un
binaire supprimé, c'est-à-dire des erreurs toutes les cinq secondes dans le
journal de quelqu'un.

**C. `hive service uninstall` retire exactement ce que `service install` a
posé, et rien d'autre.**

## Décision — la désinstallation

**C.** Il n'y a pas de `hive uninstall` global.

`service uninstall` arrête, désactive et supprime l'unité (ou la tâche, ou le
plist) — et **le test l'exige** : après `install` puis `uninstall`, aucun
fichier de service ne subsiste et rien ne reste enregistré.

Supprimer l'état est une opération à un seul sens, sur des données qui ne sont
pas les nôtres. La documentation dit où elles sont (`.env`, `data/hive.db`,
`.hive-work/`) et que les effacer est un geste manuel. Un outil d'installation
n'est pas un outil de destruction ; le jour où quelqu'un lance `uninstall` en
croyant « désinstaller le service », il ne doit pas perdre six mois de ruche.

## Conséquences

- `hive service install | status | logs | uninstall`, avec `--system` comme
  option explicite là où elle existe.
- Le choix du niveau (utilisateur / système) est une **question posée**, jamais
  un défaut deviné — et en `--non-interactive`, son absence est une erreur de
  code `3`, pas un défaut silencieux.
- La limite de `systemd --user` (s'arrête à la fermeture de session sans
  `enable-linger`) est affichée au moment de l'installation, avec la commande
  qui la lève. Une ruche qui s'éteint sans raison apparente est un bug
  d'accueil, même quand c'est le comportement documenté de systemd.
- La documentation de désinstallation liste les chemins d'état **et** dit
  pourquoi l'outil n'y touche pas.
