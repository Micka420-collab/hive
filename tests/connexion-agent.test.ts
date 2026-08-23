// Ce qui manque pour qu'une IA travaille — et si la ruche peut le poser seule.
//
// ─── LE DÉFAUT QUE CE MODULE NOMME ───────────────────────────────────────────
//
// La détection cherche un BINAIRE (`detectBestAgent`). L'authentification
// cherche une CLÉ (`requisitionSiCredentialsManquantes`). Personne ne croisait
// les deux — et c'est justement le croisement qui distingue le poste qu'on
// répare d'un `npm install` de celui qui demande un humain.

import { describe, expect, it } from 'vitest';
import { direVerdict, juger, PAQUETS, type EtatAgent } from '../src/shared/connexion-agent.js';
import { PAQUETS_AGENTS } from '../src/shared/agent-windows.js';

describe('les quatre verdicts', () => {
  it('binaire ET clé : prête, rien à faire', () => {
    expect(juger({ agent: 'claude-code', binaire: true, cle: 'presente' }).verdict).toBe('pret');
  });

  it('binaire sans clé : il faut un humain, pas un paquet', () => {
    expect(juger({ agent: 'claude-code', binaire: true, cle: 'absente' }).verdict).toBe(
      'cle_manquante',
    );
  });

  it('clé sans binaire : LE cas que la ruche répare seule', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: 'presente' }).verdict).toBe(
      'binaire_manquant',
    );
  });

  it('ni l’un ni l’autre : installer PUIS authentifier', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: 'absente' }).verdict).toBe('rien');
  });
});

describe('la clé qu’on ne sait pas lire', () => {
  it('« inconnue » n’est ni « présente » ni « absente »', () => {
    const e = juger({ agent: 'cline', binaire: true, cle: 'inconnue' });
    expect(e.verdict).toBe('cle_inconnue');
  });

  it('elle PRÉCÈDE les autres cas — même sans binaire', () => {
    // L'ordre compte : replier « inconnue » sur « absente » ferait dire « ni
    // ligne de commande ni clé », dont la seconde moitié serait inventée.
    const e = juger({ agent: 'cline', binaire: false, cle: 'inconnue' });
    expect(e.verdict).toBe('cle_inconnue');
  });

  it('elle n’autorise JAMAIS le geste automatique', () => {
    // Le cas qui justifie tout le tri-état : proposer `npm install` sur la foi
    // d'une clé jamais vue, c'est faire suivre un conseil pour rien.
    for (const binaire of [true, false]) {
      expect(juger({ agent: 'cline', binaire, cle: 'inconnue' }).poseAutomatique).toBe(false);
    }
  });

  it('le texte DIT qu’on ne sait pas lire, sans trancher', () => {
    const sans = direVerdict(juger({ agent: 'cline', binaire: false, cle: 'inconnue' }));
    const avec = direVerdict(juger({ agent: 'cline', binaire: true, cle: 'inconnue' }));
    expect(sans).toContain('ne sait pas lire');
    expect(avec).toContain('ne sait pas lire');
    // Les deux phrases diffèrent : l'une dit que l'agent est absent du poste,
    // l'autre qu'il est là mais invérifiable. Les confondre perdrait le seul
    // geste utile — « lancez-la une fois ».
    expect(sans).not.toBe(avec);
    expect(avec).toContain('lancez-la une fois');
  });
});

describe('le geste automatique', () => {
  it('n’est proposé QUE quand le seul manque est le binaire', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: 'presente' }).poseAutomatique).toBe(
      true,
    );
    expect(juger({ agent: 'claude-code', binaire: true, cle: 'absente' }).poseAutomatique).toBe(
      false,
    );
    expect(juger({ agent: 'claude-code', binaire: false, cle: 'absente' }).poseAutomatique).toBe(
      false,
    );
    expect(juger({ agent: 'claude-code', binaire: true, cle: 'presente' }).poseAutomatique).toBe(
      false,
    );
  });

  it('n’est PAS proposé pour un agent dont la ruche ignore le paquet', () => {
    // La clé est là, le binaire manque : le verdict est le bon…
    const e = juger({ agent: 'kimi', binaire: false, cle: 'presente' });
    expect(e.verdict).toBe('binaire_manquant');
    // …mais on n'invente pas un `npm install kimi`. Exécuter un nom deviné
    // serait exactement ce qu'un installeur ne doit jamais faire.
    expect(e.installation).toBeNull();
    expect(e.poseAutomatique).toBe(false);
  });

  it('la commande est une LISTE d’arguments, jamais une ligne de shell', () => {
    const e = juger({ agent: 'claude-code', binaire: false, cle: 'presente' });
    expect(Array.isArray(e.installation)).toBe(true);
    expect(e.installation).toEqual(['npm', 'install', '-g', '@anthropic-ai/claude-code']);
    // Une ligne unique passerait par un interpréteur ; une liste, non. C'est la
    // même raison qui impose `shell: false` sur tout lancement du dépôt.
    expect(e.installation!.join(' ')).not.toContain('&&');
  });

  it('le catalogue des paquets est FERMÉ et gelé', () => {
    expect(Object.isFrozen(PAQUETS)).toBe(true);
    expect(Object.keys(PAQUETS).sort()).toEqual(['claude-code', 'codex']);
  });

  it('aucune commande d’installation ne porte de secret', () => {
    for (const argv of Object.values(PAQUETS)) {
      for (const a of argv) {
        expect(a).not.toMatch(/key|token|secret|sk-/i);
      }
    }
  });
});

describe('l’accord avec l’autre catalogue', () => {
  it('le nom du paquet de Claude Code est le MÊME des deux côtés', () => {
    // Deux catalogues coexistent, et répondent à deux questions distinctes :
    //
    //   `PAQUETS_AGENTS` (agent-windows.ts) : OÙ trouver un agent déjà
    //      installé, quand son shim n'est pas lançable sous Windows ;
    //   `PAQUETS` (ici)                     : COMMENT l'installer.
    //
    // Les fusionner serait une erreur — ils ne servent pas au même moment et
    // n'ont pas la même forme. Mais ils partagent une donnée : le nom npm. S'il
    // dérive d'un côté, la ruche installerait un paquet et en chercherait un
    // autre, sans que rien ne le dise.
    // `toContain` NE SUFFIT PAS, et le contre-rejeu l'a montré : dérivé en
    // `@anthropic-ai/claude-codex`, le nom CONTIENT toujours l'ancien, et la
    // sentinelle restait verte. Une dérive par suffixe est exactement celle
    // qu'une faute de frappe produit. On compare donc le dernier argument —
    // le nom du paquet — À L'ÉGALITÉ.
    const installe = PAQUETS['claude-code']!;
    const nomInstalle = installe[installe.length - 1];
    expect(nomInstalle).toBe(PAQUETS_AGENTS['claude']!.paquet);
  });

  it('tout paquet que la ruche INSTALLE porte une portée npm explicite', () => {
    // `@anthropic-ai/claude-code`, pas `claude-code`. Un nom sans portée est
    // exposé au typosquat du registre public : installer globalement un paquet
    // dont on ne contrôle pas le nom est le genre d'erreur qu'on ne fait qu'une
    // fois.
    for (const argv of Object.values(PAQUETS)) {
      const nom = argv[argv.length - 1]!;
      expect(nom, `« ${nom} » n’a pas de portée npm`).toMatch(/^@[^/]+\/[^/]+$/);
    }
  });
});

describe('ce que l’humain lit', () => {
  const dit = (e: EtatAgent, lang: 'fr' | 'en' = 'fr') => direVerdict(e, lang);

  it('quand la ruche peut poser le binaire, elle le DIT', () => {
    expect(dit(juger({ agent: 'claude-code', binaire: false, cle: 'presente' }))).toContain(
      'la ruche peut l’installer',
    );
  });

  it('quand elle ne le peut pas, elle ne le promet PAS', () => {
    const texte = dit(juger({ agent: 'kimi', binaire: false, cle: 'presente' }));
    expect(texte).toContain('à la main');
    expect(texte).not.toContain('la ruche peut');
  });

  it('les quatre verdicts ont chacun leur phrase, en deux langues', () => {
    const cas: EtatAgent[] = [
      juger({ agent: 'claude-code', binaire: true, cle: 'presente' }),
      juger({ agent: 'claude-code', binaire: true, cle: 'absente' }),
      juger({ agent: 'claude-code', binaire: false, cle: 'presente' }),
      juger({ agent: 'claude-code', binaire: false, cle: 'absente' }),
    ];
    const fr = cas.map((e) => dit(e));
    const en = cas.map((e) => dit(e, 'en'));
    expect(new Set(fr).size, 'quatre phrases distinctes en français').toBe(4);
    expect(new Set(en).size, 'quatre phrases distinctes en anglais').toBe(4);
    for (let i = 0; i < 4; i++) expect(fr[i]).not.toBe(en[i]);
  });

  it('aucune phrase ne peut contenir une valeur de clé — elle n’en reçoit aucune', () => {
    // Le module ne prend qu'un BOOLÉEN pour la clé. Il n'a structurellement
    // pas accès à sa valeur, donc aucune sortie ne peut la recracher.
    const e = juger({ agent: 'claude-code', binaire: false, cle: 'presente' });
    expect(Object.values(e).join(' ')).not.toMatch(/sk-|secret/i);
  });
});
