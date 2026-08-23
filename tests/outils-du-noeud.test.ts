// Croiser les CONSTATS d'un nœud avec ce que la ruche SAIT faire de chaque outil.
//
// Le nœud dit ce qu'il voit sur sa machine ; le catalogue dit jusqu'où la ruche
// va. Ce module tient la jonction, et ces bancs tiennent la promesse qui la
// justifie : un outil PRÉSENT n'est pas un outil PILOTABLE, et l'écran ne doit
// jamais laisser croire l'inverse.

import { describe, expect, it } from 'vitest';
import { OUTILS, type Niveau, rangNiveau } from '../src/shared/catalogue-outils.js';
import { combienPilotables, direOutil, outilsDuNoeud } from '../src/shared/outils-du-noeud.js';
import { juger } from '../src/shared/connexion-agent.js';
import type { OutilConstate } from '../src/shared/protocol.js';

const pose = (
  agent: string,
  binaire = true,
  cle: OutilConstate['cle'] = 'presente',
): OutilConstate => ({
  agent,
  binaire,
  cle,
});

describe('les outils d’un nœud, croisés avec le catalogue', () => {
  it('un outil INSTALLÉ dont la ruche ne sait QUE la détection n’est pas pilotable', () => {
    // LA PROMESSE CENTRALE. Windsurf peut être parfaitement installé, avec sa
    // clé posée : la ruche ne sait pas lui donner une tâche. Afficher « prêt »
    // ici serait vrai de l'OUTIL et faux de la RUCHE — et c'est la ruche qu'on
    // regarde quand on ouvre ce tableau.
    const [w] = outilsDuNoeud([pose('windsurf')]);
    expect(w!.verdict).toBe('pret'); // la machine, elle, est prête
    expect(w!.niveau).toBe('detecte');
    expect(w!.pilotable).toBe(false); // la ruche ne l'est pas
    expect(w!.limite).not.toBeNull(); // et elle DIT pourquoi
  });

  it('un outil que la ruche exécute, binaire et clé posés, est pilotable', () => {
    const [c] = outilsDuNoeud([pose('cline')]);
    expect(c!.nom).toBe('Cline');
    expect(c!.niveau).toBe('execute');
    expect(c!.pilotable).toBe(true);
  });

  it('les DEUX conditions, jamais une seule', () => {
    // Niveau suffisant mais machine incomplète : pas pilotable.
    expect(outilsDuNoeud([pose('cline', false, 'presente')])[0]!.pilotable).toBe(false);
    expect(outilsDuNoeud([pose('cline', true, 'absente')])[0]!.pilotable).toBe(false);
    expect(outilsDuNoeud([pose('cline', false, 'absente')])[0]!.pilotable).toBe(false);
    // Machine complète mais niveau insuffisant : pas pilotable non plus.
    expect(outilsDuNoeud([pose('shell')])[0]!.niveau).toBe('connecte');
    expect(outilsDuNoeud([pose('shell')])[0]!.pilotable).toBe(false);
  });

  it('une clé NON LISIBLE n’est pas une clé absente', () => {
    const [o] = outilsDuNoeud([pose('windsurf', true, 'inconnue')]);
    expect(o!.verdict).toBe('cle_inconnue');
    expect(direOutil(o!)).toContain('non lisible');
    expect(direOutil(o!, 'en')).toContain('unreadable');
    // Le piège que ce tri-état évite : conseiller de poser une clé DÉJÀ posée.
    expect(direOutil(o!)).not.toContain('absente');
    expect(direOutil(o!, 'en')).not.toContain('missing');
  });

  it('un outil INCONNU du catalogue garde son identifiant et n’a PAS de niveau', () => {
    // Un nœud plus récent que le hub annoncera des outils qu'on ne sait pas
    // situer. Lui inventer un niveau serait précisément le mensonge que
    // l'échelle sert à empêcher.
    const [x] = outilsDuNoeud([pose('outil-de-demain')]);
    expect(x!.nom).toBe('outil-de-demain');
    expect(x!.niveau).toBeNull();
    expect(x!.pilotable).toBe(false);
    expect(x!.limite).toBeNull();
  });

  it('LA SENTINELLE : chaque niveau rendu vient du CATALOGUE, jamais d’ici', () => {
    // Une copie de la table des niveaux dans ce module dériverait en silence :
    // le catalogue bougerait, l'écran continuerait d'annoncer l'ancien niveau.
    // On compare donc outil par outil, sur le catalogue ENTIER.
    for (const fiche of OUTILS) {
      const [vu] = outilsDuNoeud([pose(fiche.id)]);
      expect(vu!.niveau, fiche.id).toBe(fiche.niveau);
      expect(vu!.nom, fiche.id).toBe(fiche.nom);
      expect(vu!.limite, fiche.id).toBe(fiche.limite ?? null);
      // Et la règle du pilotable se relit depuis le catalogue, pas de mémoire.
      expect(vu!.pilotable, fiche.id).toBe(rangNiveau(fiche.niveau) >= rangNiveau('execute'));
    }
  });

  it('LA SENTINELLE : le verdict est celui de `juger`, pas une seconde règle', () => {
    // Deux règles qui disent la même chose finissent par ne plus la dire. Le
    // nœud juge avec `connexion-agent.ts` ; le hub doit juger PAREIL, sinon
    // l'écran et le terminal se contredisent sur la même machine.
    const cles: OutilConstate['cle'][] = ['presente', 'absente', 'inconnue'];
    for (const agent of ['claude-code', 'cursor', 'windsurf', 'inconnu-du-catalogue']) {
      for (const binaire of [true, false]) {
        for (const cle of cles) {
          const [vu] = outilsDuNoeud([{ agent, binaire, cle }]);
          expect(vu!.verdict, `${agent} ${String(binaire)} ${cle}`).toBe(
            juger({ agent, binaire, cle }).verdict,
          );
        }
      }
    }
  });

  it('l’ordre est TOTAL et ne dépend pas de l’ordre d’arrivée', () => {
    // Un écran qui se réordonne d'un rafraîchissement à l'autre est illisible.
    // `aaa-inconnu` et non `zzz-…` : son nom trierait AVANT « Windsurf », le
    // plus bas du catalogue. S'il partageait le rang de `detecte` au lieu de
    // passer dessous, il remonterait — c'est ce qui rend le rang de l'inconnu
    // MESURÉ plutôt que décoratif. Un `zzz-…` restait dernier dans les deux
    // cas, et laissait passer la mutation.
    const ids = ['shell', 'windsurf', 'claude-code', 'cline', 'cursor', 'aaa-inconnu'];
    const droit = outilsDuNoeud(ids.map((i) => pose(i))).map((o) => o.id);
    const envers = outilsDuNoeud([...ids].reverse().map((i) => pose(i))).map((o) => o.id);
    expect(envers).toEqual(droit);

    // Niveau décroissant : `claude-code` (contexte) avant les `execute`, et
    // l'inconnu tout à la fin — on ne coupe pas la liste avec ce qu'on ignore.
    expect(droit[0]).toBe('claude-code');
    expect(droit.at(-1)).toBe('aaa-inconnu');
    const rangs = outilsDuNoeud(ids.map((i) => pose(i))).map((o) =>
      o.niveau === null ? -1 : rangNiveau(o.niveau as Niveau),
    );
    expect([...rangs].sort((a, b) => b - a)).toEqual(rangs);
  });

  it('à niveau égal, l’ordre suit le NOM — et il départage vraiment', () => {
    // Sans ce second critère, deux outils de même niveau s'échangeraient au
    // gré du tri : la garde du dessus passerait quand même.
    const memeNiveau = outilsDuNoeud(['grok', 'cline', 'cursor', 'codex'].map((i) => pose(i)));
    expect(memeNiveau.map((o) => o.niveau)).toEqual(['execute', 'execute', 'execute', 'execute']);
    expect(memeNiveau.map((o) => o.nom)).toEqual(['Cline', 'Codex', 'Cursor', 'Grok Build']);
  });

  it('le compte des pilotables ne compte QUE les pilotables', () => {
    const vus = outilsDuNoeud([
      pose('cline'), // pilotable
      pose('cursor'), // pilotable
      pose('windsurf'), // niveau trop bas
      pose('codex', true, 'absente'), // clé absente
      pose('inconnu'), // hors catalogue
    ]);
    expect(combienPilotables(vus)).toBe(2);
    expect(combienPilotables([])).toBe(0);
  });

  it('une liste vide rend une liste vide — pas une invention', () => {
    expect(outilsDuNoeud([])).toEqual([]);
  });
});
