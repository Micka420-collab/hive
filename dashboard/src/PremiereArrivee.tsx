// L'ASSISTANT DE PREMIÈRE ARRIVÉE — la ruche configurée avant le premier projet.
//
// ─── CE QUI LE DISTINGUE D'`OnboardingEssaim` ────────────────────────────────
//
// `OnboardingEssaim` vit DANS un projet et mène au premier cycle autonome. Cet
// assistant-ci vient AVANT : il demande à l'hôte quelle ruche il installe
// (locale, hybride, cloud), où vivent les secrets, où la ruche livre, quels
// connecteurs il veut, lui montre les agents RÉELLEMENT détectés et leur
// session, puis relève la santé de la Reine avec le docteur — les mêmes
// diagnostics que `hive doctor`, isolement compris.
//
// ─── LES TROIS PROMESSES ─────────────────────────────────────────────────────
//
//   · RANGÉ CHEZ LA REINE : chaque étape franchie part au serveur (brouillon),
//     l'étape courante avec. Un onglet fermé au milieu reprend là où l'on en
//     était — sur ce poste ou sur un autre ;
//   · SEULEMENT POUR QUI PEUT ÉCRIRE : l'administrateur, ou le jeton de ruche
//     tant qu'aucun compte n'existe (`porteConfiguration`). Un membre ne voit
//     pas s'ouvrir un assistant qui lui dirait non ;
//   · RELANÇABLE : l'Intendance le rouvre, prérempli ; le terminer à nouveau
//     met les choix à jour sans rouvrir la « première arrivée » ailleurs.

import './premiere-arrivee.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  fetchSanteInitiale,
  rangerConfigurationInitiale,
  terminerConfigurationInitiale,
} from './api';
import type { EtatConfigurationInitiale } from './api';
import { ErrorState, Fieldset, Skeleton } from './composants';
import { useLang, useT } from './i18n';
import { useDialog, Voile } from './ui';
import {
  etapePrecedente,
  etapeSuivante,
  libelleConnecteur,
  libelleEtape,
  libelleGit,
  libelleMode,
  libelleSecrets,
} from './premiere-arrivee';
import {
  CHOIX_VIERGES,
  CONNECTEURS_INITIAUX,
  ETAPES_ASSISTANT,
  MODES_RUCHE,
  POLITIQUES_SECRETS,
  PREFERENCES_GIT,
} from '../../src/shared/configuration-initiale';
import type {
  ChoixInitiaux,
  EtapeAssistant,
  SanteInitiale,
} from '../../src/shared/configuration-initiale';
import type { Diagnostic } from '../../src/shared/doctor';
import { libelleAgent } from '../../src/shared/agent-libelle';

type Traduire = ReturnType<typeof useT>;

const DOC_CLOUD = 'https://github.com/Micka420-collab/hive/blob/main/docs/CLOUD.md';

const PUCE: Record<Diagnostic['gravite'], string> = {
  ok: '✔',
  risque: '⚠',
  inconnu: '?',
  bloquant: '✘',
};

function motGravite(g: Diagnostic['gravite'], t: Traduire): string {
  switch (g) {
    case 'ok':
      return t('vérifié', 'checked');
    case 'risque':
      return t('à surveiller', 'watch');
    case 'inconnu':
      return t('non vérifiable', 'unverifiable');
    case 'bloquant':
      return t('bloquant', 'blocking');
  }
}

/** Une liste de diagnostics : la puce ET le mot, jamais la couleur seule. */
function ListeDiagnostics({ diags, t }: { diags: readonly Diagnostic[]; t: Traduire }) {
  return (
    <ul className="pa-diags">
      {diags.map((d) => (
        <li key={d.cle} className={`pa-diag pa-diag--${d.gravite}`} data-gravite={d.gravite}>
          <span className="pa-diag-puce" aria-hidden="true">
            {PUCE[d.gravite]}
          </span>
          <span className="pa-diag-corps">
            <span className="pa-diag-mot">{motGravite(d.gravite, t)}</span> · {d.constat}
            {d.reparation && <code className="pa-diag-rep">{d.reparation}</code>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Un choix exclusif : de vrais boutons radio, dans un `fieldset` nommé. */
function ChoixRadio<T extends string>({
  legende,
  nom,
  valeurs,
  valeur,
  onChange,
  decrire,
}: {
  legende: ReactNode;
  nom: string;
  valeurs: readonly T[];
  valeur: T | null;
  onChange: (v: T) => void;
  decrire: (v: T) => { titre: string; texte: string };
}) {
  return (
    <Fieldset legende={legende}>
      <div className="pa-options">
        {valeurs.map((v) => {
          const d = decrire(v);
          return (
            <label key={v} className={`pa-option${valeur === v ? ' pa-option--choisie' : ''}`}>
              <input
                type="radio"
                name={nom}
                value={v}
                checked={valeur === v}
                onChange={() => onChange(v)}
              />
              <span className="pa-option-texte">
                <span className="pa-option-titre">{d.titre}</span>
                <span className="pa-option-aide">{d.texte}</span>
              </span>
            </label>
          );
        })}
      </div>
    </Fieldset>
  );
}

export function PremiereArrivee({
  etat,
  projets,
  onFermer,
  onNouveauProjet,
  onTermine,
}: {
  etat: EtatConfigurationInitiale;
  /** Projets déjà présents dans la ruche — l'étape « premier projet » le dit. */
  projets: number;
  /** « Plus tard » ou Échap : rien n'est perdu, le brouillon est chez la Reine. */
  onFermer: () => void;
  onNouveauProjet: () => void;
  onTermine: (etat: EtatConfigurationInitiale) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [choix, setChoix] = useState<ChoixInitiaux>(() => {
    const c = etat.configuration;
    return c
      ? { mode: c.mode, secrets: c.secrets, git: c.git, connecteurs: c.connecteurs, etape: c.etape }
      : { ...CHOIX_VIERGES };
  });
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [sante, setSante] = useState<SanteInitiale | null>(null);
  const [erreurSante, setErreurSante] = useState<string | null>(null);
  const [santeEnCours, setSanteEnCours] = useState(false);
  const [coherence, setCoherence] = useState(etat.coherence);
  const titre = useRef<HTMLHeadingElement>(null);
  const ref = useDialog<HTMLDivElement>(onFermer, titre);
  const etape = choix.etape;

  const lireSante = useCallback((relancer: boolean) => {
    setSanteEnCours(true);
    setErreurSante(null);
    fetchSanteInitiale(relancer)
      .then((s) => {
        setSante(s);
        setCoherence(s.coherence);
      })
      .catch((e: unknown) => setErreurSante(e instanceof Error ? e.message : String(e)))
      .finally(() => setSanteEnCours(false));
  }, []);

  // Le bilan se relève en arrivant aux étapes qui le montrent — pas avant :
  // il lance les CLI d'agents sur la machine de la Reine.
  useEffect(() => {
    if ((etape === 'agents' || etape === 'stockage' || etape === 'sante') && !sante) {
      lireSante(false);
    }
  }, [etape, sante, lireSante]);

  // Le titre de l'étape prend le focus à chaque changement : un lecteur
  // d'écran entend où il est arrivé, et Tab repart du haut de l'étape.
  useEffect(() => {
    titre.current?.focus();
  }, [etape]);

  const aller = (vers: EtapeAssistant, modif: Partial<ChoixInitiaux> = {}) => {
    const suivant = { ...choix, ...modif, etape: vers };
    setBusy(true);
    setErreur(null);
    rangerConfigurationInitiale({ ...modif, etape: vers })
      .then((r) => {
        setChoix(suivant);
        setCoherence(r.coherence);
      })
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const terminer = () => {
    setBusy(true);
    setErreur(null);
    terminerConfigurationInitiale({
      mode: choix.mode,
      secrets: choix.secrets,
      git: choix.git,
      connecteurs: choix.connecteurs,
    })
      .then((r) => onTermine(r))
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const poser = (modif: Partial<ChoixInitiaux>) => setChoix((c) => ({ ...c, ...modif }));
  // Les étapes dont le choix décide de la sécurité ne se franchissent pas à vide.
  const bloque =
    (etape === 'mode' && choix.mode === null) ||
    (etape === 'git' && choix.git === null) ||
    (etape === 'secrets' && choix.secrets === null);
  const index = ETAPES_ASSISTANT.indexOf(etape);
  const suivante = etapeSuivante(etape);
  const modifDeLEtape = (): Partial<ChoixInitiaux> => {
    if (etape === 'mode') return { mode: choix.mode };
    if (etape === 'git') return { git: choix.git };
    if (etape === 'secrets') return { secrets: choix.secrets };
    if (etape === 'connecteurs') return { connecteurs: choix.connecteurs };
    return {};
  };

  const contenu = (): ReactNode => {
    switch (etape) {
      case 'accueil':
        return (
          <>
            <p className="pa-texte">
              {t(
                'Quelques choix avant le premier projet : quelle ruche vous installez, où vivent les secrets, où la ruche livre. Chaque étape est rangée chez la Reine — vous pouvez fermer et reprendre plus tard, sur ce poste ou un autre.',
                'A few choices before the first project: which hive you are installing, where secrets live, where the hive delivers. Each step is saved at the Queen — you can close and resume later, here or on another computer.',
              )}
            </p>
            <p className="pa-texte pa-muet">
              {t(
                'Rien n’est changé à chaud : la Reine compare vos choix à ce qui tourne et vous donne la ligne exacte à poser quand ils divergent.',
                'Nothing is changed live: the Queen compares your choices with what is running and gives you the exact line to set when they differ.',
              )}
            </p>
          </>
        );
      case 'mode':
        return (
          <>
            <ChoixRadio
              legende={t('Quelle ruche installez-vous ?', 'Which hive are you installing?')}
              nom="pa-mode"
              valeurs={MODES_RUCHE}
              valeur={choix.mode}
              onChange={(mode) => poser({ mode })}
              decrire={(m) => libelleMode(m, t)}
            />
            {choix.mode === 'cloud' && (
              <p className="pa-texte pa-muet">
                <a href={DOC_CLOUD} target="_blank" rel="noreferrer">
                  {t('Guide du mode cloud (docs/CLOUD.md)', 'Cloud mode guide (docs/CLOUD.md)')}
                </a>
              </p>
            )}
          </>
        );
      case 'agents':
        return (
          <div aria-busy={santeEnCours || undefined}>
            <p className="pa-texte">
              {t(
                'Les agents de codage installés sur la machine de la Reine, avec ce que leur propre CLI dit de sa connexion.',
                'The coding agents installed on the Queen’s machine, with what their own CLI says about its sign-in.',
              )}
            </p>
            {!sante ? (
              erreurSante ? (
                <ErrorState
                  titre={t('Le relevé des agents a échoué', 'Agent detection failed')}
                  detail={erreurSante}
                  onReessayer={() => lireSante(true)}
                  enCours={santeEnCours}
                />
              ) : (
                <Skeleton lignes={3} libelle={t('Détection des agents…', 'Detecting agents…')} />
              )
            ) : sante.agents.length === 0 ? (
              <p className="pa-texte" role="status">
                {t(
                  'Aucun agent de codage détecté sur cette machine : les tâches tourneraient en simulation. Installez Claude Code (npm i -g @anthropic-ai/claude-code) ou Codex, puis relancez le relevé.',
                  'No coding agent detected on this machine: tasks would run simulated. Install Claude Code (npm i -g @anthropic-ai/claude-code) or Codex, then run the check again.',
                )}
              </p>
            ) : (
              <ul className="pa-agents">
                {sante.agents.map((a) => (
                  <li key={a.agent} className="pa-agent" data-session={a.session}>
                    <span className="pa-agent-nom">{libelleAgent(a.agent, lang === 'en')}</span>
                    <span className="pa-agent-etat">
                      {a.session === 'connectee'
                        ? t('✔ connecté', '✔ signed in')
                        : a.session === 'non_connectee'
                          ? t('✘ non connecté', '✘ not signed in')
                          : t('? session non vérifiable', '? sign-in unverifiable')}
                      {' · '}
                      {a.travaille
                        ? t('aura une ouvrière', 'will get a worker')
                        : t('n’aura pas d’ouvrière', 'will get no worker')}
                    </span>
                    {a.remede && <code className="pa-diag-rep">{a.remede}</code>}
                  </li>
                ))}
              </ul>
            )}
            {sante && (
              <p className="pa-texte pa-muet">
                {t(
                  `${sante.noeuds.enLigne} ouvrière(s) en ligne sur ${sante.noeuds.inscrits} inscrite(s).`,
                  `${sante.noeuds.enLigne} worker(s) online out of ${sante.noeuds.inscrits} registered.`,
                )}
              </p>
            )}
          </div>
        );
      case 'stockage':
        return (
          <div aria-busy={santeEnCours || undefined}>
            <p className="pa-texte">
              {t(
                'Tout ce que la ruche sait vit dans un fichier SQLite, sur la machine de la Reine. Pour le déplacer : HIVE_DB dans le .env.',
                'Everything the hive knows lives in one SQLite file, on the Queen’s machine. To move it: HIVE_DB in the .env.',
              )}
            </p>
            {sante ? (
              <dl className="pa-dl">
                <dt>{t('Fichier', 'File')}</dt>
                <dd>
                  <code>{sante.stockage.chemin}</code>
                </dd>
                <dt>{t('Intégrité', 'Integrity')}</dt>
                <dd>
                  {sante.stockage.integre === null
                    ? t('non vérifiable', 'unverifiable')
                    : sante.stockage.integre
                      ? t('✔ intègre', '✔ intact')
                      : t('✘ abîmée', '✘ damaged')}
                </dd>
                <dt>{t('Écriture', 'Writable')}</dt>
                <dd>{sante.stockage.inscriptible ? t('✔ oui', '✔ yes') : t('✘ non', '✘ no')}</dd>
                <dt>{t('Espace libre', 'Free space')}</dt>
                <dd>
                  {sante.stockage.octetsLibres === null
                    ? t('non mesurable', 'not measurable')
                    : `${(sante.stockage.octetsLibres / 1024 ** 3).toFixed(1)} ${t('Go', 'GB')}`}
                </dd>
              </dl>
            ) : erreurSante ? (
              <ErrorState
                titre={t('Le relevé du stockage a échoué', 'Storage check failed')}
                detail={erreurSante}
                onReessayer={() => lireSante(true)}
                enCours={santeEnCours}
              />
            ) : (
              <Skeleton lignes={3} />
            )}
          </div>
        );
      case 'git':
        return (
          <ChoixRadio
            legende={t(
              'Où la ruche livre-t-elle le travail relu ?',
              'Where does the hive deliver reviewed work?',
            )}
            nom="pa-git"
            valeurs={PREFERENCES_GIT}
            valeur={choix.git}
            onChange={(git) => poser({ git })}
            decrire={(g) => libelleGit(g, t)}
          />
        );
      case 'secrets':
        return (
          <ChoixRadio
            legende={t('Où vivent les secrets des agents ?', 'Where do the agents’ secrets live?')}
            nom="pa-secrets"
            valeurs={POLITIQUES_SECRETS}
            valeur={choix.secrets}
            onChange={(secrets) => poser({ secrets })}
            decrire={(p) => libelleSecrets(p, t)}
          />
        );
      case 'connecteurs':
        return (
          <Fieldset
            legende={t('Connecteurs (facultatif)', 'Connectors (optional)')}
            aide={t(
              'Seuls les connecteurs qui existent dans cette version sont proposés ; chacun se règle ensuite à sa place.',
              'Only connectors that exist in this version are offered; each is set up later in its own place.',
            )}
          >
            <div className="pa-options">
              {CONNECTEURS_INITIAUX.map((c) => {
                const d = libelleConnecteur(c, t);
                const coche = choix.connecteurs.includes(c);
                return (
                  <label key={c} className={`pa-option${coche ? ' pa-option--choisie' : ''}`}>
                    <input
                      type="checkbox"
                      checked={coche}
                      onChange={() =>
                        poser({
                          connecteurs: coche
                            ? choix.connecteurs.filter((x) => x !== c)
                            : [...choix.connecteurs, c],
                        })
                      }
                    />
                    <span className="pa-option-texte">
                      <span className="pa-option-titre">{d.titre}</span>
                      <span className="pa-option-aide">{d.texte}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Fieldset>
        );
      case 'projet':
        return projets > 0 ? (
          <p className="pa-texte" role="status">
            {t(
              `La ruche a déjà ${projets} projet(s) : cette étape est faite.`,
              `The hive already has ${projets} project(s): this step is done.`,
            )}
          </p>
        ) : (
          <>
            <p className="pa-texte">
              {t(
                'Un projet, c’est un objectif (et, si vous voulez, un dépôt). La Reine le découpe en tâches pour les ouvrières.',
                'A project is a goal (and, if you like, a repository). The Queen splits it into tasks for the workers.',
              )}
            </p>
            <button type="button" className="btn primary" onClick={onNouveauProjet}>
              {t('Créer mon premier projet', 'Create my first project')}
            </button>
            <p className="pa-texte pa-muet">
              {t('Vous pouvez aussi le faire plus tard.', 'You can also do it later.')}
            </p>
          </>
        );
      case 'sante':
        return (
          <div aria-busy={santeEnCours || undefined}>
            {sante ? (
              <>
                <p className="pa-texte" role="status">
                  {t('Bilan relevé à', 'Checked at')}{' '}
                  {new Date(sante.releveA).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR')} —{' '}
                  {motGravite(sante.verdict, t)}
                  {sante.isolement
                    ? t(` · bac à sable : ${sante.isolement}`, ` · sandbox: ${sante.isolement}`)
                    : t(' · aucun moteur de bac à sable', ' · no sandbox engine')}
                </p>
                <ListeDiagnostics diags={sante.diagnostics} t={t} />
              </>
            ) : erreurSante ? (
              <ErrorState
                titre={t('Le bilan de santé a échoué', 'The health check failed')}
                detail={erreurSante}
                onReessayer={() => lireSante(true)}
                enCours={santeEnCours}
              />
            ) : (
              <Skeleton lignes={5} libelle={t('Bilan en cours…', 'Checking…')} />
            )}
            {sante && (
              <button
                type="button"
                className="btn ghost"
                aria-disabled={santeEnCours || undefined}
                onClick={() => {
                  if (!santeEnCours) lireSante(true);
                }}
              >
                {santeEnCours ? t('Relevé…', 'Checking…') : t('Relancer le bilan', 'Run again')}
              </button>
            )}
          </div>
        );
      case 'recap':
        return (
          <>
            <dl className="pa-dl">
              <dt>{t('Mode', 'Mode')}</dt>
              <dd>{choix.mode ? libelleMode(choix.mode, t).titre : t('à choisir', 'to choose')}</dd>
              <dt>{t('Secrets', 'Secrets')}</dt>
              <dd>
                {choix.secrets
                  ? libelleSecrets(choix.secrets, t).titre
                  : t('à choisir', 'to choose')}
              </dd>
              <dt>Git</dt>
              <dd>{choix.git ? libelleGit(choix.git, t).titre : t('à choisir', 'to choose')}</dd>
              <dt>{t('Connecteurs', 'Connectors')}</dt>
              <dd>
                {choix.connecteurs.length === 0
                  ? t('aucun', 'none')
                  : choix.connecteurs.map((c) => libelleConnecteur(c, t).titre).join(' · ')}
              </dd>
            </dl>
            {coherence.length > 0 && (
              <>
                <h3 className="pa-sous-titre">
                  {t('Vos choix face à la Reine qui tourne', 'Your choices vs the running Queen')}
                </h3>
                <ListeDiagnostics diags={coherence} t={t} />
              </>
            )}
          </>
        );
    }
  };

  return (
    <Voile onClose={() => undefined}>
      <div
        ref={ref}
        className="modal pa-assistant"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pa-titre"
        data-testid="premiere-arrivee"
        data-etape={etape}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="pa-surtitre">{t('Première arrivée', 'First arrival')}</p>
        <ol className="pa-etapes" aria-label={t('Étapes', 'Steps')}>
          {ETAPES_ASSISTANT.map((e, i) => (
            <li
              key={e}
              className={i < index ? 'pa-faite' : i === index ? 'pa-courante' : undefined}
              aria-current={i === index ? 'step' : undefined}
            >
              <span className="ds-invisible">
                {i < index
                  ? t('faite : ', 'done: ')
                  : i === index
                    ? t('en cours : ', 'current: ')
                    : ''}
              </span>
              {libelleEtape(e, t)}
            </li>
          ))}
        </ol>
        <h2 id="pa-titre" ref={titre} tabIndex={-1} className="pa-titre">
          {etape === 'accueil'
            ? t('Bienvenue dans votre ruche', 'Welcome to your hive')
            : libelleEtape(etape, t)}
        </h2>
        <div className="pa-corps">{contenu()}</div>
        {bloque && (
          <p className="pa-texte pa-muet" id="pa-bloque">
            {t('Choisissez une option pour continuer.', 'Pick an option to continue.')}
          </p>
        )}
        {erreur && (
          <p className="pa-erreur" role="alert">
            {erreur}
          </p>
        )}
        <footer className="pa-pied">
          <button type="button" className="btn ghost" onClick={onFermer}>
            {t('Plus tard', 'Later')}
          </button>
          <span className="pa-pied-droite">
            {etape !== 'accueil' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => aller(etapePrecedente(etape))}
              >
                {t('Précédent', 'Back')}
              </button>
            )}
            {etape === 'recap' ? (
              <button type="button" className="btn primary" disabled={busy} onClick={terminer}>
                {busy ? t('Enregistrement…', 'Saving…') : t('Terminer', 'Finish')}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={busy || bloque}
                aria-describedby={bloque ? 'pa-bloque' : undefined}
                onClick={() => aller(suivante, modifDeLEtape())}
              >
                {etape === 'accueil' ? t('Commencer', 'Start') : t('Suivant', 'Next')}
              </button>
            )}
          </span>
        </footer>
      </div>
    </Voile>
  );
}
