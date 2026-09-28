// L'ÉQUIPE ET LES PARTAGES D'UN PROJET — qui y entre, et qui le voit sans
// compte. Sortis de `Projets.tsx` tels quels ; exportés pour être rendus en
// test (`dashboard/tests/gestes-panneaux.test.tsx`).

import { useState } from 'react';
import {
  admettreMembre,
  adopterProjet,
  creerPartage,
  estAdmin,
  fetchMembresProjet,
  fetchPartages,
  retirerMembre,
  revoquerPartage,
} from '../../api';
import type { AuthUser, PartageCree } from '../../api';
import { Input } from '../../composants';
import { useT } from '../../i18n';
import { GesteIrreversible } from '../../ui';
import { useApiPoll } from '../shared';
import type { Project } from '../../../../src/shared/types';
import { errMsg } from './commun';
import '../projets.css';

/**
 * L'équipe d'un projet — et le cul-de-sac qu'elle ouvre.
 *
 * ─── CE QUI N'AVAIT AUCUN CHEMIN ─────────────────────────────────────────────
 *
 * Un projet privé n'avait aucun moyen de gagner un membre : on ne s'invite pas
 * chez les autres (correct), et personne ne pouvait inviter non plus (oubli).
 * Un dépôt importé de GitHub cumule les deux — privé ET sans propriétaire,
 * puisque l'import s'authentifie par le jeton de ruche, qui n'est le compte de
 * personne. On connectait son dépôt, et aucune de ses abeilles ne le voyait.
 *
 * ─── POURQUOI ON ADMET PAR IDENTIFIANT, ET PAS PAR COURRIEL ──────────────────
 *
 * Admettre par courriel serait plus agréable, et ferait de cette route un
 * oracle : « ce courriel a-t-il un compte ici ? », interrogeable par tout
 * propriétaire de projet. L'inscription a été durcie exprès pour ne pas
 * répondre à cette question. On ne la rouvre pas ailleurs.
 *
 * L'ouvrière donne donc son identifiant — une chaîne opaque, qu'elle lit sur
 * cette même carte — exactement comme on se passe un billet d'invitation.
 */
export function EquipeProjet({
  project,
  user,
  refreshTick,
}: {
  project: Project;
  user: AuthUser | null;
  refreshTick: number;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const membres = useApiPoll(() => fetchMembresProjet(project.id), 120_000, refreshTick + tick);
  const [aAdmettre, setAAdmettre] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  /** Le refus d'une admission — sous le champ, qui garde la saisie à corriger. */
  const [erreurAdmission, setErreurAdmission] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  // Cosmétique, toujours : le serveur retranche de toute façon. On masque ce
  // qu'il refusera, on ne décide rien ici.
  const jeSuisAdmin = estAdmin(user);
  const jeSuisProprio = project.ownerId !== null && project.ownerId === user?.id;
  const jePeuxAdmettre = jeSuisAdmin || jeSuisProprio;
  const orphelin = project.ownerId === null;

  const agir = (p: Promise<unknown>) => {
    setOccupe(true);
    setErreur(null);
    p.then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  // Sans compte, cette carte n'a rien à dire : les routes exigent un COMPTE, et
  // afficher une équipe vide laisserait croire qu'il n'y a personne.
  if (!user) return null;

  return (
    <div className="pj-sub pj-equipe">
      <div className="pj-sub-head">
        <h4>{t('Équipe', 'Team')}</h4>
        {membres.data && <span className="pj-sub-meta">{membres.data.length}</span>}
      </div>

      {orphelin && jeSuisAdmin && (
        <div className="pj-orphelin">
          <p>
            {t(
              'Ce projet n’a pas de propriétaire — un dépôt importé appartient à la ruche, pas à un compte. Sans propriétaire, personne ne peut y admettre d’ouvrière.',
              'This project has no owner — an imported repository belongs to the hive, not to an account. Without an owner, nobody can admit a worker to it.',
            )}
          </p>
          <button
            className="btn primary"
            disabled={occupe}
            onClick={() => agir(adopterProjet(project.id))}
          >
            {t('Adopter ce projet', 'Adopt this project')}
          </button>
        </div>
      )}

      {membres.data && membres.data.length > 0 && (
        <ul className="pj-equipe-liste">
          {membres.data.map((m) => {
            // La question NOMME la personne : cette liste se relit toute seule
            // toutes les deux minutes, et la ligne visée peut avoir glissé.
            const nom = (m.displayName ?? m.userId.slice(0, 8)).slice(0, 40);
            return (
              <li key={m.userId}>
                <span className="pj-equipe-nom">{m.displayName ?? m.userId.slice(0, 8)}</span>
                <span className="pj-equipe-role">{m.role}</span>
                {jePeuxAdmettre && m.role !== 'owner' && (
                  <GesteIrreversible
                    libelle="✕"
                    ariaLabel={t('Retirer du projet', 'Remove from project')}
                    question={t(`Retirer ${nom} du projet ?`, `Remove ${nom} from the project?`)}
                    confirmer={t('Retirer', 'Remove')}
                    disabled={occupe}
                    onConfirmer={() => agir(retirerMembre(project.id, m.userId))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {jePeuxAdmettre && (
        // ─── ADMETTRE : UN FORMULAIRE, ET SA FAUTE SOUS SON CHAMP ─────────────
        //
        // Le champ se vidait AU CLIC, avant la réponse : un identifiant refusé
        // (mal copié, compte inexistant) disparaissait, et le refus s'affichait
        // en bas de la carte, loin du champ. Il ne se vide plus qu'une fois la
        // personne admise ; un refus se dit SOUS le champ, qui garde la saisie
        // à corriger.
        <form
          className="pj-admettre"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const id = aAdmettre.trim();
            if (occupe || id === '') return;
            setOccupe(true);
            setErreurAdmission(null);
            admettreMembre(project.id, id)
              .then(() => {
                setAAdmettre('');
                setTick((n) => n + 1);
              })
              .catch((err: unknown) => setErreurAdmission(errMsg(err)))
              .finally(() => setOccupe(false));
          }}
        >
          <Input
            type="text"
            className="mono"
            libelle={t('Identifiant du compte', 'Account identifier')}
            aide={t(
              'La personne le lit sur sa propre carte « Équipe », sous « Votre identifiant ».',
              'The person reads it on their own “Team” card, under “Your identifier”.',
            )}
            erreur={erreurAdmission ?? undefined}
            value={aAdmettre}
            onChange={(e) => {
              setAAdmettre(e.target.value);
              setErreurAdmission(null);
            }}
            disabled={occupe}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn" disabled={occupe || aAdmettre.trim() === ''}>
            {t('Admettre', 'Admit')}
          </button>
        </form>
      )}

      {/* L'autre bout de la manœuvre : ce qu'on donne à la personne qui tient
          le projet. Sans ça, « admettre par identifiant » n'a pas de mode
          d'emploi et la carte est inutilisable. */}
      <p className="pj-equipe-moi">
        {t('Votre identifiant :', 'Your identifier:')} <code className="mono">{user.id}</code>
      </p>

      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}

/**
 * Les liens de partage en lecture — montrer sans donner la ruche.
 *
 * ─── LA SEULE CHOSE À NE PAS RATER ICI ───────────────────────────────────────
 *
 * Le serveur ne rend le jeton QU'UNE FOIS, à la création. La liste ne le montre
 * jamais — c'est ce qui fait qu'un lien perdu se remplace au lieu de se
 * retrouver. Un écran qui n'afficherait pas le lien à ce moment-là le
 * perdrait pour de bon, et la seule issue serait d'en créer un autre sans
 * comprendre pourquoi.
 *
 * D'où le bandeau qui reste tant qu'on ne l'a pas fermé, et le libellé qui
 * annonce que c'est la seule fois.
 */
export function PartagesProjet({
  project,
  user,
  refreshTick,
}: {
  project: Project;
  user: AuthUser | null;
  refreshTick: number;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const liens = useApiPoll(() => fetchPartages(project.id), 120_000, refreshTick + tick);
  const [nouveau, setNouveau] = useState<PartageCree | null>(null);
  const [label, setLabel] = useState('');
  const [jours, setJours] = useState(7);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [copie, setCopie] = useState(false);

  if (!user) return null;

  const creer = () => {
    setOccupe(true);
    setErreur(null);
    creerPartage(project.id, {
      ...(label.trim() ? { label: label.trim() } : {}),
      ttlMs: jours * 24 * 60 * 60 * 1000,
    })
      .then((p) => {
        setNouveau(p);
        setLabel('');
        setCopie(false);
        setTick((n) => n + 1);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  const revoquer = (id: string) => {
    setOccupe(true);
    setErreur(null);
    revoquerPartage(project.id, id)
      .then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(false));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Partage en lecture', 'Read-only sharing')}</h4>
        {liens.data && <span className="pj-sub-meta">{liens.data.length}</span>}
      </div>

      {nouveau && (
        <div className="pj-lien-neuf">
          <p>
            {t(
              'Ce lien ne sera plus affiché. Copiez-le maintenant.',
              'This link will not be shown again. Copy it now.',
            )}
          </p>
          {/* `readOnly` et non `disabled` : un champ désactivé ne se sélectionne
              pas, et il faut pouvoir copier à la main si le presse-papier est
              refusé par le navigateur. */}
          <input className="pj-testcmd mono" readOnly value={nouveau.lien} aria-label="lien" />
          <div className="pj-run">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(nouveau.lien).then(() => setCopie(true));
              }}
            >
              {copie ? t('✔ copié', '✔ copied') : t('Copier', 'Copy')}
            </button>
            <button className="btn ghost" onClick={() => setNouveau(null)}>
              {t('J’ai copié', 'Done')}
            </button>
          </div>
        </div>
      )}

      {liens.data && liens.data.length > 0 && (
        <ul className="pj-liens">
          {liens.data.map((l) => {
            const nom = (l.label || t('(sans nom)', '(unnamed)')).slice(0, 40);
            return (
              <li key={l.id} className={l.vivant ? '' : 'pj-lien-mort'}>
                <span className="pj-lien-nom">{l.label || t('(sans nom)', '(unnamed)')}</span>
                <span className="pj-lien-etat">
                  {!l.vivant
                    ? t('éteint', 'dead')
                    : l.vuA
                      ? t('ouvert', 'opened')
                      : t('jamais ouvert', 'never opened')}
                </span>
                {l.vivant && (
                  <GesteIrreversible
                    libelle="✕"
                    ariaLabel={t('Révoquer ce lien', 'Revoke this link')}
                    question={t(
                      `Éteindre « ${nom} » ? Le lien ne se rallume pas.`,
                      `Kill “${nom}”? The link does not come back.`,
                    )}
                    confirmer={t('Éteindre', 'Kill')}
                    disabled={occupe}
                    onConfirmer={() => revoquer(l.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="pj-run">
        <input
          className="pj-testcmd"
          type="text"
          placeholder={t(
            'À qui ? (ex. « client », optionnel)',
            'For whom? (e.g. “client”, optional)',
          )}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={occupe}
          aria-label={t('Nom du lien', 'Link label')}
        />
        <label className="pj-select-label">
          <span>{t('jours', 'days')}</span>
          <select
            value={jours}
            onChange={(e) => setJours(Number(e.target.value))}
            disabled={occupe}
          >
            {[1, 7, 30, 90].map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={occupe} onClick={creer}>
          {t('Créer un lien', 'Create a link')}
        </button>
      </div>

      <p className="pj-equipe-moi">
        {t(
          'Un lien ouvre DEUX actes : voir l’avancement et lire le code. Il ne donne ni la ruche, ni votre compte, et se révoque un par un.',
          'A link opens TWO acts: see progress and read code. It grants neither the hive nor your account, and each one is revoked on its own.',
        )}
      </p>

      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}
