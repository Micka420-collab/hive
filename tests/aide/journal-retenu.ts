// Une politique de rétention du journal pour les bancs qui n'en éprouvent que
// la FENÊTRE : les `n` derniers événements, l'échéance des preuves closes de la
// Reine (trente jours), et un plafond qui ne mord jamais. Un banc qui éprouve
// l'échéance ou le plafond écrit sa politique en entier, sous les yeux du
// lecteur.

import type { PolitiqueJournal } from '../../src/shared/retention-journal.js';

export const TRENTE_JOURS_MS = 30 * 24 * 60 * 60 * 1000;

export const fenetreSeule = (n: number): PolitiqueJournal => ({
  fenetre: n,
  preuvesClosesMs: TRENTE_JOURS_MS,
  plafond: Number.MAX_SAFE_INTEGER,
});
