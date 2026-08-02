// Quel agent le nœud emploie — et ce que la sonde a le droit d'emporter.
//
// ─── LE DÉFAUT QUE CE FICHIER GARDE ──────────────────────────────────────────
//
// `main.ts` — c'est-à-dire `npm run node`, le chemin de celui qui INSTALLE la
// ruche sur sa propre machine — écrivait :
//
//     const agentType = (process.env.HIVE_AGENT ?? 'shell') as AgentType;
//
// L'installeur n'écrit PAS `HIVE_AGENT` dans `.env`. Rien ne venait donc
// jamais le mettre à autre chose, et un Claude Code parfaitement installé
// n'était jamais employé : le nœud tournait en SIMULÉ, avait l'air de
// travailler, et rendait de faux diffs.
//
// Le plus révélateur : `join.ts` — le chemin de l'AMI qu'on invite — détecte
// automatiquement depuis toujours. L'invité avait un vrai agent, l'hôte un
// simulacre. C'est l'inverse exact de ce qu'on attend, et personne ne pouvait
// le voir : les deux chemins se ressemblent, un seul était juste.
//
// ─── ET CE QUE CORRIGER ÇA A OUVERT ──────────────────────────────────────────
//
// Faire détecter `main.ts` n'est pas gratuit. `join.ts` se protégeait d'un
// danger PAR L'ORDRE — il sondait avant d'avoir lu le secret :
//
//     « on ne met PAS le token dans l'environnement avant, sinon un binaire
//       homonyme malveillant (claude.cmd déposé en tête de PATH) l'hériterait »
//
// Or `main.ts` charge `.env` à sa PREMIÈRE ligne. Y sonder aurait offert le
// jeton de la ruche — et la clé d'abonnement de l'humain — au premier binaire
// hostile posé en tête de PATH. Une protection qui tient à l'ordre des lignes
// ne tient pas : elle doit vivre DANS la sonde. C'est ce que le second
// `describe` vérifie.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SECRETS_JAMAIS_SONDES,
  agentCredentialEnv,
  envSonde,
  messageAgent,
} from '../src/node-client/agent-detect.js';
import { PAQUETS_AGENTS, argvAgent } from '../src/shared/agent-windows.js';

const SOURCE = readFileSync(new URL('../src/node-client/main.ts', import.meta.url), 'utf8');

/** La source SANS ses commentaires — la prose ne doit rien prouver (§ 2.3). */
const NU = SOURCE.replace(/^\s*\/\/.*$/gm, '');

describe('LE NŒUD QU’ON LANCE CHEZ SOI (`npm run node`)', () => {
  it('NE RETOMBE PLUS SUR « shell » PAR DÉFAUT', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Le défaut littéral est ce qui rendait un Claude Code installé inutile.
    // Il ne doit pas revenir — et il reviendrait sans bruit : tout resterait
    // vert, la ruche continuerait de « travailler », et les diffs seraient
    // faux.
    expect(NU, 'le repli littéral sur « shell » est précisément le défaut').not.toMatch(
      /HIVE_AGENT\s*\?\?\s*'shell'/,
    );
  });

  it('DÉTECTE, comme le fait le chemin de l’ami depuis toujours', () => {
    expect(NU).toMatch(/detectBestAgent\(\)/);
  });

  it('HIVE_AGENT garde le dernier mot', () => {
    // Forcer `shell` reste la façon d'avoir un nœud de test qui n'exécute
    // rien pour de vrai. La détection ne doit pas retirer ce choix.
    expect(NU).toMatch(/HIVE_AGENT/);
    expect(NU, 'la valeur forcée doit court-circuiter la détection').toMatch(
      /forceAgent\s*\?[\s\S]*?await detectBestAgent\(\)/,
    );
  });

  it('DIT à l’humain qu’il tourne en simulé, sans attendre `hive doctor`', () => {
    // Personne ne lance le docteur avant de voir sa ruche « travailler ». Un
    // simulacre silencieux coûte une soirée à qui croit que ça tourne.
    //
    // Cette garde constate que main.ts APPELLE le message ; c'est le
    // `describe` suivant qui éprouve LEQUEL est choisi — et c'est la loupe
    // qui a montré que la différence comptait.
    expect(NU).toMatch(/messageAgent\(/);
  });

  it('SONDE APRÈS le bac à sable, pas avant', () => {
    // Un nœud que l'isolement refuse n'a pas à sonder quoi que ce soit — et
    // l'humain doit lire d'abord ce qui l'arrête.
    const bac = NU.indexOf('bac.refuse');
    // `await detectBestAgent`, et non `detectBestAgent` : la première
    // occurrence du nom nu est la LIGNE D'IMPORT, tout en haut — la garde
    // était donc rouge quoi qu'il arrive. Elle a échoué en me le disant.
    const sonde = NU.indexOf('await detectBestAgent');
    expect(bac, 'le refus du bac doit être dans la source').toBeGreaterThan(-1);
    expect(sonde, 'la détection doit venir après le refus du bac').toBeGreaterThan(bac);
  });
});

describe('CE QU’ON DIT À L’HUMAIN — et pourquoi la nuance compte', () => {
  // ─── CE QUE LA LOUPE A TROUVÉ ICI ────────────────────────────────────────
  //
  // Ces deux cas vivaient dans `main.ts` sous forme de `=== 'shell'` et
  // `!== 'shell'`. La loupe a inversé les deux : rien n'a rougi. Les tests
  // lisaient la source et constataient que les phrases EXISTAIENT ; aucun ne
  // vérifiait laquelle sort.
  //
  // Se tromper de phrase n'est pas cosmétique : les deux demandent des gestes
  // OPPOSÉS. Envoyer « installez Claude Code » à quelqu'un qui l'a déjà le
  // fait réinstaller pour rien, et cherche la panne là où il n'y en a pas.

  it('UN VRAI AGENT NE MÉRITE AUCUN AVERTISSEMENT', () => {
    expect(messageAgent('claude-code', ['claude-code', 'shell'])).toBeNull();
    expect(messageAgent('codex', ['codex', 'shell'])).toBeNull();
    expect(messageAgent('custom', ['custom', 'shell'])).toBeNull();
  });

  it('AUCUN AGENT INSTALLÉ → on dit d’en installer un, et que les diffs sont FAUX', () => {
    const m = messageAgent('shell', ['shell']);
    expect(m).toMatch(/Aucun agent/);
    expect(m, 'le mot qui compte : ce que la ruche produit n’est pas réel').toMatch(/FAUX/);
    expect(m, 'et la commande exacte, pas « installez un agent »').toMatch(
      /@anthropic-ai\/claude-code/,
    );
  });

  it('UN AGENT DISPONIBLE MAIS ÉCARTÉ À LA MAIN → on nomme HIVE_AGENT', () => {
    // ─── LA DISTINCTION QUE LA LOUPE A RÉVÉLÉE NON DÉFENDUE ────────────────
    //
    // Ici l'humain n'a rien à installer : il a un agent, et c'est SON réglage
    // qui l'écarte. Lui dire « installez Claude Code » l'enverrait réinstaller
    // ce qu'il a déjà, et chercher une panne là où il n'y a qu'un choix.
    const m = messageAgent('shell', ['claude-code', 'shell']);
    expect(m).toMatch(/HIVE_AGENT/);
    expect(m, 'surtout PAS le message d’installation').not.toMatch(/Aucun agent/);
  });
});

describe('CE QU’UNE SONDE A LE DROIT D’EMPORTER', () => {
  it('LE JETON DE LA RUCHE NE PASSE PAS', () => {
    // ─── LE CŒUR DE LA CHOSE ───────────────────────────────────────────────
    //
    // Sonder, c'est lancer un binaire dont on ne sait encore RIEN — c'est même
    // toute la question qu'on lui pose. Lui tendre le jeton, c'est le donner à
    // quiconque a réussi à poser un `claude.cmd` en tête de PATH.
    const propre = envSonde({ HIVE_TOKEN: 'secret', PATH: '/usr/bin' });
    expect(propre.HIVE_TOKEN).toBeUndefined();
    expect(propre.PATH, 'sans PATH, la sonde ne trouverait plus rien').toBe('/usr/bin');
  });

  it('L’ABONNEMENT DE L’HUMAIN NON PLUS — c’est ce qu’un homonyme veut', () => {
    // `--version` s'affiche sans authentification : une sonde n'a aucun besoin
    // de ces variables, et c'est exactement ce qu'un binaire hostile cherche.
    const propre = envSonde({
      ANTHROPIC_API_KEY: 'sk-secret',
      ANTHROPIC_AUTH_TOKEN: 'jeton',
      OPENAI_API_KEY: 'sk-autre',
    });
    expect(Object.keys(propre)).toEqual([]);
  });

  it('TOUT LE RESTE PASSE — sinon la sonde échoue et on retombe en simulé', () => {
    // ─── POURQUOI PAS UNE LISTE D'AUTORISATION ─────────────────────────────
    //
    // Elle serait plus sûre en théorie et cassante en pratique : sous Windows,
    // oublier `SystemRoot` ou `PATHEXT` ferait échouer `claude --version`,
    // donc conclure « aucun agent », donc retomber en simulé — le défaut même
    // qu'on répare. Le remède serait la maladie.
    const propre = envSonde({
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      PATHEXT: '.COM;.EXE',
      APPDATA: 'C:\\Users\\moi\\AppData\\Roaming',
      HOME: '/home/moi',
    });
    expect(Object.keys(propre).sort()).toEqual([
      'APPDATA',
      'HOME',
      'PATH',
      'PATHEXT',
      'SystemRoot',
    ]);
  });

  it('NE MODIFIE PAS l’environnement qu’on lui donne', () => {
    // Rendre une copie, et non muter `process.env` : la sonde ne doit pas
    // désarmer le processus qui l'appelle. L'agent, lui, a BESOIN de ces
    // variables ensuite — c'est `agentCredentialEnv` qui les lui passe.
    const origine = { HIVE_TOKEN: 'secret', PATH: '/usr/bin' };
    envSonde(origine);
    expect(origine.HIVE_TOKEN, 'l’appelant garde son environnement intact').toBe('secret');
  });

  it('LA LISTE NE DOIT PAS DÉRIVER — un secret ajouté ailleurs doit y entrer', () => {
    // ─── LA GARDE CONTRE L'OUBLI ───────────────────────────────────────────
    //
    // Cette liste a le droit d'être incomplète le jour où on l'écrit ; elle
    // n'a pas le droit d'être oubliée le jour où quelqu'un ajoute un secret.
    // On relit donc le dépôt, et on exige que tout nom en `_TOKEN`, `_SECRET`
    // ou `_API_KEY` effectivement LU dans l'environnement y figure.
    const sources = ['../src/node-client/main.ts', '../src/node-client/join.ts'].map((f) =>
      readFileSync(new URL(f, import.meta.url), 'utf8'),
    );
    const lus = new Set<string>();
    for (const s of sources) {
      for (const m of s.matchAll(/\benv\.([A-Z][A-Z0-9_]*(?:_TOKEN|_SECRET|_API_KEY))\b/g)) {
        lus.add(m[1]!);
      }
    }
    const oublies = [...lus].filter((c) => !SECRETS_JAMAIS_SONDES.includes(c));
    expect(oublies, 'secret(s) lu(s) dans l’environnement et jamais retiré(s) de la sonde').toEqual(
      [],
    );
    expect(lus.size, 'la garde ne prouve rien si elle ne trouve aucun secret').toBeGreaterThan(0);
  });
});

describe('GROK BUILD — l’agent de xAI, branché comme les autres', () => {
  // ─── CE QUE CET AGENT A DE PARTICULIER, ET CE QU'IL N'A PAS ────────────────
  //
  // `grok-build` est un binaire Rust sous Apache 2.0 : même forme que Claude
  // Code et Codex du point de vue de la ruche. Il n'y a donc RIEN de spécial à
  // faire — et c'est le résultat qu'on garde ici.
  //
  // En particulier : aucun shim `.cmd` à contourner, contrairement à Claude Code
  // installé par npm. Ajouter `grok` dans `PAQUETS_AGENTS` serait faux et
  // viserait un `cli.js` qui n'existe pas.

  it('EST UN TYPE D’AGENT, donc détectable et sélectionnable', () => {
    expect(messageAgent('grok', ['grok', 'shell']), 'un vrai agent ne s’avertit pas').toBeNull();
  });

  it('SES IDENTIFIANTS TRAVERSENT LE BAC À SABLE', () => {
    // Sans `GROK_HOME`, la session ouverte au navigateur est invisible depuis le
    // bac, et l'agent redemanderait une connexion qu'aucun nœud ne peut faire.
    const vus = agentCredentialEnv('grok');
    expect(vus, 'la clé d’API').toContain('XAI_API_KEY');
    expect(vus, 'le dossier où vit la session du navigateur').toContain('GROK_HOME');
    expect(vus, 'et les dossiers de configuration habituels').toContain('HOME');
  });

  it('SA CLÉ NE PASSE JAMAIS PAR UNE SONDE', () => {
    // C'est la garde § 9bis.1 appliquée au nouvel agent : `grok --version`
    // répond sans authentification, donc une sonde n'a aucun besoin de la clé —
    // et un binaire homonyme hostile ne demande rien d'autre.
    expect(envSonde({ XAI_API_KEY: 'xai-secret', PATH: '/usr/bin' }).XAI_API_KEY).toBeUndefined();
    expect(SECRETS_JAMAIS_SONDES).toContain('XAI_API_KEY');
  });

  it('N’EST PAS TRAITÉ COMME UN PAQUET NPM', () => {
    // ─── LE PIÈGE ÉVITÉ ─────────────────────────────────────────────────────
    //
    // `PAQUETS_AGENTS` sert à retrouver le `cli.js` d'un agent installé par npm,
    // sous Windows, quand son shim `.cmd` n'est pas lançable. `grok` est un
    // binaire natif : y ajouter une entrée viserait un fichier inexistant, et la
    // détection échouerait là où elle marchait.
    expect(Object.keys(PAQUETS_AGENTS), 'seul Claude Code vient de npm').toEqual(['claude']);
    expect(argvAgent('grok', { APPDATA: 'C:\\x' }, 'win32', () => true)).toEqual(['grok']);
  });
});

describe('AUCUNE SONDE NE LIVRE DE SECRET AU BINAIRE QU’ELLE ÉPROUVE', () => {
  // ─── LA GARDE EXISTAIT, ELLE N'AVAIT PAS ÉTÉ PORTÉE ────────────────────────
  //
  // `envSonde` est pure, exportée et testée depuis longtemps — pour la sonde
  // d'agent. Les QUATRE autres sondes du dépôt lançaient `bin --version` sans
  // option `env`, donc en héritant de tout `process.env`.
  //
  // Or `main.ts` charge `.env` AVANT de préparer le bac à sable. HIVE_TOKEN,
  // HIVE_JWT_SECRET et la clé d'API partaient donc à un binaire nommé `docker`,
  // `podman`, `bwrap` ou `cloudflared` trouvé dans le PATH — c'est-à-dire à
  // n'importe quel homonyme déposé en tête de PATH.
  //
  // C'est le § 9 bis du journal : deux chemins pour un même geste, dont l'un
  // est soigné et l'autre non. Cette garde-ci relit le dépôt pour que le
  // prochain chemin naisse soigné.

  const RACINE = new URL('../src/', import.meta.url);

  /** Tous les `.ts` de `src/`, récursivement. */
  function sources(dossier: URL): URL[] {
    const out: URL[] = [];
    for (const e of readdirSync(dossier, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dossier);
      if (e.isDirectory()) out.push(...sources(u));
      else if (e.name.endsWith('.ts')) out.push(u);
    }
    return out;
  }

  it('toute sonde `--version` passe un `env` explicite', () => {
    const fautives: string[] = [];
    for (const f of sources(RACINE)) {
      const src = readFileSync(f, 'utf8');
      // Le nom du fichier où la garde est DÉFINIE : il contient l'exemple de
      // référence, on ne le juge pas sur sa propre définition.
      if (f.pathname.endsWith('agent-detect.ts')) continue;
      for (const m of src.matchAll(/(spawn|spawnSync|execFile|execFileSync)\([\s\S]{0,400}?\)/g)) {
        const appel = m[0];
        if (!appel.includes("'--version'")) continue;
        if (!/\benv:/.test(appel)) {
          fautives.push(`${f.pathname.split('/src/')[1] ?? f.pathname} : ${appel.slice(0, 70)}…`);
        }
      }
    }
    expect(fautives, 'sonde(s) qui héritent de tout process.env').toEqual([]);
  });

  it('et il y a bien des sondes à juger — sinon la garde est creuse', () => {
    let n = 0;
    for (const f of sources(RACINE)) {
      if (readFileSync(f, 'utf8').includes("'--version'")) n++;
    }
    expect(n, 'aucune sonde trouvée : la garde ne garde rien').toBeGreaterThan(2);
  });
});
