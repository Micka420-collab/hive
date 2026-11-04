// La colonne de droite : qui travaille, ce qui vient de se passer, avec qui.
//
// ─── TROIS CARTES, ET UN GUIDE QUI S'EN VA ───────────────────────────────────
//
//   · AGENTS — les machines inscrites : leur outil, leur état, leur charge,
//     la tâche qu'elles tiennent. « + Agent » invite une machine (billet
//     éphémère, #575). Aucune ⇒ l'écran dit quoi faire.
//   · ACTIVITÉ — les faits récents du journal (`activite.ts`), du projet actif
//     et de la ruche ; « Voir tout » ouvre l'historique complet.
//   · COLLABORER — les membres du projet quand il y a un compte, et le bouton
//     « Inviter » qui sépare une PERSONNE d'une MACHINE.
//
// Le guide de démarrage (3 étapes, ignorable, rejouable depuis l'aide) se pose
// au-dessus tant qu'il n'est ni ignoré ni accompli.

import { useEffect, useMemo, useState } from 'react';
import { fetchMembresProjet } from '../api';
import type { AuthUser } from '../api';
import { useLang, useT } from '../i18n';
import { useApiPoll } from '../views/shared';
import type { ViewId } from '../views/shared';
import { agentsConnectes, aUneIaReelle } from '../../../src/shared/agents-connectes';
import type { HiveEvent, HiveNode, Project, Task } from '../../../src/shared/types';
import { activiteRecente, ilYA } from './activite';
import type { GenreActivite } from './activite';
import { cartesAgents, etatAgent, initiales } from './agents-vue';
import type { CarteAgent } from './agents-vue';
import { deposerBrouillon } from './Composeur';
import { useGestes } from './gestes';
import { Icone } from './Icone';
import type { NomIcone } from './Icone';
import { CLES, ecrire, lireGuide, usePreference } from './preferences';

interface Props {
  projet: Project | null;
  projets: readonly Project[];
  noeuds: readonly HiveNode[];
  taches: readonly Task[];
  events: readonly HiveEvent[];
  user: AuthUser | null;
  refreshTick: number;
  onNavigate: (vue: ViewId, id?: string) => void;
  onOuvrirTache: (id: string) => void;
  /** En tiroir (petits écrans, vues denses) : un bouton pour refermer. */
  enTiroir: boolean;
  onFermer: () => void;
}

export function ColonneDroite(p: Props) {
  const t = useT();
  return (
    <aside
      className={`hs-colonne${p.enTiroir ? ' tiroir' : ''}`}
      aria-label={t('Agents et collaboration', 'Agents and collaboration')}
    >
      {p.enTiroir && (
        <div className="hs-colonne-tete">
          <span>{t('Agents et collaboration', 'Agents and collaboration')}</span>
          <button
            type="button"
            className="hs-icone-btn"
            onClick={p.onFermer}
            aria-label={t('Fermer le panneau', 'Close panel')}
          >
            <Icone nom="croix" />
          </button>
        </div>
      )}
      <GuideDemarrage projets={p.projets} noeuds={p.noeuds} taches={p.taches} />
      <CarteAgents {...p} />
      <CarteActivite {...p} />
      <CarteCollaborer {...p} />
    </aside>
  );
}

// ─── Agents ──────────────────────────────────────────────────────────────────

const ICONE_OUTIL: Record<string, NomIcone> = {
  'claude-code': 'etincelles',
  codex: 'code',
  cursor: 'code',
  cline: 'code',
  'hermes-agent': 'agents',
  shell: 'machine',
};

function CarteAgents({ noeuds, taches, onNavigate, onOuvrirTache }: Props) {
  const t = useT();
  const lang = useLang();
  const gestes = useGestes();
  const cartes = useMemo(() => cartesAgents(noeuds, taches, lang === 'en'), [noeuds, taches, lang]);
  const enLigne = cartes.filter((c) => c.enLigne).length;
  return (
    <section className="hs-carte" aria-labelledby="hs-agents-titre">
      <header className="hs-carte-tete">
        <h2 id="hs-agents-titre">
          <Icone nom="agents" />
          {t('Agents', 'Agents')}
          <span className="hs-compte-titre">
            {cartes.length > 0 &&
              t(`${enLigne}/${cartes.length} en ligne`, `${enLigne}/${cartes.length} online`)}
          </span>
        </h2>
        <button
          type="button"
          className="hs-btn primaire petit"
          onClick={() => gestes.ouvrirInvitation('machine')}
        >
          <Icone nom="plus" taille={16} />
          {t('Agent', 'Agent')}
        </button>
      </header>
      {cartes.length === 0 ? (
        <div className="hs-vide-carte">
          <p>
            {t(
              'Aucun agent connecté. Un agent est une machine qui fait tourner Claude Code, Codex ou un autre outil de codage pour la ruche.',
              'No agent connected. An agent is a machine running Claude Code, Codex or another coding tool for the hive.',
            )}
          </p>
          <button
            type="button"
            className="hs-btn"
            onClick={() => gestes.ouvrirInvitation('machine')}
          >
            {t('Connecter un agent', 'Connect an agent')}
          </button>
        </div>
      ) : (
        <ul className="hs-agents">
          {cartes.slice(0, 6).map((c) => (
            <LigneAgent
              key={c.id}
              carte={c}
              onNavigate={onNavigate}
              onOuvrirTache={onOuvrirTache}
            />
          ))}
          {cartes.length > 6 && (
            <li>
              <button type="button" className="hs-lien" onClick={() => onNavigate('essaim')}>
                {t(`et ${cartes.length - 6} autre(s)…`, `and ${cartes.length - 6} more…`)}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function LigneAgent({
  carte,
  onNavigate,
  onOuvrirTache,
}: {
  carte: CarteAgent;
  onNavigate: Props['onNavigate'];
  onOuvrirTache: Props['onOuvrirTache'];
}) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const etat = etatAgent(carte);
  const motEtat =
    etat === 'hors_ligne'
      ? t('hors ligne', 'offline')
      : etat === 'plein'
        ? t('à pleine charge', 'at full capacity')
        : etat === 'occupe'
          ? t('au travail', 'working')
          : t('disponible', 'available');
  return (
    <li className={`hs-agent etat-${etat}`}>
      <span className="hs-agent-avatar" aria-hidden="true">
        <Icone nom={ICONE_OUTIL[carte.agentType] ?? 'agents'} />
        <span className="hs-agent-pastille" />
      </span>
      <div className="hs-agent-corps">
        <strong>{carte.nom}</strong>
        <span className="hs-discret">
          {carte.outil}
          {/* « simulé » une fois : le libellé du shell le dit déjà. */}
          {carte.simule &&
            !carte.outil.includes(t('simulé', 'simulated')) &&
            ` · ${t('simulé', 'simulated')}`}{' '}
          · <span className="hs-visuellement-cache">{motEtat}</span>
          <span aria-hidden="true">{motEtat}</span>
          {carte.capacite > 0 && carte.enLigne && ` · ${carte.actives}/${carte.capacite}`}
        </span>
        {carte.tache && (
          <button
            type="button"
            className="hs-lien hs-agent-tache"
            onClick={() => onOuvrirTache(carte.tache!.id)}
          >
            {carte.tache.titre}
          </button>
        )}
      </div>
      <div className="hs-menu-ancre">
        <button
          type="button"
          className="hs-icone-btn"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={t(`Actions pour ${carte.nom}`, `Actions for ${carte.nom}`)}
          onClick={() => setMenu((m) => !m)}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null))
              setMenu(false);
          }}
        >
          <Icone nom="plusPoints" taille={18} />
        </button>
        {menu && (
          <ul className="hs-menu droite" role="menu">
            <li role="none">
              <button type="button" role="menuitem" onClick={() => onNavigate('chambre', carte.id)}>
                {t('Ouvrir son poste', 'Open its workstation')}
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => onNavigate('essaim')}>
                {t('Voir toutes les ouvrières', 'See all workers')}
              </button>
            </li>
          </ul>
        )}
      </div>
    </li>
  );
}

// ─── Activité ────────────────────────────────────────────────────────────────

const ICONE_GENRE: Record<GenreActivite, NomIcone> = {
  succes: 'coche',
  echec: 'croix',
  encours: 'horloge',
  info: 'activite',
  attention: 'avertissement',
};

function CarteActivite({ events, taches, noeuds, projet, onNavigate, onOuvrirTache }: Props) {
  const t = useT();
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => !document.hidden && setMaintenant(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // Un nouvel événement remet l'horloge à l'heure : « à l'instant » doit l'être.
  useEffect(() => setMaintenant(Date.now()), [events.length]);
  const items = useMemo(
    () => activiteRecente(events, taches, noeuds, t, { projetId: projet?.id ?? null, limite: 6 }),
    [events, taches, noeuds, t, projet?.id],
  );
  return (
    <section className="hs-carte" aria-labelledby="hs-activite-titre">
      <header className="hs-carte-tete">
        <h2 id="hs-activite-titre">
          <Icone nom="activite" />
          {t('Activité', 'Activity')}
        </h2>
        <button type="button" className="hs-lien" onClick={() => onNavigate('chronique')}>
          {t('Voir tout', 'See all')} <Icone nom="fleche" taille={14} />
        </button>
      </header>
      {items.length === 0 ? (
        <p className="hs-vide-carte">
          {t(
            'Aucun événement depuis l’ouverture de cet écran. Lance une mission : chaque étape s’affichera ici.',
            'No event since this screen opened. Launch a mission: each step will show up here.',
          )}
        </p>
      ) : (
        <ul className="hs-activite">
          {items.map((i) => (
            <li key={i.id} className={`genre-${i.genre}`}>
              <span className="hs-activite-icone" aria-hidden="true">
                <Icone nom={ICONE_GENRE[i.genre]} taille={14} />
              </span>
              <div>
                {i.tacheId ? (
                  <button
                    type="button"
                    className="hs-lien"
                    onClick={() => onOuvrirTache(i.tacheId!)}
                  >
                    {i.texte}
                  </button>
                ) : (
                  <span>{i.texte}</span>
                )}
                <time className="hs-discret" dateTime={new Date(i.ts).toISOString()}>
                  {ilYA(i.ts, maintenant, t)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Collaborer ──────────────────────────────────────────────────────────────

function CarteCollaborer({ projet, user, refreshTick }: Props) {
  const t = useT();
  const gestes = useGestes();
  const membres = useApiPoll(
    () => (projet && user ? fetchMembresProjet(projet.id) : Promise.resolve(null)),
    120_000,
    refreshTick + (projet?.id.length ?? 0) + (user ? 1 : 0),
  );
  const liste = membres.data ?? [];
  return (
    <section className="hs-carte hs-collaborer" aria-labelledby="hs-collab-titre">
      <header className="hs-carte-tete">
        <h2 id="hs-collab-titre">
          <Icone nom="equipe" />
          {t('Collaborer', 'Collaborate')}
        </h2>
        {liste.length > 0 && (
          <span
            className="hs-avatars"
            aria-label={t(`${liste.length} membre(s)`, `${liste.length} member(s)`)}
          >
            {liste.slice(0, 3).map((m) => (
              <span
                key={m.userId}
                className="hs-avatar"
                title={`${m.displayName ?? m.userId.slice(0, 8)} · ${m.role}`}
              >
                {initiales(m.displayName ?? m.userId)}
              </span>
            ))}
            {liste.length > 3 && <span className="hs-avatar plus">+{liste.length - 3}</span>}
          </span>
        )}
      </header>
      <p className="hs-discret">
        {!user
          ? t(
              'Sans compte, tu peux inviter une machine. Inviter une personne sur un projet demande un compte.',
              'Without an account you can invite a machine. Inviting a person to a project requires an account.',
            )
          : liste.length <= 1
            ? t(
                'Personne d’autre sur ce projet pour l’instant.',
                'Nobody else on this project yet.',
              )
            : t(
                `${liste.length} membres sur « ${projet?.name ?? ''} ».`,
                `${liste.length} members on “${projet?.name ?? ''}”.`,
              )}
      </p>
      <div className="hs-carte-actions">
        <button type="button" className="hs-btn primaire" onClick={() => gestes.ouvrirInvitation()}>
          <Icone nom="invitation" taille={16} />
          {t('Inviter', 'Invite')}
        </button>
      </div>
    </section>
  );
}

// ─── Le guide de démarrage ───────────────────────────────────────────────────

/**
 * Trois étapes, chacune COCHÉE par un fait de la ruche, jamais par un clic :
 * un projet existe ; une IA réelle est en ligne ; une tâche a été créée.
 * « Ignorer » est définitif (jusqu'à « Revoir le guide ») ; les trois faites,
 * il se range de lui-même.
 */
export function etapesGuide(
  projets: readonly Project[],
  noeuds: readonly HiveNode[],
  taches: readonly Task[],
): { projet: boolean; agent: boolean; mission: boolean } {
  return {
    projet: projets.length > 0,
    agent: aUneIaReelle(agentsConnectes(noeuds)),
    mission: taches.some((x) => !x.ombre),
  };
}

function GuideDemarrage({
  projets,
  noeuds,
  taches,
}: {
  projets: readonly Project[];
  noeuds: readonly HiveNode[];
  taches: readonly Task[];
}) {
  const t = useT();
  const gestes = useGestes();
  const guide = usePreference(CLES.guide, lireGuide);
  const e = etapesGuide(projets, noeuds, taches);
  const toutFait = e.projet && e.agent && e.mission;

  useEffect(() => {
    if (toutFait && guide === 'nouveau') ecrire(CLES.guide, 'termine');
  }, [toutFait, guide]);

  if (guide !== 'nouveau' || toutFait) return null;

  const etapes = [
    {
      fait: e.projet,
      titre: t('Ouvrir un projet', 'Open a project'),
      aide: t('Crée-le ou importe un dépôt.', 'Create one or import a repository.'),
      geste: { libelle: t('Créer', 'Create'), faire: gestes.nouveauProjet },
    },
    {
      fait: e.agent,
      titre: t('Connecter un agent', 'Connect an agent'),
      aide: t(
        'Une machine avec Claude Code, Codex… ou celle d’une personne invitée.',
        'A machine with Claude Code, Codex… or an invited person’s.',
      ),
      geste: {
        libelle: t('Connecter', 'Connect'),
        faire: () => gestes.ouvrirInvitation('machine'),
      },
    },
    {
      fait: e.mission,
      titre: t('Lancer une mission', 'Launch a mission'),
      aide: t(
        'Un exemple est prêt : rien ne part avant que tu valides le plan.',
        'An example is ready: nothing runs before you approve the plan.',
      ),
      geste: {
        libelle: t('Essayer', 'Try it'),
        faire: () =>
          deposerBrouillon(
            t(
              'Ajoute un fichier HELLO.md qui présente le projet en trois phrases.',
              'Add a HELLO.md file that introduces the project in three sentences.',
            ),
          ),
      },
    },
  ];
  const premiere = etapes.findIndex((x) => !x.fait);

  return (
    <section className="hs-carte hs-guide" aria-labelledby="hs-guide-titre">
      <header className="hs-carte-tete">
        <h2 id="hs-guide-titre">
          <Icone nom="etincelles" />
          {t('Démarrage', 'Getting started')}
        </h2>
        <button type="button" className="hs-lien" onClick={() => ecrire(CLES.guide, 'ignore')}>
          {t('Ignorer', 'Skip')}
        </button>
      </header>
      <ol className="hs-etapes">
        {etapes.map((x, i) => (
          <li key={x.titre} className={x.fait ? 'faite' : i === premiere ? 'courante' : undefined}>
            <span className="hs-etape-num" aria-hidden="true">
              {x.fait ? <Icone nom="coche" taille={14} /> : i + 1}
            </span>
            <div>
              <strong>
                {x.titre}
                {x.fait && <span className="hs-visuellement-cache"> — {t('fait', 'done')}</span>}
              </strong>
              {!x.fait && <span className="hs-discret">{x.aide}</span>}
            </div>
            {!x.fait && i === premiere && (
              <button type="button" className="hs-btn petit" onClick={x.geste.faire}>
                {x.geste.libelle}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
