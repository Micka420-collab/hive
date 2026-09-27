// « Pas ce modèle-là pour cette tâche » — la consigne de routage de
// l'opérateur, dans le tiroir d'une tâche.
//
// Elle se LIT pour tout le monde et se POSE par qui répond du projet
// (propriétaire, administrateur, jeton sur un projet orphelin) : un membre qui
// essaie reçoit le refus de la Reine, affiché tel quel. Ce que la consigne
// fait est dit à côté du formulaire — une exclusion dure, qui ne touche aucun
// score appris — pour qu'on ne la prenne pas pour un réglage de l'Aiguillage.
//
// Les choix proposés viennent des ouvrières CONNUES de la ruche (familles et
// modèles déclarés) : une consigne sur un nom que personne n'offre ne
// routerait nulle part. Si aucune ouvrière en ligne ne la satisfait,
// l'écran le dit — c'est la règle même de l'ordonnanceur (`offreSousConsigne`).

import { useEffect, useMemo, useState } from 'react';
import { fetchConsigneRoutage, poserConsigneRoutage } from './api';
import type { ConsigneRoutageRangee } from './api';
import { useT } from './i18n';
import { offreSousConsigne } from '../../src/shared/consigne-routage';
import type { ConsigneRoutage } from '../../src/shared/consigne-routage';
import type { HiveNode, Task } from '../../src/shared/types';

interface Props {
  task: Task;
  nodes: readonly HiveNode[];
}

/** La consigne en une phrase, pour la lecture. */
function direConsigne(c: ConsigneRoutage, t: ReturnType<typeof useT>): string {
  const morceaux: string[] = [];
  if (c.agent) morceaux.push(t(`agent imposé : ${c.agent}`, `agent pinned: ${c.agent}`));
  if (c.modele) morceaux.push(t(`modèle imposé : ${c.modele}`, `model pinned: ${c.modele}`));
  if (c.sansAgents?.length) {
    const noms = c.sansAgents.join(', ');
    morceaux.push(t(`agents exclus : ${noms}`, `agents excluded: ${noms}`));
  }
  if (c.sansModeles?.length) {
    const noms = c.sansModeles.join(', ');
    morceaux.push(t(`modèles exclus : ${noms}`, `models excluded: ${noms}`));
  }
  return morceaux.join(' · ');
}

const trie = (valeurs: Iterable<string>): string[] =>
  [...new Set(valeurs)].sort((a, b) => a.localeCompare(b));

export function ConsigneRoutageTache({ task, nodes }: Props) {
  const t = useT();
  const [rangee, setRangee] = useState<ConsigneRoutageRangee | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [agent, setAgent] = useState('');
  const [modele, setModele] = useState('');
  const [sansAgents, setSansAgents] = useState<string[]>([]);
  const [sansModeles, setSansModeles] = useState<string[]>([]);

  const familles = useMemo(() => trie(nodes.map((n) => n.agentType)), [nodes]);
  const modeles = useMemo(() => trie(nodes.flatMap((n) => n.modeles ?? [])), [nodes]);

  const remplir = (c: ConsigneRoutage | null): void => {
    setAgent(c?.agent ?? '');
    setModele(c?.modele ?? '');
    setSansAgents(c?.sansAgents ?? []);
    setSansModeles(c?.sansModeles ?? []);
  };

  useEffect(() => {
    let vivant = true;
    setErreur(null);
    fetchConsigneRoutage(task.id)
      .then((r) => {
        if (!vivant) return;
        setRangee(r);
        remplir(r.consigne);
      })
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [task.id]);

  const brouillon: ConsigneRoutage = {
    ...(agent ? { agent } : {}),
    ...(modele ? { modele } : {}),
    ...(sansAgents.length > 0 ? { sansAgents } : {}),
    ...(sansModeles.length > 0 ? { sansModeles } : {}),
  };
  const vide = Object.keys(brouillon).length === 0;
  const actuelle = rangee?.consigne ?? null;
  const enLigne = nodes.filter((n) => n.status === 'online');
  const insatisfaite = actuelle !== null && offreSousConsigne(enLigne, actuelle).length === 0;

  const envoyer = async (consigne: ConsigneRoutage | null): Promise<void> => {
    setOccupe(true);
    setErreur(null);
    try {
      const r = await poserConsigneRoutage(task.id, consigne);
      setRangee(r);
      remplir(r.consigne);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  const basculer = (liste: string[], nom: string, poser: (l: string[]) => void): void =>
    poser(liste.includes(nom) ? liste.filter((x) => x !== nom) : [...liste, nom]);

  return (
    <section
      className="routage-panel"
      aria-labelledby="consigne-routage-title"
      data-testid="consigne-routage"
    >
      <h3 id="consigne-routage-title">{t('Consigne de routage', 'Routing constraint')}</h3>
      <p className="muted" data-testid="consigne-routage-actuelle">
        {actuelle
          ? t(
              `Forcée par l’opérateur — ${direConsigne(actuelle, t)}.`,
              `Forced by the operator — ${direConsigne(actuelle, t)}.`,
            )
          : t('Aucune : l’Aiguillage choisit seul.', 'None: the router decides alone.')}
      </p>
      {insatisfaite && (
        <p className="modal-error" role="status" data-testid="consigne-routage-insatisfaite">
          {t(
            'Aucune ouvrière en ligne ne respecte cette consigne : la tâche attendra qu’il y en ait une.',
            'No online worker satisfies this constraint: the task will wait for one.',
          )}
        </p>
      )}
      {rangee?.effet === 'prochaine_affectation' && (
        <p className="muted">
          {t(
            'La tâche est déjà partie : la consigne vaudra pour sa prochaine affectation.',
            'The task has already started: the constraint applies to its next assignment.',
          )}
        </p>
      )}
      <p className="muted">
        {t(
          'Une exclusion dure, prioritaire sur les préférences et les courses de drones. Elle ne touche aucun score appris : le classement consigné reste celui de l’Aiguillage.',
          'A hard exclusion, above preferences and drone races. It touches no learned score: the recorded ranking stays the router’s own.',
        )}
      </p>
      <div className="consigne-routage-form">
        <label>
          {t('Imposer l’agent', 'Pin the agent')}{' '}
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            data-testid="consigne-agent"
          >
            <option value="">—</option>
            {familles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          {t('Imposer le modèle', 'Pin the model')}{' '}
          <select
            value={modele}
            onChange={(e) => setModele(e.target.value)}
            data-testid="consigne-modele"
          >
            <option value="">—</option>
            {modeles.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {familles.length > 0 && (
          <fieldset>
            <legend>{t('Exclure les agents', 'Exclude agents')}</legend>
            {familles.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={sansAgents.includes(f)}
                  onChange={() => basculer(sansAgents, f, setSansAgents)}
                />{' '}
                {f}
              </label>
            ))}
          </fieldset>
        )}
        {modeles.length > 0 && (
          <fieldset>
            <legend>{t('Exclure les modèles', 'Exclude models')}</legend>
            {modeles.map((m) => (
              <label key={m}>
                <input
                  type="checkbox"
                  checked={sansModeles.includes(m)}
                  onChange={() => basculer(sansModeles, m, setSansModeles)}
                />{' '}
                {m}
              </label>
            ))}
          </fieldset>
        )}
        <button
          className="btn"
          onClick={() => void envoyer(brouillon)}
          disabled={occupe || vide}
          data-testid="consigne-poser"
        >
          {t('Poser la consigne', 'Set the constraint')}
        </button>{' '}
        {actuelle && (
          <button
            className="chip"
            onClick={() => void envoyer(null)}
            disabled={occupe}
            data-testid="consigne-lever"
          >
            {t('Lever la consigne', 'Lift the constraint')}
          </button>
        )}
      </div>
      {erreur && (
        <p className="modal-error" role="status">
          {erreur}
        </p>
      )}
    </section>
  );
}
