// CE QUE `hive join` ANNONCE À L'INVITÉ — et pourquoi se tromper de phrase coûte cher.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage de nuit : `transport === 'clair_public'`, mutée en
// `!==`, ne faisait rougir personne. Elle vit dans `join.ts`, qui finit par
// `await main()` — l'importer ouvrirait un WebSocket, donc aucun banc ne peut
// le charger (§ 2.8 du carnet). C'est la raison structurelle, pas un oubli.
//
// Le dépôt avait déjà tranché exactement ce cas pour l'installeur :
// `conseilServeur()` vit dans `installer.ts` (pur) « parce que `main()` court à
// l'import et qu'aucun test ne peut le lire — c'est là que le `&&` du conseil
// avait survécu au balayage, invisible ». Même cause, même remède.
//
// ─── CE QUI EST JUGÉ ICI, ET CE QUI NE L'EST PAS ─────────────────────────────
//
// `jugerTransport()` est pur et éprouvé ailleurs : savoir si une URL est sûre,
// privée ou publique n'est pas la question de ce fichier. Ce qui n'était tenu
// par RIEN, c'est la correspondance entre ce verdict et ce que l'invité LIT.
//
// Et les deux messages en clair ne disent pas la même chose du tout : l'un
// rassure à juste titre (réseau privé), l'autre prévient que la clé, les
// prompts, les logs et les diffs de code traverseront l'internet sans
// chiffrement. Les intervertir affiche « usuel en local » à quelqu'un qui
// s'apprête à envoyer son code source en clair.

import { describe, expect, it } from 'vitest';
import { annonceAgent, avertissementTransport } from '../src/node-client/annonces-join.js';
import { jugerTransport } from '../src/shared/acces.js';

describe('l’avertissement de transport', () => {
  it('UNE ADRESSE PUBLIQUE EN CLAIR EST DÉNONCÉE — et on dit ce qui voyage', () => {
    const dit = avertissementTransport('clair_public');
    expect(dit, 'il y a quelque chose à dire').not.toBeNull();
    expect(dit, 'le mot qui alerte').toContain('EN CLAIR');
    expect(dit, 'et le fait qu’il s’agit d’une adresse publique').toContain('publique');
    // Ce n'est pas seulement « votre mot de passe » : c'est le CODE SOURCE.
    expect(dit).toContain('clé');
    expect(dit).toContain('prompts');
    expect(dit).toContain('diffs de code');
    // Et on donne la sortie, sinon prévenir ne sert qu'à inquiéter.
    expect(dit, 'la solution est nommée').toContain('wss://');
  });

  it('UN RÉSEAU PRIVÉ EST DIT USUEL — jamais alarmant', () => {
    const dit = avertissementTransport('clair_prive');
    expect(dit).not.toBeNull();
    expect(dit, 'on rassure').toContain('usuel en local');
    // LA garde : la phrase rassurante ne doit RIEN emprunter à l'alarme.
    // Mutée, c'est elle qui s'afficherait devant une adresse publique.
    expect(dit, 'aucun mot d’alerte ici').not.toContain('EN CLAIR');
    expect(dit, 'et surtout pas « publique »').not.toContain('publique');
  });

  it('LES DEUX MESSAGES EN CLAIR SONT DISTINCTS — les confondre trompe DANS LES DEUX SENS', () => {
    // Muter la garde ne fait pas « perdre » un avertissement : elle les
    // ÉCHANGE. Celui qui envoie son code sur l'internet lit « usuel en local »,
    // et celui qui se connecte à sa propre machine est effrayé pour rien. Un
    // avertissement qui se trompe de situation apprend à ne plus le lire.
    expect(avertissementTransport('clair_public')).not.toBe(avertissementTransport('clair_prive'));
  });

  it('UN TRANSPORT CHIFFRÉ NE DIT RIEN — le silence est l’information', () => {
    // `wss://` : il n'y a rien à signaler, et meubler ferait du bruit dans
    // lequel le vrai avertissement se perdrait.
    expect(avertissementTransport('sur')).toBeNull();
  });

  it('UNE URL QUI N’EST PAS UNE RUCHE NE DIT RIEN NON PLUS — ce n’est pas ici qu’on refuse', () => {
    expect(avertissementTransport(null)).toBeNull();
  });

  it('BRANCHÉ SUR LE VRAI JUGE, LES TROIS CAS TOMBENT JUSTE', () => {
    // Le banc précédent juge la correspondance ; celui-ci vérifie que les deux
    // pièces s'emboîtent — un module pur peut être parfait et mal câblé.
    expect(avertissementTransport(jugerTransport('wss://ruche.example.com/ws'))).toBeNull();
    expect(avertissementTransport(jugerTransport('ws://192.168.1.20:8787/ws'))).toContain(
      'usuel en local',
    );
    expect(avertissementTransport(jugerTransport('ws://ruche.example.com/ws'))).toContain(
      'EN CLAIR',
    );
  });
});

describe('l’annonce de l’agent retenu', () => {
  it('UN VRAI AGENT NE S’ANNONCE PAS — il n’y a rien à expliquer', () => {
    expect(annonceAgent('claude-code', ['claude-code', 'shell'])).toBeNull();
    expect(annonceAgent('codex', ['codex', 'shell'])).toBeNull();
  });

  it('AUCUN AGENT INSTALLÉ : on le dit, ET on dit comment en sortir', () => {
    const dit = annonceAgent('shell', ['shell']);
    expect(dit).not.toBeNull();
    expect(dit, 'le constat').toContain('Aucun agent IA détecté');
    expect(dit, 'la sortie, sinon le constat est stérile').toContain('Installez Claude Code');
  });

  it('SIMULÉ FORCÉ ALORS QUE DE VRAIS AGENTS SONT LÀ : on nomme la VARIABLE', () => {
    // LA garde de cette fonction. Dire « aucun agent détecté » à quelqu'un qui
    // en a trois installés l'envoie réinstaller ce qu'il possède déjà, au lieu
    // de regarder `HIVE_AGENT`. Deux situations, deux phrases.
    const dit = annonceAgent('shell', ['claude-code', 'codex', 'shell']);
    expect(dit).not.toBeNull();
    expect(dit, 'c’est un CHOIX, pas une absence').toContain('HIVE_AGENT');
    expect(dit, 'et surtout pas « aucun agent »').not.toContain('Aucun agent IA détecté');
  });

  it('LES DEUX PHRASES DU MODE SIMULÉ SONT DISTINCTES', () => {
    expect(annonceAgent('shell', ['shell'])).not.toBe(
      annonceAgent('shell', ['claude-code', 'codex', 'shell']),
    );
  });

  it('UNE LISTE VIDE VAUT « AUCUN AGENT RÉEL » — pas une troisième phrase', () => {
    expect(annonceAgent('shell', [])).toContain('Aucun agent IA détecté');
  });
});
