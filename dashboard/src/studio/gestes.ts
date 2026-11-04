// Les gestes globaux de Hive Studio, offerts à tout ce qui est monté dans le shell.
//
// La palette, l'invitation, les réglages, l'aide : des dialogues GLOBAUX, que
// l'accueil, la barre, le rail, la colonne et la palette elle-même ouvrent.
// Les passer de prop en prop à travers quatorze vues aurait été le vrai coût ;
// un contexte les rend disponibles sans que les vues existantes changent.

import { createContext, useContext } from 'react';

export type GenreInvitation = 'machine' | 'personne';

export interface GestesStudio {
  ouvrirPalette(mode?: 'tout' | 'commandes'): void;
  ouvrirInvitation(genre?: GenreInvitation): void;
  ouvrirReglages(): void;
  ouvrirRaccourcis(): void;
  /** Ouvre (ou referme) la colonne de droite. */
  basculerColonne(): void;
  nouveauProjet(): void;
  /** Relance le guide de démarrage, même ignoré. */
  revoirGuide(): void;
}

const RIEN: GestesStudio = {
  ouvrirPalette: () => undefined,
  ouvrirInvitation: () => undefined,
  ouvrirReglages: () => undefined,
  ouvrirRaccourcis: () => undefined,
  basculerColonne: () => undefined,
  nouveauProjet: () => undefined,
  revoirGuide: () => undefined,
};

export const ContexteStudio = createContext<GestesStudio>(RIEN);

export function useGestes(): GestesStudio {
  return useContext(ContexteStudio);
}
