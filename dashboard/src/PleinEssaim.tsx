// Le Plein Essaim — jusqu'où la ruche avance seule sur un projet.
//
// PARTI PRIS D'INTERFACE : ce panneau ne montre pas un interrupteur, il montre
// CE QUE LA RUCHE FERAIT MAINTENANT. Un bouton qui allume une gouvernance
// autonome sans dire son prochain geste demande une confiance qu'on n'a pas à
// demander — et il rend l'autonomie effrayante alors qu'elle est explicable.
//
// Deux commandes distinctes, et la séparation est le sujet :
//   · le NIVEAU, qui dit jusqu'où la ruche va toute seule ;
//   · l'INSCRIPTION DU DÉPÔT, qui est l'autorisation de fusionner, donnée une
//     fois. Les deux sont exigées ensemble pour qu'une fusion parte.
//
// Une case qui coche les deux d'un geste aurait fait passer l'autorisation
// d'écriture pour un détail du réglage. C'est exactement ce qu'il ne faut pas.
//
// ─── UNE SEULE LISTE, ET LE GESTE QUI LÈVE CHAQUE MANQUE ─────────────────────
//
// La carte d'un projet empilait deux listes de la même préparation, qui se
// contredisaient : « Chemin vers le premier cycle — 1/5 prérequis » au-dessus,
// « Prêt pour l'autonomie · 4/8 » ici, sur un fond crème écrit pour l'ancien
// thème et illisible sur le sombre. Il n'en reste qu'une : chaque condition
// manquante dit ce qui manque et le geste qui la lève. Et le chemin des
// gouvernantes dit le VRAI — une caste se GAGNE sur antécédents
// (polyethisme.ts, règle 1) ; l'ancienne aide envoyait la « nommer » dans la
// Chambre, où rien ne la donne.
//
// L'ordre reste celui du raisonnement : maintenant → prêt ? → santé (AVANT les
// réglages : on ne propose pas de monter le niveau d'une ruche qui abîme le
// projet) → niveau et autorisation → ce que la ruche a appris.

import { useCallback, useEffect, useState } from 'react';
import { fetchEssaim, fetchEssaimCycles, setEssaim } from './api';
import type {
  CycleEssaimUi,
  DeriveUi,
  EtatEssaimUi,
  IndicateurDerive,
  NiveauEssaim,
  PasEssaim,
} from './api';
import { useT } from './i18n';
import { Icone, type NomIcone } from './studio/Icone';
import { useGestes } from './studio/gestes';
import { timeShort } from './views/shared';

type T = ReturnType<typeof useT>;

/** Rafraîchissement : la décision change quand l'état de la ruche change. */
const PERIODE_MS = 5_000;

/** Le ton d'un état, lu par la feuille (`ton-*`) — jamais la couleur seule. */
type Ton = 'neutre' | 'actif' | 'ok' | 'attention' | 'echec';

function libellePas(pas: PasEssaim, t: T): string {
  switch (pas) {
    case 'inerte':
      return t('En sommeil', 'Dormant');
    case 'halte':
      return t('Halte — la ruche se dégrade', 'Halt — the hive is degrading');
    case 'plafond':
      return t('Plafond atteint', 'Cap reached');
    case 'deliberer':
      return t('Délibérer', 'Deliberate');
    case 'planifier':
      return t('Planifier', 'Plan');
    case 'butiner':
      return t('Butiner', 'Forage');
    case 'corriger':
      return t('Corriger', 'Fix');
    case 'livrer':
      return t('Livrer', 'Deliver');
    case 'fusionner':
      return t('Fusionner', 'Merge');
    default:
      // Le dashboard est servi en fichiers statiques : ce navigateur peut
      // parler à un orchestrateur plus récent, qui connaît un pas de plus.
      // On rend alors son NOM BRUT — inélégant, mais vrai. Inventer un
      // libellé (« Repos ») afficherait une décision que la ruche n'a pas
      // prise, et c'est le pire mensonge possible sur cet écran.
      return pas;
  }
}

function iconePas(pas: PasEssaim): NomIcone {
  const icones: Record<PasEssaim, NomIcone> = {
    inerte: 'arret',
    halte: 'avertissement',
    plafond: 'avertissement',
    deliberer: 'bulle',
    planifier: 'plan',
    butiner: 'etincelles',
    corriger: 'eclair',
    livrer: 'envoyer',
    fusionner: 'diff',
  };
  // `??` et pas un accès nu : un pas inconnu d'un serveur plus récent rendrait
  // `undefined`, donc une icône vide à côté d'un libellé bien présent.
  return icones[pas] ?? 'activite';
}

function tonPas(pas: PasEssaim): Ton {
  switch (pas) {
    case 'halte':
      return 'echec';
    case 'plafond':
      return 'attention';
    case 'deliberer':
    case 'planifier':
    case 'butiner':
    case 'corriger':
    case 'livrer':
    case 'fusionner':
      return 'actif';
    default:
      // `inerte`, et un pas inconnu : on ne prétend pas qu'il se passe quelque chose.
      return 'neutre';
  }
}

/** « autonomie désactivée » → « Autonomie désactivée. » : le motif se lit comme une phrase. */
function phrase(s: string): string {
  const x = s.trim();
  if (x === '') return x;
  const p = x[0]!.toUpperCase() + x.slice(1);
  return /[.!?…]$/.test(p) ? p : `${p}.`;
}

function libelleNiveau(n: NiveauEssaim, t: T): string {
  switch (n) {
    case 'off':
      return t('Éteint', 'Off');
    case 'propose':
      return t('Propose', 'Propose');
    case 'gouverne':
      return t('Gouverne', 'Govern');
    case 'plein':
      return t('Plein', 'Full');
    default:
      // Un niveau d'un orchestrateur plus récent : son nom brut, pas un libellé inventé.
      return n;
  }
}

function descriptionNiveau(n: NiveauEssaim, t: T): string {
  switch (n) {
    case 'off':
      return t(
        'La ruche ne fait rien seule : elle attend tes missions.',
        'The hive does nothing on its own: it waits for your missions.',
      );
    case 'propose':
      return t(
        'Elle choisit quoi faire et crée les tâches. Elle ne livre rien.',
        'It picks what to do and creates the tasks. It delivers nothing.',
      );
    case 'gouverne':
      return t(
        'Elle décide, produit, se critique et ouvre les pull requests. Rien n’est fusionné.',
        'It decides, produces, critiques itself and opens pull requests. Nothing is merged.',
      );
    default:
      return t(
        'Tout ce qui précède, et elle fusionne — seulement sur un dépôt que tu as autorisé.',
        'All of the above, and it merges — only into a repository you authorised.',
      );
  }
}

type EtatSante = DeriveUi['etat'];

function libelleSante(e: EtatSante, t: T): string {
  switch (e) {
    case 'saine':
      return t('Bonne', 'Good');
    case 'a_surveiller':
      return t('À surveiller', 'To watch');
    case 'degradee':
      return t('Dégradée', 'Degraded');
    default:
      return t('Pas encore mesurable', 'Not measurable yet');
  }
}

function tonSante(e: EtatSante): Ton {
  return e === 'saine'
    ? 'ok'
    : e === 'degradee'
      ? 'echec'
      : e === 'a_surveiller'
        ? 'attention'
        : 'neutre';
}

function iconeSante(e: EtatSante): NomIcone {
  return e === 'saine' ? 'coche' : e === 'indeterminee' ? 'horloge' : 'avertissement';
}

function libelleIndicateur(cle: IndicateurDerive['cle'], t: T): string {
  switch (cle) {
    case 'qualite':
      return t('Qualité', 'Quality');
    case 'entropie':
      return t('Complexité', 'Complexity');
    case 'repetition':
      return t('Répétition', 'Repetition');
    default:
      return t('Solitude', 'Solitude');
  }
}

function libelleIssueCycle(issue: string | undefined, t: T): string {
  switch (issue) {
    case 'agi':
      return t('a agi', 'acted');
    case 'observe':
      return t('observe', 'observed');
    case 'abandonne':
      return t('abandonné', 'abandoned');
    case 'echoue':
      return t('échec', 'failed');
    case 'non_branche':
      return t('non branché', 'not wired');
    default:
      return issue ?? '—';
  }
}

// ─── PRÊT POUR L'AUTONOMIE ──────────────────────────────────────────────────

/** Une condition de l'autonomie, et ce qui la lève quand elle manque. */
export interface EtapeAutonomie {
  id: 'agents' | 'runner' | 'gouvernantes' | 'sante' | 'budget' | 'fusion';
  ok: boolean;
  titre: string;
  /** À droite du titre : un compte (« 0 sur 2 ») ou des noms. */
  detail?: string;
  /** Ce qui manque, en une phrase — lue seulement quand la condition manque. */
  aide: string;
  /** Une commande à taper, montrée comme du code. */
  code?: string;
  /** Un geste que l'écran sait faire lui-même. */
  geste?: 'inviter';
}

/**
 * Les conditions, dans l'ordre du chemin. Lues dans `pret` — le serveur
 * (GET /essaim) les calcule ; l'écran n'en invente aucune. La fusion n'en est
 * une qu'au niveau Plein : ailleurs, le serveur la dit remplie (`!veutFusion`),
 * et une coche verte sur « dépôt autorisé » d'un projet SANS dépôt mentait.
 */
export function etapesAutonomie(etat: EtatEssaimUi, t: T): EtapeAutonomie[] {
  const p = etat.pret;
  if (!p) return [];
  const n = etat.gouvernantes.length;
  const requises = etat.gouvernantesRequises;
  const s = etat.seuilsGouvernante;
  const etapes: EtapeAutonomie[] = [
    {
      id: 'agents',
      ok: p.noeudsEnLigne && p.agentsReels,
      titre: t('Un vrai agent de codage en ligne', 'A real coding agent online'),
      aide: !p.noeudsEnLigne
        ? t(
            'Aucune machine n’est en ligne. Invite une machine où Claude Code, Codex ou un autre agent de codage est installé.',
            'No machine is online. Invite a machine where Claude Code, Codex or another coding agent is installed.',
          )
        : t(
            'Les machines en ligne sont simulées : pour travailler seule, la ruche a besoin d’un vrai agent — Claude Code, Codex…',
            'The machines online are simulated: to work on its own, the hive needs a real agent — Claude Code, Codex…',
          ),
      geste: 'inviter',
    },
    {
      id: 'runner',
      ok: p.runner,
      titre: t('L’autonomie branchée sur la Reine', 'Autonomy enabled on the Queen'),
      aide: t(
        'Relance la Reine avec cette variable. Sans elle, la ruche calcule ses décisions sans les exécuter.',
        'Restart the Queen with this variable. Without it, the hive computes its decisions without carrying them out.',
      ),
      code: 'HIVE_RUNNER=on',
    },
    {
      id: 'gouvernantes',
      ok: p.gouvernantes,
      titre: t(`${requises} gouvernantes`, `${requises} governing workers`),
      detail: p.gouvernantes
        ? etat.gouvernantes.map((g) => g.nom).join(' · ')
        : t(`${n} sur ${requises}`, `${n} of ${requises}`),
      aide: s
        ? t(
            `Une ouvrière devient gouvernante en faisant ses preuves : au moins ${s.productions} productions, avec une fiabilité d’au moins ${Math.round(s.fiabilite * 100)} %. Rien à régler — laisse travailler tes machines.`,
            `A worker becomes a governing worker by proving itself: at least ${s.productions} productions, with at least ${Math.round(s.fiabilite * 100)} % reliability. Nothing to set — let your machines work.`,
          )
        : t(
            'Une ouvrière devient gouvernante en faisant ses preuves, production après production. Rien à régler — laisse travailler tes machines.',
            'A worker becomes a governing worker by proving itself, production after production. Nothing to set — let your machines work.',
          ),
    },
    {
      id: 'sante',
      ok: p.derive,
      titre: t('Un projet en bonne santé', 'A healthy project'),
      aide: t(
        'La santé du projet est dégradée — le détail est juste en dessous. La ruche ne prend pas d’autonomie sur un projet qui se dégrade.',
        'The project’s health is degraded — details just below. The hive takes no autonomy on a project that is degrading.',
      ),
    },
    {
      id: 'budget',
      ok: p.plafond,
      titre: t('Du budget disponible', 'Budget available'),
      aide: t(
        'Le plafond de dépense est atteint : relève-le ou retire-le dans la Balance du projet.',
        'The spend cap is reached: raise or remove it in the project’s Balance.',
      ),
    },
  ];
  if (etat.niveau === 'plein') {
    etapes.push({
      id: 'fusion',
      ok: p.repo && p.depot,
      titre: t('Un dépôt autorisé pour la fusion', 'A repository authorised for merging'),
      aide: !p.repo
        ? t(
            'Ajoute l’adresse du dépôt GitHub au projet : sans elle, la ruche n’a nulle part où fusionner.',
            'Add the GitHub repository address to the project: without it, the hive has nowhere to merge.',
          )
        : t(
            'Coche « Fusionner sans me redemander », plus bas.',
            'Tick “Merge without asking me”, below.',
          ),
    });
  }
  return etapes;
}

function LigneEtape({
  e,
  ouverte,
  t,
  onInviter,
}: {
  e: EtapeAutonomie;
  ouverte: boolean;
  t: T;
  onInviter: () => void;
}) {
  if (e.ok) {
    return (
      <li className="essaim-etape ok" data-etape={e.id}>
        <span className="essaim-etape-puce" aria-hidden="true">
          <Icone nom="coche" taille={12} />
        </span>
        <span className="essaim-etape-titre">
          {e.titre}
          <span className="hs-visuellement-cache"> — {t('fait', 'done')}</span>
        </span>
        {e.detail && <span className="essaim-etape-detail">{e.detail}</span>}
      </li>
    );
  }
  return (
    <li className="essaim-etape manque" data-etape={e.id}>
      {/* `details` natif : il s'ouvre au clavier comme à la souris, et la
          première condition manquante arrive ouverte — c'est elle qu'on lève. */}
      <details open={ouverte}>
        <summary>
          <span className="essaim-etape-puce" aria-hidden="true" />
          <span className="essaim-etape-titre">
            {e.titre}
            <span className="hs-visuellement-cache"> — {t('à faire', 'to do')}</span>
          </span>
          {e.detail && <span className="essaim-etape-detail">{e.detail}</span>}
          <span className="essaim-etape-chevron" aria-hidden="true">
            <Icone nom="chevronBas" taille={14} />
          </span>
        </summary>
        <div className="essaim-etape-aide">
          <p>{e.aide}</p>
          {e.code && <code className="essaim-code">{e.code}</code>}
          {e.geste === 'inviter' && (
            <button type="button" className="essaim-btn" onClick={onInviter}>
              <Icone nom="machine" taille={14} />
              {t('Inviter une machine', 'Invite a machine')}
            </button>
          )}
        </div>
      </details>
    </li>
  );
}

function PretPourAutonomie({
  etat,
  t,
  idTitre,
  onInviter,
}: {
  etat: EtatEssaimUi;
  t: T;
  idTitre: string;
  onInviter: () => void;
}) {
  const etapes = etapesAutonomie(etat, t);
  if (etapes.length === 0) return null;
  const faites = etapes.filter((e) => e.ok).length;
  const complet = faites === etapes.length;
  const premiere = etapes.find((e) => !e.ok)?.id;
  const liste = (
    <ol className="essaim-etapes">
      {etapes.map((e) => (
        <LigneEtape key={e.id} e={e} ouverte={e.id === premiere} t={t} onInviter={onInviter} />
      ))}
    </ol>
  );
  return (
    <section className="essaim-section" aria-labelledby={idTitre}>
      <div className="essaim-section-tete">
        <h4 id={idTitre}>{t('Prêt pour l’autonomie', 'Ready for autonomy')}</h4>
        <span className={`essaim-etat ton-${complet ? 'ok' : 'neutre'}`}>
          {t(`${faites} sur ${etapes.length}`, `${faites} of ${etapes.length}`)}
        </span>
      </div>
      <div
        className="essaim-jauge"
        role="progressbar"
        aria-labelledby={idTitre}
        aria-valuemin={0}
        aria-valuemax={etapes.length}
        aria-valuenow={faites}
        aria-valuetext={t(
          `${faites} condition(s) remplie(s) sur ${etapes.length}`,
          `${faites} of ${etapes.length} condition(s) met`,
        )}
      >
        <span style={{ width: `${(faites / etapes.length) * 100}%` }} />
      </div>
      {complet ? (
        // Tout est prêt : la liste se replie, elle reste à un clic.
        <details className="essaim-pret-replie">
          <summary>
            {etat.niveau === 'off'
              ? t(
                  'Tout est prêt : choisis un niveau d’autonomie ci-dessous.',
                  'All set: pick an autonomy level below.',
                )
              : t('Tout est prêt.', 'All set.')}
            <span className="essaim-etape-chevron" aria-hidden="true">
              <Icone nom="chevronBas" taille={14} />
            </span>
          </summary>
          {liste}
        </details>
      ) : (
        liste
      )}
    </section>
  );
}

// ─── LE PANNEAU ─────────────────────────────────────────────────────────────

export function PleinEssaim({ projectId }: { projectId: string }) {
  const t = useT();
  const gestes = useGestes();
  const [etat, setEtat] = useState<EtatEssaimUi | null>(null);
  const [cycles, setCycles] = useState<CycleEssaimUi[] | null>(null);
  const [erreur, setErreur] = useState<string>('');
  const [occupe, setOccupe] = useState(false);
  const id = `essaim-${projectId}`;

  const recharger = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([fetchEssaim(projectId), fetchEssaimCycles(projectId, 10)]);
      setEtat(e);
      setCycles(c.cycles);
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void recharger();
    const minuterie = setInterval(() => void recharger(), PERIODE_MS);
    return () => clearInterval(minuterie);
  }, [recharger]);

  const regler = async (niveau: NiveauEssaim, depotInscrit: boolean): Promise<void> => {
    // Pendant un envoi, le geste est ignoré — pas désactivé : un bouton qui se
    // désactive sous le doigt jette le focus au fond de la page.
    if (occupe) return;
    setOccupe(true);
    try {
      await setEssaim(projectId, niveau, depotInscrit);
      await recharger();
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const entete = (
    <header className="essaim-tete">
      <h3 id={`${id}-titre`}>
        <span className="marque" aria-hidden="true" /> {t('Plein Essaim', 'Full Swarm')}
      </h3>
      <p className="essaim-intro">
        {t(
          'La ruche décide, produit et se corrige seule, des jours durant — jusqu’au niveau que tu choisis, tant que le projet reste sain.',
          'The hive decides, produces and fixes itself, for days on end — up to the level you choose, as long as the project stays healthy.',
        )}
      </p>
    </header>
  );

  const ligneErreur = erreur ? (
    <p className="essaim-erreur" role="alert">
      <Icone nom="avertissement" taille={14} />
      <span>{erreur}</span>
    </p>
  ) : null;

  if (!etat) {
    return (
      <section className="essaim-panneau" aria-labelledby={`${id}-titre`} aria-busy={!erreur}>
        {entete}
        {ligneErreur ?? <p className="essaim-vide">{t('Chargement…', 'Loading…')}</p>}
      </section>
    );
  }

  const pas = etat.decision.pas;
  const systemiques = etat.lecons.filter((l) => l.portee === 'systemique');
  const derive = etat.derive;
  // « Pas encore mesurable » dit POURQUOI (le motif porte le compte et le seuil) ;
  // ailleurs, le compte des productions observées — jamais un « 0 » décoratif.
  const noteSante =
    derive.etat === 'indeterminee'
      ? phrase(derive.motif)
      : derive.echantillon > 0
        ? t(
            `${derive.echantillon} production(s) observée(s)`,
            `${derive.echantillon} production(s) observed`,
          )
        : null;
  const replierSante = derive.etat === 'saine' || derive.etat === 'indeterminee';
  const indicateurs = (
    <ul className="essaim-indicateurs">
      {derive.indicateurs.map((i) => (
        <li key={i.cle} className={`essaim-ind essaim-ind--${i.etat} ton-${tonSante(i.etat)}`}>
          <span className="essaim-ind-icone" aria-hidden="true">
            <Icone nom={iconeSante(i.etat)} taille={12} />
          </span>
          <span className="essaim-ind-cle">
            {libelleIndicateur(i.cle, t)}
            <span className="hs-visuellement-cache"> — {libelleSante(i.etat, t)}</span>
          </span>
          <span className="essaim-ind-constat">{i.constat}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      className="essaim-panneau"
      aria-labelledby={`${id}-titre`}
      aria-busy={occupe || undefined}
    >
      {entete}

      {/* Ce que la ruche ferait MAINTENANT. Le cœur du panneau. */}
      <div className={`essaim-maintenant ton-${tonPas(pas)}`}>
        <span className="essaim-maintenant-icone" aria-hidden="true">
          <Icone nom={iconePas(pas)} taille={16} />
        </span>
        <div className="essaim-maintenant-texte">
          <strong>{libellePas(pas, t)}</strong>
          <span className="essaim-motif">{phrase(etat.decision.motif)}</span>
        </div>
      </div>

      {/* CE QUE LA RUCHE FAIT DE CETTE DÉCISION — distinct du verdict, et
          dit juste dessous parce que c'est là qu'on le cherche. Sans ces
          lignes, l'écran annoncerait « délibérer » sans que rien ne se
          passe, et personne ne saurait s'il faut attendre ou s'inquiéter. */}
      {etat.runner && etat.runner.mode !== 'on' && (
        <p className="essaim-note">
          <Icone nom="eclair" taille={14} />
          <span>
            {t(
              'Simulation seulement : la décision est calculée, rien ne s’exécute tant que l’autonomie n’est pas branchée sur la Reine.',
              'Simulation only: the decision is computed, nothing runs until autonomy is enabled on the Queen.',
            )}
          </span>
        </p>
      )}
      {etat.runner?.enPause && (
        <p className="essaim-note ton-echec">
          <Icone nom="avertissement" taille={14} />
          <span>
            {t(
              `La ruche a renoncé à ce projet après ${etat.runner.echecs} échecs de suite. Choisis à nouveau un niveau ci-dessous pour la relancer.`,
              `The hive gave up on this project after ${etat.runner.echecs} consecutive failures. Pick a level again below to restart it.`,
            )}
          </span>
        </p>
      )}

      <PretPourAutonomie
        etat={etat}
        t={t}
        idTitre={`${id}-pret`}
        onInviter={() => gestes.ouvrirInvitation('machine')}
      />

      {cycles && cycles.length > 0 && (
        <section className="essaim-section" aria-labelledby={`${id}-cycles`}>
          <h4 id={`${id}-cycles`}>{t('Derniers cycles', 'Recent cycles')}</h4>
          <ul className="essaim-cycles">
            {cycles.map((c, i) => (
              <li key={`${c.ts}-${i}`}>
                <time dateTime={new Date(c.ts).toISOString()}>{timeShort(c.ts)}</time>
                <span className="essaim-cycle-pas">
                  {c.pas ? libellePas(c.pas as PasEssaim, t) : '?'}
                </span>
                <span className="essaim-cycle-issue">{libelleIssueCycle(c.issue, t)}</span>
                {c.detail ? (
                  <span className="essaim-cycle-detail" title={c.detail}>
                    {c.detail.length > 60 ? `${c.detail.slice(0, 60)}…` : c.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* La Dérive : ce qui rend une autonomie de plusieurs semaines
          défendable — la ruche sait reconnaître qu'elle se dégrade. AVANT les
          réglages : on ne propose pas de monter le niveau d'autonomie d'une
          ruche qui est en train de pourrir le projet. */}
      <section className="essaim-section" aria-labelledby={`${id}-sante`}>
        <div className="essaim-section-tete">
          <h4 id={`${id}-sante`}>{t('Santé du projet', 'Project health')}</h4>
          <span className={`essaim-etat ton-${tonSante(derive.etat)}`}>
            {libelleSante(derive.etat, t)}
          </span>
        </div>
        {noteSante && <p className="essaim-section-note">{noteSante}</p>}
        {derive.indicateurs.length > 0 &&
          (replierSante ? (
            // Rien ne va mal : les indicateurs se replient, à un clic. Ils
            // s'ouvrent d'eux-mêmes quand la santé est à surveiller ou dégradée.
            <details className="essaim-replie">
              <summary>
                {t(
                  `Voir les ${derive.indicateurs.length} indicateurs`,
                  `Show the ${derive.indicateurs.length} indicators`,
                )}
                <span className="essaim-etape-chevron" aria-hidden="true">
                  <Icone nom="chevronBas" taille={14} />
                </span>
              </summary>
              {indicateurs}
            </details>
          ) : (
            indicateurs
          ))}
      </section>

      {/* Les quatre niveaux, puis l'autorisation de fusionner — SÉPARÉE. */}
      <section className="essaim-section" aria-labelledby={`${id}-niveau`}>
        <h4 id={`${id}-niveau`}>{t('Niveau d’autonomie', 'Autonomy level')}</h4>
        <div className="essaim-niveaux" role="group" aria-labelledby={`${id}-niveau`}>
          {etat.niveaux.map((n) => (
            <button
              key={n}
              type="button"
              data-niveau={n}
              aria-pressed={etat.niveau === n}
              aria-disabled={occupe || undefined}
              className={etat.niveau === n ? 'essaim-niveau actif' : 'essaim-niveau'}
              title={descriptionNiveau(n, t)}
              onClick={() => void regler(n, etat.depotInscrit)}
            >
              {libelleNiveau(n, t)}
            </button>
          ))}
        </div>
        <p className="essaim-desc">{descriptionNiveau(etat.niveau, t)}</p>

        <label className="essaim-inscription">
          <input
            type="checkbox"
            checked={etat.depotInscrit}
            aria-disabled={occupe || undefined}
            onChange={(e) => void regler(etat.niveau, e.target.checked)}
          />
          <span className="essaim-inscription-textes">
            <strong>{t('Fusionner sans me redemander', 'Merge without asking me')}</strong>
            <span>
              {t(
                'J’autorise la ruche à fusionner sur ce dépôt, sans me redemander à chaque fois. Ne sert qu’au niveau Plein.',
                'I authorise the hive to merge into this repository, without asking me each time. Only used at the Full level.',
              )}
            </span>
          </span>
        </label>
        {etat.niveau === 'plein' && !etat.depotInscrit && (
          <p className="essaim-note ton-attention">
            <Icone nom="avertissement" taille={14} />
            <span>
              {t(
                'Niveau Plein sans dépôt autorisé : la ruche ouvrira les pull requests et les laissera t’attendre.',
                'Full level without an authorised repository: the hive will open pull requests and leave them waiting for you.',
              )}
            </span>
          </p>
        )}
      </section>

      {/* Ce que la ruche a appris des erreurs de ses membres. */}
      {etat.lecons.length > 0 && (
        <section className="essaim-section" aria-labelledby={`${id}-lecons`}>
          <h4 id={`${id}-lecons`}>{t('Ce que la ruche a appris', 'What the hive has learned')}</h4>
          {systemiques.length > 0 && (
            <p className="essaim-note ton-attention">
              <Icone nom="avertissement" taille={14} />
              <span>
                {t(
                  `${systemiques.length} erreur(s) vue(s) sur plusieurs machines : elles viennent du code, pas d’une machine.`,
                  `${systemiques.length} error(s) seen on several machines: they come from the code, not from one machine.`,
                )}
              </span>
            </p>
          )}
          <ul className="essaim-lecons">
            {etat.lecons.slice(0, 5).map((l) => (
              <li key={l.signature} className={`essaim-lecon essaim-lecon--${l.portee}`}>
                <span className="essaim-lecon-portee">
                  {l.portee === 'systemique' && (
                    <span className="essaim-lecon-alerte">
                      <Icone nom="avertissement" taille={12} />
                      <span className="hs-visuellement-cache">
                        {t('Vient du code : ', 'Comes from the code: ')}
                      </span>
                    </span>
                  )}
                  {l.portee === 'isolee' || l.noeuds <= 1
                    ? t('1 machine', '1 machine')
                    : t(`${l.noeuds} machines`, `${l.noeuds} machines`)}
                </span>
                <span className="essaim-lecon-extrait">{l.extrait}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ligneErreur}
    </section>
  );
}
