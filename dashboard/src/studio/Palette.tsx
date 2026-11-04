// La palette — Ctrl/Cmd + K : chercher partout, et agir sans quitter le clavier.
//
// ─── CE QU'ELLE CHERCHE, ET CE QU'ELLE DIT NE PAS CHERCHER ───────────────────
//
// Elle cherche dans ce que l'écran a DÉJÀ : l'instantané temps réel (projets,
// tâches, machines), les pages, et les commandes. Aucune route de recherche
// n'existe côté Reine, et la palette n'en invente pas : les FICHIERS se
// cherchent dans « Code », qui lit le dépôt — le pied de la palette le dit.
//
// ─── LE MOTIF D'ACCESSIBILITÉ ────────────────────────────────────────────────
//
// Une combobox : le focus RESTE dans le champ, les flèches déplacent l'option
// active (`aria-activedescendant`), Entrée l'exécute, Échap ferme. Les groupes
// sont des `role="group"` nommés : un lecteur d'écran annonce « Projets »
// avant le premier projet.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLang, useT } from '../i18n';
import { statusLabel } from '../ui';
import { useDialog, Voile } from '../ui';
import type { ViewId } from '../views/shared';
import { libelleAgent } from '../../../src/shared/agent-libelle';
import type { HiveNode, Project, Task } from '../../../src/shared/types';
import { Icone } from './Icone';
import type { NomIcone } from './Icone';
import { section, sectionDeVue } from './navigation';
import { aPlat, rechercher } from './recherche';
import type { EntreePalette, GroupePalette } from './recherche';

/** Une page offerte par la palette — lue dans la `NAV` d'`App.tsx`. */
export interface VuePalette {
  readonly id: ViewId;
  readonly label: string;
  readonly labelEn: string;
  readonly ancien?: string;
  readonly ancienEn?: string;
  readonly key: string;
}

/** Une commande : un geste du studio, déjà lié à son effet. */
export interface CommandePalette {
  readonly id: string;
  readonly titre: string;
  readonly sousTitre?: string;
  readonly alias?: readonly string[];
  readonly icone: NomIcone;
  readonly raccourci?: string;
  readonly faire: () => void;
}

interface Action {
  readonly icone: NomIcone;
  readonly raccourci?: string;
  readonly faire: () => void;
}

interface Props {
  mode: 'tout' | 'commandes';
  onFermer: () => void;
  commandes: readonly CommandePalette[];
  vues: readonly VuePalette[];
  projets: readonly Project[];
  taches: readonly Task[];
  noeuds: readonly HiveNode[];
  onNavigate: (vue: ViewId, id?: string) => void;
  onOuvrirTache: (id: string) => void;
  onChoisirProjet: (id: string) => void;
}

/** Au plus ce nombre de tâches indexées : les plus récentes. */
export const TACHES_INDEXEES = 400;

export function entreesPalette(
  p: Omit<Props, 'onFermer'>,
  anglais: boolean,
): EntreePalette<Action>[] {
  const out: EntreePalette<Action>[] = [];
  for (const c of p.commandes) {
    out.push({
      id: `c:${c.id}`,
      groupe: 'commandes',
      titre: c.titre,
      sousTitre: c.sousTitre,
      alias: c.alias,
      action: { icone: c.icone, raccourci: c.raccourci, faire: c.faire },
    });
  }
  if (p.mode === 'commandes') return out;

  const derniere = new Map<string, number>();
  for (const x of p.taches)
    derniere.set(x.projectId, Math.max(derniere.get(x.projectId) ?? 0, x.updatedAt));
  const nomProjet = new Map(p.projets.map((x) => [x.id, x.name]));
  for (const pr of p.projets) {
    out.push({
      id: `p:${pr.id}`,
      groupe: 'projets',
      titre: pr.name,
      sousTitre: pr.description ?? pr.repoUrl ?? undefined,
      recence: derniere.get(pr.id) ?? pr.createdAt,
      action: {
        icone: 'projets',
        faire: () => {
          p.onChoisirProjet(pr.id);
          p.onNavigate('studio');
        },
      },
    });
  }

  const recentes = [...p.taches]
    .filter((x) => !x.ombre)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, TACHES_INDEXEES);
  for (const x of recentes) {
    out.push({
      id: `t:${x.id}`,
      groupe: 'missions',
      titre: x.title,
      sousTitre: `${statusLabel(x.status, anglais ? 'en' : 'fr')} · ${nomProjet.get(x.projectId) ?? '—'}`,
      alias: [x.id],
      recence: x.updatedAt,
      action: { icone: 'missions', faire: () => p.onOuvrirTache(x.id) },
    });
  }

  for (const n of p.noeuds) {
    out.push({
      id: `n:${n.id}`,
      groupe: 'agents',
      titre: n.name,
      sousTitre: `${libelleAgent(n.agentType)} · ${n.status === 'online' ? (anglais ? 'online' : 'en ligne') : anglais ? 'offline' : 'hors ligne'}`,
      alias: [n.ownerName, n.agentType],
      recence: n.lastSeen ?? undefined,
      action: { icone: 'machine', faire: () => p.onNavigate('chambre', n.id) },
    });
  }

  for (const v of p.vues) {
    const s = section(sectionDeVue(v.id));
    out.push({
      id: `v:${v.id}`,
      groupe: 'vues',
      titre: anglais ? v.labelEn : v.label,
      sousTitre: anglais ? s.labelEn : s.label,
      alias: [v.label, v.labelEn, v.ancien, v.ancienEn].filter((a): a is string => Boolean(a)),
      action: { icone: 'fleche', raccourci: v.key, faire: () => p.onNavigate(v.id) },
    });
  }
  return out;
}

function nomGroupe(g: GroupePalette, t: (fr: string, en: string) => string): string {
  switch (g) {
    case 'commandes':
      return t('Actions', 'Actions');
    case 'projets':
      return t('Projets', 'Projects');
    case 'missions':
      return t('Tâches', 'Tasks');
    case 'agents':
      return t('Machines', 'Machines');
    case 'vues':
      return t('Pages', 'Pages');
  }
}

function Cadre({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="modal hs-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Palette"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function Palette(props: Props) {
  const t = useT();
  const lang = useLang();
  const base = useId();
  const [requete, setRequete] = useState('');
  const [actif, setActif] = useState(0);
  const liste = useRef<HTMLDivElement>(null);

  const entrees = useMemo(() => entreesPalette(props, lang === 'en'), [props, lang]);
  const groupes = useMemo(() => rechercher(entrees, requete), [entrees, requete]);
  const plat = useMemo(() => aPlat(groupes), [groupes]);

  useEffect(() => setActif(0), [requete]);

  // L'option active reste visible quand les flèches la font sortir du cadre.
  useEffect(() => {
    liste.current
      ?.querySelector<HTMLElement>(`[data-rang="${actif}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [actif]);

  const executer = (e: EntreePalette<Action> | undefined) => {
    if (!e) return;
    props.onFermer();
    // Après la fermeture : un geste qui ouvre un autre dialogue ne doit pas
    // le voir refermé par le démontage de celui-ci.
    window.setTimeout(e.action.faire, 0);
  };

  const idOption = (i: number) => `${base}-o${i}`;
  let rang = -1;

  return (
    <Voile onClose={props.onFermer}>
      <Cadre onClose={props.onFermer}>
        <div className="hs-palette-saisie">
          <Icone nom="recherche" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${base}-liste`}
            aria-activedescendant={plat.length > 0 ? idOption(actif) : undefined}
            aria-autocomplete="list"
            aria-label={t('Rechercher', 'Search')}
            placeholder={
              props.mode === 'commandes'
                ? t('Que voulez-vous faire ?', 'What do you want to do?')
                : t(
                    'Projets, tâches, machines, pages, actions…',
                    'Projects, tasks, machines, pages, actions…',
                  )
            }
            value={requete}
            onChange={(e) => setRequete(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActif((a) => (plat.length === 0 ? 0 : (a + 1) % plat.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActif((a) => (plat.length === 0 ? 0 : (a - 1 + plat.length) % plat.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                executer(plat[actif]);
              }
            }}
          />
          <kbd>{t('Échap', 'Esc')}</kbd>
        </div>
        <div
          className="hs-palette-resultats"
          id={`${base}-liste`}
          role="listbox"
          ref={liste}
          aria-label={t('Résultats', 'Results')}
        >
          {plat.length === 0 && (
            <p className="hs-vide">
              {t(`Rien ne correspond à « ${requete} ».`, `Nothing matches “${requete}”.`)}
            </p>
          )}
          {groupes.map((g) => (
            <div key={g.groupe} role="group" aria-labelledby={`${base}-g-${g.groupe}`}>
              <p className="hs-palette-groupe" id={`${base}-g-${g.groupe}`}>
                {nomGroupe(g.groupe, t)}
              </p>
              <ul className="hs-palette-liste" role="presentation">
                {g.entrees.map((e) => {
                  rang += 1;
                  const i = rang;
                  return (
                    <li
                      key={e.id}
                      id={idOption(i)}
                      role="option"
                      aria-selected={i === actif}
                      data-rang={i}
                      className="hs-palette-entree"
                      onMouseMove={() => setActif(i)}
                      onClick={() => executer(e)}
                    >
                      <Icone nom={e.action.icone} taille={18} />
                      <span className="hs-palette-textes">
                        <span>{e.titre}</span>
                        {e.sousTitre && <span className="hs-discret">{e.sousTitre}</span>}
                      </span>
                      {e.action.raccourci && <kbd>{e.action.raccourci}</kbd>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <footer className="hs-palette-pied">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('choisir', 'move')}
          </span>
          <span>
            <kbd>{t('Entrée', 'Enter')}</kbd> {t('ouvrir', 'open')}
          </span>
          <span className="hs-discret">
            {t('Les fichiers se cherchent dans « Code ».', 'Search files in “Code”.')}
          </span>
        </footer>
      </Cadre>
    </Voile>
  );
}
