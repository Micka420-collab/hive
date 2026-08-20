# Hive Cloud — comme n8n : gratuit chez soi, payant sur tes serveurs

Deux éditions, un seul dépôt.

| Édition | Où ça tourne | Prix pour l'utilisateur | Commande |
| ------- | ------------ | ----------------------- | -------- |
| **Community** | Sa machine | **0 €**, pour toujours | `npm run setup` ou `docker compose up` |
| **Cloud** | **Tes** serveurs | Queen 49 €/mois, Rush dès 79 € | `docker compose -f docker-compose.cloud.yml up -d` |

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
HIVE_EDITION=cloud
HIVE_TOKEN=<32+ caractères>
HIVE_JWT_SECRET=<64 hex>
HIVE_WEBHOOK_SECRET=<secret du webhook Stripe>
HIVE_PUBLIC_URL=wss://hive.example.com/ws
HIVE_CORS_ORIGIN=https://hive.example.com
HIVE_BALANCE=strict
```

4. Dans `docker/Caddyfile.cloud`, remplace `hive.example.com`.
5. `docker compose -f docker-compose.cloud.yml up -d`

Caddy termine TLS. La Queen n'écoute **pas** sur Internet directement : seulement le réseau Docker, derrière Caddy.

`GET /api/edition` doit répondre `{ "edition": "cloud", "factureHorlogeHote": true }`.

Sans `HIVE_WEBHOOK_SECRET`, **la Queen Cloud refuse de démarrer**. Ce n'est pas un oubli : tourner sans webhook, c'est facturer des heures que Stripe ne pourra jamais activer.

## 3. Stripe

Dans le Dashboard Stripe :

- Produits alignés sur les clés de plan Hive : `queen`, `eclaireuse`, `essaim`, `colonie`.
- Métadonnées **obligatoires** sur l'abonnement : `projectId`, `plan`.
- Webhook vers `https://hive.example.com/api/webhooks/abonnement`.
- Événements : `customer.subscription.created`, `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.

La signature Stripe (`Stripe-Signature`) est acceptée, même format HMAC que `x-hive-signature`. Aucune carte n'entre dans Hive.

Checkout / Customer Portal restent chez Stripe (PCI). Hive ne voit qu'un identifiant opaque et un état.

## 4. Plusieurs clients

Un process = une Queen = une base. Pour un deuxième client : un second compose (ou un second service) avec `HIVE_DB=/app/data/tenants/<slug>/hive.db` et un `HIVE_TOKEN` distinct.

Les slugs sont jugés par `jugerSlug` : minuscules, pas de `..`, pas de chemin. `cheminBaseLocataire(racine, slug)` refuse tout ce qui sortirait du dossier.

## 5. Ce qui n'est pas encore branché

- Le **Checkout Stripe hébergé** depuis le tableau de bord (lien à coller depuis Stripe).
- Le **provisionnement automatique de VPS** (le fournisseur livré est manuel : instructions + billet).
- Un **compte npm** / image GHCR officielle.

Le logiciel pour encaisser et borner est là. Les identifiants Stripe et le domaine sont les tiens.
