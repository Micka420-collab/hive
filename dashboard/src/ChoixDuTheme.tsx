// Le choix du thème, dans la barre du haut : Système · Sombre · Clair.
//
// Un menu plutôt qu'une bascule à deux états : « système » est un TROISIÈME
// choix, pas l'un des deux autres. Une bascule sombre ↔ clair ne permettrait
// plus jamais de revenir à « suivre l'OS » une fois le premier clic donné.
//
// Le bouton montre le thème RÉSOLU par son glyphe (◐ pour « système ») et le
// dit en entier dans son nom accessible : « Thème : sombre ».

import { Menu } from './composants';
import { useT } from './i18n';
import { changerTheme, useChoixTheme } from './theme';
import type { ChoixTheme } from './theme';

const GLYPHE: Record<ChoixTheme, string> = { systeme: '◐', sombre: '☾', clair: '☀' };

export function ChoixDuTheme() {
  const t = useT();
  const choix = useChoixTheme();
  const nom: Record<ChoixTheme, string> = {
    systeme: t('Système', 'System'),
    sombre: t('Sombre', 'Dark'),
    clair: t('Clair', 'Light'),
  };
  return (
    <Menu
      className="mc-theme"
      testId="mc-theme"
      libelle={t(`Thème : ${nom[choix]}`, `Theme: ${nom[choix]}`)}
      declencheur={<span aria-hidden="true">{GLYPHE[choix]}</span>}
      elements={(['systeme', 'sombre', 'clair'] as const).map((c) => ({
        id: c,
        libelle: nom[c],
        coche: c === choix,
        onChoisir: () => changerTheme(c),
      }))}
    />
  );
}
