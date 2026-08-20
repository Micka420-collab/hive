// LA VUE DU PORTEUR DE LIEN — ce que voit quelqu'un qui n'a pas de compte.
//
// ─── CE QUI MANQUAIT, ET CE QUE ÇA VALAIT ────────────────────────────────────
//
// Le partage en lecture était entier côté serveur : un troisième jeton
// (`hive3_`), deux actes de lecture, un projet, une expiration, une révocation
// individuelle — et des tests. Il n'avait AUCUNE interface, ni pour créer un
// lien, ni pour en lire un. Une personne à qui on envoyait l'URL arrivait sur
// la mire de connexion d'une ruche où elle n'a pas de compte.
//
// Un mécanisme sans écran n'existe pas. C'est le même constat que pour Les
// Guetteuses et le polyéthisme, et il vaut ici davantage : le partage était
// documenté comme s'il marchait.
//
// ─── LES TROIS RÈGLES DE CET ÉCRAN ───────────────────────────────────────────
//
// 1. IL DIT CE QU'IL EST. Un bandeau permanent : lecture seule, par lien de
//    partage. Sans lui, quelqu'un croirait avoir « un compte sur la ruche » et
//    s'étonnerait que rien ne réagisse.
//
// 2. IL NE MONTRE QUE CE QUE LE LIEN OUVRE. Deux actes, pas trois : voir
//    l'avancement, lire le code. Pas de sidebar, pas d'essaim, pas de journal,
//    pas de retouche. Ce qui n'est pas proposé ne peut pas décevoir.
//
// 3. IL SE QUITTE. Le jeton vit dans `sessionStorage` — il meurt avec l'onglet
//    — mais on ne laisse pas quelqu'un coincé dans la lecture du projet d'un
//    autre parce qu'il a cliqué un lien : un bouton le rend à sa propre ruche.

import { lazy, Suspense, useEffect, useState } from 'react';
import { clearPartage, fetchReport } from '../api';
import type { ProjectReport } from '../api';
import { useT } from '../i18n';
import { ProgressBar } from '../ui';
import type { ViewProps } from './shared';
import type { HiveEvent, StateSnapshot } from '../../../src/shared/types';
import './partage.css';

const Rayon = lazy(() => import('./Rayon'));

const AUCUN_EVENEMENT: HiveEvent[] = [];

/**
 * Le nom du projet vient du RAPPORT, pas d'un instantané.
 *
 * Un porteur de lien n'a pas le jeton de ruche : le flux WebSocket lui est
 * fermé, et `snapshot.projects` sera toujours vide chez lui. Le rapport
 * d'avancement, lui, passe par le lien — et il porte le nom. On reconstruit
 * donc l'instantané minimal dont Le Rayon a besoin, plutôt que d'en faire une
 * seconde version « spéciale partage » qui divergerait de la vraie.
 */
function instantaneDe(projectId: string, nom: string): StateSnapshot {
  return {
    projects: [
      {
        id: projectId,
        name: nom,
        description: '',
        repoUrl: null,
        visibility: 'private',
        ownerId: null,
        createdAt: 0,
      },
    ],
    nodes: [],
    // Le Rayon ne montre que des FICHIERS : il n'a besoin d'aucune tâche, et
    // zéro sur zéro n'est pas une troncature — c'est une absence honnête.
    tasks: [],
    tasksTotal: 0,
  };
}

export default function Partage({ projectId }: { projectId: string }) {
  const t = useT();
  const [rapport, setRapport] = useState<ProjectReport | null>(null);
  // ─── UN DRAPEAU, ET SURTOUT PAS LE MESSAGE DU SERVEUR ──────────────────────
  //
  // Première version : `useState<string | null>`, alimentée par
  // `e instanceof Error ? e.message : String(e)`. La loupe a rendu ce ternaire
  // SANS TEST, et il l'était pour une raison qu'aucun banc n'aurait pu réparer :
  // **la chaîne n'est jamais affichée**. La branche de refus rend un texte fixe,
  // et `erreur` n'y sert que de « quelque chose a échoué ». Le ternaire calculait
  // donc une valeur que personne ne lit — un mutant équivalent par construction.
  //
  // Il ne se remplace pas par un banc, il se retire : garder en mémoire le
  // message du serveur, dans un écran dont la règle est que le refus reste
  // INDISTINGUABLE de l'inexistence, c'est laisser à portée de main la seule
  // chose qu'on a décidé de ne pas dire. Un `useState<boolean>` ne peut pas
  // fuiter ce qu'il ne contient pas.
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetchReport(projectId)
      .then((r) => vivant && setRapport(r))
      .catch(() => vivant && setEchec(true));
    return () => {
      vivant = false;
    };
  }, [projectId]);

  const quitter = () => {
    clearPartage();
    location.hash = '#/ruche';
    location.reload();
  };

  // LE REFUS EST INDISTINGUABLE DE L'INEXISTENCE côté serveur, et il doit le
  // rester ici : on ne dit pas « ce lien a expiré » plutôt que « ce projet
  // n'existe pas », parce qu'on ne le sait pas — et que le serveur s'est donné
  // du mal pour ne pas le dire.
  if (echec) {
    return (
      <div className="pa-vue pa-vide">
        <h1>
          <span className="marque" aria-hidden="true" /> Hive
        </h1>
        <p className="panel-error">
          {t(
            'Ce lien de lecture ne donne accès à rien : il a peut-être expiré, été révoqué, ou n’a jamais été valide.',
            'This read link grants access to nothing: it may have expired, been revoked, or never been valid.',
          )}
        </p>
        <button className="btn" onClick={quitter}>
          {t('Quitter la lecture partagée', 'Leave shared reading')}
        </button>
      </div>
    );
  }

  return (
    <div className="pa-vue">
      <header className="pa-tete">
        <div className="pa-tete-gauche">
          <span className="pa-marque">
            <span className="marque" aria-hidden="true" /> Hive
          </span>
          <span className="pa-badge">
            {t('lecture seule · lien de partage', 'read-only · share link')}
          </span>
        </div>
        <button className="btn ghost" onClick={quitter}>
          {t('Quitter', 'Leave')}
        </button>
      </header>

      {rapport === null ? (
        <p className="empty pad">{t('Ouverture du rayon…', 'Opening the comb…')}</p>
      ) : (
        <>
          <section className="card pa-avancement">
            <header className="panel-head">
              <h2>{rapport.name}</h2>
              <span className="panel-count">
                {rapport.done}/{rapport.total} {t('tâche(s)', 'task(s)')}
              </span>
            </header>
            <div className="pa-barre">
              <ProgressBar value={rapport.done} max={Math.max(rapport.total, 1)} />
              <span className="pa-pct">{rapport.progressPct} %</span>
            </div>
            <p className="pa-note">
              {t(
                'Vous voyez l’avancement et le code. Vous ne voyez pas qui travaille, et vous ne pouvez rien modifier.',
                'You see progress and code. You do not see who is working, and you cannot change anything.',
              )}
            </p>
          </section>

          <Suspense fallback={<p className="empty pad">{t('Le Rayon…', 'The Comb…')}</p>}>
            <Rayon
              {...({
                snapshot: instantaneDe(projectId, rapport.name),
                events: AUCUN_EVENEMENT,
                agentsByTask: {},
                deferred: new Set<string>(),
                onOpenTask: () => undefined,
                // Une vue publique ne crée rien : le point d'entrée existe pour
                // satisfaire le contrat, et ne mène nulle part.
                onNewProject: () => undefined,
                onNavigate: () => undefined,
                selectedId: projectId,
                refreshTick: 0,
                user: null,
              } satisfies ViewProps)}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
