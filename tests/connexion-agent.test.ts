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

describe('les quatre verdicts', () => {
  it('binaire ET clé : prête, rien à faire', () => {
    expect(juger({ agent: 'claude-code', binaire: true, cle: true }).verdict).toBe('pret');
  });

  it('binaire sans clé : il faut un humain, pas un paquet', () => {
    expect(juger({ agent: 'claude-code', binaire: true, cle: false }).verdict).toBe(
      'cle_manquante',
    );
  });

  it('clé sans binaire : LE cas que la ruche répare seule', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: true }).verdict).toBe(
      'binaire_manquant',
    );
  });

  it('ni l’un ni l’autre : installer PUIS authentifier', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: false }).verdict).toBe('rien');
  });
});

describe('le geste automatique', () => {
  it('n’est proposé QUE quand le seul manque est le binaire', () => {
    expect(juger({ agent: 'claude-code', binaire: false, cle: true }).poseAutomatique).toBe(true);
    expect(juger({ agent: 'claude-code', binaire: true, cle: false }).poseAutomatique).toBe(false);
    expect(juger({ agent: 'claude-code', binaire: false, cle: false }).poseAutomatique).toBe(false);
    expect(juger({ agent: 'claude-code', binaire: true, cle: true }).poseAutomatique).toBe(false);
  });

  it('n’est PAS proposé pour un agent dont la ruche ignore le paquet', () => {
    // La clé est là, le binaire manque : le verdict est le bon…
    const e = juger({ agent: 'kimi', binaire: false, cle: true });
    expect(e.verdict).toBe('binaire_manquant');
    // …mais on n'invente pas un `npm install kimi`. Exécuter un nom deviné
    // serait exactement ce qu'un installeur ne doit jamais faire.
    expect(e.installation).toBeNull();
    expect(e.poseAutomatique).toBe(false);
  });

  it('la commande est une LISTE d’arguments, jamais une ligne de shell', () => {
    const e = juger({ agent: 'claude-code', binaire: false, cle: true });
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

describe('ce que l’humain lit', () => {
  const dit = (e: EtatAgent, lang: 'fr' | 'en' = 'fr') => direVerdict(e, lang);

  it('quand la ruche peut poser le binaire, elle le DIT', () => {
    expect(dit(juger({ agent: 'claude-code', binaire: false, cle: true }))).toContain(
      'la ruche peut l’installer',
    );
  });

  it('quand elle ne le peut pas, elle ne le promet PAS', () => {
    const texte = dit(juger({ agent: 'kimi', binaire: false, cle: true }));
    expect(texte).toContain('à la main');
    expect(texte).not.toContain('la ruche peut');
  });

  it('les quatre verdicts ont chacun leur phrase, en deux langues', () => {
    const cas: EtatAgent[] = [
      juger({ agent: 'claude-code', binaire: true, cle: true }),
      juger({ agent: 'claude-code', binaire: true, cle: false }),
      juger({ agent: 'claude-code', binaire: false, cle: true }),
      juger({ agent: 'claude-code', binaire: false, cle: false }),
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
    const e = juger({ agent: 'claude-code', binaire: false, cle: true });
    expect(Object.values(e).join(' ')).not.toMatch(/sk-|secret/i);
  });
});
