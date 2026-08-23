// Croiser le binaire et la clé — la composition, éprouvée sans machine réelle.
//
// `connexion-agent.ts` tient la RÈGLE (module pur, ses propres bancs).
// Ce fichier tient ce que `connexion.ts` en fait : interroger les deux sources,
// et n'annoncer que ce qui est VRAI.

import { describe, expect, it } from 'vitest';
import {
  conseilDemarrage,
  diagnostiquerAgents,
  unAgentEstPret,
} from '../src/node-client/connexion.js';
import { AGENTS_A_IDENTIFIANTS_CONNUS } from '../src/node-client/agent-detect.js';
import type { AgentType } from '../src/node-client/agent-detect.js';
import { readFileSync } from 'node:fs';
import { PAQUETS } from '../src/shared/connexion-agent.js';
import { libelleAgent } from '../src/shared/agent-libelle.js';

/** Un poste : quels binaires, quel environnement. Rien n'est touché sur disque. */
function poste(opts: { binaires?: AgentType[]; env?: NodeJS.ProcessEnv } = {}) {
  return {
    agentsPresents: () => Promise.resolve(opts.binaires ?? []),
    env: opts.env ?? {},
    // Aucun dossier de session locale : sans cela, un `~/.claude` présent sur
    // la machine du banc ferait passer la clé pour présente.
    existe: () => false,
    plateforme: 'linux',
  };
}

describe('le diagnostic croise les deux sources', () => {
  it('un poste nu : rien n’est prêt, et rien ne se pose tout seul', async () => {
    const etats = await diagnostiquerAgents(poste());
    expect(etats.some((e) => e.verdict === 'pret')).toBe(false);
    expect(etats.some((e) => e.poseAutomatique)).toBe(false);
  });

  it('un poste nu : ceux qu’on sait lire disent « rien », les autres « inconnue »', async () => {
    // La distinction que le tri-état apporte. Avant lui, TOUT rendait « rien »
    // — y compris pour un agent dont la ruche n'avait jamais su lire la clé.
    const etats = await diagnostiquerAgents(poste());
    for (const e of etats) {
      const attendu = AGENTS_A_IDENTIFIANTS_CONNUS.includes(e.agent as never)
        ? 'rien'
        : 'cle_inconnue';
      expect(e.verdict, `${e.agent}`).toBe(attendu);
    }
  });

  it('LA SENTINELLE : la liste des agents lisibles suit les BRANCHES de la fonction', async () => {
    // `AGENTS_A_IDENTIFIANTS_CONNUS` recopie à la main les agents que
    // `requisitionSiCredentialsManquantes` sait vraiment juger. Je l'ai écrite
    // de mémoire une première fois, et j'ai oublié `cursor` : le diagnostic
    // annonçait alors « clé inconnue » pour un agent dont la ruche sait
    // parfaitement lire les identifiants.
    //
    // On lit donc les branches dans la SOURCE plutôt que de les retenir.
    const source = readFileSync(
      new URL('../src/node-client/agent-detect.js', import.meta.url).pathname.replace(
        /\.js$/,
        '.ts',
      ),
      'utf8',
    );
    const corps = source.slice(
      source.indexOf('export function requisitionSiCredentialsManquantes'),
    );
    const branches = [...corps.matchAll(/if \(agent === '([a-z-]+)'\)/g)]
      .map((m) => m[1]!)
      // `shell` et `custom` sortent par la garde du haut : ils n'ont pas
      // d'identifiants du tout, ce qui n'est pas la même chose qu'inconnus.
      .filter((a) => a !== 'shell' && a !== 'custom');

    expect([...AGENTS_A_IDENTIFIANTS_CONNUS].sort()).toEqual([...new Set(branches)].sort());
  });

  it('LE CAS DE L’UTILISATEUR : la clé est dans .env, le binaire manque', async () => {
    const etats = await diagnostiquerAgents(poste({ env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }));
    const claude = etats.find((e) => e.agent === 'claude-code')!;
    expect(claude.cle).toBe('presente');
    expect(claude.binaire).toBe(false);
    expect(claude.verdict).toBe('binaire_manquant');
    expect(claude.poseAutomatique).toBe(true);
  });

  it('binaire présent et clé présente : prêt', async () => {
    const etats = await diagnostiquerAgents(
      poste({ binaires: ['claude-code'], env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }),
    );
    expect(etats.find((e) => e.agent === 'claude-code')!.verdict).toBe('pret');
  });

  it('binaire présent, clé absente : il faut un humain, pas un paquet', async () => {
    const etats = await diagnostiquerAgents(poste({ binaires: ['codex'] }));
    const codex = etats.find((e) => e.agent === 'codex')!;
    expect(codex.verdict).toBe('cle_manquante');
    expect(codex.poseAutomatique).toBe(false);
  });

  it('chaque agent est jugé avec SA clé, jamais celle d’un autre', async () => {
    const etats = await diagnostiquerAgents(poste({ env: { OPENAI_API_KEY: 'sk-de-banc' } }));
    expect(etats.find((e) => e.agent === 'codex')!.cle).toBe('presente');
    expect(etats.find((e) => e.agent === 'claude-code')!.cle).toBe('absente');
    expect(etats.find((e) => e.agent === 'grok')!.cle).toBe('absente');
  });

  it('`shell` n’est pas interrogé — il n’a ni binaire à poser ni clé à porter', async () => {
    const etats = await diagnostiquerAgents(poste({ binaires: ['shell'] }));
    expect(etats.map((e) => e.agent)).not.toContain('shell');
    expect(etats.map((e) => e.agent)).not.toContain('custom');
  });

  it('l’ordre est TOTAL : le prêt d’abord, le réparable ensuite', async () => {
    const etats = await diagnostiquerAgents(
      poste({
        binaires: ['codex'],
        env: { OPENAI_API_KEY: 'sk-a', ANTHROPIC_API_KEY: 'sk-b' },
      }),
    );
    expect(etats[0]!.agent).toBe('codex');
    expect(etats[0]!.verdict).toBe('pret');
    expect(etats[1]!.agent).toBe('claude-code');
    expect(etats[1]!.poseAutomatique).toBe(true);
  });

  it('deux appels sur le même poste rendent la MÊME liste', async () => {
    const p = poste({ env: { ANTHROPIC_API_KEY: 'sk-de-banc', XAI_API_KEY: 'sk-x' } });
    const a = await diagnostiquerAgents(p);
    const b = await diagnostiquerAgents(p);
    expect(a.map((e) => e.agent)).toEqual(b.map((e) => e.agent));
  });
});

describe('le conseil au démarrage', () => {
  it('nomme LA commande exacte quand la clé est déjà là', async () => {
    const etats = await diagnostiquerAgents(poste({ env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }));
    const texte = conseilDemarrage(etats);
    expect(texte).toContain('npm install -g @anthropic-ai/claude-code');
    expect(texte).toContain('Claude Code');
  });

  it('se tait quand aucune clé n’est là — installer ne servirait à rien', async () => {
    // Un binaire posé sans identifiants donne un agent qui refuse de
    // travailler : l'utilisateur aurait suivi le conseil pour rien.
    expect(conseilDemarrage(await diagnostiquerAgents(poste()))).toBeNull();
  });

  it('se tait aussi quand tout est déjà prêt', async () => {
    const etats = await diagnostiquerAgents(
      poste({ binaires: ['claude-code'], env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }),
    );
    expect(conseilDemarrage(etats)).toBeNull();
  });

  it('ne recrache JAMAIS la valeur de la clé', async () => {
    const etats = await diagnostiquerAgents(
      poste({ env: { ANTHROPIC_API_KEY: 'sk-secret-a-ne-pas-imprimer' } }),
    );
    expect(conseilDemarrage(etats)).not.toContain('sk-secret');
    expect(conseilDemarrage(etats, 'en')).not.toContain('sk-secret');
  });

  it('parle anglais quand on le lui demande', async () => {
    const etats = await diagnostiquerAgents(poste({ env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }));
    expect(conseilDemarrage(etats, 'en')).toContain('only its CLI is missing');
  });
});

describe('la sentinelle de l’équivalence', () => {
  it('tout agent du catalogue porte un libellé INDÉPENDANT de la langue', () => {
    // Ce banc ne défend pas un comportement : il défend une ÉQUIVALENCE.
    //
    // Dans `conseilDemarrage`, la loupe a montré que muter `lang === 'en'` en
    // `!==` ne change rien. C'est vrai — mais seulement parce que les deux
    // agents du catalogue s'appellent « Claude Code » et « Codex » dans les
    // deux langues. Cette vérité tient à une COÏNCIDENCE du catalogue, pas à
    // une propriété du code.
    //
    // Le jour où quelqu'un ajoute à `PAQUETS` un agent dont le nom se traduit,
    // l'équivalence tombe — et sans ce banc, elle tomberait EN SILENCE, en
    // laissant derrière elle un commentaire qui affirmerait le contraire.
    for (const agent of Object.keys(PAQUETS)) {
      expect(
        libelleAgent(agent, false),
        `« ${agent} » se traduit : l’équivalence notée dans connexion.ts ne tient plus`,
      ).toBe(libelleAgent(agent, true));
    }
  });
});

describe('un agent est-il prêt ?', () => {
  it('non sur un poste nu', async () => {
    expect(unAgentEstPret(await diagnostiquerAgents(poste()))).toBe(false);
  });

  it('non quand il ne manque QUE le binaire — la clé seule ne code pas', async () => {
    const etats = await diagnostiquerAgents(poste({ env: { ANTHROPIC_API_KEY: 'sk-de-banc' } }));
    expect(unAgentEstPret(etats)).toBe(false);
  });

  it('oui dès qu’un agent réel a binaire ET clé', async () => {
    const etats = await diagnostiquerAgents(
      poste({ binaires: ['grok'], env: { XAI_API_KEY: 'sk-de-banc' } }),
    );
    expect(unAgentEstPret(etats)).toBe(true);
  });
});
