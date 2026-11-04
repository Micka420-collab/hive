// Les deux dialogues de l'aide : les Réglages de l'écran, et les Raccourcis clavier.
//
// ─── CE QUE LES RÉGLAGES TOUCHENT, ET CE QU'ILS NE TOUCHENT PAS ─────────────
//
// Uniquement l'AFFICHAGE, et uniquement dans CE navigateur (`localStorage`) :
// le thème, la langue, le panorama, la colonne, le rail, le guide. Rien ne
// part à la Reine — aucune route n'est ajoutée pour des préférences d'écran,
// et rien de ce qui se règle ici ne change ce que la ruche fait.

import type { ReactNode } from 'react';
import { setLang, useLang, useT } from '../i18n';
import { useDialog, Voile } from '../ui';
import { Icone } from './Icone';
import { choisirTheme, CLES, ecrire, lireBooleen, lireTheme, usePreference } from './preferences';
import type { ThemeChoisi } from './preferences';

function Cadre({
  titre,
  onClose,
  children,
}: {
  titre: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const t = useT();
  return (
    <div
      ref={ref}
      className="modal hs-dialogue"
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="hs-dialogue-tete">
        <h2>{titre}</h2>
        <button
          type="button"
          className="hs-icone-btn"
          onClick={onClose}
          aria-label={t('Fermer', 'Close')}
        >
          <Icone nom="croix" />
        </button>
      </header>
      <div className="hs-dialogue-corps">{children}</div>
    </div>
  );
}

function Choix<T extends string>({
  libelle,
  valeur,
  options,
  onChoisir,
}: {
  libelle: string;
  valeur: T;
  options: readonly { v: T; nom: string }[];
  onChoisir: (v: T) => void;
}) {
  return (
    <div className="hs-segment" role="radiogroup" aria-label={libelle}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={valeur === o.v}
          className={valeur === o.v ? 'actif' : undefined}
          onClick={() => onChoisir(o.v)}
        >
          {o.nom}
        </button>
      ))}
    </div>
  );
}

function Interrupteur({
  libelle,
  actif,
  onBasculer,
}: {
  libelle: string;
  actif: boolean;
  onBasculer: () => void;
}) {
  const t = useT();
  return (
    <div className="hs-segment" role="radiogroup" aria-label={libelle}>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={actif === v}
          className={actif === v ? 'actif' : undefined}
          onClick={() => actif !== v && onBasculer()}
        >
          {v ? t('Oui', 'On') : t('Non', 'Off')}
        </button>
      ))}
    </div>
  );
}

export function Reglages({
  onFermer,
  onRevoirGuide,
}: {
  onFermer: () => void;
  onRevoirGuide: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const theme = usePreference(CLES.theme, lireTheme);
  const banniere = usePreference(CLES.banniere, (v) => lireBooleen(v, true));
  const colonne = usePreference(CLES.colonne, (v) => lireBooleen(v, true));
  const rail = usePreference(CLES.rail, (v) => lireBooleen(v, false));

  const ligne = (titre: string, aide: string, controle: ReactNode) => (
    <div className="hs-reglage">
      <div>
        <strong>{titre}</strong>
        <p className="hs-discret">{aide}</p>
      </div>
      {controle}
    </div>
  );

  return (
    <Voile onClose={onFermer}>
      <Cadre titre={t('Réglages', 'Settings')} onClose={onFermer}>
        <h3>{t('Apparence', 'Appearance')}</h3>
        {ligne(
          t('Thème', 'Theme'),
          t('« Automatique » suit le réglage du système.', '“Auto” follows the system setting.'),
          <Choix<ThemeChoisi>
            libelle={t('Thème', 'Theme')}
            valeur={theme}
            onChoisir={choisirTheme}
            options={[
              { v: 'sombre', nom: t('Sombre', 'Dark') },
              { v: 'clair', nom: t('Clair', 'Light') },
              { v: 'auto', nom: t('Automatique', 'Auto') },
            ]}
          />,
        )}
        {ligne(
          t('Langue', 'Language'),
          t(
            'L’interface entière, messages d’erreur compris.',
            'The whole interface, error messages included.',
          ),
          <Choix<'fr' | 'en'>
            libelle={t('Langue', 'Language')}
            valeur={lang}
            onChoisir={setLang}
            options={[
              { v: 'fr', nom: 'Français' },
              { v: 'en', nom: 'English' },
            ]}
          />,
        )}
        {ligne(
          t('Panorama de l’accueil', 'Home panorama'),
          t(
            'L’image derrière le titre. Sans elle, l’accueil est plus compact.',
            'The picture behind the title. Without it, home is more compact.',
          ),
          <Interrupteur
            libelle={t('Panorama de l’accueil', 'Home panorama')}
            actif={banniere}
            onBasculer={() => ecrire(CLES.banniere, banniere ? '0' : '1')}
          />,
        )}
        <h3>{t('Disposition', 'Layout')}</h3>
        {ligne(
          t('Colonne des agents sur l’accueil', 'Agents column on home'),
          t(
            'Sur un écran large. Ailleurs, elle s’ouvre en tiroir.',
            'On a wide screen. Elsewhere it opens as a drawer.',
          ),
          <Interrupteur
            libelle={t('Colonne des agents sur l’accueil', 'Agents column on home')}
            actif={colonne}
            onBasculer={() => ecrire(CLES.colonne, colonne ? '0' : '1')}
          />,
        )}
        {ligne(
          t('Navigation repliée', 'Collapsed navigation'),
          t(
            'Les icônes seules ; chaque nom reste en infobulle.',
            'Icons only; each name stays in a tooltip.',
          ),
          <Interrupteur
            libelle={t('Navigation repliée', 'Collapsed navigation')}
            actif={rail}
            onBasculer={() => ecrire(CLES.rail, rail ? '0' : '1')}
          />,
        )}
        {ligne(
          t('Guide de démarrage', 'Getting-started guide'),
          t('Les trois étapes de la colonne des agents.', 'The three steps in the agents column.'),
          <button
            type="button"
            className="hs-btn petit"
            onClick={() => {
              onFermer();
              onRevoirGuide();
            }}
          >
            {t('Revoir', 'Replay')}
          </button>,
        )}
        <p className="hs-discret">
          {t(
            'Ces réglages restent dans ce navigateur. Ils ne changent rien à ce que fait la ruche.',
            'These settings stay in this browser. They change nothing about what the hive does.',
          )}
        </p>
      </Cadre>
    </Voile>
  );
}

export interface RaccourciVue {
  readonly key: string;
  readonly nom: string;
}

export function Raccourcis({
  onFermer,
  vues,
}: {
  onFermer: () => void;
  vues: readonly RaccourciVue[];
}) {
  const t = useT();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const touche = (k: string) => <kbd key={k}>{k}</kbd>;
  const lignes: [ReactNode, string][] = [
    [
      <>
        {touche(mac ? '⌘' : 'Ctrl')}
        {touche('K')}
      </>,
      t('Rechercher partout, lancer une action', 'Search everything, run an action'),
    ],
    [touche('?'), t('Cette aide', 'This help')],
    [
      touche(t('Échap', 'Esc')),
      t('Fermer un dialogue, un tiroir, un menu', 'Close a dialog, drawer or menu'),
    ],
    [
      touche(t('Entrée', 'Enter')),
      t(
        'Dans la saisie de l’accueil : préparer le plan (ou envoyer la question)',
        'In the home input: prepare the plan (or send the question)',
      ),
    ],
    [
      <>
        {touche(t('Maj', 'Shift'))}
        {touche(t('Entrée', 'Enter'))}
      </>,
      t('Aller à la ligne dans la saisie', 'New line in the input'),
    ],
  ];
  return (
    <Voile onClose={onFermer}>
      <Cadre titre={t('Raccourcis clavier', 'Keyboard shortcuts')} onClose={onFermer}>
        <h3>{t('Partout', 'Everywhere')}</h3>
        <dl className="hs-raccourcis">
          {lignes.map(([k, d], i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <h3>{t('Pages (hors saisie)', 'Pages (outside inputs)')}</h3>
        <dl className="hs-raccourcis">
          {vues.map((v) => (
            <div key={v.key} style={{ display: 'contents' }}>
              <dt>{touche(v.key)}</dt>
              <dd>{v.nom}</dd>
            </div>
          ))}
        </dl>
        <h3>{t('Dans « Validation »', 'In “Review”')}</h3>
        <dl className="hs-raccourcis">
          <dt>
            {touche('j')}
            {touche('k')}
          </dt>
          <dd>{t('Production suivante, précédente', 'Next, previous production')}</dd>
          <dt>{touche('a')}</dt>
          <dd>{t('Approuver', 'Approve')}</dd>
          <dt>{touche('x')}</dt>
          <dd>{t('Refuser', 'Reject')}</dd>
          <dt>{touche('u')}</dt>
          <dd>{t('Annuler le verdict', 'Undo the verdict')}</dd>
        </dl>
      </Cadre>
    </Voile>
  );
}
