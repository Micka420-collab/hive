// L'invitation qui ne mène nulle part.
//
// ─── LE DÉFAUT MESURÉ ────────────────────────────────────────────────────────
//
// Une ruche démarrée sans `HIVE_HOST` n'écoute que sur `127.0.0.1`. Elle
// fabrique pourtant une invitation vers son IP de réseau local, parce que
// c'est l'adresse qu'un ami devrait utiliser. Cette invitation est INVALIDE :
// personne d'autre que cette machine ne peut ouvrir la socket. L'ami colle la
// commande, elle échoue par un timeout, et rien dans l'interface ne dit
// pourquoi — c'est le « je peux pas inviter un ami » rapporté.
//
// Le diagnostic est purement local (deux chaînes), donc il se teste sans
// serveur — et l'interface peut le rendre mot pour mot.

import { describe, expect, it } from 'vitest';
import { inviteInjoignable } from '../src/shared/joignable.js';
import { libelleAgent } from '../src/shared/agent-libelle.js';

describe('l’invitation prévient quand elle ne peut pas aboutir', () => {
  it('écoute locale + adresse annoncée distante ⇒ on le dit, avec le remède', () => {
    const dit = inviteInjoignable('127.0.0.1', 'ws://192.168.1.20:7777/ws');
    expect(dit, 'le cas fautif doit parler').toBeTruthy();
    expect(dit, 'sans le remède, l’alerte laisse sur place').toContain('HIVE_HOST=0.0.0.0');
    expect(dit).toContain('192.168.1.20');
  });

  it('la ruche ouverte au réseau ne dit rien — il n’y a rien à corriger', () => {
    expect(inviteInjoignable('0.0.0.0', 'ws://192.168.1.20:7777/ws')).toBeNull();
    expect(inviteInjoignable('192.168.1.20', 'ws://192.168.1.20:7777/ws')).toBeNull();
  });

  it('une invitation qui pointe vers la machine elle-même est cohérente', () => {
    // Travailler seul sur sa propre machine est un usage NORMAL : y crier à
    // l'erreur apprendrait à ignorer l'alerte.
    expect(inviteInjoignable('127.0.0.1', 'ws://127.0.0.1:7777/ws')).toBeNull();
    expect(inviteInjoignable('localhost', 'ws://localhost:7777/ws')).toBeNull();
    expect(inviteInjoignable('::1', 'ws://[::1]:7777/ws')).toBeNull();
  });

  it('une URL illisible ne déclenche pas d’alarme inventée', () => {
    expect(inviteInjoignable('127.0.0.1', 'pas-une-url')).toBeNull();
  });
});

describe('l’agent se dit avec le nom que l’humain connaît', () => {
  it('les identifiants techniques deviennent des noms de marque', () => {
    expect(libelleAgent('claude-code')).toBe('Claude Code');
    expect(libelleAgent('codex')).toBe('Codex');
  });

  it('le repli DIT qu’il est simulé — « shell » ne prévenait personne', () => {
    expect(libelleAgent('shell')).toContain('simulé');
    expect(libelleAgent('shell', true)).toContain('simulated');
  });

  it('un agent inconnu garde sa clé — inventer un nom tromperait plus', () => {
    expect(libelleAgent('mon-ia-maison')).toBe('mon-ia-maison');
  });
});
