// Vue Mon espace — le tableau de bord d'une personne.
//
// ─── LA QUESTION À LAQUELLE CET ÉCRAN RÉPOND ─────────────────────────────────
//
// Pas « quel est l'état de mes projets », mais « qu'est-ce qui va me coûter
// quelque chose si je ne fais rien aujourd'hui ». D'où l'ordre de la page : les
// alertes d'abord, classées par le serveur (module `tableau.ts`), les projets
// ensuite. Un écran qui commencerait par une jolie grille de cartes obligerait
// à chercher le problème au milieu de ce qui va bien.
//
// L'écran ne reclasse RIEN. Le rang des alertes est une décision, elle est
// prise et testée côté serveur ; la recopier ici en ferait une seconde, et
// deux décisions finissent toujours par diverger.
//
// ─── CE QUI EST TU, ET POURQUOI ──────────────────────────────────────────────
//
// Une jauge de quota n'apparaît que si un plafond existe. Sans plafond il n'y a
// rien à consommer, et une barre à zéro raconterait « vous n'avez rien
// dépensé » alors que la vérité est « rien ne vous borne ». Le serveur rend
// `null` exactement pour ça ; l'écran le respecte au lieu de le remplacer par 0.

import { fetchMonTableau } from '../api';
import type { Alerte, Gravite, MonTableau, ProjetRendu } from '../api';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { useApiPoll } from './shared';
import type { ViewProps } from './shared';
import './monespace.css';

const HEURE_MS = 3_600_000;

/**
 * Une durée en HEURES, l'unité des quotas.
 *
 * Volontairement pas `formatDuree`, qui choisit son échelle : il rendrait
 * « 0 ms » là où le quota d'en face vaut « 200 h », et comparer une
 * milliseconde à une heure dans la même phrase ne veut rien dire. Ici tout est
 * ramené à l'unité vendue, pour que les deux nombres soient du même ordre.
 *
 * Une décimale sous dix heures, entier au-delà : au-dessus, le dixième d'heure
 * n'informe plus personne et donne une fausse impression de précision.
 */
function enHeures(ms: number): string {
  const h = Math.max(0, ms) / HEURE_MS;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
}

const PUCE: Record<Gravite, string> = { critique: '●', attention: '◉', info: '○' };

/** Libellé d'un niveau d'autonomie. Le mot brut de la base n'est pas une phrase. */
const AUTONOMIE: Record<string, { fr: string; en: string }> = {
  off: { fr: 'manuelle', en: 'manual' },
  propose: { fr: 'la ruche propose', en: 'the hive proposes' },
  gouverne: { fr: 'la ruche gouverne', en: 'the hive governs' },
  plein: { fr: 'plein essaim', en: 'full swarm' },
};

/** Libellé d'un état d'abonnement, écrit pour quelqu'un qui n'a pas lu le code. */
const ABONNEMENT: Record<string, { fr: string; en: string }> = {
  aucun: { fr: 'sans abonnement', en: 'no subscription' },
  actif: { fr: 'actif', en: 'active' },
  impaye: { fr: 'impayé', en: 'unpaid' },
  annule: { fr: 'annulé', en: 'cancelled' },
  expire: { fr: 'expiré', en: 'expired' },
};

function libelle(
  table: Record<string, { fr: string; en: string }>,
  cle: string,
  t: Translate,
): string {
  const l = table[cle];
  return l ? t(l.fr, l.en) : cle;
}

/**
 * Écrit la phrase d'une alerte dans la langue de l'interface.
 *
 * Le serveur ne sait pas dans quelle langue on regarde : il envoie la CLÉ, les
 * jours et quelques valeurs (`details`), et la phrase se compose ici. Sans
 * cela, ces lignes seraient les seules de tout l'écran à rester en français
 * quand l'interface passe en anglais.
 *
 * Le `default` retombe sur `a.message`, la phrase française fabriquée par le
 * serveur. Ce n'est pas de la paresse : le jour où le serveur ajoute une
 * alerte que ce client ne connaît pas, mieux vaut une phrase compréhensible
 * dans la mauvaise langue qu'une ligne vide.
 */
function phrase(a: Alerte, t: Translate): string {
  // `details` peut MANQUER : le bundle est statique, ce navigateur peut parler
  // à un orchestrateur plus ancien. Sans ce repli, la vue entière plantait sur
  // un `a.details.serveur` — page blanche pour une phrase absente.
  const d = a.details ?? {};
  switch (a.cle) {
    case 'effacement_imminent': {
      const m = d.serveur ?? '';
      return a.jours === 0
        ? t(
            `La machine ${m} va être effacée aujourd’hui, avec tout ce qu’elle contient. Réactivez l’abonnement pour la garder.`,
            `Machine ${m} will be erased today, along with everything on it. Reactivate the subscription to keep it.`,
          )
        : t(
            `La machine ${m} sera effacée dans ${a.jours} jour(s), avec tout ce qu’elle contient. Réactivez l’abonnement pour la garder.`,
            `Machine ${m} will be erased in ${a.jours} day(s), along with everything on it. Reactivate the subscription to keep it.`,
          );
    }
    case 'impaye':
      return d.enGrace
        ? t(
            'Le dernier paiement n’est pas passé. Le projet continue pendant le délai de grâce, puis s’arrêtera.',
            'The last payment did not go through. The project keeps running during the grace period, then stops.',
          )
        : t(
            'Le délai de grâce est écoulé : le projet est arrêté faute de paiement.',
            'The grace period is over: the project is stopped for lack of payment.',
          );
    case 'periode_echue':
      return t(
        `Le projet ne butine plus : ${d.motif ?? ''}.`,
        `The project no longer forages: ${d.motif ?? ''}.`,
      );
    case 'fin_de_periode':
      return a.jours === 0
        ? t('La période payée se termine aujourd’hui.', 'The paid period ends today.')
        : t(
            `La période payée se termine dans ${a.jours} jour(s).`,
            `The paid period ends in ${a.jours} day(s).`,
          );
    case 'quota_epuise':
      return t(
        'Le quota de ce projet est entièrement consommé — la ruche n’assigne plus de tâches.',
        'This project’s quota is fully used — the hive no longer assigns tasks.',
      );
    case 'quota_presque_epuise': {
      const h = (d.heuresRestantes ?? 0).toFixed(1);
      return t(
        `Il reste environ ${h} h de quota sur ce projet.`,
        `About ${h} h of quota left on this project.`,
      );
    }
    default:
      return a.message;
  }
}

export default function MonEspace({ user, refreshTick, onNavigate }: ViewProps) {
  const t = useT();

  if (!user) {
    return (
      <div className="view me-view">
        <section className="card me-accueil">
          <h2>
            <span className="marque" aria-hidden="true" /> {t('Votre espace', 'Your space')}
          </h2>
          <p>
            {t(
              'Créez un compte pour suivre vos projets : quota consommé, abonnement, machines et échéances au même endroit. La ruche reste utilisable sans compte — l’espace personnel n’ajoute que ce qui vous appartient.',
              'Create an account to follow your projects: quota used, subscription, machines and deadlines in one place. The hive stays usable without an account — this space only adds what belongs to you.',
            )}
          </p>
          <p className="me-accueil-action">
            {t('Connectez-vous depuis la barre du haut.', 'Sign in from the top bar.')}
          </p>
        </section>
      </div>
    );
  }

  return <Espace nom={user.displayName} refreshTick={refreshTick} onNavigate={onNavigate} />;
}

/**
 * Composant SÉPARÉ, monté seulement une fois la session connue.
 *
 * `useApiPoll` mémorise son fetcher et ne relance son effet que sur son
 * intervalle : appelé plus haut, il partirait au premier rendu — avant que
 * `/api/auth/me` ait répondu — et l'appel authentifié se ferait sans jeton.
 */
function Espace({
  nom,
  refreshTick,
  onNavigate,
}: {
  nom: string;
  refreshTick: number;
  onNavigate: ViewProps['onNavigate'];
}) {
  const t = useT();
  const poll = useApiPoll(fetchMonTableau, 30_000, refreshTick);

  if (poll.error) {
    return (
      <div className="view me-view">
        <section className="card">
          <h2>
            <span className="marque" aria-hidden="true" /> {t('Mon espace', 'My space')}
          </h2>
          <p className="panel-error">{poll.error}</p>
        </section>
      </div>
    );
  }
  if (!poll.data) {
    return (
      <div className="view me-view">
        <section className="card">
          <h2>
            <span className="marque" aria-hidden="true" /> {t('Mon espace', 'My space')}
          </h2>
          <p className="muted-text">{t('Relevé en cours…', 'Reading…')}</p>
        </section>
      </div>
    );
  }

  const d: MonTableau = poll.data;

  return (
    <div className="view me-view">
      <section className="card me-entete">
        <header className="panel-head">
          <h2>
            <span className="marque" aria-hidden="true" /> {t('Bonjour', 'Hello')} {nom}
          </h2>
          <span className="muted-text">
            {d.totaux.projets} {t('projet(s)', 'project(s)')}
          </span>
        </header>
        <div className="me-tuiles">
          <Tuile
            valeur={String(d.totaux.projets)}
            libelle={t('projets suivis', 'projects followed')}
          />
          <Tuile
            valeur={String(d.totaux.serveursActifs)}
            libelle={t('machines en marche', 'machines running')}
            ton={d.totaux.serveursActifs > 0 ? 'chaud' : 'calme'}
          />
          <Tuile
            valeur={`${d.totaux.heuresIncluses} h`}
            libelle={t('incluses par vos plans', 'included by your plans')}
          />
          <Tuile
            valeur={enHeures(d.totaux.depenseMs)}
            libelle={t('temps-ouvrière dépensé', 'worker-time spent')}
          />
        </div>
        {!d.balanceAJour && (
          <p className="me-note">
            {t(
              'Le grand livre n’a pas fini son rattrapage : les dépenses affichées sont encore incomplètes.',
              'The ledger has not finished catching up: the spend shown is still incomplete.',
            )}
          </p>
        )}
      </section>

      <Alertes alertes={d.alertes} onNavigate={onNavigate} />

      <section className="card me-projets">
        <header className="panel-head">
          <h2>⬡ {t('Mes projets', 'My projects')}</h2>
        </header>
        {d.projets.length === 0 ? (
          <p className="muted-text me-vide">
            {t(
              'Aucun projet pour l’instant. Le bouton « + Projet » en haut à droite en crée un : il vous appartiendra, et il apparaîtra ici.',
              'No project yet. The “+ Project” button at the top right creates one: it will belong to you, and it will show up here.',
            )}
          </p>
        ) : (
          <div className="me-grille">
            {d.projets.map((p) => (
              <CarteProjet key={p.projectId} p={p} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tuile({
  valeur,
  libelle,
  ton = 'calme',
}: {
  valeur: string;
  libelle: string;
  ton?: 'calme' | 'chaud';
}) {
  return (
    <div className={`me-tuile ${ton}`}>
      <span className="me-tuile-valeur">{valeur}</span>
      <span className="me-tuile-libelle">{libelle}</span>
    </div>
  );
}

function Alertes({
  alertes,
  onNavigate,
}: {
  alertes: Alerte[];
  onNavigate: ViewProps['onNavigate'];
}) {
  const t = useT();

  // Le silence est une information : le dire vaut mieux qu'une section absente,
  // qui laisserait croire que le relevé n'a pas eu lieu.
  if (alertes.length === 0) {
    return (
      <section className="card me-alertes calme">
        <p className="me-rien">
          {t(
            'Rien ne réclame votre attention : aucun paiement en souffrance, aucun quota au bord, aucune donnée sur le point d’être effacée.',
            'Nothing needs your attention: no payment pending, no quota near its edge, no data about to be erased.',
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="card me-alertes">
      <header className="panel-head">
        <h2>
          {t('À traiter', 'To handle')} <span className="panel-count">{alertes.length}</span>
        </h2>
      </header>
      <ul className="me-liste">
        {alertes.map((a, i) => (
          <li key={`${a.cle}-${a.projectId}-${i}`} className={`me-alerte ${a.gravite}`}>
            <span className="me-puce" aria-hidden="true">
              {PUCE[a.gravite]}
            </span>
            <div className="me-alerte-corps">
              <p className="me-alerte-message">{phrase(a, t)}</p>
              <button
                className="me-alerte-projet"
                onClick={() => onNavigate('projets', a.projectId)}
                title={t('Ouvrir ce projet', 'Open this project')}
              >
                {a.projet}
              </button>
            </div>
            {a.jours >= 0 && (
              <span className="me-jours" title={t('jours restants', 'days left')}>
                {a.jours} {t('j', 'd')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CarteProjet({ p, onNavigate }: { p: ProjetRendu; onNavigate: ViewProps['onNavigate'] }) {
  const t = useT();

  return (
    <article className={`me-carte${p.actif ? '' : ' inactive'}`}>
      <header className="me-carte-tete">
        <button className="me-carte-nom" onClick={() => onNavigate('projets', p.projectId)}>
          {p.nom}
        </button>
        {p.role === 'owner' && (
          <span className="me-role" title={t('Vous en êtes propriétaire', 'You own it')}>
            {t('propriétaire', 'owner')}
          </span>
        )}
      </header>

      <dl className="me-faits">
        <div>
          <dt>{t('Abonnement', 'Subscription')}</dt>
          <dd>
            <span className={`me-etat ${p.etatAbonnement}`}>
              {libelle(ABONNEMENT, p.etatAbonnement, t)}
            </span>
            {p.plan !== 'libre' && <span className="me-plan">{p.plan}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('Autonomie', 'Autonomy')}</dt>
          <dd>{libelle(AUTONOMIE, p.autonomie, t)}</dd>
        </div>
        {p.joursRestants >= 0 && (
          <div>
            <dt>{t('Période', 'Period')}</dt>
            <dd>
              {p.joursRestants === 0
                ? t('se termine aujourd’hui', 'ends today')
                : `${p.joursRestants} ${t('jour(s) restant(s)', 'day(s) left')}`}
            </dd>
          </div>
        )}
        {p.serveurs.length > 0 && (
          <div>
            <dt>{t('Machines', 'Machines')}</dt>
            <dd>
              {p.serveursFacturables} / {p.serveurs.length}{' '}
              <small>{t('en marche', 'running')}</small>
            </dd>
          </div>
        )}
      </dl>

      {/* Sans plafond, PAS de jauge : une barre à zéro dirait « rien dépensé »
          alors que la vérité est « rien ne vous borne ». */}
      {p.partConsommee === null ? (
        <p className="me-sans-plafond">
          {t('Aucun plafond de dépense posé.', 'No spending cap set.')}
        </p>
      ) : (
        <div className="me-jauge-bloc">
          <div
            className={`me-jauge${p.partConsommee >= 1 ? ' pleine' : p.partConsommee >= 0.9 ? ' haute' : ''}`}
            role="progressbar"
            aria-valuenow={Math.round(p.partConsommee * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('Quota consommé', 'Quota used')}
          >
            <span style={{ width: `${Math.round(p.partConsommee * 100)}%` }} />
          </div>
          <span className="me-jauge-texte">
            {enHeures(p.depenseMs)} / {enHeures(p.plafondMs ?? 0)} ·{' '}
            {Math.round(p.partConsommee * 100)} %
          </span>
        </div>
      )}

      {!p.actif && p.etatAbonnement !== 'aucun' && <p className="me-motif">{p.motifDroits}</p>}
    </article>
  );
}
