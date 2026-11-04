// Vue Accueil — Hive Studio : décrire une mission, la suivre, voir ce qu'elle touche.
//
// ─── LES QUATRE QUESTIONS DE L'ÉCRAN (#579) ──────────────────────────────────
//
//   Où suis-je ?           — le projet actif, nommé dans la barre et dans l'aide
//                            de la saisie.
//   Que se passe-t-il ?    — la carte de mission, lue sur les missions que la
//                            Reine tient elle-même, et le fil de la conversation.
//   Que puis-je faire ?    — la saisie : une mission (plan → validation →
//                            lancement), ou une question à la Reine.
//   Qu'est-ce qui exige    — les productions à valider, les échecs, l'absence
//   mon attention ?          d'agent : dits dans la carte et dans le fil.
//
// Aucune donnée de la maquette n'est reprise : sans projet, sans mission, sans
// agent, l'écran le dit et propose le geste qui manque.

import { useEffect, useMemo, useState } from 'react';
import { fetchFullAuto, fetchMissions } from '../api';
import { useT } from '../i18n';
import { agentsConnectes, aUneIaReelle } from '../../../src/shared/agents-connectes';
import { CarteMission } from '../studio/CarteMission';
import { Composeur } from '../studio/Composeur';
import { useConversation } from '../studio/conversation';
import { EspaceTravail, lireOnglet } from '../studio/EspaceTravail';
import type { Onglet } from '../studio/EspaceTravail';
import { useGestes } from '../studio/gestes';
import { Icone } from '../studio/Icone';
import { missionCourante, titreMission } from '../studio/mission-courante';
import { CLES, ecrire, lireBooleen, lireBriefs, usePreference } from '../studio/preferences';
import { useProjetActif } from '../studio/projet-actif';
import { getReview, useApiPoll, useReviewTick } from './shared';
import type { ViewProps } from './shared';

/** « Bonjour » le jour, « Bonsoir » à partir de 18 h — et le prénom, s'il y a un compte. */
export function salutation(
  heure: number,
  nom: string | null,
  t: (fr: string, en: string) => string,
): string {
  const prenom = nom?.trim().split(/\s+/)[0] ?? '';
  const mot = heure >= 18 || heure < 5 ? t('Bonsoir', 'Good evening') : t('Bonjour', 'Hello');
  return prenom ? `${mot} ${prenom}` : mot;
}

export default function Studio({ snapshot, user, refreshTick, onOpenTask, onNavigate }: ViewProps) {
  const t = useT();
  const gestes = useGestes();
  const [projet] = useProjetActif(snapshot.projects, snapshot.tasks);
  const banniere = usePreference(CLES.banniere, (v) => lireBooleen(v, true));
  const briefs = usePreference(CLES.briefs, lireBriefs);
  const onglet = usePreference(CLES.onglet, lireOnglet);
  const reviewTick = useReviewTick();
  const conversation = useConversation(projet?.id ?? null);
  const [tickLocal, setTickLocal] = useState(0);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  // L'horloge de « depuis 12 min » : une minute suffit, et rien ne tourne caché.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setMaintenant(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const agents = useMemo(() => agentsConnectes(snapshot.nodes), [snapshot.nodes]);
  const iaEnLigne = aUneIaReelle(agents);
  const iasEnLigne = agents.filter((a) => a.enLigne > 0 && !a.simule).map((a) => a.libelle);
  const simulesEnLigne = agents.filter((a) => a.simule).reduce((n, a) => n + a.enLigne, 0);

  const missions = useApiPoll(
    () => (projet ? fetchMissions(projet.id) : Promise.resolve(null)),
    20_000,
    refreshTick + tickLocal + (projet ? projet.id.length : 0),
  );
  // Le full auto du projet : l'accueil le dit (la saisie, la carte de mission)
  // — « rien ne part sans ta validation » serait faux quand il est allumé.
  const fullAuto = useApiPoll(
    () => (projet ? fetchFullAuto(projet.id) : Promise.resolve(null)),
    15_000,
    refreshTick + tickLocal + (projet ? projet.id.length : 0),
  );
  const fullAutoActif = fullAuto.data?.actif === true;

  const mission = useMemo(
    () =>
      projet
        ? missionCourante({
            projectId: projet.id,
            taches: snapshot.tasks,
            missions: missions.data?.missions ?? null,
            iaEnLigne,
            aRevoir: (x) => getReview(x.id) === null,
          })
        : missionCourante({
            projectId: '',
            taches: [],
            missions: [],
            iaEnLigne,
            aRevoir: () => false,
          }),
    // `reviewTick` : un verdict posé ailleurs change « à valider ».
    [projet, snapshot.tasks, missions.data, iaEnLigne, reviewTick],
  );
  const titreLu = titreMission(mission, briefs);
  // Sans le brief (lancée d'un autre navigateur, ou par la démo), le titre est
  // celui de la PREMIÈRE tâche : « Dernière mission · Échafauder le dépôt »
  // nommait une mission de huit tâches d'après la première. Il dit les autres.
  const autres = mission.taches.length - 1;
  const titre =
    titreLu !== null && !mission.taches.some((x) => briefs[x.id]) && autres > 0
      ? t(`${titreLu} et ${autres} autre(s) tâche(s)`, `${titreLu} and ${autres} other task(s)`)
      : titreLu;
  const brief = mission.taches.map((x) => briefs[x.id]).find(Boolean) ?? null;

  const choisirOnglet = (o: Onglet) => ecrire(CLES.onglet, o);

  return (
    <div className="hs-studio">
      <section className={`hs-hero${banniere ? '' : ' sans-image'}`} aria-labelledby="hs-salut">
        {banniere && <div className="hs-hero-image" aria-hidden="true" />}
        <div className="hs-hero-texte">
          <h1 id="hs-salut">
            {salutation(new Date(maintenant).getHours(), user?.displayName ?? null, t)}
          </h1>
          <p>
            {t(
              'Ton espace de création et d’orchestration IA.',
              'Your AI creation and orchestration space.',
            )}
          </p>
        </div>
        {/* La saisie VIT dans le panorama, comme sur la maquette (#579) : elle
            mordait sur son bord bas, à moitié dedans, à moitié dehors. */}
        {snapshot.projects.length > 0 && (
          <Composeur
            projet={projet}
            iaEnLigne={iaEnLigne}
            iasEnLigne={iasEnLigne}
            simulesEnLigne={simulesEnLigne}
            poserQuestion={(m, a) => conversation.envoyer(m, a)}
            questionEnCours={conversation.enCours}
            onMissionLancee={() => {
              setTickLocal((n) => n + 1);
              choisirOnglet('conversation');
            }}
            onQuestion={() => choisirOnglet('conversation')}
            fullAuto={fullAutoActif}
          />
        )}
      </section>

      {snapshot.projects.length === 0 ? (
        <section className="hs-depart" aria-labelledby="hs-depart-titre">
          <span className="hs-depart-icone" aria-hidden="true">
            <Icone nom="projets" taille={28} />
          </span>
          <div>
            <h2 id="hs-depart-titre">
              {t('Crée ton premier projet', 'Create your first project')}
            </h2>
            <p className="hs-discret">
              {t(
                'Un projet réunit un dépôt de code, ses missions et les agents qui y travaillent. Tu peux partir de zéro ou importer un dépôt existant.',
                'A project brings together a code repository, its missions and the agents working on it. Start from scratch or import an existing repository.',
              )}
            </p>
          </div>
          <div className="hs-depart-actions">
            <button type="button" className="hs-btn primaire" onClick={gestes.nouveauProjet}>
              <Icone nom="plus" taille={16} /> {t('Créer un projet', 'Create a project')}
            </button>
            <button type="button" className="hs-btn" onClick={() => onNavigate('projets')}>
              {t('Importer un dépôt', 'Import a repository')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <CarteMission
            mission={mission}
            titre={titre}
            // Le tic de 30 s ou l'instant du rendu, le plus récent : chaque
            // événement du flux re-rend l'accueil, et l'écoulé suit.
            maintenant={Math.max(maintenant, Date.now())}
            erreur={missions.error}
            onVoirPlan={() => choisirOnglet('plan')}
            onVoirValidation={() => choisirOnglet('resultats')}
            fullAuto={fullAutoActif}
            onVoirAutomatisations={() => onNavigate('automatisations')}
          />
          <EspaceTravail
            projet={projet}
            mission={mission}
            brief={brief}
            noeuds={snapshot.nodes}
            conversation={conversation}
            onglet={onglet}
            onOnglet={choisirOnglet}
            onOuvrirTache={onOpenTask}
            reviewTick={reviewTick}
          />
        </>
      )}
    </div>
  );
}
