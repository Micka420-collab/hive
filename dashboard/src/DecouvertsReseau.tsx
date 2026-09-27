// « Sur votre réseau local » — les machines qui se signalent, et le geste qui
// les accueille.
//
// ─── POURQUOI UN CODE À SAISIR, ET PAS UN SIMPLE BOUTON ──────────────────────
//
// Un bouton « Rejoindre » seul serait un « auto-join » déguisé, dans les deux
// sens : n'importe quelle ruche voisine pourrait s'approprier une machine qui
// se signale, et n'importe qui pourrait se faire passer pour « le portable de
// Camille » et recevoir un billet. Le code d'appariement n'existe QUE sur
// l'écran de la machine : le recopier ici est la preuve qu'on l'a devant soi,
// et l'offre scellée sous ce code ne s'ouvre que chez elle.
//
// L'écran dit donc, à chaque étape, où lire ce code — et, quand la découverte
// est éteinte (le défaut), comment l'allumer. Une liste vide et muette se lirait
// « personne sur le réseau » alors qu'elle veut dire « personne n'écoute ».

import { useState } from 'react';
import type { FormEvent } from 'react';
import { fetchDecouverte, rejoindreDecouvert } from './api';
import type { Decouvert } from './api';
import { useLang, useT } from './i18n';
import { useApiPoll } from './views/shared';
import { PICTO_PLATEFORME } from '../../src/shared/machine';
import { libelleAgent } from '../../src/shared/agent-libelle';

/** Toutes les cinq secondes tant que la fenêtre est ouverte : une machine qu'on vient de lancer doit apparaître vite. */
const CADENCE_MS = 5_000;

export function DecouvertsReseau() {
  const t = useT();
  const lang = useLang();
  const poll = useApiPoll(fetchDecouverte, CADENCE_MS);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  const d = poll.data;
  if (!d) {
    return (
      <section className="decouverte" aria-labelledby="decouverte-titre">
        <h3 id="decouverte-titre">{t('Sur votre réseau local', 'On your local network')}</h3>
        <p className="invite-note">
          {poll.error
            ? t(`Découverte illisible : ${poll.error}`, `Discovery unreadable: ${poll.error}`)
            : t('Écoute du réseau…', 'Listening to the network…')}
        </p>
      </section>
    );
  }

  const libres = d.decouverts.filter((m) => m.etat === 'libre');
  const chezNous = d.decouverts.filter((m) => m.ruche === 'cette_ruche');
  const ailleurs = d.decouverts.filter((m) => m.etat === 'membre' && m.ruche !== 'cette_ruche');

  const ouvrir = (id: string) => {
    setOuverte(id);
    setCode('');
    setRetour(null);
  };

  const envoyer = async (e: FormEvent, m: Decouvert) => {
    e.preventDefault();
    setEnvoi(true);
    setRetour(null);
    try {
      const r = await rejoindreDecouvert(m.id, code);
      setRetour({
        ok: true,
        texte: t(
          r.detail,
          `« ${m.nom} » accepted the offer: it trades its ticket for its key and joins the workers in a few seconds.`,
        ),
      });
      setOuverte(null);
      poll.refresh();
    } catch (err) {
      // Le formulaire RESTE ouvert : un code mal recopié se corrige sur place.
      setRetour({ ok: false, texte: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnvoi(false);
    }
  };

  const agents = (m: Decouvert) =>
    m.agents.length > 0
      ? m.agents.map((a) => libelleAgent(a, lang === 'en')).join(', ')
      : t('aucun agent IA connecté', 'no connected AI agent');

  return (
    <section className="decouverte" aria-labelledby="decouverte-titre">
      <h3 id="decouverte-titre">{t('Sur votre réseau local', 'On your local network')}</h3>

      {!d.active && (
        <p className="invite-note">
          {d.conseil ??
            t('Découverte du réseau local désactivée.', 'Local network discovery is turned off.')}
        </p>
      )}

      {/* Allumée, mais vouée à l'échec : le dire AVANT le clic. */}
      {d.active && d.injoignable && <p className="modal-error">{d.injoignable}</p>}

      {/* Juste après un accueil, la liste se vide : c'est le succès qui parle,
          pas « aucune machine en attente » — qui se lirait comme un échec. */}
      {d.active && libres.length === 0 && !retour?.ok && (
        <p className="invite-note">
          {t(
            'Aucune machine en attente. Sur celle à ajouter, lancez ',
            'No machine is waiting. On the one to add, run ',
          )}
          <code>hive join --decouvrable</code>
          {t(
            ' : elle apparaîtra ici avec un code à recopier.',
            ': it will show up here with a code to copy.',
          )}
        </p>
      )}

      {libres.length > 0 && (
        <ul className="decouverte-liste">
          {libres.map((m) => (
            <li key={m.id} className="decouverte-machine">
              <div className="decouverte-ident">
                <span className="decouverte-nom">
                  <span aria-hidden="true">{PICTO_PLATEFORME[m.os]}</span> {m.nom}
                </span>
                <span className="decouverte-meta">
                  {agents(m)} · {m.places}{' '}
                  {t(m.places > 1 ? 'places' : 'place', m.places > 1 ? 'slots' : 'slot')} ·{' '}
                  {m.adresse}
                </span>
              </div>
              {ouverte === m.id ? (
                <form className="decouverte-code" onSubmit={(e) => void envoyer(e, m)}>
                  <label htmlFor={`code-${m.id}`}>
                    {t('Code affiché sur la machine', 'Code shown on the machine')}
                  </label>
                  <div className="decouverte-code-rangee">
                    <input
                      id={`code-${m.id}`}
                      className="code-input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="K7Q2-9XMP"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={16}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={envoi || code.trim() === ''}
                    >
                      {envoi ? t('Envoi…', 'Sending…') : t('Accueillir', 'Welcome')}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setOuverte(null)}>
                      {t('Annuler', 'Cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className="btn" onClick={() => ouvrir(m.id)}>
                  {t('Rejoindre', 'Join')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {retour && (
        <p role="status" className={retour.ok ? 'decouverte-ok' : 'modal-error'}>
          {retour.texte}
        </p>
      )}

      {(chezNous.length > 0 || ailleurs.length > 0) && (
        <p className="invite-note">
          {chezNous.length > 0 &&
            t(
              `Déjà dans cette ruche : ${chezNous.map((m) => m.nom).join(', ')}.`,
              `Already in this hive: ${chezNous.map((m) => m.nom).join(', ')}.`,
            )}{' '}
          {ailleurs.length > 0 &&
            t(
              `Membres d’une autre ruche : ${ailleurs.length}.`,
              `Members of another hive: ${ailleurs.length}.`,
            )}
        </p>
      )}

      {d.active && (
        <p className="invite-note decouverte-empreinte">
          {t('Empreinte de cette ruche : ', 'This hive’s fingerprint: ')}
          <code>{d.empreinte}</code>
          {t(
            ' — la machine l’affiche en recevant l’offre : comparez-les.',
            ' — the machine prints it when it receives the offer: compare them.',
          )}
        </p>
      )}
    </section>
  );
}
