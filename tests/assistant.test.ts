// L'assistant de configuration.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// L'assistant traduit des réponses en réglages, en étapes et en REFUS. Les
// refus sont la partie qui compte : ce sont eux qui empêchent quelqu'un
// d'ouvrir sa ruche au monde en croyant faire une manipulation anodine.
//
// Trois d'entre eux valent le fichier :
//
//   1. `0.0.0.0` AVEC UN JETON TRIVIAL EST REFUSÉ, pas averti. Un
//      avertissement se lit après coup ; un refus se lit avant.
//   2. Un tunnel ou un proxy SANS DOMAINE est refusé — sinon on poserait une
//      configuration qui ne peut pas marcher, et l'échec arriverait plus tard,
//      loin de sa cause.
//   3. Le bloc nginx contient les en-têtes `Upgrade`. Sans eux, le dashboard
//      se charge et paraît fonctionner pendant que le WebSocket échoue EN
//      SILENCE : aucun nœud ne se connecte, et rien n'explique pourquoi.

import { describe, expect, it } from 'vitest';
import {
  EXPOSITIONS,
  fusionner,
  planExposition,
  planProjet,
  type ReponsesExposition,
} from '../src/assistant.js';
import { LIMITS } from '../src/shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../src/shared/types.js';

const JETON_FORT = 'un-jeton-bien-assez-long-pour-passer';
const BASE: ReponsesExposition = { exposition: 'locale', port: 7777, jeton: JETON_FORT };

describe('la mise en ligne — les refus', () => {
  it('0.0.0.0 AVEC UN JETON TRIVIAL EST REFUSÉ, PAS AVERTI', () => {
    // Exposer une ruche protégée par « change-me » sur un réseau, c'est la
    // donner. Le refus vaut mieux que l'avertissement : un avertissement se
    // lit après coup.
    for (const jeton of ['', DEFAULT_TOKEN, 'court', 'x'.repeat(MIN_TOKEN_LENGTH - 1)]) {
      const plan = planExposition({ ...BASE, exposition: 'reseau_local', jeton });
      expect(plan.refus, `jeton « ${jeton} »`).not.toBeNull();
      expect(plan.reglages, 'un refus ne pose AUCUN réglage').toEqual([]);
      expect(plan.refus).toContain(String(MIN_TOKEN_LENGTH));
    }
  });

  it('avec un jeton correct, l’écoute réseau est acceptée — et dit ce qu’elle coûte', () => {
    const plan = planExposition({ ...BASE, exposition: 'reseau_local' });
    expect(plan.refus).toBeNull();
    expect(plan.reglages.find((r) => r.cle === 'HIVE_HOST')?.valeur).toBe('0.0.0.0');
    expect(plan.avertissements.join(' ')).toMatch(/EN CLAIR/);
  });

  it('un tunnel ou un proxy SANS DOMAINE est refusé', () => {
    for (const exposition of ['tunnel', 'proxy'] as const) {
      for (const domaine of [undefined, '', '   ', 'pas un domaine', 'http://x.fr']) {
        const plan = planExposition({ ...BASE, exposition, domaine });
        expect(plan.refus, `${exposition} / « ${domaine} »`).not.toBeNull();
        expect(plan.reglages).toEqual([]);
      }
    }
  });
});

describe('la mise en ligne — ce qui est posé', () => {
  it('le mode local n’ouvre rien, et le CORS n’est jamais « * »', () => {
    const plan = planExposition(BASE);
    expect(plan.reglages.find((r) => r.cle === 'HIVE_HOST')?.valeur).toBe('127.0.0.1');
    const cors = plan.reglages.find((r) => r.cle === 'HIVE_CORS_ORIGIN')?.valeur;
    expect(cors).toBe('http://localhost:7777');
    expect(cors).not.toContain('*');
  });

  it('AUCUN MODE NE POSE JAMAIS UN CORS EN « * »', () => {
    // La ruche refuse de démarrer avec « * » ; proposer cette valeur serait
    // livrer une configuration qui ne démarre pas.
    for (const exposition of EXPOSITIONS) {
      const plan = planExposition({ ...BASE, exposition, domaine: 'ruche.exemple.fr' });
      for (const r of plan.reglages) expect(r.valeur, `${exposition}/${r.cle}`).not.toBe('*');
    }
  });

  it('LE TUNNEL N’OUVRE AUCUN PORT — c’est tout son intérêt', () => {
    const plan = planExposition({ ...BASE, exposition: 'tunnel', domaine: 'ruche.exemple.fr' });
    expect(plan.refus).toBeNull();
    expect(plan.reglages.find((r) => r.cle === 'HIVE_HOST')?.valeur).toBe('127.0.0.1');
    expect(plan.reglages.find((r) => r.cle === 'HIVE_PUBLIC_URL')?.valeur).toBe(
      'wss://ruche.exemple.fr/ws',
    );
    // Les quatre étapes viennent de `cloudflare.ts`, pas d'une invention.
    expect(plan.etapes.map((e) => e.commande).join('\n')).toMatch(/cloudflared tunnel login/);
    expect(plan.etapes.map((e) => e.commande).join('\n')).toMatch(/route dns/);
  });

  it('le nom du tunnel a un défaut, et le choix est respecté', () => {
    const parDefaut = planExposition({ ...BASE, exposition: 'tunnel', domaine: 'a.exemple.fr' });
    expect(parDefaut.etapes.map((e) => e.commande).join(' ')).toContain('tunnel create hive');
    const choisi = planExposition({
      ...BASE,
      exposition: 'tunnel',
      domaine: 'a.exemple.fr',
      nomTunnel: 'ma-ruche',
    });
    expect(choisi.etapes.map((e) => e.commande).join(' ')).toContain('tunnel create ma-ruche');
  });

  it('LE BLOC NGINX PORTE LES EN-TÊTES UPGRADE — le piège classique', () => {
    // Sans eux, le dashboard se charge et paraît marcher pendant que le
    // WebSocket échoue en silence. Aucun nœud ne se connecte, et rien ne dit
    // pourquoi : c'est une soirée perdue pour qui suit la doc.
    const plan = planExposition({ ...BASE, exposition: 'proxy', domaine: 'ruche.exemple.fr' });
    const nginx = plan.etapes.find((e) => e.titre.toLowerCase().includes('nginx'));
    expect(nginx, 'aucun extrait nginx').toBeDefined();
    expect(nginx!.commande).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(nginx!.commande).toContain('proxy_set_header Connection "upgrade";');
    expect(nginx!.commande).toContain('proxy_http_version 1.1;');
  });

  it('Caddy est proposé en premier, parce qu’il est plus court et plus sûr', () => {
    const plan = planExposition({ ...BASE, exposition: 'proxy', domaine: 'ruche.exemple.fr' });
    expect(plan.etapes[0]?.titre.toLowerCase()).toContain('caddy');
    expect(plan.etapes[0]?.commande).toContain('reverse_proxy 127.0.0.1:7777');
  });

  it('chaque étape dit POURQUOI — une commande sans raison ne s’adapte pas', () => {
    for (const exposition of ['tunnel', 'proxy'] as const) {
      const plan = planExposition({ ...BASE, exposition, domaine: 'ruche.exemple.fr' });
      for (const e of plan.etapes) {
        expect(e.pourquoi.length, `${exposition} — « ${e.titre} »`).toBeGreaterThan(20);
        expect(e.commande.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('le premier projet', () => {
  it('compose une commande réelle, avec le nom échappé', () => {
    const plan = planProjet('Ma première ruche');
    expect(plan.refus).toBeNull();
    expect(plan.commande).toBe('npm run cli -- project "Ma première ruche"');
  });

  it('un nom avec des guillemets ne casse pas la commande', () => {
    // Le nom vient de l'humain : il finit dans un shell.
    expect(planProjet('le "grand" projet').commande).toContain('\\"grand\\"');
  });

  it('refuse ce qui n’est pas un nom', () => {
    expect(planProjet('').refus).not.toBeNull();
    expect(planProjet('   ').refus).not.toBeNull();
    expect(planProjet('x'.repeat(LIMITS.name + 1)).refus).toContain(String(LIMITS.name));
    // Un caractère de contrôle finit dans un terminal, un journal et une page
    // web : on le refuse à l'entrée plutôt que de l'échapper partout.
    expect(planProjet('projet\x1b[41m').refus).not.toBeNull();
  });

  it('n’accepte comme dépôt que ce que Hive sait cloner', () => {
    expect(planProjet('p', 'https://github.com/a/b').refus).toBeNull();
    expect(planProjet('p', 'git@github.com:a/b.git').refus).toBeNull();
    for (const mauvais of ['file:///etc', 'ftp://x', '../../etc/passwd', 'javascript:x']) {
      expect(planProjet('p', mauvais).refus, mauvais).not.toBeNull();
    }
  });

  it('sans dépôt, il le DIT plutôt que de laisser la surprise', () => {
    expect(planProjet('p').avertissements.join(' ')).toMatch(/espace vide/);
    expect(planProjet('p', 'https://github.com/a/b').avertissements).toEqual([]);
  });
});

describe('ce qui change dans le .env', () => {
  const propose = [
    { cle: 'HIVE_HOST', valeur: '127.0.0.1', pourquoi: 'x' },
    { cle: 'HIVE_CORS_ORIGIN', valeur: 'https://a.fr', pourquoi: 'y' },
    { cle: 'HIVE_PUBLIC_URL', valeur: 'wss://a.fr/ws', pourquoi: 'z' },
  ];

  it('AJOUTER ET REMPLACER NE SE CONFONDENT PAS', () => {
    // Remplacer efface une décision antérieure ; ajouter non. Les confondre
    // sous un même « écrire le .env » est ce qui rend un installeur effrayant.
    const existant = new Map([
      ['HIVE_HOST', '127.0.0.1'],
      ['HIVE_CORS_ORIGIN', 'http://localhost:5173'],
    ]);
    const f = fusionner(existant, propose);
    expect(f.inchangees.map((r) => r.cle)).toEqual(['HIVE_HOST']);
    expect(f.changements.map((r) => r.cle)).toEqual(['HIVE_CORS_ORIGIN']);
    expect(f.changements[0]?.ancienne).toBe('http://localhost:5173');
    expect(f.ajouts.map((r) => r.cle)).toEqual(['HIVE_PUBLIC_URL']);
  });

  it('un fichier vide ne donne que des ajouts', () => {
    const f = fusionner(new Map(), propose);
    expect(f.ajouts).toHaveLength(3);
    expect(f.changements).toEqual([]);
  });

  it('rien à proposer ne change rien', () => {
    const f = fusionner(new Map([['A', 'b']]), []);
    expect(f).toEqual({ ajouts: [], changements: [], inchangees: [] });
  });
});
