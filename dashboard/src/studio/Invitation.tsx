// Le dialogue « Inviter » de Hive Studio — une machine, ou une personne.
//
// ─── DEUX INVITATIONS QUI NE DONNENT PAS LA MÊME CHOSE ───────────────────────
//
//   · UNE MACHINE (la sienne, celle d'un collègue) rejoint la RUCHE : elle
//     prendra des tâches avec son Claude Code, son Codex… Le lien est un billet
//     éphémère à usage unique (#575, `shared/porte.ts`) : 24 h, une machine,
//     révocable dans l'Intendance, sans le jeton maître. Le corps est celui du
//     panneau historique (`CorpsInvitationMachine`).
//   · UNE PERSONNE rejoint un PROJET : elle y lit les tâches et y travaille avec
//     son compte. Le serveur admet par IDENTIFIANT de compte, jamais par
//     courriel (une route qui répondrait « ce courriel a-t-il un compte ? »
//     serait un oracle) ; et le lien de partage montre l'avancement en lecture
//     seule, sans donner la ruche. Les deux cartes sont celles de la page
//     Projets (`EquipeProjet`, `PartagesProjet`), chargées à la demande.
//
// Ce dialogue reste MONTÉ fermé : le billet d'une machine survit à la
// fermeture, et rouvrir remontre le même lien au lieu d'en émettre un autre.

import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { EVENT_OUVRIR_COMPTE } from '../AccountPanel';
import type { AuthUser } from '../api';
import { useT } from '../i18n';
import { CorpsInvitationMachine, useInvitationMachine } from '../InvitePanel';
import { useDialog, Voile } from '../ui';
import type { HiveEvent, Project } from '../../../src/shared/types';
import type { GenreInvitation } from './gestes';
import { Icone } from './Icone';

const EquipeProjet = lazy(() =>
  import('../views/Projets').then((m) => ({ default: m.EquipeProjet })),
);
const PartagesProjet = lazy(() =>
  import('../views/Projets').then((m) => ({ default: m.PartagesProjet })),
);

function Cadre({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="modal hs-dialogue"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hs-invitation-titre"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

interface Props {
  ouvert: boolean;
  genre: GenreInvitation;
  onGenre: (g: GenreInvitation) => void;
  onFermer: () => void;
  events: readonly HiveEvent[];
  projet: Project | null;
  user: AuthUser | null;
  refreshTick: number;
}

export function Invitation({
  ouvert,
  genre,
  onGenre,
  onFermer,
  events,
  projet,
  user,
  refreshTick,
}: Props) {
  const t = useT();
  const machine = useInvitationMachine();
  if (!ouvert) return null;
  return (
    <Voile onClose={onFermer}>
      <Cadre onClose={onFermer}>
        <header className="hs-dialogue-tete">
          <h2 id="hs-invitation-titre">{t('Inviter', 'Invite')}</h2>
          <button
            type="button"
            className="hs-icone-btn"
            onClick={onFermer}
            aria-label={t('Fermer', 'Close')}
          >
            <Icone nom="croix" />
          </button>
        </header>
        <div className="hs-dialogue-corps">
          <div
            className="hs-invitation-choix"
            role="group"
            aria-label={t('Qui inviter ?', 'Who to invite?')}
          >
            <button
              type="button"
              className="hs-choix"
              aria-pressed={genre === 'machine'}
              onClick={() => onGenre('machine')}
            >
              <strong>
                <Icone nom="machine" taille={18} />
                {t('Une machine', 'A machine')}
              </strong>
              <span>
                {t(
                  'Un ordinateur rejoint la ruche et prend des tâches avec ses agents (Claude Code, Codex…).',
                  'A computer joins the hive and takes tasks with its agents (Claude Code, Codex…).',
                )}
              </span>
            </button>
            <button
              type="button"
              className="hs-choix"
              aria-pressed={genre === 'personne'}
              onClick={() => onGenre('personne')}
            >
              <strong>
                <Icone nom="equipe" taille={18} />
                {t('Une personne', 'A person')}
              </strong>
              <span>
                {projet
                  ? t(
                      `Un compte rejoint le projet « ${projet.name} ».`,
                      `An account joins the project “${projet.name}”.`,
                    )
                  : t('Un compte rejoint un projet.', 'An account joins a project.')}
              </span>
            </button>
          </div>

          {genre === 'machine' ? (
            <CorpsInvitationMachine etat={machine} events={events} />
          ) : (
            <InvitationPersonne projet={projet} user={user} refreshTick={refreshTick} />
          )}
        </div>
      </Cadre>
    </Voile>
  );
}

function InvitationPersonne({
  projet,
  user,
  refreshTick,
}: {
  projet: Project | null;
  user: AuthUser | null;
  refreshTick: number;
}) {
  const t = useT();
  if (!user) {
    return (
      <div className="hs-alerte info">
        <p>
          {t(
            'Inviter une personne sur un projet demande un compte : c’est lui qui dit qui l’invite, et qui l’admet. Sans compte, vous pouvez inviter une machine.',
            'Inviting a person to a project requires an account: it says who invites and who admits them. Without an account, you can invite a machine.',
          )}
        </p>
        <button
          type="button"
          className="hs-btn primaire"
          onClick={() => window.dispatchEvent(new Event(EVENT_OUVRIR_COMPTE))}
        >
          {t('Se connecter', 'Sign in')}
        </button>
      </div>
    );
  }
  if (!projet) {
    return (
      <p className="hs-vide">
        {t(
          'Choisissez d’abord un projet : une personne rejoint un projet, pas la ruche entière.',
          'Pick a project first: a person joins a project, not the whole hive.',
        )}
      </p>
    );
  }
  return (
    <>
      <h3>{t('Comment ça marche', 'How it works')}</h3>
      <ol className="hs-etapes">
        <li>
          <span className="hs-etape-num">1</span>
          <div>
            <strong>
              {t(
                'La personne crée son compte sur cette ruche',
                'They create an account on this hive',
              )}
            </strong>
            <span className="hs-discret">
              {t(
                'Puis elle vous donne son identifiant, affiché dans son espace.',
                'Then they give you their identifier, shown in their space.',
              )}
            </span>
          </div>
        </li>
        <li>
          <span className="hs-etape-num">2</span>
          <div>
            <strong>{t('Vous l’admettez ci-dessous', 'You admit them below')}</strong>
            <span className="hs-discret">
              {t(
                'Le propriétaire du projet ou un administrateur seulement. Le retrait est immédiat.',
                'Project owner or an administrator only. Removal is immediate.',
              )}
            </span>
          </div>
        </li>
      </ol>
      <Suspense fallback={<p className="hs-discret">{t('Chargement…', 'Loading…')}</p>}>
        <h3>{t('Équipe du projet', 'Project team')}</h3>
        <EquipeProjet project={projet} user={user} refreshTick={refreshTick} />
        <h3>{t('Montrer sans donner accès', 'Show without granting access')}</h3>
        <p className="hs-discret">
          {t(
            'Un lien de partage montre l’avancement et le code en lecture seule, sans compte : expirable, révocable.',
            'A share link shows progress and code read-only, without an account: expiring, revocable.',
          )}
        </p>
        <PartagesProjet project={projet} user={user} refreshTick={refreshTick} />
      </Suspense>
    </>
  );
}
