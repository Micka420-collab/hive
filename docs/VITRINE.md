# La vitrine — direction et choix

> Ce que `site/` (accueil, présentation, Rush) suit depuis la refonte du 30 octobre 2026 : les
> jetons, la typographie, la mise en page et les principes — et pourquoi chaque défaut
> « générique » a été écarté. Une retouche de la vitrine se relit contre cette page ; les
> contrats exécutables restent dans `tests/site*.test.ts` et `tests/vitrine-*.test.ts`.

## Sujet, lecteur, travail de la page

- **Sujet** : Hive, orchestrateur open source qui fait travailler plusieurs familles d'IA de
  codage (Claude Code, Codex, Cursor, Cline, Grok, Hermes) sur un même projet, depuis les
  machines des membres. Thèse du projet : **prouver, chiffres à l'appui, qu'un essaim fait
  mieux et plus sûr qu'un agent seul** — relecture croisée entre familles, ouvrières en bac à
  sable, journal de preuves, coût déclaré (jamais estimé).
- **Lecteur** : développeur / lead tech qui évalue l'outillage multi-agents ; lit FR ou EN.
- **Travail de la page** : (1) faire comprendre la thèse en un écran ; (2) faire télécharger
  l'application ; (3) montrer que rejoindre une ruche tient dans un lien.

## Jetons (le sombre est la référence — direction artistique de Mission Control)

| rôle                     | jeton                   | valeur                                       |
| ------------------------ | ----------------------- | -------------------------------------------- |
| page                     | `--bg`                  | `#0c0d10`                                    |
| page, 2e niveau          | `--bg-2`                | `#111318`                                    |
| carte                    | `--panel`               | `#15171d`                                    |
| dans une carte           | `--panel-2`             | `#1b1e25`                                    |
| creux                    | `--panel-3`             | `#23272f`                                    |
| filet                    | `--border`              | `#262a33`                                    |
| filet appuyé             | `--border-2`            | `#333844`                                    |
| texte                    | `--text`                | `#eeebe5`                                    |
| secondaire               | `--muted`               | `#a9abb2`                                    |
| tertiaire                | `--faint`               | `#8f929b`                                    |
| miel qui écrit           | `--honey`               | `#f0b64a`                                    |
| miel qui remplit         | `--gold`                | `#f6c445`                                    |
| ambre (attention)        | `--gold-2`              | `#e8a857`                                    |
| succès / danger          | `--green` / `--red`     | `#5ccfa8` / `#ff8a73`                        |
| information              | `--blue`                | `#72b6f0`                                    |
| texte sur miel           | `--encre`               | `#08090b`                                    |
| texte sur alvéole sombre | `--creme` / `--creme-2` | `#f4eee0` / `#cdbf9f`                        |
| aplat de l'appel         | `--chip`                | = surface `panel-2` (nom imposé par un test) |

Rayons : 12 (carte / cadre), 10 (bouton, champ), 8 (puce), 999 (pastille d'état seulement).
Pas d'ombre : **les filets découpent**. Trois niveaux de surface, pas plus. Verre seulement
sur l'en-tête collant. Grille 4 px, pas de base 8.

## Typographie

- **Bricolage Grotesque** 600 pour h1/h2/h3 et les chiffres mis en avant. h1
  `clamp(40px, 6vw, 72px)`, approche −0,03 em ; h2 `clamp(32px, 4.2vw, 52px)`, −0,024 em ;
  h3 20/18 px.
- **Instrument Sans** 400/500 pour le texte, 16 px / 1,55 ; 60–68 ch de mesure.
- **JetBrains Mono** 400/600 pour les commandes, identifiants, états et chiffres alignés
  (`tabular-nums`), 12–13 px. Jamais pour un titre.
- Surtitre `.kicker` : 11 px, 700, capitales, +0,12 em, couleur `--faint` — un test l'exige en
  capitales ; on le garde **minuscule et rare** (un par section, jamais ailleurs).
- Pas d'émoji comme icône. Pas de « → » collé au texte des liens. Pas de chaînes « A · B · C »
  pour des métadonnées : des puces bordées ou une liste.

## Mise en page (alignée à gauche, 1180 px, gouttière 24 / 16 px)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⬡ Hive v0.5.0 · MIT   Preuve Fonctions Sécurité Éditions Rush Démarrer   FR EN  ★ 12 GitHub │
├─────────────────────────────────────────────────────────────────────┤
│ Open source · application de bureau                                 │
│ Une IA seule demande qu'on la croie.      ┌─ FICHE DE PREUVE · exemple ─┐ │
│ Un essaim Hive doit le prouver.           │ Corriger la garde du secret │ │
│                                           │ Produit   codex · Tour de T │ │
│ Hive fait travailler plusieurs IA…        │ Relu par  claude-code · ok  │ │
│                                           │ Bac       podman            │ │
│ [ Télécharger Hive pour Windows ]         │ Coût      0,42 $ déclaré    │ │
│ Hive-Setup-0.5.0.exe · macOS · Linux      │ ─────────────────────────── │ │
│ Paquets non signés : SmartScreen…         │ ◌ attend votre accord       │ │
│                                           └─────────────────────────────┘ │
│ Plutôt le terminal ?                                                │
│ [Linux · macOS] [Windows] [Docker] [Déjà cloné]                     │
│ $ curl -fsSL …/install.sh | sh                          [copier]    │
│ Jamais de sudo…  Aucune clé d'API.                                  │
│ [8 388 tests ✓] [Palier 7 livré] [TypeScript strict] [Node ≥ 24.18] │
├─────────────────────────────────────────────────────────────────────┤
│ Fonctionne avec l'IA que vous utilisez déjà   Claude Code  Codex  Cursor  Cline  Grok  Hermes │
├─────────────────────────────────────────────────────────────────────┤
│ COMMENT ÇA MARCHE — Trois gestes, et vous gardez la main.           │
│ 01 Installez Hive   02 Invitez par un lien   03 L'essaim travaille et se relit │
│ ┌──────── Swarm View (SVG) ────────┐ légende · journal vivant        │
├─────────────────────────────────────────────────────────────────────┤
│ LA PORTE — Rejoindre une ruche tient dans un lien.                  │
│ ┌ chez l'hôte : Inviter → lien, copier/partager, états ┐ ┌ chez l'invité : OS détecté, │
│ │ rien · lien ouvert · entrée                          │ │ [Rejoindre avec l'application] │
│ └──────────────────────────────────────────────────────┘ │ ou la commande · alvéole qui attend │
├─────────────────────────────────────────────────────────────────────┤
│ LA PREUVE — Ce que Hive doit prouver, et comment il le mesure.      │
│ relecture croisée │ une IA relue par une AUTRE famille …            │
│ bac à sable       │ podman / docker / bubblewrap, déclaré par le nœud │
│ journal de preuves│ verdict, relecteur, temps, ce qui reste inconnu  │
│ coût déclaré      │ celui que le CLI de l'agent déclare, jamais estimé │
│ Aucun benchmark publié : les chiffres sont ceux de VOTRE ruche.     │
├─────────────────────────────────────────────────────────────────────┤
│ EN BREF — 23 fonctions, 4 familles (details) · l'écran de pilotage (onglets) │
│ SÉCURITÉ — 8 points, et ce que l'isolement ne fait pas              │
│ ÉDITIONS — Community 0 € · Cloud 49 € · Team 99 € · Enterprise      │
│ DÉMARRER — démo, adresse de la ruche, trois gestes                  │
│ APPEL — aplat, deux liens                                           │
│ PIED — plan en 3 colonnes                                           │
└─────────────────────────────────────────────────────────────────────┘
```

Téléphone (390) : une colonne ; la fiche passe sous le texte ; la nav glisse sur une ligne ;
cibles 44 px ; la piste des agents défile ; les grilles retombent sans plancher dur.

## Principes

1. **Prouver, pas décorer.** Chaque élément visuel est un _relevé_ (fiche, registre, journal,
   écran) — jamais une illustration. L'hexagone décoratif du héros disparaît ; sa place est
   prise par la fiche de preuve d'une tâche.
2. **Le miel est un verdict.** Il remplit UNE action primaire par vue et l'alvéole qui attend ;
   il écrit un lien ou une valeur mise en avant. Jamais d'aplat.
3. **Les filets découpent.** Trois surfaces, un filet de 1 px, aucune ombre, aucun dégradé.
4. **Un seul moment de mouvement par vue** : l'alvéole de la porte qui attend puis se remplit, le
   journal qui avance. Plus d'apparitions au défilement, plus de parallaxe, plus de survol
   systématique. `prefers-reduced-motion` coupe tout.
5. **Honnête** : aucun chiffre de benchmark inventé ; les écrans d'exemple sont dits
   « exemple » ; les paquets non signés sont dits non signés.

## Relecture contre les défauts génériques

- _Fond quasi noir + un accent vif_ : imposé par la direction artistique du produit — on le
  suit, mais : anthracite **froid** à cinq niveaux (pas un `#111` teinté), miel **rare** et
  porteur de sens (verdict / action), les statuts vert-rouge-bleu font le travail.
- _Chrome de gabarit_ : surtitre en capitales exigé par un test → réduit à 11 px, `--faint`, un
  par section ; **retiré** : les « A · B · C » (puces bordées à la place), le « → » dans les
  liens, les émojis-icônes (23 cartes, rail, raccourcis), les numéros 01–04 sur les familles
  (ce n'est pas une séquence ; les étapes, elles, le sont et gardent 01–03).
- _Kit de cartes SaaS_ : 23 cartes imposées par un test → cartes **plates** sans ombre, posées
  dans une grille à filets (une seule bordure extérieure arrondie), rayon réservé au
  conteneur. Pas de dégradé décoratif, pas d'ombre grise.
- _Héros « gros chiffre + petit libellé »_ : non — titre en deux temps (prémisse grise / thèse
  blanche) et une **fiche de preuve** à droite, qui EST la thèse.
- _Mouvement_ : le site actuel révèle chaque section au défilement et fait bouger l'hexagone à
  la souris → retiré. Il reste le journal et l'alvéole de la porte.
- _Variante claire_ : non livrée — le sombre est la référence, et une seconde palette
  doublerait les littéraux que les tests interdisent. La présentation imprimable reste une
  **feuille blanche** (elle part sur papier) posée sur le bureau sombre, avec les mêmes
  graisses et le même miel.
