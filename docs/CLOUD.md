# Hive Cloud — gratuit chez soi, payant sur tes serveurs

Deux éditions, un seul dépôt.

| Édition       | Où ça tourne     | Prix pour l'utilisateur        | Commande                                           |
| ------------- | ---------------- | ------------------------------ | -------------------------------------------------- |
| **Community** | Sa machine       | **0 €**, pour toujours         | `npm run setup` ou `docker compose up`             |
| **Cloud**     | **Tes** serveurs | Queen 49 €/mois, Rush dès 79 € | `docker compose -f docker-compose.cloud.yml up -d` |

Au-dessus, deux paliers d'ÉQUIPE — jamais du cœur : **Team** (99 €/mois, cloud
ou self-host : rôles fins, quotas par membre, projets d'organisation, sièges
illimités) et **Enterprise** (sur devis : SSO/SAML, audit exportable, rétention
personnalisée, SLA). Les portes sont dans `src/shared/paliers.ts` ; le détail
et le pourquoi dans [`MODELE-ECONOMIQUE.md`](MODELE-ECONOMIQUE.md) §6.

Aucune fonction du noyau n'est retirée de Community pour vendre Cloud. Ce qui se vend, c'est **l'hébergement** (la Queen allumée, éventuellement des nœuds) et **du temps-ouvrière mesuré sur l'horloge de l'hébergeur**, jamais sur `durationMs` déclaré par l'agent.

Les tarifs et les marges sont dans [`MODELE-ECONOMIQUE.md`](MODELE-ECONOMIQUE.md).

## 1. Community (gratuit)

Rien de plus que le README. `HIVE_EDITION` vaut `community` par défaut. Les routes de paiement existent mais **refusent tout** sans `HIVE_WEBHOOK_SECRET` — une ruche d'amis n'encaisse rien.

## 2. Cloud sur tes serveurs

Tu es l'opérateur. Tes clients paient **toi** (Stripe), pas GitHub.

1. Un VPS (2 vCPU / 4 Go suffisent pour la Queen).
2. DNS : `hive.example.com` → l'IP du VPS.
3. Clone, `.env` depuis `.env.example`, puis au minimum :

```
HIVE_DOMAIN=hive.example.com
HIVE_TOKEN=<32+ caractères>
HIVE_JWT_SECRET=<64 hex>
HIVE_WEBHOOK_SECRET=<secret du webhook Stripe>
HIVE_PUBLIC_URL=wss://hive.example.com/ws
HIVE_CORS_ORIGIN=https://hive.example.com
```

4. `docker compose -f docker-compose.cloud.yml up -d --wait`

`HIVE_EDITION=cloud` et `HIVE_BALANCE=strict` sont posés par le compose : inutile de les écrire. `HIVE_DOMAIN` est le nom que Caddy sert, et dont il obtient le certificat Let's Encrypt tout seul. Il vit dans `.env` et **pas** dans `docker/Caddyfile.cloud` : ce fichier est suivi par git, et l'éditer faisait tomber la prochaine mise à jour (`git pull`) en conflit. Sans `HIVE_DOMAIN`, compose refuse de démarrer et dit quoi écrire. `HIVE_CORS_ORIGIN` doit nommer l'adresse HTTPS du tableau de bord : sans elle, l'écran servi par ce domaine voit sa connexion WebSocket refusée (4403).

Caddy termine TLS. La Queen n'écoute **pas** sur Internet directement : seulement le réseau Docker, derrière Caddy.

### Le compose ne démarre aucune ouvrière

`docker compose -f docker-compose.cloud.yml up` démarre Caddy et une **Reine** — pas de machine qui travaille. Les ouvrières font tourner les agents de codage avec les identifiants de LEUR machine, et les enfermer dans ce serveur leur donnerait une maison sans clés. Une ouvrière rejoint par billet : le bouton **Inviter** de la barre du haut du tableau de bord en compose un (il annonce `HIVE_PUBLIC_URL`), et la machine qui travaille lance

```sh
npx github:Micka420-collab/hive join hive2_votre-billet
```

Tant qu'aucune n'est venue, les tâches attendent, et l'écran le dit.

Le compose pose `HIVE_TRUST_PROXY=uniquelocal` : la Queen croit le `X-Forwarded-For` que Caddy lui transmet depuis le réseau privé de Docker, et chaque client garde **son** compteur anti-abus (débit, échecs de connexion, inscriptions, entrées par billet). Sans ce réglage, tous les clients auraient l'IP de Caddy et un seul compteur : un client qui s'acharne bloquerait tout le monde. Proxy hors Docker sur la même machine : `loopback`. `true` et un nombre de sauts (`1`) sont refusés : ni l'un ni l'autre ne vérifie que le pair est bien le proxy, et tout client joignable en direct pourrait choisir son IP. Une valeur refusée arrête la Queen au démarrage (code 2), avec la liste des valeurs acceptées — plutôt que de la laisser tourner avec un seul compteur pour tous les clients.

`GET /api/edition` doit répondre `{ "edition": "cloud", "factureHorlogeHote": true }`.

**Ce que l'horloge facture.** Une session s'ouvre quand la Queen assigne une tâche (ou ré-adopte celle qu'un nœud revenu porte encore) et se ferme quand la tentative s'arrête : résultat, annulation, refus du nœud, nœud perdu, redémarrage de la Queen. Une tentative interrompue est facturée pour le temps qu'elle a réellement occupé l'hébergeur, jusqu'au dernier instant où la Queen l'a vue vivante : ni la panne de la Queen, ni le délai de détection d'un nœud muet, ni l'attente en file ne sont décomptés. Quand une tâche se termine (aboutie, échouée ou annulée), ses sous-tâches déléguées encore en vol sont annulées avec elle, et leur horloge s'arrête au même instant. Une seule exception, et seulement quand la tâche a abouti : une sous-tâche qui avait déjà livré, puis que l'Evaluator a rouverte pour correction, continue — sa tâche parente peut encore être rouverte et relire cette correction. Sous une tâche échouée ou annulée, qui ne sera jamais rouverte, elle est annulée comme les autres, et l'Evaluator ne rouvre plus aucune de ses sous-tâches.

Sans `HIVE_WEBHOOK_SECRET`, **la Queen Cloud refuse de démarrer**. Ce n'est pas un oubli : tourner sans webhook, c'est facturer des heures que Stripe ne pourra jamais activer.

## 3. Stripe

Dans le Dashboard Stripe :

- Produits alignés sur les clés de plan Hive : `queen`, `eclaireuse`, `essaim`, `colonie`, `team`. (`enterprise` se signe au contrat — l'abonnement s'active par le même webhook, mais le prix vit dans le devis, pas dans un produit public.)
- Métadonnées **obligatoires** sur l'abonnement : `projectId`, `plan`.
- Webhook vers `https://hive.example.com/api/webhooks/abonnement`.
- Événements : `customer.subscription.created`, `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.

La signature Stripe (`Stripe-Signature`) est acceptée, même format HMAC que `x-hive-signature`. Aucune carte n'entre dans Hive.

Checkout / Customer Portal restent chez Stripe (PCI). Hive ne voit qu'un identifiant opaque et un état.

## 4. Plusieurs clients

Un process = une Queen = une base. Pour un deuxième client : un second compose (ou un second service) avec `HIVE_DB=/app/data/tenants/<slug>/hive.db` et un `HIVE_TOKEN` distinct.

Les slugs sont jugés par `jugerSlug` : minuscules, pas de `..`, pas de chemin. `cheminBaseLocataire(racine, slug)` refuse tout ce qui sortirait du dossier.

## 5. Mettre à jour, et sauvegarder d'abord

Les versions sont étiquetées (`vX.Y.Z`) ; ce qui change d'une version à l'autre et comment monter est dans [`RELEASING.md`](RELEASING.md). Il n'y a **pas d'image publiée** : l'image se construit sur le serveur, depuis le dépôt. Mettre à jour, c'est donc tirer le code et reconstruire.

**D'abord la sauvegarde**, dans le volume, puis hors du serveur :

```sh
docker compose -f docker-compose.cloud.yml exec ruche node dist/cli.js sauvegarde
docker compose -f docker-compose.cloud.yml cp ruche:/app/data/sauvegardes ./sauvegardes
docker compose -f docker-compose.cloud.yml cp ruche:/app/data/queen.env ./queen.env.sauvegarde
```

La première ligne copie la base par `VACUUM INTO` (jamais un `cp` à chaud : il perd les écritures récentes, voir [`INSTALLATION.md`](INSTALLATION.md#sauvegarder-la-base)). La deuxième la sort du volume. La troisième garde les clés d'API posées depuis la Chambre, qui vivent dans le volume (le fichier naît avec la première clé : sans clé posée, la commande le dit, et il n'y a rien à garder) — c'est un fichier de **secrets** : rangez-le comme tel. Gardez aussi `.env`.

**Une fois, pour une ruche posée avant 0.4.0** : l'ancienne consigne faisait remplacer `hive.example.com` dans `docker/Caddyfile.cloud`. Ce fichier lit maintenant `{$HIVE_DOMAIN}` : écrire `HIVE_DOMAIN=<votre domaine>` dans `.env`, puis `git checkout -- docker/Caddyfile.cloud`, **avant** de tirer le code — sinon `git pull` ou `git checkout` tombe en conflit sur cette ligne, et compose refuse de démarrer tant que `HIVE_DOMAIN` manque.

**Puis la montée** :

```sh
git fetch --tags && git checkout vX.Y.Z      # ou : git pull --ff-only
docker compose -f docker-compose.cloud.yml pull caddy
docker compose -f docker-compose.cloud.yml build --pull ruche
docker compose -f docker-compose.cloud.yml up -d --wait
```

`pull caddy` rafraîchit l'image de Caddy ; `build --pull` reconstruit la Reine sur une base Node à jour (correctifs de sécurité de Debian compris). Le volume `hive-cloud-donnees` n'est pas touché : la nouvelle Reine rouvre la même base. La CI l'éprouve à chaque PR, de la dernière étiquette à l'arbre proposé, sur un même volume (travail `montee`).

## 6. Ce qui n'est pas encore branché

- Le **Checkout Stripe hébergé** depuis le tableau de bord (lien à coller depuis Stripe).
- Le **provisionnement automatique de VPS** (le fournisseur livré est manuel : instructions + billet).
- Le **filtre des destinations de clonage**. L'image porte git (la Reine clone les dépôts des projets pour le Rayon) : tout compte authentifié peut donc faire émettre à la Reine une requête git vers l'adresse qu'il donne en `repoUrl` — y compris une adresse interne au réseau du serveur (un autre service du réseau Docker, `169.254.169.254`). Ce sont des requêtes aveugles, de forme git (`/info/refs?service=git-upload-pack`), et une Reine Cloud posée sur l'hôte avait déjà git ; mais tant que ce filtre manque, ne posez pas Hive Cloud dans un réseau où une telle requête ouvre quelque chose.
- Un **compte npm**. Pas d'image GHCR officielle non plus, et c'est une décision : l'image se construit chez l'opérateur, depuis le dépôt qu'il a sous les yeux.

## 7. Ce que la CI prouve, à chaque PR

Le travail `cloud` de `.github/workflows/ci.yml` démarre ce compose tel que livré — le vrai Caddy, sur ce Caddyfile-ci — avec `HIVE_DOMAIN=hive.localhost` : un nom local, que Caddy sert avec son autorité interne. Il vérifie que compose refuse sans `HIVE_DOMAIN`, que la Reine refuse sans `HIVE_WEBHOOK_SECRET`, que `:80` redirige vers HTTPS, que `/api/edition` répond `cloud` sous un certificat vérifié, que la Reine n'est pas joignable en direct, puis lance deux clients dans deux conteneurs (deux adresses) : l'un s'acharne sous des `X-Forwarded-For` forgés jusqu'au 429, l'autre garde son compteur et reçoit l'état de la ruche par WebSocket. Le déroulé est dans `scripts/essai-conteneurs.mjs` et `scripts/sonde-cloud.mjs`.

Le logiciel pour encaisser et borner est là. Les identifiants Stripe et le domaine sont les tiens.
