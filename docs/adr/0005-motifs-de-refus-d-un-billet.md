# ADR 0005 — Dire pourquoi un billet est refusé, sans en dire trop

- **Statut** : proposé (lot 0 de la mission « L'ACCUEIL »)
- **Date** : 2026-07-27
- **Concerne** : §5 B de `MISSION-ACCUEIL.md`, et la limite du §16

## Contexte

La mission demande, pour le chemin « rejoindre une ruche » : _« Si le billet
est expiré/consommé, dis-le en clair avec la marche à suivre — c'est le cas
d'échec le plus fréquent et le plus vexant. »_

**Ce n'est pas faisable côté client aujourd'hui.** `src/orchestrator/server.ts`
répond `401 { error: 'billet refusé' }` pour **tous** les motifs.
`src/shared/acces.ts` en distingue pourtant six, dans un ordre fixe
(`jugerBillet`) : `inconnu` → `revoque` → `expire` → `epuise`, puis la
vérification PBKDF2 du secret (`secret_invalide`), plus `course_perdue` en cas
de collision. Ces motifs ne partent qu'au journal, via
`emitEvent('invite_rejected')`.

Le flou n'est donc pas un oubli : c'est une réponse uniforme, qui n'apprend
rien à qui tâtonne. La question est de savoir ce qu'on peut en révéler sans le
défaire.

## Options pesées

**A. Ne rien changer.** Le message reste « billet refusé ». L'ami qui a attendu
deux jours avant de coller son billet ne saura pas s'il doit en redemander un
ou vérifier sa connexion. C'est exactement le cas que la mission veut fermer.

**B. Tout révéler.** Un `inconnu` distinct d'un `secret_invalide` transforme
l'endpoint en oracle : on peut énumérer les identifiants de billets existants,
puis concentrer les tentatives sur ceux qui existent. Le débit est déjà borné
(10 échecs par minute et par IP, `server.ts:243`), mais un oracle borné reste
un oracle, et il ne se referme jamais après coup.

**C. Ne distinguer que les motifs qui supposent un billet déjà authentifié.**
`expire`, `epuise` et `revoque` ne peuvent être connus que d'un porteur du bon
secret. Les révéler n'apprend rien à qui n'a pas ce secret — il le savait déjà.
`inconnu` et `secret_invalide` restent **un seul et même message**, parce que
c'est leur indistinction qui ferme l'oracle.

## Décision

**C**, avec une inversion de l'ordre de vérification.

`jugerBillet` teste aujourd'hui l'existence et l'état **avant** le secret. Pour
que C tienne, il faut que le secret soit vérifié **avant** de révéler quoi que
ce soit sur l'état : sinon « expiré » serait dit à quelqu'un qui ne connaît pas
le secret, et l'oracle reviendrait par la fenêtre.

La réponse devient :

| Situation                         | Réponse HTTP                      | Ce que le client affiche                                                           |
| --------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Secret correct, billet expiré     | `401 { error, motif: 'expire' }`  | « Ce billet a expiré. Demandez-en un nouveau à l'hôte : `npm run cli -- invite`. » |
| Secret correct, usages épuisés    | `401 { error, motif: 'epuise' }`  | « Ce billet a déjà servi le nombre de fois prévu. »                                |
| Secret correct, billet révoqué    | `401 { error, motif: 'revoque' }` | « L'hôte a révoqué ce billet. »                                                    |
| Billet inconnu **ou** secret faux | `401 { error }`, **sans motif**   | « Billet refusé — vérifiez que vous l'avez collé en entier. »                      |

L'ordre de vérification devient donc : trouver le billet → **vérifier le
secret** → juger l'état. Un billet inconnu et un secret faux prennent le même
chemin, et — point à ne pas manquer — **doivent coûter le même temps**, sinon
la durée de la réponse rétablit l'oracle. Le PBKDF2 doit tourner dans les deux
cas, y compris sur un billet inconnu.

Le `detail` déjà renvoyé en `409` (« identifiant de nœud déjà utilisé ») est
par ailleurs perdu à l'affichage par `join.ts:102`, qui ne lit que `error`.
C'est un correctif à un mot, dans le même lot.

## Conséquences

- Touche `src/shared/acces.ts` (ordre de `jugerBillet`) et
  `src/orchestrator/server.ts` (route `/api/rejoindre`). C'est une entorse
  assumée au §16 « pas de refonte de l'orchestrateur » : ce n'est pas une
  refonte, c'est le seul endroit d'où l'information demandée peut venir. Faute
  de quoi le §5 B est irréalisable et devrait être retiré de la mission.
- `emitEvent('invite_rejected')` continue de journaliser le motif **exact**,
  `secret_invalide` compris : ce que le client ne voit pas, l'hôte le voit.
- Tests : un cas par motif visible, un cas qui vérifie que `inconnu` et
  `secret_invalide` rendent **exactement** la même réponse, et un test de
  temps de réponse comparable entre les deux (borne large, pour ne pas être
  instable en CI).
- Le débit reste borné à 10 échecs par minute et par IP. Aucune raison de le
  relâcher, et une bonne de ne pas le faire.
