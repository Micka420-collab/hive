// @vitest-environment happy-dom
//
// L'ÉCRAN QUI DISAIT « ARBITRAGE HUMAIN » POUR RIEN.
//
// La Miellerie affichait « Pas de quorum — arbitrage humain » dès que deux
// agents rendaient des octets différents. Sur du code, c'est TOUJOURS le cas :
// deux IA qui font exactement la même correction ne l'écrivent pas pareil. Un
// relecteur lisait donc « ils ne sont pas d'accord, tranchez » alors que rien
// n'avait été mesuré.
//
// ─── CE QUE CE FICHIER TIENT ─────────────────────────────────────────────────
//
// · le libellé ne prétend plus au constat de désaccord ;
// · la SURFACE s'affiche, et se distingue des factions ;
// · un désaccord sur l'ENDROIT est signalé, parce que c'est la seule
//   divergence que cet écran mesure vraiment ;
// · une abstention (diff illisible) se VOIT — un zéro silencieux se lirait
//   comme « tout le monde a été pris en compte ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConsensusPanel } from '../src/views/Miellerie';
import { setLang } from '../src/i18n';
import type { Verdict } from '../src/api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root;

async function monter(element: React.ReactElement): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine.render(element);
  });
}

const texte = (): string => (conteneur.textContent ?? '').replace(/\s+/g, ' ');
const compte = (sel: string): number => conteneur.querySelectorAll(sel).length;

beforeAll(() => {
  setLang('fr');
});

afterEach(async () => {
  await act(async () => {
    racine.unmount();
  });
  conteneur.remove();
});

/** Un verdict complet, qu'on retouche cas par cas. */
const verdict = (patch: Partial<Verdict>): Verdict => ({
  outcome: 'no_quorum',
  winner: null,
  factions: [
    { signature: 'aaaa1111', votes: 1, nodeIds: ['n1'], agentTypes: ['claude-code'], diversity: 1 },
    { signature: 'bbbb2222', votes: 1, nodeIds: ['n2'], agentTypes: ['codex'], diversity: 1 },
  ],
  quorum: 2,
  surfaces: [
    {
      fichiers: ['src/auth.ts'],
      votes: 2,
      nodeIds: ['n1', 'n2'],
      agentTypes: ['claude-code', 'codex'],
      diversity: 2,
    },
  ],
  sansSurface: 0,
  ...patch,
});

describe('LE LIBELLÉ NE PRÉTEND PLUS AU CONSTAT', () => {
  it('« pas de quorum » ne dit plus « arbitrage humain »', async () => {
    // C'était l'erreur : présenter une absence de mesure comme un désaccord
    // constaté. Le mot « arbitrage » n'a plus rien à faire là.
    await monter(<ConsensusPanel verdict={verdict({})} error={null} />);
    expect(texte()).not.toContain('arbitrage');
    expect(texte()).toContain('Sorties toutes différentes');
  });

  it('…et il EXPLIQUE que c’est le résultat attendu sur du code', async () => {
    // Sans cette phrase, le nouveau libellé serait juste plus sec : il faut
    // dire pourquoi, sinon le relecteur refait la même déduction fausse.
    await monter(<ConsensusPanel verdict={verdict({})} error={null} />);
    expect(texte()).toContain('Attendu sur du code');
    expect(texte()).toContain('ne rendent pas les mêmes octets');
  });

  it('un consensus textuel ne se vend pas plus cher qu’il ne vaut', async () => {
    // « Consensus atteint » sur du code voulait dire, en pratique, que les deux
    // agents étaient identiques. Le libellé dit maintenant ce qui a été mesuré.
    await monter(
      <ConsensusPanel
        verdict={verdict({
          outcome: 'elected',
          winner: {
            signature: 'aaaa1111',
            votes: 2,
            nodeIds: ['n1', 'n2'],
            agentTypes: ['claude-code', 'codex'],
            diversity: 2,
          },
        })}
        error={null}
      />,
    );
    expect(texte()).toContain('Sorties identiques');
    expect(texte()).toContain('exactement les mêmes octets');
  });
});

describe('LA SURFACE — ce que l’écran ne montrait pas du tout', () => {
  it('elle s’affiche, avec ses fichiers et ses agents', async () => {
    await monter(<ConsensusPanel verdict={verdict({})} error={null} />);
    expect(compte('.mi-surf')).toBe(1);
    expect(texte()).toContain('Où le changement a été fait');
    expect(texte()).toContain('src/auth.ts');
    expect(texte()).toContain('2 voix');
  });

  it('UN SEUL LIEU se dit « accord sur le lieu, pas sur le code »', async () => {
    // La nuance est tout le sujet : la surface n'est pas un consensus.
    await monter(<ConsensusPanel verdict={verdict({})} error={null} />);
    expect(texte()).toContain('pas sur le code');
    expect(compte('.mi-surf-alerte'), 'aucune alerte : un seul lieu').toBe(0);
  });

  it('DEUX LIEUX LÈVENT UNE ALERTE — c’est le seul désaccord réel', async () => {
    // L'identité textuelle rendait le même `no_quorum` dans les deux cas et
    // noyait donc cette divergence-ci, la seule qui soit mesurée.
    await monter(
      <ConsensusPanel
        verdict={verdict({
          surfaces: [
            {
              fichiers: ['src/auth.ts'],
              votes: 1,
              nodeIds: ['n1'],
              agentTypes: ['claude-code'],
              diversity: 1,
            },
            {
              fichiers: ['src/server.ts'],
              votes: 1,
              nodeIds: ['n2'],
              agentTypes: ['codex'],
              diversity: 1,
            },
          ],
        })}
        error={null}
      />,
    );
    expect(compte('.mi-surf-alerte')).toBe(1);
    expect(texte()).toContain('ne sont pas d’accord sur l’ENDROIT');
    expect(texte()).toContain('src/auth.ts');
    expect(texte()).toContain('src/server.ts');
    expect(texte(), 'et surtout pas « accord sur le lieu »').not.toContain('pas sur le code');
  });

  it('UN SEUL AGENT n’est pas un accord avec lui-même', async () => {
    // Une surface à une voix ne dit rien : personne n'a confirmé le lieu.
    // L'annoncer comme un accord serait exactement le mensonge rassurant.
    await monter(
      <ConsensusPanel
        verdict={verdict({
          factions: [
            {
              signature: 'aaaa1111',
              votes: 1,
              nodeIds: ['n1'],
              agentTypes: ['claude-code'],
              diversity: 1,
            },
          ],
          surfaces: [
            {
              fichiers: ['src/auth.ts'],
              votes: 1,
              nodeIds: ['n1'],
              agentTypes: ['claude-code'],
              diversity: 1,
            },
          ],
        })}
        error={null}
      />,
    );
    expect(texte(), 'une voix seule n’est pas un accord').not.toContain('pas sur le code');
    expect(compte('.mi-surf-alerte'), 'ni un désaccord').toBe(0);
    expect(texte(), 'mais le lieu reste affiché').toContain('src/auth.ts');
  });

  it('L’ABSTENTION SE VOIT : un diff illisible n’est pas un accord', async () => {
    await monter(<ConsensusPanel verdict={verdict({ sansSurface: 2 })} error={null} />);
    expect(texte()).toContain('2 bulletin(s) sans diff lisible');
    expect(texte()).toContain('pas comptés comme d’accord');
  });

  it('rien à montrer, rien de montré — pas un panneau vide trompeur', async () => {
    await monter(
      <ConsensusPanel
        verdict={verdict({
          outcome: 'no_ballots',
          factions: [],
          surfaces: [],
          sansSurface: 0,
        })}
        error={null}
      />,
    );
    expect(compte('.mi-surf'), 'aucun cadre « où » sans donnée').toBe(0);
    expect(texte()).toContain('Aucun bulletin');
  });
});
