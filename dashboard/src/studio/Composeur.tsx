// La saisie principale de l'accueil — « Décris ta mission ou pose une question à tes agents ».
//
// ─── DEUX GESTES, DEUX CHEMINS RÉELS ─────────────────────────────────────────
//
//   · MISSION — le texte part à `POST /api/plan`, qui rend un DAG de tâches
//     SANS rien écrire. L'aperçu montre le plan, le projet visé, les agents
//     qui pourront le prendre et, s'il existe, le devis de La Balance. Rien ne
//     tourne avant « Lancer la mission » : c'est alors seulement que
//     `POST /api/projects/:id/tasks` crée les tâches, et que la Reine ouvre la
//     mission (`orchestrator/missions.ts`).
//   · QUESTION — le texte part à la Reine (`POST /api/chat`), contextualisé par
//     le projet actif ; la réponse s'écrit dans la conversation.
//
// Les suggestions ne lancent RIEN : elles remplissent un brouillon (#579).

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { addTasks, planBrief } from '../api';
import type { DevisPlan, NewTaskInput, PlanResponse } from '../api';
import { useLang, useT } from '../i18n';
import { extrairePiece } from '../reine-extraire';
import { demarrerEcoute, voixEcouteDisponible } from '../reine-voix';
import type { EtatEcoute, SessionEcoute } from '../reine-voix';
import {
  assemblerMessageReine,
  CHAT_QUESTION_MAX,
  expliquerAssemblage,
} from '../../../src/shared/reine-pieces.js';
import type { PieceJointeTexte } from '../../../src/shared/reine-pieces.js';
import type { Project } from '../../../src/shared/types';
import { formatDuree } from '../ui';
import { useGestes } from './gestes';
import { Icone } from './Icone';
import { ajouterBrief, CLES, ecrire, pref } from './preferences';

/** Limite de `POST /api/plan` (schéma du serveur). */
export const BRIEF_MAX = 4000;

export type ModeSaisie = 'mission' | 'question';

/**
 * Rend des identifiants UNIQUES au plan, et remappe ses dépendances. Les ids
 * du planificateur sont déterministes (`socle`, `tests`…) et la validation de
 * la Reine est globale : le deuxième plan d'une ruche serait refusé en
 * collision (même règle que l'atelier de la vue Projets).
 */
export function idsUniques(taches: readonly NewTaskInput[], suffixe: string): NewTaskInput[] {
  const renomme = new Map(
    taches.filter((t) => t.id).map((t) => [t.id!, `${t.id}-${suffixe}`] as const),
  );
  return taches.map((t) => ({
    ...t,
    ...(t.id ? { id: renomme.get(t.id) } : {}),
    ...(t.dependsOn ? { dependsOn: t.dependsOn.map((d) => renomme.get(d) ?? d) } : {}),
  }));
}

interface Props {
  projet: Project | null;
  /** Une IA réelle (non simulée) est en ligne. */
  iaEnLigne: boolean;
  /** Les libellés des IA en ligne, pour l'aperçu (« Claude Code · Codex »). */
  iasEnLigne: readonly string[];
  /** Machines simulées en ligne (la démo) : elles prennent les tâches, sans IA. */
  simulesEnLigne?: number;
  /** Envoie une question à la Reine ; rend `true` si elle a répondu. */
  poserQuestion: (message: string, affiche: string) => Promise<boolean>;
  questionEnCours: boolean;
  /** Appelé quand une mission vient d'être créée — l'accueil montre alors le plan. */
  onMissionLancee: (taches: readonly { id: string }[]) => void;
  /** Appelé quand une question part — l'accueil montre alors la conversation. */
  onQuestion: () => void;
}

type Etat = 'repos' | 'planification' | 'apercu' | 'lancement';

export function Composeur({
  projet,
  iaEnLigne,
  iasEnLigne,
  simulesEnLigne = 0,
  poserQuestion,
  questionEnCours,
  onMissionLancee,
  onQuestion,
}: Props) {
  const t = useT();
  const lang = useLang();
  const gestes = useGestes();
  const [mode, setMode] = useState<ModeSaisie>('mission');
  const [texte, setTexte] = useState('');
  const [etat, setEtat] = useState<Etat>('repos');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');
  const [pieces, setPieces] = useState<PieceJointeTexte[]>([]);
  const [ecoute, setEcoute] = useState<EtatEcoute>('inactif');
  const [voix] = useState(voixEcouteDisponible);
  const session = useRef<SessionEcoute | null>(null);
  const champ = useRef<HTMLTextAreaElement>(null);
  const fichier = useRef<HTMLInputElement>(null);

  // La hauteur suit le texte, de une à six lignes.
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [texte]);

  useEffect(() => () => session.current?.stop(), []);

  // Un brouillon déposé d'ailleurs (guide de démarrage, palette) : on le prend.
  useEffect(() => {
    const surBrouillon = (e: Event) => {
      const detail = (e as CustomEvent<{ texte: string; mode?: ModeSaisie }>).detail;
      if (!detail) return;
      setMode(detail.mode ?? 'mission');
      setTexte(detail.texte);
      setPlan(null);
      setEtat('repos');
      requestAnimationFrame(() => champ.current?.focus());
    };
    window.addEventListener(EVENT_BROUILLON, surBrouillon);
    return () => window.removeEventListener(EVENT_BROUILLON, surBrouillon);
  }, []);

  const max = mode === 'mission' ? BRIEF_MAX : CHAT_QUESTION_MAX;
  const vide = texte.trim() === '' && pieces.length === 0;
  const occupe = etat === 'planification' || etat === 'lancement' || questionEnCours;
  const sansProjet = mode === 'mission' && projet === null;

  const preparer = () => {
    if (!projet) return;
    setEtat('planification');
    setErreur(null);
    planBrief(texte.trim(), 'auto')
      .then((p) => {
        setPlan(p);
        setEtat('apercu');
        setAnnonce(
          t(
            `Plan proposé : ${p.tasks.length} tâche(s). Relis-le avant de lancer.`,
            `Proposed plan: ${p.tasks.length} task(s). Review it before launching.`,
          ),
        );
      })
      .catch((e: unknown) => {
        setEtat('repos');
        setErreur(
          t(
            `La Reine n’a pas pu découper cette mission : ${msg(e)}`,
            `The Queen could not plan this mission: ${msg(e)}`,
          ),
        );
      });
  };

  const lancer = () => {
    if (!projet || !plan) return;
    setEtat('lancement');
    setErreur(null);
    const taches = idsUniques(plan.tasks, Date.now().toString(36));
    const brief = texte.trim();
    addTasks(projet.id, taches)
      .then((creees) => {
        ecrire(
          CLES.briefs,
          JSON.stringify(
            ajouterBrief(
              pref.briefs(),
              creees.map((c) => c.id),
              brief,
            ),
          ),
        );
        setPlan(null);
        setTexte('');
        setEtat('repos');
        setAnnonce(
          t(
            `Mission lancée : ${creees.length} tâche(s) déposées dans « ${projet.name} ».`,
            `Mission launched: ${creees.length} task(s) added to “${projet.name}”.`,
          ),
        );
        onMissionLancee(creees);
        // Le plan replié emporte le bouton « Lancer » : le focus revient au
        // champ, prêt pour la suite — il tombait sur <body>.
        requestAnimationFrame(() => champ.current?.focus());
      })
      .catch((e: unknown) => {
        setEtat('apercu');
        setErreur(t(`Lancement refusé : ${msg(e)}`, `Launch rejected: ${msg(e)}`));
      });
  };

  const demander = () => {
    const assemble = assemblerMessageReine(texte, pieces);
    if (!assemble.ok) {
      setErreur(expliquerAssemblage(assemble.motif, lang));
      return;
    }
    const affiche =
      texte.trim() + (pieces.length > 0 ? `\n📎 ${pieces.map((p) => p.nom).join(', ')}` : '');
    setErreur(null);
    setTexte('');
    setPieces([]);
    onQuestion();
    void poserQuestion(assemble.message, affiche.trim());
  };

  const soumettre = () => {
    if (occupe || vide) return;
    if (texte.length > max) {
      setErreur(t(`Au plus ${max} caractères.`, `At most ${max} characters.`));
      return;
    }
    if (mode === 'mission') preparer();
    else demander();
  };

  const surTouche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      soumettre();
    }
  };

  const basculerEcoute = () => {
    if (ecoute === 'ecoute') {
      session.current?.stop();
      session.current = null;
      return;
    }
    const base = texte.trim() ? `${texte.trim()} ` : '';
    session.current = demarrerEcoute({
      lang: lang === 'en' ? 'en-US' : 'fr-FR',
      onEtat: setEcoute,
      onTexte: (dicte, final) => {
        if (final) setTexte((avant) => `${avant.trimEnd()} ${dicte.trim()}`.trim());
        else setTexte(`${base}${dicte}`);
      },
      onErreur: () => setErreur(t('La dictée s’est interrompue.', 'Dictation stopped.')),
    });
  };

  const joindre = async (liste: FileList | null) => {
    if (!liste) return;
    const lues = await Promise.all([...liste].map((f) => extrairePiece(f, lang)));
    setPieces((avant) => [...avant, ...lues].slice(0, 6));
    for (const p of lues) {
      if (p.refus) setErreur(`${p.nom} : ${p.refus}`);
    }
  };

  const placeholder =
    mode === 'mission'
      ? t(
          'Décris ta mission ou pose une question à tes agents…',
          'Describe your mission or ask your agents…',
        )
      : t('Pose ta question à la Reine…', 'Ask the Queen…');

  return (
    <div className="hs-composeur-zone">
      <form
        className={`hs-composeur${occupe ? ' occupe' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          soumettre();
        }}
        aria-label={t('Nouvelle mission', 'New mission')}
      >
        <span className="hs-composeur-icone" aria-hidden="true">
          <Icone nom="etincelles" taille={22} />
        </span>
        <label htmlFor="hs-saisie" className="hs-visuellement-cache">
          {mode === 'mission'
            ? t('Que veux-tu accomplir ?', 'What do you want to accomplish?')
            : t('Ta question à la Reine', 'Your question to the Queen')}
        </label>
        <textarea
          id="hs-saisie"
          ref={champ}
          rows={1}
          value={texte}
          maxLength={max + 200}
          placeholder={placeholder}
          onChange={(e) => {
            setTexte(e.target.value);
            if (etat === 'apercu') {
              // Le plan affiché ne correspond plus au texte : on le retire.
              setPlan(null);
              setEtat('repos');
            }
          }}
          onKeyDown={surTouche}
          disabled={etat === 'lancement'}
          aria-describedby="hs-saisie-aide"
        />
        <div className="hs-composeur-actions">
          {mode === 'question' && (
            <>
              <input
                ref={fichier}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void joindre(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="hs-icone-btn"
                onClick={() => fichier.current?.click()}
                aria-label={t('Joindre un document', 'Attach a document')}
                title={t(
                  'Joindre un document (texte, PDF, Word)',
                  'Attach a document (text, PDF, Word)',
                )}
              >
                <Icone nom="trombone" />
              </button>
            </>
          )}
          {voix && (
            <button
              type="button"
              className={`hs-icone-btn${ecoute === 'ecoute' ? ' actif' : ''}`}
              onClick={basculerEcoute}
              aria-pressed={ecoute === 'ecoute'}
              aria-label={
                ecoute === 'ecoute'
                  ? t('Arrêter la dictée', 'Stop dictation')
                  : t('Dicter', 'Dictate')
              }
              title={t('Dicter (micro du navigateur)', 'Dictate (browser microphone)')}
            >
              <Icone nom="micro" />
            </button>
          )}
          <button
            type="submit"
            className="hs-envoyer"
            disabled={occupe || vide || sansProjet}
            aria-label={
              mode === 'mission'
                ? t('Préparer la mission', 'Prepare the mission')
                : t('Envoyer la question', 'Send the question')
            }
            title={
              sansProjet
                ? t('Crée ou choisis d’abord un projet', 'Create or pick a project first')
                : undefined
            }
          >
            {occupe ? <span className="hs-rouet" aria-hidden="true" /> : <Icone nom="envoyer" />}
          </button>
        </div>
      </form>

      <div className="hs-composeur-pied" id="hs-saisie-aide">
        <div
          className="hs-segment"
          role="radiogroup"
          aria-label={t('Type de demande', 'Request type')}
        >
          {(['mission', 'question'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'actif' : undefined}
              onClick={() => {
                setMode(m);
                setPlan(null);
                setEtat('repos');
                setErreur(null);
              }}
            >
              {m === 'mission'
                ? t('Mission', 'Mission')
                : t('Question à la Reine', 'Ask the Queen')}
            </button>
          ))}
        </div>
        <span className="hs-composeur-indice">
          {mode === 'mission'
            ? projet
              ? t(
                  `Projet « ${projet.name} » · Entrée pour préparer le plan, rien ne part sans ta validation`,
                  `Project “${projet.name}” · Enter to prepare the plan, nothing runs without your approval`,
                )
              : t(
                  'Aucun projet : crée-en un pour lancer une mission',
                  'No project: create one to launch a mission',
                )
            : t(
                'Entrée pour envoyer · Maj+Entrée pour aller à la ligne',
                'Enter to send · Shift+Enter for a new line',
              )}
        </span>
        {texte.length > max * 0.8 && (
          <span className={`hs-compteur${texte.length > max ? ' depasse' : ''}`}>
            {texte.length}/{max}
          </span>
        )}
      </div>

      {pieces.length > 0 && (
        <ul className="hs-pieces" aria-label={t('Documents joints', 'Attached documents')}>
          {pieces.map((p, i) => (
            <li key={`${p.nom}-${i}`} className={p.refus ? 'refus' : undefined}>
              <Icone nom="fichier" taille={16} />
              <span>{p.nom}</span>
              <button
                type="button"
                className="hs-icone-btn petit"
                aria-label={t(`Retirer ${p.nom}`, `Remove ${p.nom}`)}
                onClick={() => setPieces((l) => l.filter((_, j) => j !== i))}
              >
                <Icone nom="croix" taille={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {sansProjet && (
        <div className="hs-alerte info" role="note">
          <p>
            {t(
              'Une mission travaille sur un projet : son dépôt, ses tâches, ses agents.',
              'A mission works on a project: its repository, tasks and agents.',
            )}
          </p>
          <button type="button" className="hs-btn primaire" onClick={gestes.nouveauProjet}>
            <Icone nom="plus" taille={16} /> {t('Créer un projet', 'Create a project')}
          </button>
        </div>
      )}

      {erreur && (
        <p className="hs-alerte erreur" role="alert">
          {erreur}
        </p>
      )}
      <p className="hs-visuellement-cache" aria-live="polite">
        {annonce}
      </p>

      {etat !== 'apercu' && etat !== 'lancement' && vide && !sansProjet && (
        <Suggestions mode={mode} />
      )}

      {plan && (etat === 'apercu' || etat === 'lancement') && projet && (
        <ApercuPlan
          plan={plan}
          projet={projet}
          iaEnLigne={iaEnLigne}
          iasEnLigne={iasEnLigne}
          simulesEnLigne={simulesEnLigne}
          enLancement={etat === 'lancement'}
          onLancer={lancer}
          onModifier={() => {
            setPlan(null);
            setEtat('repos');
            requestAnimationFrame(() => champ.current?.focus());
          }}
          onAnnuler={() => {
            setPlan(null);
            setTexte('');
            setEtat('repos');
          }}
        />
      )}
    </div>
  );
}

/** Dépose un brouillon dans la saisie de l'accueil, depuis n'importe où. */
export const EVENT_BROUILLON = 'hive:studio-brouillon';

export function deposerBrouillon(texte: string, mode: ModeSaisie = 'mission'): void {
  window.dispatchEvent(new CustomEvent(EVENT_BROUILLON, { detail: { texte, mode } }));
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Suggestions({ mode }: { mode: ModeSaisie }) {
  const t = useT();
  const [plus, setPlus] = useState(false);
  const liste =
    mode === 'mission'
      ? [
          {
            icone: 'etincelles' as const,
            libelle: t('Créer une fonctionnalité', 'Build a feature'),
            texte: t('Ajoute la fonctionnalité suivante : ', 'Add the following feature: '),
          },
          {
            icone: 'avertissement' as const,
            libelle: t('Corriger un bug', 'Fix a bug'),
            texte: t(
              'Corrige ce bug : … \nComportement observé : … \nComportement attendu : … \nAjoute un test qui le prouve.',
              'Fix this bug: … \nObserved behaviour: … \nExpected behaviour: … \nAdd a test that proves it.',
            ),
          },
          {
            icone: 'coche' as const,
            libelle: t('Écrire des tests', 'Write tests'),
            texte: t(
              'Écris des tests pour … puis lance la suite.',
              'Write tests for … then run the suite.',
            ),
          },
          {
            icone: 'recherche' as const,
            libelle: t('Auditer le code', 'Audit the code'),
            texte: t(
              'Analyse ce dépôt, identifie les bugs, propose les corrections et lance les tests.',
              'Analyse this repository, find the bugs, propose fixes and run the tests.',
            ),
          },
        ]
      : [
          {
            icone: 'activite' as const,
            libelle: t('Où en est le projet ?', 'How is the project doing?'),
            texte: t('Où en est le projet ?', 'How is the project doing?'),
          },
          {
            icone: 'horloge' as const,
            libelle: t('Que s’est-il passé cette nuit ?', 'What happened overnight?'),
            texte: t('Que s’est-il passé cette nuit ?', 'What happened overnight?'),
          },
          {
            icone: 'agents' as const,
            libelle: t('Quel agent travaille le mieux ?', 'Which agent works best?'),
            texte: t('Quel nœud travaille le mieux ?', 'Which node works best?'),
          },
          {
            icone: 'etincelles' as const,
            libelle: t('Aide-moi à écrire un brief', 'Help me write a brief'),
            texte: t('Aide-moi à écrire un bon brief', 'Help me write a good brief'),
          },
        ];
  const autres =
    mode === 'mission'
      ? [
          t('Optimise les performances de …', 'Optimise the performance of …'),
          t(
            'Documente le projet : README, installation, architecture.',
            'Document the project: README, setup, architecture.',
          ),
          t(
            'Prépare une livraison : changelog, version, vérifications.',
            'Prepare a release: changelog, version, checks.',
          ),
        ]
      : [];
  return (
    <div className="hs-suggestions" aria-label={t('Suggestions', 'Suggestions')}>
      {liste.map((s) => (
        <button
          key={s.libelle}
          type="button"
          className="hs-puce"
          onClick={() => deposerBrouillon(s.texte, mode)}
        >
          <Icone nom={s.icone} taille={16} />
          {s.libelle}
        </button>
      ))}
      {autres.length > 0 && (
        <div className="hs-suggestions-plus">
          <button
            type="button"
            className="hs-puce"
            aria-expanded={plus}
            aria-label={t('Autres suggestions', 'More suggestions')}
            onClick={() => setPlus((p) => !p)}
          >
            <Icone nom="plusPoints" taille={16} />
          </button>
          {plus && (
            <ul className="hs-menu" role="menu">
              {autres.map((a) => (
                <li key={a} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPlus(false);
                      deposerBrouillon(a, mode);
                    }}
                  >
                    {a}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ApercuPlan({
  plan,
  projet,
  iaEnLigne,
  iasEnLigne,
  simulesEnLigne = 0,
  enLancement,
  onLancer,
  onModifier,
  onAnnuler,
}: {
  plan: PlanResponse;
  projet: Project;
  iaEnLigne: boolean;
  iasEnLigne: readonly string[];
  /** Machines simulées en ligne (la démo) : elles prennent les tâches, sans IA. */
  simulesEnLigne?: number;
  enLancement: boolean;
  onLancer: () => void;
  onModifier: () => void;
  onAnnuler: () => void;
}) {
  const t = useT();
  const gestes = useGestes();
  const rang = new Map(plan.tasks.map((x, i) => [x.id ?? `#${i}`, i + 1]));
  return (
    <section className="hs-apercu" aria-labelledby="hs-apercu-titre">
      <header className="hs-apercu-tete">
        <div>
          <h2 id="hs-apercu-titre">
            {t(
              `Plan proposé — ${plan.tasks.length} tâche(s)`,
              `Proposed plan — ${plan.tasks.length} task(s)`,
            )}
          </h2>
          <p className="hs-discret">
            {plan.source === 'llm'
              ? t('Découpé par le modèle de la Reine', 'Split by the Queen’s model')
              : t('Découpage heuristique (sans IA)', 'Heuristic split (no AI)')}{' '}
            · {t('projet', 'project')} « {projet.name} »
          </p>
        </div>
        <div className="hs-apercu-actions">
          <button
            type="button"
            className="hs-btn fantome"
            onClick={onAnnuler}
            disabled={enLancement}
          >
            {t('Annuler', 'Cancel')}
          </button>
          <button type="button" className="hs-btn" onClick={onModifier} disabled={enLancement}>
            {t('Modifier', 'Edit')}
          </button>
          <button
            type="button"
            className="hs-btn primaire"
            onClick={enLancement ? undefined : onLancer}
            aria-disabled={enLancement}
          >
            {enLancement
              ? t('Lancement…', 'Launching…')
              : t('Lancer la mission', 'Launch the mission')}
            <Icone nom="fleche" taille={16} />
          </button>
        </div>
      </header>
      <ol className="hs-apercu-liste">
        {plan.tasks.map((x, i) => (
          <li key={x.id ?? i}>
            <span className="hs-rang">{i + 1}</span>
            <div>
              <strong>{x.title}</strong>
              <p>{x.prompt.length > 220 ? `${x.prompt.slice(0, 220)}…` : x.prompt}</p>
              {x.dependsOn && x.dependsOn.length > 0 && (
                <span className="hs-discret">
                  {t('après', 'after')}{' '}
                  {x.dependsOn.map((d) => `#${rang.get(d) ?? '?'}`).join(', ')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {plan.note && <p className="hs-discret">{plan.note}</p>}
      <Devis devis={plan.devis} />
      {iaEnLigne ? (
        <p className="hs-apercu-agents">
          <span className="hs-point ok" aria-hidden="true" />
          {t('Prêt à être pris par', 'Ready to be picked up by')} {iasEnLigne.join(' · ')}
        </p>
      ) : (
        <div className="hs-alerte attention" role="note">
          <p>
            {simulesEnLigne > 0
              ? t(
                  `Aucune IA réelle en ligne : ${simulesEnLigne} machine(s) simulée(s) prendront ces tâches et rendront des résultats d’exemple, sans IA.`,
                  `No real AI online: ${simulesEnLigne} simulated machine(s) will take these tasks and return sample results, without AI.`,
                )
              : t(
                  'Aucune IA n’est en ligne : les tâches seront créées et attendront qu’un agent se connecte.',
                  'No AI is online: tasks will be created and wait for an agent to connect.',
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
      )}
    </section>
  );
}

/** Le devis de La Balance — dit « estimé », et tu quand il n'existe pas. */
function Devis({ devis }: { devis: DevisPlan | null | undefined }) {
  const t = useT();
  if (!devis) return null;
  const echantillon = Math.min(...devis.parTache.map((d) => d.echantillon));
  return (
    <p className="hs-discret">
      <Icone nom="horloge" taille={14} /> {t('Temps machine estimé', 'Estimated machine time')} : ~
      {formatDuree(devis.totalMedianeMs)} ({t('médiane', 'median')}), {t('jusqu’à', 'up to')}{' '}
      {formatDuree(devis.totalP90Ms)} (p90) —{' '}
      {t(
        `d’après au moins ${echantillon} tâches comparables`,
        `from at least ${echantillon} comparable tasks`,
      )}
    </p>
  );
}
