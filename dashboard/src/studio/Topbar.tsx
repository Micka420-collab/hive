// La barre du haut de Hive Studio — le contexte, pas une seconde navigation.
//
// À gauche : le projet actif (et le moyen d'en changer), puis DEUX voyants
// qui répondent à deux questions distinctes — l'écran reçoit-il la ruche ?
// une IA réelle peut-elle travailler ? Le premier était vert pendant que
// « 0 nœud actif » ne travaillait sur rien : deux questions, deux voyants.
// Au centre : la recherche (Ctrl/Cmd+K). À droite : les actions de la page,
// la palette des actions, ce qui exige l'attention, l'aide, la colonne, le
// compte. Aucune entrée du rail n'y est recopiée (#579).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { agentsConnectes, etatBandeau } from '../../../src/shared/agents-connectes';
import type { EtatBandeau } from '../../../src/shared/agents-connectes';
import type { HiveNode, Project } from '../../../src/shared/types';
import type { ViewId } from '../views/shared';
import { useGestes } from './gestes';
import { Icone } from './Icone';
import { normaliser } from './recherche';

export interface Attention {
  readonly id: string;
  readonly texte: string;
  readonly gravite: 'info' | 'attention' | 'critique';
  readonly aller: { vue: ViewId; id?: string } | null;
}

interface Props {
  projets: readonly Project[];
  projetActif: Project | null;
  onChoisirProjet: (id: string) => void;
  connecte: boolean;
  tropLent: boolean;
  jetonRefuse: boolean;
  noeuds: readonly HiveNode[];
  jeton: string;
  onJeton: (v: string) => void;
  onAppliquerJeton: () => void;
  onReconnecter: () => void;
  attentions: readonly Attention[];
  onNavigate: (vue: ViewId, id?: string) => void;
  colonneOuverte: boolean;
  focus: boolean;
  onFocus: () => void;
  onMenu: () => void;
  /** Les actions propres à la page courante (`topbar-actions`, dans `App.tsx`). */
  actions: ReactNode;
  compte: ReactNode;
}

/** Ferme un menu quand on clique ailleurs ou qu'on presse Échap. */
function useFermeture(ouvert: boolean, fermer: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fermer();
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fermer();
      }
    };
    document.addEventListener('mousedown', clic);
    document.addEventListener('keydown', touche, true);
    return () => {
      document.removeEventListener('mousedown', clic);
      document.removeEventListener('keydown', touche, true);
    };
  }, [ouvert, fermer]);
  return ref;
}

export type EtatLiaison = 'refuse' | 'hors_ligne' | 'reconnexion' | 'connecte';

/** L'écran reçoit-il la ruche ? Un jeton refusé l'emporte sur tout le reste. */
export function etatLiaison(
  connecte: boolean,
  jetonRefuse: boolean,
  tropLent: boolean,
): EtatLiaison {
  if (jetonRefuse) return 'refuse';
  if (connecte) return 'connecte';
  return tropLent ? 'reconnexion' : 'hors_ligne';
}

/** Le mot du voyant d'IA — les mêmes que l'ancien bandeau (`app-bandeau-ia`). */
export function motIA(
  etat: EtatBandeau,
  reels: readonly string[],
  t: (fr: string, en: string) => string,
): string {
  switch (etat) {
    case 'reelle':
      return reels.join(' · ');
    case 'simulee':
      return t('simulé — aucune IA', 'simulated — no AI');
    case 'aucune_ia':
      return t('aucune ouvrière en ligne', 'no worker online');
    case 'aucun_noeud':
      return t('aucune ouvrière', 'no worker');
  }
}

/** L'infobulle du voyant d'IA ; le cas rouge NOMME la commande à taper. */
export function titreIA(etat: EtatBandeau, t: (fr: string, en: string) => string): string {
  switch (etat) {
    case 'reelle':
      return t('Les IA qui codent réellement en ce moment', 'The AIs actually coding right now');
    case 'simulee':
      return t(
        'Seul un agent SIMULÉ répond : les diffs produits ne viennent d’aucune IA',
        'Only a SIMULATED agent answers: the diffs produced come from no AI',
      );
    case 'aucune_ia':
      return t(
        'Des ouvrières sont inscrites, aucune ne répond',
        'Workers are registered, none answers',
      );
    case 'aucun_noeud':
      return t(
        'Aucune ouvrière inscrite — lancez « npm run node » sur votre poste, ou invitez une machine',
        'No worker registered — run « npm run node » on your machine, or invite a machine',
      );
  }
}

export function Topbar(p: Props) {
  const t = useT();
  const gestes = useGestes();
  const raccourci = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  return (
    <header className="hs-topbar">
      <button
        type="button"
        className="hs-icone-btn hs-menu-mobile"
        onClick={p.onMenu}
        aria-label={t('Ouvrir la navigation', 'Open navigation')}
      >
        <Icone nom="menu" />
      </button>
      <SelecteurProjet {...p} />
      <div className="hs-statuts">
        <PastilleLiaison {...p} />
        <PastilleIA noeuds={p.noeuds} onNavigate={p.onNavigate} />
      </div>
      <button
        type="button"
        className="hs-recherche"
        onClick={() => gestes.ouvrirPalette('tout')}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label={t('Rechercher partout', 'Search everything')}
      >
        <Icone nom="recherche" taille={18} />
        <span className="hs-recherche-texte">{t('Rechercher partout…', 'Search everything…')}</span>
        <kbd>{raccourci}</kbd>
      </button>
      <div className="hs-topbar-droite">
        {p.actions}
        <button
          type="button"
          className="hs-btn contour"
          onClick={() => gestes.ouvrirPalette('commandes')}
        >
          <Icone nom="eclair" taille={16} />
          <span className="hs-cache-etroit">{t('Actions', 'Actions')}</span>
        </button>
        <Notifications {...p} />
        <Aide />
        <button
          type="button"
          className={`hs-icone-btn${p.colonneOuverte ? ' actif' : ''}`}
          onClick={gestes.basculerColonne}
          aria-pressed={p.colonneOuverte}
          aria-label={
            p.colonneOuverte
              ? t('Masquer le panneau des agents', 'Hide agents panel')
              : t('Afficher le panneau des agents', 'Show agents panel')
          }
          title={t('Agents et collaboration', 'Agents and collaboration')}
        >
          <Icone nom="panneauDroit" />
        </button>
        <button
          type="button"
          data-masquable=""
          className={`hs-icone-btn${p.focus ? ' actif' : ''}`}
          onClick={p.onFocus}
          aria-pressed={p.focus}
          aria-label={
            p.focus ? t('Quitter le mode focus', 'Leave focus mode') : t('Mode focus', 'Focus mode')
          }
          title={t('Mode focus : masquer les panneaux latéraux', 'Focus mode: hide side panels')}
        >
          <Icone nom={p.focus ? 'reduire' : 'agrandir'} />
        </button>
        <div className="hs-compte">{p.compte}</div>
      </div>
    </header>
  );
}

function SelecteurProjet({ projets, projetActif, onChoisirProjet }: Props) {
  const t = useT();
  const gestes = useGestes();
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');
  const fermer = useCallback(() => setOuvert(false), []);
  const ref = useFermeture(ouvert, fermer);
  const liste = projets.filter((x) => normaliser(x.name).includes(normaliser(filtre)));
  return (
    <div className="hs-selecteur" ref={ref}>
      <button
        type="button"
        className="hs-selecteur-btn"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        title={projetActif?.name}
      >
        <Icone nom="projets" taille={18} />
        <span className="hs-cache-etroit hs-discret">{t('Projet :', 'Project:')}</span>
        <strong>{projetActif?.name ?? t('aucun', 'none')}</strong>
        <Icone nom="chevronBas" taille={16} />
      </button>
      {ouvert && (
        <div className="hs-popover">
          {projets.length > 6 && (
            <input
              type="search"
              autoFocus
              className="hs-champ"
              placeholder={t('Filtrer les projets…', 'Filter projects…')}
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              aria-label={t('Filtrer les projets', 'Filter projects')}
            />
          )}
          <ul role="listbox" aria-label={t('Projets', 'Projects')} className="hs-liste">
            {liste.map((x) => (
              <li key={x.id} role="option" aria-selected={x.id === projetActif?.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChoisirProjet(x.id);
                    setOuvert(false);
                  }}
                >
                  <span>{x.name}</span>
                  {x.id === projetActif?.id && <Icone nom="coche" taille={16} />}
                </button>
              </li>
            ))}
            {liste.length === 0 && (
              <li>
                <span className="hs-discret">{t('Aucun projet', 'No project')}</span>
              </li>
            )}
          </ul>
          <div className="hs-popover-pied">
            <button
              type="button"
              className="hs-btn petit"
              onClick={() => {
                setOuvert(false);
                gestes.nouveauProjet();
              }}
            >
              <Icone nom="plus" taille={14} /> {t('Nouveau projet', 'New project')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PastilleLiaison({
  connecte,
  tropLent,
  jetonRefuse,
  jeton,
  onJeton,
  onAppliquerJeton,
  onReconnecter,
}: Props) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const fermer = useCallback(() => setOuvert(false), []);
  const ref = useFermeture(ouvert, fermer);
  const etat = etatLiaison(connecte, jetonRefuse, tropLent);
  // Un jeton refusé ouvre le panneau de lui-même : c'est là qu'on le corrige.
  useEffect(() => {
    if (jetonRefuse) setOuvert(true);
  }, [jetonRefuse]);
  const ton = etat === 'connecte' ? 'ok' : etat === 'reconnexion' ? 'attention' : 'echec';
  const mot =
    etat === 'connecte'
      ? t('Connecté', 'Connected')
      : etat === 'reconnexion'
        ? t('Reconnexion…', 'Reconnecting…')
        : etat === 'refuse'
          ? t('Jeton refusé', 'Token rejected')
          : t('Hors ligne', 'Offline');
  return (
    <div className="hs-liaison" ref={ref}>
      <button
        type="button"
        className={`hs-pastille ton-${ton} cliquable`}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        data-testid="mc-liaison"
        data-etat={etat}
        title={t('La liaison de cet écran avec la ruche', 'This screen’s link with the hive')}
      >
        <span className="hs-point" aria-hidden="true" />
        <span className="hs-liaison-mot">{mot}</span>
      </button>
      {ouvert && (
        <div
          className="hs-popover large"
          role="dialog"
          aria-label={t('Liaison avec la ruche', 'Hive connection')}
        >
          <p>
            {etat === 'connecte' &&
              t(
                'Cet écran reçoit la ruche en direct : chaque tâche, chaque machine, chaque verdict.',
                'This screen receives the hive live: every task, machine and verdict.',
              )}
            {etat === 'hors_ligne' &&
              t(
                'L’écran ne reçoit plus la ruche. Il se reconnecte seul, puis rattrape le journal.',
                'The screen no longer receives the hive. It reconnects on its own, then catches up the journal.',
              )}
            {etat === 'reconnexion' &&
              t(
                'Cet écran lisait moins vite que la Reine n’écrivait : elle l’a coupé pour borner sa mémoire. Il se reconnecte seul, puis rattrape le journal.',
                'This screen read slower than the Queen wrote: she cut it to bound her memory. It reconnects on its own, then catches up the journal.',
              )}
            {etat === 'refuse' &&
              t(
                'Jeton refusé : collez ici la valeur exacte de HIVE_TOKEN (fichier .env de l’orchestrateur). Ce n’est pas le jeton GitHub.',
                'Token rejected: paste the exact HIVE_TOKEN value here (orchestrator .env file). This is not the GitHub token.',
              )}
          </p>
          <label className="hs-etiquette" htmlFor="hs-jeton">
            {t('Jeton de la ruche (x-hive-token)', 'Hive token (x-hive-token)')}
          </label>
          <div className="hs-ligne">
            <input
              id="hs-jeton"
              type="password"
              className={`hs-champ token-input${jetonRefuse ? ' invalide token-input-err' : ''}`}
              value={jeton}
              autoComplete="off"
              placeholder={t('Jeton', 'Token')}
              onChange={(e) => onJeton(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAppliquerJeton()}
              aria-invalid={jetonRefuse || undefined}
            />
            <button type="button" className="hs-btn" onClick={onAppliquerJeton}>
              {t('Appliquer', 'Apply')}
            </button>
          </div>
          {etat !== 'connecte' && (
            <div className="hs-popover-pied">
              <button type="button" className="hs-btn petit" onClick={onReconnecter}>
                {t('Réessayer maintenant', 'Retry now')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PastilleIA({
  noeuds,
  onNavigate,
}: {
  noeuds: readonly HiveNode[];
  onNavigate: (vue: ViewId) => void;
}) {
  const t = useT();
  const gestes = useGestes();
  const agents = useMemo(() => agentsConnectes(noeuds), [noeuds]);
  const etat = etatBandeau(agents);
  const reels = agents.filter((a) => a.enLigne > 0 && !a.simule).map((a) => a.libelle);
  return (
    <button
      type="button"
      className={`hs-ia mc-ia mc-ia-${etat}`}
      data-testid="mc-ia"
      title={titreIA(etat, t)}
      onClick={() =>
        etat === 'reelle' ? onNavigate('essaim') : gestes.ouvrirInvitation('machine')
      }
    >
      <span className="conn-dot" aria-hidden="true" />
      <Icone nom="etincelles" taille={14} />
      <span data-testid="mc-ia-mot">{motIA(etat, reels, t)}</span>
    </button>
  );
}

function Notifications({ attentions, onNavigate }: Props) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const fermer = useCallback(() => setOuvert(false), []);
  const ref = useFermeture(ouvert, fermer);
  const critique = attentions.some((a) => a.gravite === 'critique');
  return (
    <div className="hs-menu-ancre" ref={ref}>
      <button
        type="button"
        className="hs-icone-btn"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label={
          attentions.length > 0
            ? t(
                `${attentions.length} point(s) demandent ton attention`,
                `${attentions.length} item(s) need your attention`,
              )
            : t('Rien ne demande ton attention', 'Nothing needs your attention')
        }
        onClick={() => setOuvert((o) => !o)}
      >
        <Icone nom="cloche" />
        {attentions.length > 0 && (
          <span className={`hs-cloche-point${critique ? ' critique' : ''}`} aria-hidden="true" />
        )}
      </button>
      {ouvert && (
        <div
          className="hs-popover droite large"
          role="dialog"
          aria-label={t('Ce qui demande ton attention', 'What needs your attention')}
        >
          <p className="hs-popover-titre">{t('À traiter', 'To handle')}</p>
          {attentions.length === 0 ? (
            <p className="hs-discret">
              {t('Rien ne demande ton attention.', 'Nothing needs your attention.')}
            </p>
          ) : (
            <ul className="hs-liste">
              {attentions.map((a) => (
                <li key={a.id} className={`gravite-${a.gravite}`}>
                  {a.aller ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOuvert(false);
                        onNavigate(a.aller!.vue, a.aller!.id);
                      }}
                    >
                      <span className="hs-point" aria-hidden="true" />
                      <span className="hs-liste-texte">{a.texte}</span>
                    </button>
                  ) : (
                    <span>
                      <span className="hs-point" aria-hidden="true" />
                      <span className="hs-liste-texte">{a.texte}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Aide() {
  const t = useT();
  const gestes = useGestes();
  const [ouvert, setOuvert] = useState(false);
  const fermer = useCallback(() => setOuvert(false), []);
  const ref = useFermeture(ouvert, fermer);
  const choisir = (f: () => void) => () => {
    setOuvert(false);
    f();
  };
  return (
    <div className="hs-menu-ancre" data-masquable="" ref={ref}>
      <button
        type="button"
        className="hs-icone-btn"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={t('Aide', 'Help')}
        onClick={() => setOuvert((o) => !o)}
      >
        <Icone nom="aide" />
      </button>
      {ouvert && (
        <ul className="hs-menu droite" role="menu">
          <li role="none">
            <button type="button" role="menuitem" onClick={choisir(gestes.ouvrirRaccourcis)}>
              {t('Raccourcis clavier', 'Keyboard shortcuts')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={choisir(gestes.revoirGuide)}>
              {t('Revoir le guide de démarrage', 'Replay the getting-started guide')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={choisir(gestes.ouvrirReglages)}>
              {t('Réglages', 'Settings')}
            </button>
          </li>
          <li role="none">
            <a
              role="menuitem"
              href="https://github.com/Micka420-collab/hive/blob/main/docs/FONCTIONNALITES.md"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOuvert(false)}
            >
              {t('Documentation', 'Documentation')}
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
