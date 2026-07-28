// Vue Intendance — la salle des machines : les serveurs que la ruche a démarrés
// pour les abonnés, et les comptes qui ont le droit d'y toucher.
//
// ─── CE QUE CET ÉCRAN MET EN AVANT, ET POURQUOI ──────────────────────────────
//
// Le premier chiffre n'est pas le total des machines : c'est `facturables`,
// celles qui coûtent de l'argent EN CE MOMENT. C'est la seule donnée qu'un hôte
// ne veut jamais découvrir sur sa facture, et un tableau qui ne montrerait que
// « 12 serveurs » la noierait parmi les éteintes et les supprimées.
//
// Le second est la rétention : une machine arrêtée garde son travail trente
// jours, puis il disparaît. Ce compte à rebours doit être VISIBLE avant qu'il
// n'arrive à zéro, pas expliqué après.
//
// ─── CE QUE CET ÉCRAN NE FAIT PAS ────────────────────────────────────────────
//
// Il ne décide rien. Les états permis viennent du serveur (`transitions`), les
// refus aussi. Cacher un bouton n'est pas une sécurité : un membre qui tape
// l'URL reçoit 403 du serveur, et c'est le serveur qui a raison. Ce qui suit
// évite seulement de proposer des gestes voués à être refusés.

import { useState } from 'react';
import {
  billetServeur,
  estAdmin,
  fetchCles,
  fetchMembres,
  fetchServeurs,
  revoquerBillet,
  revoquerNoeud,
  roleConnu,
  setMembreRole,
  setServeurEtat,
} from '../api';
import type {
  EtatServeur,
  IntendanceMembres,
  IntendanceServeurs,
  Role,
  ServeurAdmin,
} from '../api';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { GesteIrreversible } from '../ui';
import { timeShort, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import './intendance.css';

/** Libellés des états. Le mot brut de la base ne se montre pas à un humain. */
const ETAT_LABEL: Record<EtatServeur, { fr: string; en: string }> = {
  demande: { fr: 'demandé', en: 'requested' },
  provisionnement: { fr: 'en préparation', en: 'provisioning' },
  pret: { fr: 'prêt', en: 'ready' },
  arrete: { fr: 'arrêté', en: 'stopped' },
  supprime: { fr: 'supprimé', en: 'deleted' },
  echoue: { fr: 'en échec', en: 'failed' },
};

/**
 * Ce que coûte chaque état, en clair.
 *
 * « arrêté » et « supprimé » ne coûtent rien tous les deux, mais l'un est
 * réversible et l'autre non : les confondre ferait cliquer sur le mauvais.
 */
const ETAT_SENS: Record<EtatServeur, { fr: string; en: string }> = {
  demande: { fr: 'ne coûte rien encore', en: 'not billed yet' },
  provisionnement: { fr: 'facturée', en: 'billed' },
  pret: { fr: 'facturée', en: 'billed' },
  arrete: { fr: 'ne coûte plus rien — réversible', en: 'no longer billed — reversible' },
  supprime: { fr: 'effacée — définitif', en: 'erased — permanent' },
  echoue: { fr: 'ne coûte rien', en: 'not billed' },
};

function etatText(e: EtatServeur, t: Translate): string {
  const l = ETAT_LABEL[e];
  return l ? t(l.fr, l.en) : e;
}

/** Date lisible ; « — » plutôt qu'une époque 1970 pour un horodatage vide. */
function dateOu(ts: number): string {
  if (!ts) return '—';
  return `${new Date(ts).toLocaleDateString()} ${timeShort(ts)}`;
}

export default function Intendance({ user, refreshTick }: ViewProps) {
  const t = useT();
  const admin = estAdmin(user);

  if (!user) {
    return (
      <Refus
        titre={t('Intendance réservée', 'Stewardship is restricted')}
        texte={t(
          'Cet écran gère de vraies machines et de vrais comptes. Il demande une session, pas seulement le jeton de la ruche — celui-ci est distribué à chaque nœud membre.',
          'This screen manages real machines and real accounts. It requires a session, not just the hive token — that token is handed to every member node.',
        )}
        action={t('Connectez-vous depuis la barre du haut.', 'Sign in from the top bar.')}
      />
    );
  }

  if (!admin) {
    return (
      <Refus
        titre={t('Vous n’êtes pas administrateur', 'You are not an administrator')}
        texte={t(
          'L’intendance est ouverte aux comptes administrateurs. Le vôtre est un compte membre : il peut tout faire dans la ruche, sauf démarrer, éteindre ou effacer des machines.',
          'Stewardship is open to administrator accounts. Yours is a member account: it can do everything in the hive except start, stop or erase machines.',
        )}
        action={t(
          'Un administrateur existant peut vous nommer depuis cet écran.',
          'An existing administrator can promote you from this screen.',
        )}
      />
    );
  }

  return <Salle moiId={user.id} refreshTick={refreshTick} />;
}

/**
 * Le contenu réservé aux administrateurs — un composant SÉPARÉ, et ce n'est pas
 * cosmétique.
 *
 * `useApiPoll` mémorise son fetcher dans une ref et ne relance son effet que
 * sur `intervalMs` / `tick`. Appelé dans le composant parent avec un fetcher
 * choisi selon le rôle, il partirait au tout premier rendu — alors que la
 * session n'est pas encore revenue de `/api/auth/me` — avec le fetcher
 * « ne rien demander », et n'irait JAMAIS chercher les machines ensuite :
 * l'écran resterait sur « Relevé en cours… » pour toujours.
 *
 * En montant ce composant seulement une fois le rôle connu, ses hooks
 * démarrent avec le bon fetcher. C'est aussi ce qui garantit qu'aucun appel
 * d'intendance ne part pour un compte qui n'y a pas droit.
 */
function Salle({ moiId, refreshTick }: { moiId: string; refreshTick: number }) {
  const serveurs = useApiPoll(fetchServeurs, 30_000, refreshTick);
  const membres = useApiPoll(fetchMembres, 60_000, refreshTick);

  return (
    <div className="view in-view">
      <SectionServeurs
        data={serveurs.data}
        error={serveurs.error}
        onChanged={() => serveurs.refresh()}
      />
      <SectionMembres
        data={membres.data}
        error={membres.error}
        moiId={moiId}
        onChanged={() => membres.refresh()}
      />
      {/* Les CLÉS après les COMPTES, et surtout distinctes d'eux : un compte
          est une personne qui se connecte, une clé est une machine qui
          butine. Les confondre ferait révoquer l'un en croyant retirer
          l'autre. */}
      <SectionCles refreshTick={refreshTick} />
    </div>
  );
}

function Refus({ titre, texte, action }: { titre: string; texte: string; action: string }) {
  return (
    <div className="view in-view">
      <section className="card in-refus">
        <h2>🔒 {titre}</h2>
        <p>{texte}</p>
        <p className="in-refus-action">{action}</p>
      </section>
    </div>
  );
}

// ─── Les serveurs ────────────────────────────────────────────────────────────

function SectionServeurs({
  data,
  error,
  onChanged,
}: {
  data: IntendanceServeurs | null;
  error: string | null;
  onChanged: () => void;
}) {
  const t = useT();

  if (error) {
    return (
      <section className="card">
        <h2>🖥 {t('Les machines', 'Machines')}</h2>
        <p className="panel-error">{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card">
        <h2>🖥 {t('Les machines', 'Machines')}</h2>
        <p className="muted-text">{t('Relevé en cours…', 'Reading…')}</p>
      </section>
    );
  }

  const { vue } = data;

  return (
    <section className="card in-serveurs">
      <header className="panel-head">
        <h2>🖥 {t('Les machines', 'Machines')}</h2>
        <span className="muted-text">
          {t('fournisseur', 'provider')} : <code>{data.fournisseur}</code> · {t('plafond', 'cap')}{' '}
          {data.serveursMax} · {t('rétention', 'retention')} {data.retentionJours}{' '}
          {t('jours', 'days')}
        </span>
      </header>

      <div className="in-tuiles">
        <Tuile
          valeur={vue.facturables}
          libelle={t('facturées en ce moment', 'billed right now')}
          ton={vue.facturables > 0 ? 'chaud' : 'calme'}
          aide={t(
            'Machines en préparation ou prêtes. C’est ce que coûte la ruche à cette seconde.',
            'Machines provisioning or ready. This is what the hive costs this second.',
          )}
        />
        <Tuile
          valeur={vue.parEtat.pret}
          libelle={t('prêtes', 'ready')}
          ton="calme"
          aide={t('Machines qui travaillent.', 'Machines actually working.')}
        />
        <Tuile
          valeur={vue.parEtat.arrete}
          libelle={t('arrêtées', 'stopped')}
          ton="calme"
          aide={t(
            'Ne coûtent plus rien ; leur travail est encore là.',
            'No longer billed; their work is still there.',
          )}
        />
        <Tuile
          valeur={vue.parEtat.echoue}
          libelle={t('en échec', 'failed')}
          ton={vue.parEtat.echoue > 0 ? 'chaud' : 'calme'}
          aide={t(
            'Le fournisseur a refusé. Le motif est sur la ligne.',
            'The provider refused. The reason is on the row.',
          )}
        />
        <Tuile
          valeur={vue.total}
          libelle={t('au total', 'in total')}
          ton="calme"
          aide={t('Supprimées comprises.', 'Deleted ones included.')}
        />
      </div>

      {vue.bientotSupprimes.length > 0 && (
        <p className="in-alerte" role="status">
          ⏳{' '}
          {t(
            'Effacement définitif imminent — le travail de ces machines part avec elles :',
            'Permanent erasure imminent — these machines take their work with them:',
          )}{' '}
          {vue.bientotSupprimes.map((b) => `${b.id} (${b.jours} j)`).join(', ')}
        </p>
      )}

      {data.serveurs.length === 0 ? (
        <p className="muted-text in-vide">
          {t(
            'Aucune machine. Elles se créent seules quand un abonnement qui en inclut est payé — il n’y a rien à démarrer à la main ici.',
            'No machines. They are created on their own when a plan that includes them is paid — there is nothing to start by hand here.',
          )}
        </p>
      ) : (
        <table className="task-table in-table">
          <thead>
            <tr>
              <th>{t('Projet', 'Project')}</th>
              <th>{t('État', 'State')}</th>
              <th>{t('Gabarit', 'Size')}</th>
              <th>{t('Machine', 'Machine')}</th>
              <th>{t('Mis à jour', 'Updated')}</th>
              <th>{t('Gestes', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.serveurs.map((s) => (
              <LigneServeur key={s.id} s={s} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Tuile({
  valeur,
  libelle,
  ton,
  aide,
}: {
  valeur: number;
  libelle: string;
  ton: 'calme' | 'chaud';
  aide: string;
}) {
  return (
    <div className={`in-tuile ${ton}`} title={aide}>
      <span className="in-tuile-valeur">{valeur}</span>
      <span className="in-tuile-libelle">{libelle}</span>
    </div>
  );
}

function LigneServeur({ s, onChanged }: { s: ServeurAdmin; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<EtatServeur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [aConfirmer, setAConfirmer] = useState<EtatServeur | null>(null);
  // Le billet n'est PAS rangé : il vit en mémoire côté hub et disparaît dès
  // qu'on l'a lu. On le garde donc ici le temps de la page, et l'écran dit
  // clairement qu'il faut le copier maintenant.
  const [billet, setBillet] = useState<string | null>(null);
  const [billetOccupe, setBilletOccupe] = useState(false);

  const demanderBillet = async () => {
    setBilletOccupe(true);
    setErreur(null);
    try {
      setBillet((await billetServeur(s.id)).commande);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBilletOccupe(false);
    }
  };

  const agir = async (vers: EtatServeur) => {
    setBusy(vers);
    setErreur(null);
    setNote(null);
    try {
      const r = await setServeurEtat(s.id, vers, 'geste d’intendance');
      // `change: false` = l'état était déjà celui-là (double-clic, rejeu).
      // Le dire posément vaut mieux que de le peindre en rouge.
      if (!r.change) setNote(t('déjà dans cet état', 'already in that state'));
      onChanged();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setAConfirmer(null);
    }
  };

  return (
    <>
      <tr className={`in-ligne etat-${s.etat}`}>
        <td>
          <span className="in-projet">{s.projet || t('(projet effacé)', '(project gone)')}</span>
          <code className="in-id">{s.id}</code>
        </td>
        <td>
          <span className={`in-etat etat-${s.etat}`}>{etatText(s.etat, t)}</span>
          <small className="in-sens">{t(ETAT_SENS[s.etat].fr, ETAT_SENS[s.etat].en)}</small>
          {s.joursAvantSuppression >= 0 && (
            <small className="in-retention">
              ⏳ {s.joursAvantSuppression} {t('j avant effacement', 'd before erasure')}
            </small>
          )}
        </td>
        <td>{s.gabarit}</td>
        <td>
          {s.refMachine ? (
            <code>{s.refMachine}</code>
          ) : (
            <span className="muted-text">{t('pas encore créée', 'not created yet')}</span>
          )}
          {s.motif && <small className="in-motif">{s.motif}</small>}
          {/* Le billet ne se range plus : il faut donc un endroit pour aller le
              chercher, sinon le motif caviardé renvoie l'administrateur vers
              une page qui ne sait rien lui donner. */}
          {s.etat === 'provisionnement' &&
            (billet === null ? (
              <button
                className="btn ghost in-geste"
                disabled={billetOccupe}
                onClick={() => void demanderBillet()}
                title={t(
                  'Le billet n’est remis qu’une seule fois : copiez-le tout de suite.',
                  'The ticket is handed over only once: copy it right away.',
                )}
              >
                {billetOccupe ? '…' : t('🎟 Voir le billet', '🎟 Show the ticket')}
              </button>
            ) : (
              <>
                <code className="in-billet">{billet}</code>
                <small className="in-motif">
                  {t(
                    'Copiez-le maintenant : il ne sera plus affiché. Un billet perdu ne se retrouve pas, il se remplace.',
                    'Copy it now: it will not be shown again. A lost ticket is not recovered, it is replaced.',
                  )}
                </small>
              </>
            ))}
        </td>
        <td className="in-date">{dateOu(s.majA)}</td>
        <td className="in-gestes">
          {s.transitions.length === 0 ? (
            <span className="muted-text">{t('rien à faire', 'nothing to do')}</span>
          ) : (
            s.transitions.map((vers) => (
              <button
                key={vers}
                className={`btn ghost in-geste${vers === 'supprime' ? ' danger' : ''}`}
                disabled={busy !== null}
                onClick={() => (vers === 'supprime' ? setAConfirmer(vers) : void agir(vers))}
                title={t(ETAT_SENS[vers].fr, ETAT_SENS[vers].en)}
              >
                {busy === vers ? '…' : `→ ${etatText(vers, t)}`}
              </button>
            ))
          )}
        </td>
      </tr>
      {(erreur || note || aConfirmer) && (
        <tr className="in-ligne-suite">
          <td colSpan={6}>
            {erreur && <span className="panel-error">{erreur}</span>}
            {note && <span className="muted-text">{note}</span>}
            {aConfirmer && (
              <span className="in-confirme">
                {t(
                  'Effacer définitivement cette machine ? Son travail ne sera pas récupérable.',
                  'Permanently erase this machine? Its work will not be recoverable.',
                )}{' '}
                <button className="btn danger" onClick={() => void agir(aConfirmer)}>
                  {t('Oui, effacer', 'Yes, erase')}
                </button>
                <button className="btn ghost" onClick={() => setAConfirmer(null)}>
                  {t('Annuler', 'Cancel')}
                </button>
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Les membres ─────────────────────────────────────────────────────────────

/**
 * Les clés de la ruche — les MACHINES, pas les comptes.
 *
 * ─── POURQUOI CET ÉCRAN MANQUAIT, ET CE QUE ÇA COÛTAIT ───────────────────────
 *
 * Révoquer une clé compromise est l'archétype de la décision d'administration.
 * Elle n'existait qu'en ligne de commande : le tableau de bord montrait le
 * pouls, les anomalies, les castes — et pas « qui a une clé de ma ruche ».
 * Un tableau de bord qui ne permet pas de décider ce qui compte le jour où ça
 * compte n'est pas un tableau de bord.
 *
 * ─── DEUX LISTES, ET IL FAUT LES SÉPARER ─────────────────────────────────────
 *
 * Une CLÉ appartient à une machine et vaut participation à l'essaim. Un BILLET
 * ne vaut rien par lui-même : il sert à OBTENIR une clé, à usage compté et avec
 * une date. Révoquer un billet ne déconnecte personne ; révoquer une clé
 * déconnecte la machine tout de suite — et c'est écrit à l'écran, parce que
 * les deux gestes n'ont pas les mêmes conséquences.
 */
function SectionCles({ refreshTick }: { refreshTick: number }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const cles = useApiPoll(fetchCles, 60_000, refreshTick + tick);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const agir = (id: string, p: Promise<unknown>) => {
    setBusy(id);
    setErreur(null);
    p.then(() => setTick((n) => n + 1))
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const quand = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : t('jamais', 'never'));

  return (
    <section className="card">
      <header className="panel-head">
        <h2>🔑 {t('Les clés de la ruche', 'The hive’s keys')}</h2>
        {cles.data && (
          <span className="panel-count">
            {cles.data.noeuds.filter((n) => !n.revoque).length} {t('active(s)', 'active')}
          </span>
        )}
      </header>

      {cles.error && <p className="panel-error">{cles.error}</p>}
      {erreur && <p className="panel-error">{erreur}</p>}

      {cles.data && (
        <>
          <p className="in-cles-note">
            {t(
              'Une clé appartient à une MACHINE. La révoquer déconnecte cette machine immédiatement — c’est le geste à faire le jour où vous croyez une clé sortie.',
              'A key belongs to a MACHINE. Revoking it disconnects that machine immediately — the gesture for the day you believe a key has leaked.',
            )}
          </p>
          {cles.data.noeuds.length === 0 ? (
            <p className="empty pad">
              {t(
                'Aucune clé par machine : les nœuds connectés utilisent encore le jeton de ruche partagé.',
                'No per-machine key: connected nodes still use the shared hive token.',
              )}
            </p>
          ) : (
            <ul className="in-cles">
              {cles.data.noeuds.map((n) => {
                // La question nomme la machine : cette liste se relit toute
                // seule chaque minute, et la ligne visée peut avoir glissé.
                const nom = (n.label || n.nodeId.slice(0, 12)).slice(0, 40);
                return (
                  <li key={n.nodeId} className={n.revoque ? 'in-cle-morte' : ''}>
                    <span className="in-cle-nom">{n.label || n.nodeId.slice(0, 12)}</span>
                    <span className="in-cle-vu">
                      {t('vue', 'seen')} {quand(n.lastSeenAt)}
                    </span>
                    {n.revoque ? (
                      <span className="in-cle-etat">{t('révoquée', 'revoked')}</span>
                    ) : (
                      // Ce bouton-ci COUPE une machine. Celui des billets, juste
                      // en dessous et jusqu'ici identique, ne déconnecte
                      // personne. Le panneau l'écrivait déjà ; les commandes le
                      // démentaient.
                      <GesteIrreversible
                        libelle={t('Révoquer', 'Revoke')}
                        question={t(
                          `Déconnecter ${nom} maintenant ? Sa clé ne vaudra plus rien.`,
                          `Disconnect ${nom} now? Its key will be worthless.`,
                        )}
                        confirmer={t('Déconnecter', 'Disconnect')}
                        disabled={busy !== null}
                        onConfirmer={() => agir(n.nodeId, revoquerNoeud(n.nodeId))}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="pj-sub-head in-cles-tete">
            <h4>{t('Billets d’invitation', 'Invitation tickets')}</h4>
          </div>
          <p className="in-cles-note">
            {t(
              'Un billet ne vaut rien par lui-même : il sert à obtenir une clé, à usage compté. Le révoquer ne déconnecte personne.',
              'A ticket is worth nothing on its own: it is used to obtain a key, a counted number of times. Revoking it disconnects nobody.',
            )}
          </p>
          {cles.data.billets.length === 0 ? (
            <p className="empty pad">{t('Aucun billet émis.', 'No ticket issued.')}</p>
          ) : (
            <ul className="in-cles">
              {cles.data.billets.map((b) => (
                <li key={b.id} className={b.etat === 'vivant' ? '' : 'in-cle-morte'}>
                  <span className="in-cle-nom">{b.label || b.id.slice(0, 12)}</span>
                  <span className="in-cle-vu">
                    {b.usesLeft}/{b.usesTotal} {t('usage(s)', 'use(s)')}
                  </span>
                  {b.etat === 'vivant' ? (
                    // CE BOUTON RESTE NU, ET C'EST VOULU. Révoquer un billet ne
                    // coupe personne — le panneau l'écrit juste au-dessus. Lui
                    // coller la garde du bouton d'à côté apprendrait à cliquer
                    // à travers les gardes, et la prochaine — celle qui coupe
                    // une machine — se ferait traverser aussi. Une garde
                    // partout est une garde nulle part.
                    <button
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => agir(b.id, revoquerBillet(b.id))}
                    >
                      {t('Révoquer', 'Revoke')}
                    </button>
                  ) : (
                    <span className="in-cle-etat">{b.etat}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SectionMembres({
  data,
  error,
  moiId,
  onChanged,
}: {
  data: IntendanceMembres | null;
  error: string | null;
  moiId: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) {
    return (
      <section className="card">
        <h2>👥 {t('Les comptes', 'Accounts')}</h2>
        <p className="panel-error">{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card">
        <h2>👥 {t('Les comptes', 'Accounts')}</h2>
        <p className="muted-text">{t('Relevé en cours…', 'Reading…')}</p>
      </section>
    );
  }

  const changer = async (userId: string, role: Role) => {
    setBusy(userId);
    setErreur(null);
    try {
      await setMembreRole(userId, role);
      onChanged();
    } catch (e) {
      // Le refus du DERNIER admin arrive ici (409) : c'est un garde-fou, et
      // son texte explique déjà pourquoi. On le montre tel quel.
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card in-membres">
      <header className="panel-head">
        <h2>👥 {t('Les comptes', 'Accounts')}</h2>
        <span className="muted-text">
          {data.membres.length} {t('compte(s)', 'account(s)')} · {data.admins}{' '}
          {t('administrateur(s)', 'administrator(s)')}
        </span>
      </header>

      {data.inscription.avertissement && (
        <p className="in-alerte" role="status">
          {data.inscription.avertissement}
        </p>
      )}

      {erreur && <p className="panel-error">{erreur}</p>}

      <table className="task-table in-table">
        <thead>
          <tr>
            <th>{t('Nom', 'Name')}</th>
            <th>Email</th>
            <th>{t('Rôle', 'Role')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.membres.map((m) => {
            const role = roleConnu(m.role);
            const moi = m.id === moiId;
            const cible: Role = role === 'admin' ? 'membre' : 'admin';
            return (
              <tr key={m.id}>
                <td>
                  {m.displayName}
                  {moi && <span className="in-moi">{t('vous', 'you')}</span>}
                </td>
                <td className="in-email">{m.email}</td>
                <td>
                  <span className={`in-role ${role}`}>
                    {role === 'admin'
                      ? t('administrateur', 'administrator')
                      : t('membre', 'member')}
                  </span>
                </td>
                <td className="in-gestes">
                  <button
                    className="btn ghost in-geste"
                    disabled={busy !== null}
                    onClick={() => void changer(m.id, cible)}
                    title={
                      cible === 'admin'
                        ? t(
                            'Donner le droit de démarrer, éteindre et effacer des machines.',
                            'Grant the right to start, stop and erase machines.',
                          )
                        : t(
                            'Retirer l’accès à l’intendance. Le dernier administrateur ne peut pas être retiré.',
                            'Revoke stewardship access. The last administrator cannot be revoked.',
                          )
                    }
                  >
                    {busy === m.id
                      ? '…'
                      : cible === 'admin'
                        ? t('Nommer administrateur', 'Make administrator')
                        : t('Rendre membre', 'Make member')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
